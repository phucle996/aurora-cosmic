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
	runtime *observer.IngestRuntimeObserver
}

func NewService(cfg *config.Config, log *slog.Logger, metrics *observer.Metrics, runtimes ...*observer.IngestRuntimeObserver) *Service {
	if log == nil {
		log = slog.Default()
	}
	var runtime *observer.IngestRuntimeObserver
	if len(runtimes) > 0 {
		runtime = runtimes[0]
	}
	return &Service{cfg: cfg, log: log, metrics: metrics, runtime: runtime}
}

func (s *Service) Run(ctx context.Context, command control.Command) (runErr error) {
	defer func() {
		event := observer.IngestRuntimeEvent{JobID: command.JobID, Status: "completed"}
		switch {
		case ctx.Err() != nil:
			event.Status = "canceled"
		case runErr != nil:
			event.Status = "failed"
			event.Error = runErr.Error()
		case drainRequested(command.Drain):
			event.Status = "stopped"
		}
		s.runtime.Publish(event)
	}()
	if s.cfg == nil {
		return fmt.Errorf("ingestion configuration is required")
	}
	s.publishPlanning(command, "PREPARING_BRONZE_STORAGE", 0, 5)

	minioClient, err := storage.NewMinIOClient(s.cfg.MinIO.Endpoint, s.cfg.MinIO.AccessKey, s.cfg.MinIO.SecretKey)
	if err != nil {
		return fmt.Errorf("create Bronze storage client: %w", err)
	}
	preferredTICs, toiSnapshotID, toiRows, err := catalog.SyncTOI(ctx, minioClient, s.cfg.MinIO.Bucket)
	if err != nil {
		s.reportPlanningTerminal(ctx, minioClient, "DOWNLOADING_TOI", err)
		return fmt.Errorf("sync shared TOI catalog: %w", err)
	}
	s.publishPlanning(command, "TOI_READY_WAITING_FOR_MANIFEST_TARGETS", 1, 5)
	manifest, manifestRef, discoveredProducts, err := s.resolveManifest(ctx, command, preferredTICs, minioClient)
	if err != nil {
		s.reportPlanningTerminal(ctx, minioClient, "BUILDING_MANIFEST", err)
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
		s.reportPlanningTerminal(ctx, minioClient, "DOWNLOADING_TIC", err)
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
			Drain:              command.Drain,
			Progress: func(progress ProgressEvent) {
				s.runtime.Publish(observer.IngestRuntimeEvent{
					JobID:             command.JobID,
					Status:            "progress",
					ProductID:         progress.Result.SourceProductID,
					CompletedProducts: progress.CompletedProducts,
					TotalProducts:     progress.TotalProducts,
					CompletedBytes:    progress.CompletedBytes,
					ExpectedBytes:     progress.TotalBytes,
					ActiveWorkers:     progress.ActiveWorkers,
				})
			},
			TransferProgress: func(progress TransferProgressEvent) {
				status := "transfer"
				if progress.Done {
					status = "transfer_complete"
				}
				s.runtime.Publish(observer.IngestRuntimeEvent{
					JobID:                command.JobID,
					Status:               status,
					WorkerID:             progress.WorkerID,
					ProductID:            progress.ProductID,
					ProductKind:          string(progress.ProductKind),
					ProductBytes:         progress.BytesRead,
					ProductExpectedBytes: progress.ExpectedBytes,
				})
			},
			Metrics: s.metrics,
			Logger:  s.log,
		},
	)
	if command.ReportRunning != nil {
		command.ReportRunning()
	}
	s.runtime.Publish(observer.IngestRuntimeEvent{JobID: command.JobID, Status: "running"})

	summary, _, err := pipeline.IngestManifest(ctx, manifest)
	if err != nil {
		return fmt.Errorf("ingest manifest: %w", err)
	}
	if summary.FailedCount > 0 {
		return fmt.Errorf("ingestion completed with %d failed products", summary.FailedCount)
	}
	return nil
}

func drainRequested(drain <-chan struct{}) bool {
	if drain == nil {
		return false
	}
	select {
	case <-drain:
		return true
	default:
		return false
	}
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
	const planningTotal = 5
	writeManifestProgress(ctx, store, s.cfg.MinIO.Bucket, manifestProgress{
		State: "RUNNING", Stage: "DISCOVERING_MAST_PRODUCTS", Completed: 0,
	})
	s.publishPlanning(command, "DISCOVERING_MAST_PRODUCTS", 0, planningTotal)
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

	// MAST_TIMEOUT bounds each remote request. A full sector spans many pages,
	// so its workflow deadline is intentionally separate and substantially
	// longer than one HTTP request.
	discoveryTimeout := s.cfg.MAST.DiscoveryTimeout
	if discoveryTimeout <= 0 {
		discoveryTimeout = 10 * time.Minute
	}
	discoveryCtx, cancelDiscovery := context.WithTimeout(ctx, discoveryTimeout)
	defer cancelDiscovery()
	progressWriter := newManifestProgressWriter(ctx, store, s.cfg.MinIO.Bucket)

	products, err := mast.DiscoverTESS(discoveryCtx, s.newMASTClient(), mast.DiscoverOptions{
		Sector:   command.Sector,
		Limit:    command.Limit,
		PageSize: s.cfg.MAST.PageSize,
		Progress: func(progress mast.DiscoverProgress) {
			progressWriter.Report(manifestProgress{
				State:              "RUNNING",
				Stage:              progress.Stage,
				Completed:          0,
				StageCompleted:     progress.Completed,
				StageTotal:         progress.Total,
				DiscoveredProducts: progress.Products,
			})
			s.publishMeasuredPlanning(command, progress)
		},
	}, s.log)
	progressWriter.Close()
	if err != nil {
		if errors.Is(discoveryCtx.Err(), context.DeadlineExceeded) {
			return nil, "", 0, fmt.Errorf("discover TESS products: MAST discovery deadline exceeded after %s", discoveryTimeout)
		}
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

type manifestProgressWriter struct {
	ctx     context.Context
	store   *storage.MinIOClient
	bucket  string
	updates chan manifestProgress
	done    chan struct{}
}

func newManifestProgressWriter(ctx context.Context, store *storage.MinIOClient, bucket string) *manifestProgressWriter {
	w := &manifestProgressWriter{
		ctx:     ctx,
		store:   store,
		bucket:  bucket,
		updates: make(chan manifestProgress, 1),
		done:    make(chan struct{}),
	}
	go func() {
		defer close(w.done)
		for progress := range w.updates {
			writeCtx, cancel := context.WithTimeout(w.ctx, 2*time.Second)
			writeManifestProgress(writeCtx, w.store, w.bucket, progress)
			cancel()
		}
	}()
	return w
}

// Report coalesces operator snapshots so a slow MinIO telemetry write can
// never block MAST discovery or consume its deadline.
func (w *manifestProgressWriter) Report(progress manifestProgress) {
	select {
	case w.updates <- progress:
		return
	default:
	}
	select {
	case <-w.updates:
	default:
	}
	select {
	case w.updates <- progress:
	default:
	}
}

func (w *manifestProgressWriter) Close() {
	close(w.updates)
	<-w.done
}

func (s *Service) publishPlanning(command control.Command, stage string, completed, total int) {
	if s.runtime == nil {
		return
	}
	s.runtime.Publish(observer.IngestRuntimeEvent{
		JobID:             command.JobID,
		Status:            "planning",
		PlanningStage:     stage,
		PlanningCompleted: completed,
		PlanningTotal:     total,
	})
}

func (s *Service) publishMeasuredPlanning(command control.Command, progress mast.DiscoverProgress) {
	if s.runtime == nil {
		return
	}
	s.runtime.Publish(observer.IngestRuntimeEvent{
		JobID:             command.JobID,
		Status:            "planning",
		PlanningStage:     progress.Stage,
		PlanningCompleted: progress.Completed,
		PlanningTotal:     progress.Total,
		PlanningProducts:  progress.Products,
	})
}

// reportPlanningTerminal must survive cancellation. The control context is
// intentionally canceled during a stop or service restart; a short independent
// write lets the next status read distinguish CANCELED/FAILED from a stale
// RUNNING planner document.
func (s *Service) reportPlanningTerminal(runCtx context.Context, store *storage.MinIOClient, stage string, runErr error) {
	persistCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if runCtx.Err() != nil {
		catalog.ReportCanceled(persistCtx, store, s.cfg.MinIO.Bucket, stage)
		reportManifestCanceled(persistCtx, store, s.cfg.MinIO.Bucket, stage)
		return
	}
	catalog.ReportFailure(persistCtx, store, s.cfg.MinIO.Bucket, stage, runErr)
	reportManifestFailure(persistCtx, store, s.cfg.MinIO.Bucket, stage, runErr)
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
