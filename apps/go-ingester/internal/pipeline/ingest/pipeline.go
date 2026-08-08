package ingest

import (
	"context"
	"fmt"
	"log/slog"
	"sync"
	"sync/atomic"
	"time"

	"go-ingester/infra/mast"
	"go-ingester/internal/model"
	"go-ingester/internal/pipeline/checkpoint"
)

// Pipeline manages the bounded concurrent streaming of FITS files into MinIO and event publishing with Checkpoint persistence.
type Pipeline struct {
	mastClient         *mast.Client
	minioClient        model.Client
	publisher          model.Publisher
	cpManager          *checkpoint.Manager
	bucket             string
	concurrency        int
	checkpointInterval time.Duration
	maxRunBytes        int64
	log                *slog.Logger
}

// NewPipeline constructs an ingestion Pipeline.
func NewPipeline(mastClient *mast.Client, minioClient model.Client, publisher model.Publisher, cpManager *checkpoint.Manager, bucket string, concurrency int, log *slog.Logger) *Pipeline {
	if concurrency <= 0 {
		concurrency = 4
	}
	if log == nil {
		log = slog.Default()
	}
	return &Pipeline{
		mastClient:         mastClient,
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

// IngestManifest processes all products in the manifest using bounded worker goroutines.
func (p *Pipeline) IngestManifest(ctx context.Context, m *model.Manifest, dryRun bool) (*model.Summary, []model.ProductResult, error) {
	startTime := time.Now()
	if m == nil {
		return nil, nil, fmt.Errorf("ingest: manifest is nil")
	}

	// 1. Collect all products from manifest.
	var allProducts []model.ManifestProduct
	for _, s := range m.Samples {
		if s.TargetPixel != nil {
			allProducts = append(allProducts, *s.TargetPixel)
		}
		if s.LightCurve != nil {
			allProducts = append(allProducts, *s.LightCurve)
		}
	}
	allProducts = append(allProducts, m.FFIs...)

	if len(allProducts) == 0 {
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

	// Ensure destination bucket exists only after cheap manifest validation.
	// An oversized run must fail without opening a storage connection.
	if !dryRun && p.minioClient != nil {
		if err := p.minioClient.EnsureBucket(ctx, p.bucket); err != nil {
			return nil, nil, fmt.Errorf("ingest: bucket check %q: %w", p.bucket, err)
		}
	}

	plannedProducts := len(allProducts)
	resultsChan := make(chan model.ProductResult, plannedProducts)
	// Compact pending products in place so the recovery pass does not retain a
	// second full ManifestProduct slice for large manifests.
	pendingCount := 0
	var storedBytesCounter int64

	// 2. Checkpoint recovery & filtering before queueing downloads.
	for _, prod := range allProducts {
		if p.cpManager != nil {
			pc, ok := p.cpManager.GetProductCheckpoint(prod.SourceProductID)
			if ok {
				res, handled := p.recoverCheckpointProduct(ctx, prod, pc)
				if handled {
					if res.Status == model.StatusStored || res.Status == model.StatusPublished || res.Status == model.StatusStoredEventFailed {
						atomic.AddInt64(&storedBytesCounter, res.SizeBytes)
					}
					resultsChan <- res
					continue
				}
			}
		}

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
				select {
				case <-ctx.Done():
					resultsChan <- model.ProductResult{
						SourceProductID: prod.SourceProductID,
						Status:          model.StatusFailed,
						Error:           ctx.Err(),
					}
					continue
				default:
				}

				if p.cpManager != nil {
					p.cpManager.UpdateProductState(prod.SourceProductID, model.StateDownloading, 0, "", nil)
				}

				res := p.ingestProduct(ctx, prod, dryRun)
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
					}
					checkpointDirty.Add(1)
				}

				resultsChan <- res
			}
		}()
	}

	for _, prod := range productsToDownload {
		// Keep enqueueing even after cancellation so workers can emit a
		// deterministic FAILED result for every planned product.
		jobs <- prod
	}
	close(jobs)

	wg.Wait()
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
		if err := p.cpManager.Flush(ctx); err != nil {
			return summary, results, fmt.Errorf("ingest: final checkpoint flush failed: %w", err)
		}
	}

	return summary, results, nil
}
