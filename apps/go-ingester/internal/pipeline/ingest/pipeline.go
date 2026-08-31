package ingest

import (
	"context"
	"fmt"
	"io"
	"log/slog"
	"sync"
	"sync/atomic"
	"time"

	"go-ingester/internal/model"
	"go-ingester/internal/observer"
	"go-ingester/internal/pipeline/checkpoint"
	"go-ingester/internal/pipeline/event"
	"go-ingester/internal/pipeline/plan"
	"go-ingester/internal/pipeline/storage"
)

// SourceReader is the application-facing contract for streaming a source
// product. The ingestion core deliberately does not depend on a concrete MAST
// client so it can be tested and reused with another catalog/source adapter.
type SourceReader interface {
	OpenProduct(ctx context.Context, dataURI string) (io.ReadCloser, int64, error)
}

// ProgressEvent is emitted once for every manifest product when it reaches a
// terminal state. It is transport-agnostic so telemetry sinks can render the
// same progress data without coupling the data plane to a delivery mechanism.
type ProgressEvent struct {
	Result            model.ProductResult
	CompletedProducts int64
	TotalProducts     int
	CompletedBytes    int64
	TotalBytes        int64
	Elapsed           time.Duration
	ThroughputBps     float64
	ActiveWorkers     int
	ConfiguredWorkers int
}

// ProgressReporter receives ingestion progress updates. Implementations should
// return quickly; a slow reporter back-pressures workers by design.
type ProgressReporter func(ProgressEvent)

// CapacityGate blocks until one more Bronze object can be admitted safely.
// It is deliberately a small port: storage pressure belongs to the lifecycle
// policy, while the ingestion data plane only needs permission per product.
type CapacityGate interface {
	Acquire(context.Context, int64) (release func(), err error)
}

// Dependencies are the ports required by the ingestion data plane.
type Dependencies struct {
	Source      SourceReader
	Storage     storage.Client
	Publisher   event.Publisher
	Checkpoints *checkpoint.Manager
}

// Options are immutable for a single ingestion run.
type Options struct {
	Bucket             string
	WorkerCount        int
	CheckpointInterval time.Duration
	CapacityGate       CapacityGate
	Progress           ProgressReporter
	Metrics            *observer.Metrics
	Logger             *slog.Logger
}

// Pipeline manages bounded concurrent FITS streaming, durable checkpoints,
// and post-storage event publication. It has no HTTP or environment coupling.
type Pipeline struct {
	sourceReader       SourceReader
	minioClient        storage.Client
	publisher          event.Publisher
	cpManager          *checkpoint.Manager
	bucket             string
	concurrency        int
	checkpointInterval time.Duration
	capacityGate       CapacityGate
	progress           ProgressReporter
	metrics            *observer.Metrics
	log                *slog.Logger
}

// NewPipeline constructs a fully configured ingestion data plane.
func NewPipeline(dependencies Dependencies, options Options) *Pipeline {
	if options.WorkerCount <= 0 {
		options.WorkerCount = 4
	}
	if options.Logger == nil {
		options.Logger = slog.Default()
	}
	if options.CheckpointInterval <= 0 {
		options.CheckpointInterval = 5 * time.Second
	}
	return &Pipeline{
		sourceReader:       dependencies.Source,
		minioClient:        dependencies.Storage,
		publisher:          dependencies.Publisher,
		cpManager:          dependencies.Checkpoints,
		bucket:             options.Bucket,
		concurrency:        options.WorkerCount,
		checkpointInterval: options.CheckpointInterval,
		capacityGate:       options.CapacityGate,
		progress:           options.Progress,
		metrics:            options.Metrics,
		log:                options.Logger,
	}
}

// IngestManifest processes all products in the manifest using bounded worker goroutines.
func (p *Pipeline) IngestManifest(ctx context.Context, m *model.Manifest) (*model.Summary, []model.ProductResult, error) {
	startTime := time.Now()
	if m == nil {
		return nil, nil, fmt.Errorf("ingest: manifest is nil")
	}
	if p.minioClient == nil {
		return nil, nil, fmt.Errorf("ingest: storage is not configured")
	}

	// Target products are scheduled as adjacent TPF + light-curve pairs. The
	// ingestion data plane no longer probes detector headers or downloads FFIs.
	allProducts := plan.Products(m)

	if len(allProducts) == 0 {
		if p.metrics != nil {
			p.metrics.SetQueueDepth(0)
		}
		return &model.Summary{Elapsed: time.Since(startTime)}, nil, nil
	}
	for _, prod := range allProducts {
		if prod.SizeBytes < 0 {
			return nil, nil, fmt.Errorf("ingest: product %q has negative size %d", prod.SourceProductID, prod.SizeBytes)
		}
	}
	// Ensure destination bucket exists only after cheap manifest validation.
	if err := p.minioClient.EnsureBucket(ctx, p.bucket); err != nil {
		return nil, nil, fmt.Errorf("ingest: bucket check %q: %w", p.bucket, err)
	}

	plannedProducts := len(allProducts)
	var totalBytes int64
	for _, prod := range allProducts {
		if prod.SizeBytes > 0 {
			totalBytes += prod.SizeBytes
			if totalBytes < 0 { // defensive overflow guard for malformed manifests
				totalBytes = 0
				break
			}
		}
	}
	resultsChan := make(chan model.ProductResult, plannedProducts)
	// Compact pending products in place so the recovery pass does not retain a
	// second full ManifestProduct slice for large manifests.
	pendingCount := 0
	var storedBytesCounter int64
	var completedCounter atomic.Int64
	var activeWorkers atomic.Int64
	reportProgress := func(res model.ProductResult) {
		completed := completedCounter.Add(1)
		if p.progress == nil {
			return
		}
		elapsed := time.Since(startTime)
		storedBytes := atomic.LoadInt64(&storedBytesCounter)
		throughput := float64(0)
		if elapsed > 0 {
			throughput = float64(storedBytes) / elapsed.Seconds()
		}
		p.progress(ProgressEvent{
			Result:            res,
			CompletedProducts: completed,
			TotalProducts:     plannedProducts,
			CompletedBytes:    storedBytes,
			TotalBytes:        totalBytes,
			Elapsed:           elapsed,
			ThroughputBps:     throughput,
			ActiveWorkers:     int(activeWorkers.Load()),
			ConfiguredWorkers: p.concurrency,
		})
	}

	// Cross-run resume: load previous checkpoint to skip already-stored products.
	// Products that were STORED/PUBLISHED in the previous run are verified with
	// a single StatObject call — much faster than downloading from MAST again.
	// Products absent from the previous checkpoint are queued for fresh download.
	type prevEntry struct {
		objectKey string
		size      int64
		sha256    string
	}
	prevDone := make(map[string]prevEntry) // productID → stored object info
	if p.cpManager != nil {
		if prev := p.cpManager.PreviousCheckpoint(); prev != nil {
			for id, pc := range prev.Products {
				if pc != nil && (pc.State == model.StatePublished || pc.State == model.StateStored) && pc.ObjectKey != "" {
					prevDone[id] = prevEntry{objectKey: pc.ObjectKey, size: pc.SizeBytes, sha256: pc.SHA256}
				}
			}
			p.log.Info("ingest: previous checkpoint loaded for cross-run resume",
				slog.Int("prev_done_count", len(prevDone)),
			)
		}
	}

	// 2. Filter pass: resolve each product against previous checkpoint or current run checkpoint.
	for _, prod := range allProducts {
		// Fast path A: product was STORED/PUBLISHED in a previous run.
		// Verify the Bronze object still exists with one StatObject — if valid, skip download.
		if prev, ok := prevDone[prod.SourceProductID]; ok {
			info, exists, statErr := p.minioClient.StatObject(ctx, p.bucket, prev.objectKey)
			if statErr == nil && exists && info.Size > 0 {
				res := p.publishOnly(ctx, prod, prev.objectKey, info.Size, prev.sha256)
				if res.Status == model.StatusStored {
					res.Status = model.StatusSkipped
				}
				if p.metrics != nil {
					p.metrics.ProductStarted()
				}
				resultsChan <- res
				reportProgress(res)
				continue
			}
			// Object missing or stat error — checkpoint invalid, log and re-download.
			p.log.Warn("ingest: previous checkpoint entry invalid, will re-download",
				slog.String("product_id", prod.SourceProductID),
				slog.String("object_key", prev.objectKey),
			)
		}

		// Fast path B: current-run checkpoint (within-run crash recovery).
		if p.cpManager != nil {
			pc, ok := p.cpManager.GetProductCheckpoint(prod.SourceProductID)
			if ok {
				recoveryStart := time.Now()
				res, handled := p.recoverCheckpointProduct(ctx, prod, pc)
				if handled {
					if p.metrics != nil {
						p.metrics.ProductStarted()
					}
					if res.Status == model.StatusStored || res.Status == model.StatusPublished || res.Status == model.StatusStoredEventFailed {
						atomic.AddInt64(&storedBytesCounter, res.SizeBytes)
					}
					resultsChan <- res
					reportProgress(res)
					recordMetrics(p.metrics, res, time.Since(recoveryStart))
					continue
				}
			}
		}

		// Slow path: product not in any checkpoint — queue for fresh download.
		allProducts[pendingCount] = prod
		pendingCount++
	}
	for i := pendingCount; i < plannedProducts; i++ {
		allProducts[i] = model.ManifestProduct{}
	}
	productsToDownload := allProducts[:pendingCount]

	// 3. Set up a bounded worker queue. This avoids allocating another full
	// channel-sized copy of a large manifest before workers can start.
	queueSize := p.concurrency * 2
	if queueSize < 1 {
		queueSize = 1
	}
	jobs := make(chan model.ManifestProduct, queueSize)

	var wg sync.WaitGroup
	workerCount := p.concurrency
	if workerCount > len(productsToDownload) {
		workerCount = len(productsToDownload)
	}

	var checkpointDirty atomic.Int64
	checkpointStop := make(chan struct{})
	var checkpointWG sync.WaitGroup
	if p.cpManager != nil {
		checkpointWG.Add(1)
		go func() {
			defer checkpointWG.Done()
			ticker := time.NewTicker(p.checkpointInterval)
			defer ticker.Stop()
			for {
				select {
				case <-ticker.C:
					if checkpointDirty.Load() == 0 {
						continue
					}
					if err := p.cpManager.Flush(ctx); err != nil {
						p.log.Warn("checkpoint: periodic flush failed", slog.Any("error", err))
						continue
					}
					checkpointDirty.Store(0)
				case <-checkpointStop:
					return
				}
			}
		}()
	}

	for i := 0; i < workerCount; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for prod := range jobs {
				if ctx.Err() != nil {
					return
				}
				if p.metrics != nil {
					p.metrics.SetQueueDepth(len(jobs))
					p.metrics.ProductStarted()
				}
				productStart := time.Now()
				activeWorkers.Add(1)
				var res model.ProductResult
				select {
				case <-ctx.Done():
					res = model.ProductResult{
						SourceProductID: prod.SourceProductID,
						Status:          model.StatusFailed,
						Error:           ctx.Err(),
					}
				default:
					break
				}

				if res.Status == "" {
					if p.cpManager != nil {
						p.cpManager.UpdateProductState(prod.SourceProductID, model.StateDownloading, 0, "", nil)
					}
					res = p.ingestProduct(ctx, prod)
				}
				activeWorkers.Add(-1)
				if p.metrics != nil {
					p.metrics.ProductFinished(metricStatus(res), time.Since(productStart).Seconds(), res.SizeBytes)
				}
				if res.Status == model.StatusStored || res.Status == model.StatusPublished || res.Status == model.StatusStoredEventFailed {
					atomic.AddInt64(&storedBytesCounter, res.SizeBytes)
				}

				// Update checkpoint state after download worker completes.
				if p.cpManager != nil {
					switch res.Status {
					case model.StatusPublished:
						p.cpManager.UpdateProductState(prod.SourceProductID, model.StatePublished, res.SizeBytes, res.SHA256, nil)
					case model.StatusStored, model.StatusStoredEventFailed:
						p.cpManager.UpdateProductState(prod.SourceProductID, model.StateStored, res.SizeBytes, res.SHA256, res.Error)
					case model.StatusFailed:
						p.cpManager.UpdateProductState(prod.SourceProductID, model.StateFailed, res.SizeBytes, res.SHA256, res.Error)
					case model.StatusSkipped:
						p.cpManager.UpdateProductState(prod.SourceProductID, model.StatePlanned, res.SizeBytes, res.SHA256, res.Error)
					}
					checkpointDirty.Add(1)
				}

				resultsChan <- res
				reportProgress(res)
			}
		}()
	}

enqueue:
	for _, prod := range productsToDownload {
		select {
		case jobs <- prod:
			if p.metrics != nil {
				p.metrics.SetQueueDepth(len(jobs))
			}
		case <-ctx.Done():
			break enqueue
		}
	}
	close(jobs)

	wg.Wait()
	if p.metrics != nil {
		p.metrics.SetQueueDepth(0)
	}
	close(checkpointStop)
	checkpointWG.Wait()
	close(resultsChan)

	// 4. Summarise results and finalize checkpoint run status.
	results := make([]model.ProductResult, 0, len(allProducts))
	summary := &model.Summary{
		PlannedProducts: plannedProducts,
		StoredBytes:     storedBytesCounter,
	}

	for res := range resultsChan {
		results = append(results, res)
		switch res.Status {
		case model.StatusPublished:
			summary.PublishedCount++
		case model.StatusStored:
			summary.StoredCount++
		case model.StatusSkipped:
			summary.SkippedCount++
		case model.StatusStoredEventFailed:
			summary.StoredEventFailedCount++
			summary.StoredCount++
		case model.StatusFailed:
			summary.FailedCount++
		}
	}

	summary.Elapsed = time.Since(startTime)
	if summary.Elapsed.Seconds() > 0 {
		summary.ThroughputBps = float64(summary.StoredBytes) / summary.Elapsed.Seconds()
	}

	if p.cpManager != nil {
		p.cpManager.FinalizeRun()
		flushCtx, flushCancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer flushCancel()
		if err := p.cpManager.Flush(flushCtx); err != nil {
			p.log.Warn("final checkpoint flush failed", slog.Any("error", err))
		}
	}

	return summary, results, nil
}

func metricStatus(res model.ProductResult) string {
	switch res.Status {
	case model.StatusSkipped:
		return "skipped"
	case model.StatusStored, model.StatusPublished:
		return "success"
	default:
		return "failed"
	}
}

func recordMetrics(metrics *observer.Metrics, res model.ProductResult, elapsed time.Duration) {
	if metrics == nil {
		return
	}
	metrics.ProductFinished(metricStatus(res), elapsed.Seconds(), res.SizeBytes)
}
