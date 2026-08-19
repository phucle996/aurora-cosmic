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
)

// SourceReader is the application-facing contract for streaming a source
// product. The ingestion core deliberately does not depend on a concrete MAST
// client so it can be tested and reused with another catalog/source adapter.
type SourceReader interface {
	OpenProduct(ctx context.Context, dataURI string) (io.ReadCloser, int64, error)
}

// ProgressEvent is emitted once for every manifest product when it reaches a
// terminal state. It is intentionally transport-agnostic so CLI, JSON logs,
// or a future metrics exporter can render the same progress data.
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

// Pipeline manages the bounded concurrent streaming of FITS files into MinIO and event publishing with Checkpoint persistence.
type Pipeline struct {
	sourceReader       SourceReader
	minioClient        model.Client
	publisher          model.Publisher
	cpManager          *checkpoint.Manager
	bucket             string
	concurrency        int
	checkpointInterval time.Duration
	maxRunBytes        int64
	progress           ProgressReporter
	metrics            *observer.Metrics
	log                *slog.Logger
}

type runByteBudget struct {
	limit int64
	used  atomic.Int64
}

func (b *runByteBudget) reserve(size int64) bool {
	if b == nil || b.limit <= 0 || size <= 0 {
		return true
	}
	for {
		current := b.used.Load()
		if size > b.limit-current {
			return false
		}
		if b.used.CompareAndSwap(current, current+size) {
			return true
		}
	}
}

func (b *runByteBudget) release(size int64) {
	if b == nil || size <= 0 {
		return
	}
	b.used.Add(-size)
}

// NewPipeline constructs an ingestion Pipeline.
func NewPipeline(sourceReader SourceReader, minioClient model.Client, publisher model.Publisher, cpManager *checkpoint.Manager, bucket string, concurrency int, log *slog.Logger) *Pipeline {
	if concurrency <= 0 {
		concurrency = 4
	}
	if log == nil {
		log = slog.Default()
	}
	return &Pipeline{
		sourceReader:       sourceReader,
		minioClient:        minioClient,
		publisher:          publisher,
		cpManager:          cpManager,
		bucket:             bucket,
		concurrency:        concurrency,
		checkpointInterval: 5 * time.Second,
		log:                log,
	}
}

// SetMaxRunBytes rejects a manifest larger than the configured Bronze budget
// before any network or storage work begins. Existing-object usage is enforced
// by the lifecycle cleanup command; this guard protects a single run.
func (p *Pipeline) SetMaxRunBytes(maxBytes int64) {
	if maxBytes > 0 {
		p.maxRunBytes = maxBytes
	}
}

// SetCheckpointInterval controls how often progress is persisted to MinIO.
// Progress remains in memory between flushes, avoiding a serialized pair of
// object writes for every product while keeping crash recovery bounded.
func (p *Pipeline) SetCheckpointInterval(interval time.Duration) {
	if interval > 0 {
		p.checkpointInterval = interval
	}
}

// SetProgressReporter attaches an optional per-product progress callback.
func (p *Pipeline) SetProgressReporter(reporter ProgressReporter) {
	p.progress = reporter
}

// SetObserver attaches the bounded Prometheus instrumentation for this
// pipeline. The pipeline remains usable without it in unit tests and CLI
// modes that do not need metrics.
func (p *Pipeline) SetObserver(metrics *observer.Metrics) {
	p.metrics = metrics
}

// IngestManifest processes all products in the manifest using bounded worker goroutines.
func (p *Pipeline) IngestManifest(ctx context.Context, m *model.Manifest, dryRun bool) (*model.Summary, []model.ProductResult, error) {
	startTime := time.Now()
	if m == nil {
		return nil, nil, fmt.Errorf("ingest: manifest is nil")
	}

	// 1. Collect all products from manifest.
	allProducts := m.Products()

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
	if p.maxRunBytes > 0 {
		var runBytes int64
		for _, prod := range allProducts {
			if prod.SizeBytes > p.maxRunBytes-runBytes {
				return nil, nil, fmt.Errorf("ingest: manifest size exceeds configured run budget %d", p.maxRunBytes)
			}
			runBytes += prod.SizeBytes
		}
	}
	runBudget := &runByteBudget{limit: p.maxRunBytes}

	// Ensure destination bucket exists only after cheap manifest validation.
	// An oversized run must fail without opening a storage connection.
	if !dryRun && p.minioClient != nil {
		if err := p.minioClient.EnsureBucket(ctx, p.bucket); err != nil {
			return nil, nil, fmt.Errorf("ingest: bucket check %q: %w", p.bucket, err)
		}
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
	if !dryRun && p.cpManager != nil {
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
	if p.cpManager != nil && !dryRun {
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
					res = p.ingestProduct(ctx, prod, dryRun, runBudget)
				}
				activeWorkers.Add(-1)
				if p.metrics != nil {
					p.metrics.ProductFinished(metricStatus(res), time.Since(productStart).Seconds(), res.SizeBytes)
				}
				if res.Status == model.StatusStored || res.Status == model.StatusPublished || res.Status == model.StatusStoredEventFailed {
					atomic.AddInt64(&storedBytesCounter, res.SizeBytes)
				}

				// Update checkpoint state after download worker completes.
				if p.cpManager != nil && !dryRun {
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

	for _, prod := range productsToDownload {
		// Keep enqueueing even after cancellation so workers can emit a
		// deterministic FAILED result for every planned product.
		jobs <- prod
		if p.metrics != nil {
			p.metrics.SetQueueDepth(len(jobs))
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

	if p.cpManager != nil && !dryRun {
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
