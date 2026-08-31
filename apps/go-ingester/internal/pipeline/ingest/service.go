package ingest

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"sync"
	"time"

	"go-ingester/infra/events"
	"go-ingester/infra/mast"
	"go-ingester/infra/storage"
	"go-ingester/internal/config"
	"go-ingester/internal/control"
	"go-ingester/internal/model"
	"go-ingester/internal/observer"
	"go-ingester/internal/pipeline/catalog"
	"go-ingester/internal/pipeline/checkpoint"
	"go-ingester/internal/pipeline/lifecycle"
	"go-ingester/internal/pipeline/plan"

	"github.com/google/uuid"
)

// Service is the single ingestion workflow: plan resolution, capacity safety,
// checkpoint recovery, event connection, then bounded data-plane execution.
type Service struct {
	cfg     *config.Config
	log     *slog.Logger
	metrics *observer.Metrics
}

func NewService(cfg *config.Config, log *slog.Logger, metrics *observer.Metrics) *Service {
	if log == nil {
		log = slog.Default()
	}
	return &Service{cfg: cfg, log: log, metrics: metrics}
}

func (s *Service) Run(ctx context.Context, command control.Command) error {
	if s.cfg == nil {
		return fmt.Errorf("ingestion configuration is required")
	}

	minioClient, err := storage.NewMinIOClient(s.cfg.MinIO.Endpoint, s.cfg.MinIO.AccessKey, s.cfg.MinIO.SecretKey)
	if err != nil {
		return fmt.Errorf("create Bronze storage client: %w", err)
	}
	preferredTICs, toiSnapshotID, toiRows, err := catalog.SyncTOI(ctx, minioClient, s.cfg.MinIO.Bucket)
	if err != nil {
		catalog.ReportFailure(ctx, minioClient, s.cfg.MinIO.Bucket, "DOWNLOADING_TOI", err)
		return fmt.Errorf("sync shared TOI catalog: %w", err)
	}
	manifest, manifestRef, discoveredProducts, err := s.resolveManifest(ctx, command, preferredTICs, minioClient)
	if err != nil {
		reportManifestFailure(ctx, minioClient, s.cfg.MinIO.Bucket, "BUILDING_MANIFEST", err)
		return err
	}
	ticIDs := make([]int64, 0, len(manifest.Samples))
	for _, sample := range manifest.Samples {
		ticIDs = append(ticIDs, sample.TICID)
	}
	writeManifestProgress(ctx, minioClient, s.cfg.MinIO.Bucket, manifestProgress{
		State:              "RUNNING",
		Stage:              "PINNING_CATALOG_SNAPSHOTS",
		Completed:          4,
		DiscoveredProducts: discoveredProducts,
		PairedSamples:      manifest.Statistics.PairedCount,
		SelectedSamples:    len(manifest.Samples),
		PrioritySamples:    countPreferredSamples(manifest, preferredTICs),
	})
	ticSnapshotID, err := catalog.SyncTIC(ctx, minioClient, s.cfg.MinIO.Bucket, ticIDs, toiSnapshotID, toiRows)
	if err != nil {
		catalog.ReportFailure(ctx, minioClient, s.cfg.MinIO.Bucket, "DOWNLOADING_TIC", err)
		reportManifestFailure(ctx, minioClient, s.cfg.MinIO.Bucket, "PINNING_CATALOG_SNAPSHOTS", err)
		return fmt.Errorf("sync shared TIC catalog: %w", err)
	}
	manifest.CatalogSnapshots = map[string]string{"TIC": ticSnapshotID, "TOI": toiSnapshotID}
	writeManifestProgress(ctx, minioClient, s.cfg.MinIO.Bucket, manifestProgress{
		State:              "COMPLETED",
		Stage:              "MANIFEST_READY",
		Completed:          5,
		DiscoveredProducts: discoveredProducts,
		PairedSamples:      manifest.Statistics.PairedCount,
		SelectedSamples:    len(manifest.Samples),
		PrioritySamples:    countPreferredSamples(manifest, preferredTICs),
		CatalogSnapshots:   manifest.CatalogSnapshots,
	})
	capacity, err := lifecycle.NewManager(minioClient, s.cfg.MinIO.Bucket, lifecycle.Policy{
		MaxBytes:           s.cfg.Bronze.MaxBytes,
		HighWatermarkBytes: s.cfg.Bronze.HighWatermarkBytes,
		LowWatermarkBytes:  s.cfg.Bronze.LowWatermarkBytes,
	}, s.log)
	if err != nil {
		return fmt.Errorf("create Bronze lifecycle policy: %w", err)
	}
	// Do not preflight the complete manifest here. A full sector is intentionally
	// larger than the bounded Bronze window; the data plane admits one product
	// at a time and pauses for safe lifecycle eviction when it reaches capacity.
	capacityGate := &rollingCapacityGate{manager: capacity, log: s.log, retryEvery: 5 * time.Second}

	checkpoints := checkpoint.NewStore(minioClient, s.cfg.MinIO.Bucket)
	manager, err := s.openCheckpoint(ctx, checkpoints, manifest, manifestRef, command)
	if err != nil {
		return err
	}

	publisher, err := events.NewNATSPublisher(s.cfg.NATS.URL, 5*time.Second)
	if err != nil {
		return fmt.Errorf("connect JetStream publisher: %w", err)
	}
	defer publisher.Close()

	pipeline := NewPipeline(
		Dependencies{
			Source:      s.newMASTClient(),
			Storage:     minioClient,
			Publisher:   publisher,
			Checkpoints: manager,
		},
		Options{
			Bucket:             s.cfg.MinIO.Bucket,
			WorkerCount:        command.Concurrency,
			CheckpointInterval: s.cfg.Ingest.CheckpointInterval,
			CapacityGate:       capacityGate,
			Metrics:            s.metrics,
			Logger:             s.log,
		},
	)

	summary, _, err := pipeline.IngestManifest(ctx, manifest)
	if err != nil {
		return fmt.Errorf("ingest manifest: %w", err)
	}
	if summary.FailedCount > 0 {
		return fmt.Errorf("ingestion completed with %d failed products", summary.FailedCount)
	}
	return nil
}

type rollingCapacityGate struct {
	manager    *lifecycle.Manager
	log        *slog.Logger
	retryEvery time.Duration
	mu         sync.Mutex
	reserved   int64
}

func (g *rollingCapacityGate) Acquire(ctx context.Context, expectedBytes int64) (func(), error) {
	if g.manager == nil || expectedBytes <= 0 {
		return func() {}, nil
	}
	for {
		g.mu.Lock()
		err := g.manager.CheckProjectedCapacity(ctx, expectedBytes+g.reserved)
		if err == nil {
			g.reserved += expectedBytes
			g.mu.Unlock()
			var once sync.Once
			return func() { once.Do(func() { g.mu.Lock(); g.reserved -= expectedBytes; g.mu.Unlock() }) }, nil
		}
		g.mu.Unlock()
		if !errors.Is(err, lifecycle.ErrStoragePressure) {
			return nil, err
		}
		if g.log != nil {
			g.log.Info("ingest: Bronze window full; waiting for Silver lineage before continuing",
				slog.Int64("next_product_bytes", expectedBytes),
				slog.Duration("retry_after", g.retryEvery),
			)
		}
		timer := time.NewTimer(g.retryEvery)
		select {
		case <-ctx.Done():
			timer.Stop()
			return nil, ctx.Err()
		case <-timer.C:
		}
	}
}

func (s *Service) resolveManifest(ctx context.Context, command control.Command, preferredTICs map[int64]struct{}, store *storage.MinIOClient) (*model.Manifest, string, int, error) {
	writeManifestProgress(ctx, store, s.cfg.MinIO.Bucket, manifestProgress{
		State: "RUNNING", Stage: "DISCOVERING_MAST_PRODUCTS", Completed: 0,
	})
	if command.ManifestPath != "" {
		manifest, err := plan.Read(command.ManifestPath)
		if err != nil {
			return nil, "", 0, fmt.Errorf("read manifest: %w", err)
		}
		writeManifestProgress(ctx, store, s.cfg.MinIO.Bucket, manifestProgress{
			State: "RUNNING", Stage: "MANIFEST_SELECTED", Completed: 4,
			PairedSamples: manifest.Statistics.PairedCount, SelectedSamples: len(manifest.Samples),
			PrioritySamples: countPreferredSamples(manifest, preferredTICs),
		})
		return manifest, command.ManifestPath, len(manifest.Samples) * 2, nil
	}

	products, err := mast.DiscoverTESS(ctx, s.newMASTClient(), mast.DiscoverOptions{
		Sector:   command.Sector,
		Limit:    command.Limit,
		PageSize: s.cfg.MAST.PageSize,
	}, s.log)
	if err != nil {
		return nil, "", 0, fmt.Errorf("discover TESS products: %w", err)
	}
	writeManifestProgress(ctx, store, s.cfg.MinIO.Bucket, manifestProgress{
		State: "RUNNING", Stage: "PAIRING_TPF_AND_LIGHT_CURVE", Completed: 1,
		DiscoveredProducts: len(products),
	})
	manifest, err := plan.Build(products, plan.SelectOptions{MaxSamples: command.Limit, PreferredTICIDs: preferredTICs})
	if err != nil {
		return nil, "", len(products), fmt.Errorf("build research-ready manifest: %w", err)
	}
	writeManifestProgress(ctx, store, s.cfg.MinIO.Bucket, manifestProgress{
		State: "RUNNING", Stage: "TOI_PRIORITY_APPLIED", Completed: 3,
		DiscoveredProducts: len(products), PairedSamples: manifest.Statistics.PairedCount,
		SelectedSamples: len(manifest.Samples), PrioritySamples: countPreferredSamples(manifest, preferredTICs),
	})
	return manifest, manifestReference(command), len(products), nil
}

func countPreferredSamples(manifest *model.Manifest, preferredTICs map[int64]struct{}) int {
	if manifest == nil || len(preferredTICs) == 0 {
		return 0
	}
	count := 0
	for _, sample := range manifest.Samples {
		if _, preferred := preferredTICs[sample.TICID]; preferred {
			count++
		}
	}
	return count
}

func (s *Service) openCheckpoint(ctx context.Context, store *checkpoint.Store, manifest *model.Manifest, manifestRef string, command control.Command) (*checkpoint.Manager, error) {
	manifestHash, err := checkpoint.ManifestHash(manifest)
	if err != nil {
		return nil, fmt.Errorf("hash manifest: %w", err)
	}
	if !command.Fresh {
		current, exists, err := store.LoadCurrent(ctx)
		if err != nil {
			return nil, fmt.Errorf("load current checkpoint: %w", err)
		}
		if exists && current != nil {
			if command.Resume || current.ManifestHash == manifestHash {
				return checkpoint.NewManager(store, current), nil
			}
			manager := checkpoint.NewManager(store, newCheckpoint(manifestRef, manifestHash, manifest))
			manager.SetPreviousCheckpoint(current)
			return manager, nil
		}
	}
	return checkpoint.NewManager(store, newCheckpoint(manifestRef, manifestHash, manifest)), nil
}

func (s *Service) newMASTClient() *mast.Client {
	return mast.NewClient(s.cfg.MAST.APIURL, s.cfg.MAST.Timeout)
}

func newCheckpoint(manifestRef, manifestHash string, manifest *model.Manifest) *model.Checkpoint {
	return checkpoint.NewInitial(
		"ingest-"+uuid.NewString()[:8],
		manifestRef,
		manifestHash,
		plan.SampleProducts(manifest),
	)
}

func manifestReference(command control.Command) string {
	limit := "all"
	if command.Limit > 0 {
		limit = fmt.Sprintf("%d", command.Limit)
	}
	return fmt.Sprintf("remote:tess/sector=%d/limit=%s", command.Sector, limit)
}
