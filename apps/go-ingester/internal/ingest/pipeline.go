package ingest

import (
	"context"
	"fmt"
	"log/slog"
	"sync"
	"sync/atomic"
	"time"

	"go-ingester/internal/checkpoint"
	"go-ingester/internal/events"
	"go-ingester/internal/manifest"
	"go-ingester/internal/mast"
	"go-ingester/internal/storage"
)

// Pipeline manages the bounded concurrent streaming of FITS files into MinIO and event publishing with Checkpoint persistence.
type Pipeline struct {
	mastClient  *mast.Client
	minioClient storage.Client
	publisher   events.Publisher
	cpManager   *checkpoint.Manager
	bucket      string
	concurrency int
	log         *slog.Logger
}

// NewPipeline constructs an ingestion Pipeline.
func NewPipeline(mastClient *mast.Client, minioClient storage.Client, publisher events.Publisher, cpManager *checkpoint.Manager, bucket string, concurrency int, log *slog.Logger) *Pipeline {
	if concurrency <= 0 {
		concurrency = 4
	}
	return &Pipeline{
		mastClient:  mastClient,
		minioClient: minioClient,
		publisher:   publisher,
		cpManager:   cpManager,
		bucket:      bucket,
		concurrency: concurrency,
		log:         log,
	}
}

// IngestManifest processes all products in the manifest using bounded worker goroutines.
func (p *Pipeline) IngestManifest(ctx context.Context, m *manifest.Manifest, dryRun bool) (*Summary, []ProductResult, error) {
	startTime := time.Now()

	// Ensure destination bucket exists if not in dry-run mode.
	if !dryRun && p.minioClient != nil {
		if err := p.minioClient.EnsureBucket(ctx, p.bucket); err != nil {
			return nil, nil, fmt.Errorf("ingest: bucket check %q: %w", p.bucket, err)
		}
	}

	// 1. Collect all products from manifest.
	var allProducts []manifest.ManifestProduct
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
		return &Summary{Elapsed: time.Since(startTime)}, nil, nil
	}

	resultsChan := make(chan ProductResult, len(allProducts))
	var productsToDownload []manifest.ManifestProduct
	var storedBytesCounter int64

	// 2. Checkpoint recovery & filtering before queueing downloads.
	for _, prod := range allProducts {
		if p.cpManager != nil {
			pc, ok := p.cpManager.GetProductCheckpoint(prod.SourceProductID)
			if ok {
				res, handled := p.recoverCheckpointProduct(ctx, prod, pc)
				if handled {
					if res.Status == StatusStored || res.Status == StatusPublished || res.Status == StatusStoredEventFailed {
						atomic.AddInt64(&storedBytesCounter, res.SizeBytes)
					}
					resultsChan <- res
					continue
				}
			}
		}

		productsToDownload = append(productsToDownload, prod)
	}

	// 3. Set up worker channel for remaining download jobs.
	jobs := make(chan manifest.ManifestProduct, len(productsToDownload))
	for _, prod := range productsToDownload {
		jobs <- prod
	}
	close(jobs)

	var wg sync.WaitGroup
	workerCount := p.concurrency
	if workerCount > len(productsToDownload) {
		workerCount = len(productsToDownload)
	}

	for i := 0; i < workerCount; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for prod := range jobs {
				select {
				case <-ctx.Done():
					resultsChan <- ProductResult{
						SourceProductID: prod.SourceProductID,
						Status:          StatusFailed,
						Error:           ctx.Err(),
					}
					continue
				default:
				}

				if p.cpManager != nil {
					p.cpManager.UpdateProductState(prod.SourceProductID, checkpoint.StateDownloading, 0, "", nil)
				}

				res := p.ingestProduct(ctx, prod, dryRun)
				if res.Status == StatusStored || res.Status == StatusPublished || res.Status == StatusStoredEventFailed {
					atomic.AddInt64(&storedBytesCounter, res.SizeBytes)
				}

				// Update checkpoint state after download worker completes.
				if p.cpManager != nil && !dryRun {
					switch res.Status {
					case StatusPublished:
						p.cpManager.UpdateProductState(prod.SourceProductID, checkpoint.StatePublished, res.SizeBytes, res.SHA256, nil)
					case StatusStored, StatusStoredEventFailed:
						p.cpManager.UpdateProductState(prod.SourceProductID, checkpoint.StateStored, res.SizeBytes, res.SHA256, res.Error)
					case StatusFailed:
						p.cpManager.UpdateProductState(prod.SourceProductID, checkpoint.StateFailed, res.SizeBytes, res.SHA256, res.Error)
					}
					_ = p.cpManager.Flush(ctx)
				}

				resultsChan <- res
			}
		}()
	}

	wg.Wait()
	close(resultsChan)

	// 4. Summarise results and finalize checkpoint run status.
	results := make([]ProductResult, 0, len(allProducts))
	summary := &Summary{
		PlannedProducts: len(allProducts),
		StoredBytes:     storedBytesCounter,
	}

	for res := range resultsChan {
		results = append(results, res)
		switch res.Status {
		case StatusPublished:
			summary.PublishedCount++
		case StatusStored:
			summary.StoredCount++
		case StatusSkipped:
			summary.SkippedCount++
		case StatusStoredEventFailed:
			summary.StoredEventFailedCount++
			summary.StoredCount++
		case StatusFailed:
			summary.FailedCount++
		}
	}

	if p.cpManager != nil && !dryRun {
		p.cpManager.FinalizeRun()
		_ = p.cpManager.Flush(ctx)
	}

	summary.Elapsed = time.Since(startTime)
	if summary.Elapsed.Seconds() > 0 {
		summary.ThroughputBps = float64(summary.StoredBytes) / summary.Elapsed.Seconds()
	}

	return summary, results, nil
}
