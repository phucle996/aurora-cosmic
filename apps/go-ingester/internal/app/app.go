package app

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"

	eventsinfra "go-ingester/infra/events"
	"go-ingester/infra/mast"
	storageinfra "go-ingester/infra/storage"
	"go-ingester/internal/config"
	"go-ingester/internal/model"
	"go-ingester/internal/observer"
	"go-ingester/internal/pipeline/checkpoint"
	"go-ingester/internal/pipeline/ingest"
	"go-ingester/internal/pipeline/plan"

	"github.com/google/uuid"
)

func Run(ctx context.Context, cfg *config.Config, log *slog.Logger, metrics *observer.Metrics) error {
	log.Info("Ingester service runner started",
		slog.Int("concurrency", cfg.Ingest.Concurrency),
		slog.String("minio", cfg.MinIO.Endpoint),
		slog.String("nats", cfg.NATS.URL),
	)

	control := newControlServer(cfg, log, metrics)
	if err := control.Start(); err != nil {
		return err
	}
	defer control.Shutdown(context.Background())
	<-ctx.Done()
	log.Info("Shutdown signal received, stopping ingestion tasks...")
	return nil
}

type ControlStartRequest struct {
	ManifestPath string `json:"manifest_path"`
	Sector       int    `json:"sector"`
	Limit        int    `json:"limit"`
	Concurrency  int    `json:"concurrency"`
	Resume       bool   `json:"resume"`
	Fresh        bool   `json:"fresh"`
}

type controlServer struct {
	cfg     *config.Config
	log     *slog.Logger
	metrics *observer.Metrics
	server  *http.Server
	mu      sync.Mutex
	active  *controlRun
}

type controlRun struct {
	ID           string    `json:"job_id"`
	Status       string    `json:"status"`
	ManifestPath string    `json:"manifest_path,omitempty"`
	Sector       int       `json:"sector,omitempty"`
	StartedAt    time.Time `json:"started_at"`
	UpdatedAt    time.Time `json:"updated_at"`
	Error        string    `json:"error,omitempty"`
	cancel       context.CancelFunc
}

func newControlServer(cfg *config.Config, log *slog.Logger, metrics *observer.Metrics) *controlServer {
	return &controlServer{cfg: cfg, log: log, metrics: metrics}
}

func (s *controlServer) Start() error {
	mux := http.NewServeMux()
	mux.HandleFunc("/healthz", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
		_, _ = w.Write([]byte("ok\n"))
	})
	mux.HandleFunc("/api/v1/ingest/jobs", s.jobs)
	mux.HandleFunc("/api/v1/ingest/jobs/", s.jobAction)
	s.server = &http.Server{Addr: s.cfg.Control.Addr, Handler: mux, ReadHeaderTimeout: 5 * time.Second}
	listener, err := net.Listen("tcp", s.cfg.Control.Addr)
	if err != nil {
		return fmt.Errorf("ingest control listen %s: %w", s.cfg.Control.Addr, err)
	}
	go func() { _ = s.server.Serve(listener) }()
	return nil
}

func (s *controlServer) Shutdown(ctx context.Context) error {
	if s.server == nil {
		return nil
	}
	return s.server.Shutdown(ctx)
}

func (s *controlServer) jobs(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodGet {
		s.mu.Lock()
		var run *controlRun
		if s.active != nil {
			copy := *s.active
			copy.cancel = nil
			run = &copy
		}
		s.mu.Unlock()
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		if run == nil {
			_ = json.NewEncoder(w).Encode(map[string]string{"status": "not_observed"})
		} else {
			_ = json.NewEncoder(w).Encode(run)
		}
		return
	}
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var request ControlStartRequest
	if json.NewDecoder(r.Body).Decode(&request) != nil {
		http.Error(w, "invalid request", http.StatusBadRequest)
		return
	}
	if request.ManifestPath == "" && request.Sector <= 0 {
		http.Error(w, "manifest_path or sector is required", http.StatusBadRequest)
		return
	}
	if request.Limit <= 0 {
		request.Limit = 10
	}
	if request.Concurrency <= 0 {
		request.Concurrency = s.cfg.Ingest.Concurrency
	}
	s.mu.Lock()
	if s.active != nil && s.active.Status == "running" {
		s.mu.Unlock()
		http.Error(w, "an ingest job is already running", http.StatusConflict)
		return
	}
	ctx, cancel := context.WithCancel(context.Background())
	run := &controlRun{ID: "ingest-job-" + uuid.NewString()[:8], Status: "running", ManifestPath: request.ManifestPath, Sector: request.Sector, StartedAt: time.Now().UTC(), UpdatedAt: time.Now().UTC(), cancel: cancel}
	s.active = run
	s.mu.Unlock()
	go func() {
		var manifest *model.Manifest
		var err error
		manifestPath := request.ManifestPath
		if manifestPath != "" {
			manifest, err = plan.Read(manifestPath)
		} else {
			timeout, parseErr := time.ParseDuration(s.cfg.MAST.Timeout)
			if parseErr != nil {
				timeout = 30 * time.Second
			}
			results, discoverErr := mast.DiscoverTESS(ctx, mast.NewClient(s.cfg.MAST.APIURL, timeout), mast.DiscoverOptions{Sector: request.Sector, Limit: request.Limit, PageSize: s.cfg.MAST.PageSize}, s.log)
			if discoverErr != nil {
				err = discoverErr
			} else {
				manifest, err = plan.Build(results, model.SelectOptions{IncludeTPF: s.cfg.Manifest.IncludeTPF, IncludeLC: s.cfg.Manifest.IncludeLC, IncludeFFI: s.cfg.Manifest.IncludeFFI, RequirePair: s.cfg.Manifest.RequirePair, MaxSamples: request.Limit})
				manifestPath = fmt.Sprintf("remote:tess/sector=%d/limit=%d", request.Sector, request.Limit)
			}
		}
		if err == nil {
			accessKey := os.Getenv("MINIO_ACCESS_KEY")
			if accessKey == "" {
				accessKey = "minioadmin"
			}
			secretKey := os.Getenv("MINIO_SECRET_KEY")
			if secretKey == "" {
				secretKey = "minioadmin"
			}
			var mc *storageinfra.MinIOClient
			mc, err = storageinfra.NewMinIOClient(s.cfg.MinIO.Endpoint, accessKey, secretKey)
			if err == nil {
				cpStore := checkpoint.NewStore(mc, s.cfg.MinIO.Bucket)
				var cpManager *checkpoint.Manager
				manifestHash := model.ComputeManifestHash(manifest)
				if !request.Fresh {
					existing, exists, loadErr := cpStore.LoadCurrent(ctx)
					if loadErr == nil && exists && existing != nil && (existing.ManifestHash == manifestHash || request.Resume) {
						cpManager = checkpoint.NewManager(cpStore, existing)
					}
				}
				if cpManager == nil {
					cpManager = checkpoint.NewManager(cpStore, model.CreateNewInitialCheckpoint("ingest-"+uuid.NewString()[:8], manifestPath, manifestHash, manifest.Products()))
				}
				publisher, pubErr := eventsinfra.NewNATSPublisher(s.cfg.NATS.URL, 5*time.Second)
				if pubErr != nil {
					s.log.Warn("nats publisher unavailable", slog.Any("error", pubErr))
				}
				if publisher != nil {
					defer publisher.Close()
				}
				timeout, parseErr := time.ParseDuration(s.cfg.MAST.Timeout)
				if parseErr != nil {
					timeout = 30 * time.Second
				}
				pipeline := ingest.NewPipeline(mast.NewClient(s.cfg.MAST.APIURL, timeout), mc, publisher, cpManager, s.cfg.MinIO.Bucket, request.Concurrency, s.log)
				pipeline.SetObserver(s.metrics)
				pipeline.SetCheckpointInterval(s.cfg.Ingest.CheckpointInterval)
				pipeline.SetMaxRunBytes(s.cfg.Bronze.MaxBytes)
				summary, _, pipelineErr := pipeline.IngestManifest(ctx, manifest, false)
				err = pipelineErr
				if err == nil && summary.FailedCount > 0 {
					err = fmt.Errorf("ingestion completed with %d failures", summary.FailedCount)
				}
			}
		}
		s.mu.Lock()
		defer s.mu.Unlock()
		run.UpdatedAt = time.Now().UTC()
		if errors.Is(err, context.Canceled) || ctx.Err() != nil {
			run.Status = "canceled"
		} else if err != nil {
			run.Status, run.Error = "failed", err.Error()
		} else {
			run.Status = "completed"
		}
	}()
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusAccepted)
	_ = json.NewEncoder(w).Encode(run)
}

func (s *controlServer) jobAction(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	id := strings.Trim(strings.TrimSuffix(strings.TrimPrefix(r.URL.Path, "/api/v1/ingest/jobs/"), "/cancel"), "/")
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.active == nil || s.active.ID != id {
		http.Error(w, "ingest job not found", http.StatusNotFound)
		return
	}
	if !strings.HasSuffix(r.URL.Path, "/cancel") {
		http.Error(w, "unsupported action", http.StatusNotFound)
		return
	}
	if s.active.Status == "running" {
		s.active.cancel()
		s.active.Status = "cancelling"
		s.active.UpdatedAt = time.Now().UTC()
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusAccepted)
	_ = json.NewEncoder(w).Encode(s.active)
}
