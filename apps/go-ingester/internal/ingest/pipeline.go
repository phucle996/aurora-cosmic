package ingest

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"hash"
	"io"
	"log/slog"
	"sync"
	"sync/atomic"
	"time"

	"go-ingester/internal/events"
	"go-ingester/internal/manifest"
	"go-ingester/internal/mast"
	"go-ingester/internal/storage"

	"github.com/google/uuid"
)

// Status represents the ingestion and event publishing outcome for a single product.
type Status string

const (
	StatusStored            Status = "STORED"
	StatusSkipped           Status = "SKIPPED"
	StatusFailed            Status = "FAILED"
	StatusStoredEventFailed Status = "STORED_EVENT_FAILED"
	StatusPublished         Status = "PUBLISHED"
)

// ProductResult captures the detailed result of ingesting one product.
type ProductResult struct {
	SourceProductID string
	ObjectKey       string
	SizeBytes       int64
	SHA256          string
	Status          Status
	Error           error
}

// Summary collects overall metrics for a completed manifest ingestion run.
type Summary struct {
	PlannedProducts        int
	PublishedCount         int
	StoredCount            int
	SkippedCount           int
	FailedCount            int
	StoredEventFailedCount int
	StoredBytes            int64
	Elapsed                time.Duration
	ThroughputBps          float64
}

// Pipeline manages the bounded concurrent streaming of FITS files into MinIO and event publishing.
type Pipeline struct {
	mastClient  *mast.Client
	minioClient storage.Client
	publisher   events.Publisher
	bucket      string
	concurrency int
	log         *slog.Logger
}

// NewPipeline constructs an ingestion Pipeline.
func NewPipeline(mastClient *mast.Client, minioClient storage.Client, publisher events.Publisher, bucket string, concurrency int, log *slog.Logger) *Pipeline {
	if concurrency <= 0 {
		concurrency = 4
	}
	return &Pipeline{
		mastClient:  mastClient,
		minioClient: minioClient,
		publisher:   publisher,
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
	var products []manifest.ManifestProduct
	for _, s := range m.Samples {
		if s.TargetPixel != nil {
			products = append(products, *s.TargetPixel)
		}
		if s.LightCurve != nil {
			products = append(products, *s.LightCurve)
		}
	}
	products = append(products, m.FFIs...)

	if len(products) == 0 {
		return &Summary{Elapsed: time.Since(startTime)}, nil, nil
	}

	// 2. Set up worker channels.
	jobs := make(chan manifest.ManifestProduct, len(products))
	resultsChan := make(chan ProductResult, len(products))
	for _, prod := range products {
		jobs <- prod
	}
	close(jobs)

	var wg sync.WaitGroup
	var storedBytesCounter int64

	// 3. Launch bounded workers.
	workerCount := p.concurrency
	if workerCount > len(products) {
		workerCount = len(products)
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

				res := p.ingestProduct(ctx, prod, dryRun)
				if res.Status == StatusStored || res.Status == StatusPublished || res.Status == StatusStoredEventFailed {
					atomic.AddInt64(&storedBytesCounter, res.SizeBytes)
				}
				resultsChan <- res
			}
		}()
	}

	wg.Wait()
	close(resultsChan)

	// 4. Summarise results.
	results := make([]ProductResult, 0, len(products))
	summary := &Summary{
		PlannedProducts: len(products),
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

	summary.Elapsed = time.Since(startTime)
	if summary.Elapsed.Seconds() > 0 {
		summary.ThroughputBps = float64(summary.StoredBytes) / summary.Elapsed.Seconds()
	}

	return summary, results, nil
}

// ingestProduct processes a single ManifestProduct.
func (p *Pipeline) ingestProduct(ctx context.Context, prod manifest.ManifestProduct, dryRun bool) ProductResult {
	objectKey, err := storage.BuildObjectKey(prod)
	if err != nil {
		return ProductResult{
			SourceProductID: prod.SourceProductID,
			Status:          StatusFailed,
			Error:           fmt.Errorf("build key: %w", err),
		}
	}

	subject, _ := events.SubjectForKind(prod.Kind)

	if dryRun {
		p.log.Info("[DRY-RUN] plan object key and event",
			slog.String("kind", string(prod.Kind)),
			slog.String("uri", prod.DataURI),
			slog.String("object_key", objectKey),
			slog.String("event_subject", subject),
		)
		return ProductResult{
			SourceProductID: prod.SourceProductID,
			ObjectKey:       objectKey,
			SizeBytes:       prod.SizeBytes,
			Status:          StatusSkipped,
		}
	}

	// Check if existing valid object can be skipped.
	info, exists, err := p.minioClient.StatObject(ctx, p.bucket, objectKey)
	if err != nil {
		p.log.Warn("ingest: stat existing object failed",
			slog.String("object_key", objectKey),
			slog.Any("error", err),
		)
	} else if exists {
		if info.Size == prod.SizeBytes {
			p.log.Info("ingest: skipping existing valid object",
				slog.String("object_key", objectKey),
				slog.Int64("size", info.Size),
			)
			return ProductResult{
				SourceProductID: prod.SourceProductID,
				ObjectKey:       objectKey,
				SizeBytes:       info.Size,
				SHA256:          info.UserMetadata["sha256"],
				Status:          StatusSkipped,
			}
		}
		p.log.Error("ingest: existing object size mismatch",
			slog.String("object_key", objectKey),
			slog.Int64("existing_size", info.Size),
			slog.Int64("expected_size", prod.SizeBytes),
		)
		return ProductResult{
			SourceProductID: prod.SourceProductID,
			ObjectKey:       objectKey,
			SizeBytes:       info.Size,
			Status:          StatusFailed,
			Error:           fmt.Errorf("existing size %d != expected %d", info.Size, prod.SizeBytes),
		}
	}

	// Stream product from MAST API.
	stream, streamSize, err := p.mastClient.OpenProduct(ctx, prod.DataURI)
	if err != nil {
		return ProductResult{
			SourceProductID: prod.SourceProductID,
			ObjectKey:       objectKey,
			Status:          StatusFailed,
			Error:           fmt.Errorf("open mast stream: %w", err),
		}
	}
	defer stream.Close()

	uploadSize := streamSize
	if uploadSize <= 0 {
		uploadSize = prod.SizeBytes
	}

	hr := newHashedReader(stream)

	userMeta := map[string]string{
		"source-product-id": prod.SourceProductID,
		"product-kind":      string(prod.Kind),
		"sector":            fmt.Sprintf("%d", prod.Sector),
		"tic-id":            fmt.Sprintf("%d", prod.TICID),
		"camera":            fmt.Sprintf("%d", prod.Camera),
		"ccd":               fmt.Sprintf("%d", prod.CCD),
		"source-uri":        prod.DataURI,
	}

	// Stream into MinIO.
	if err := p.minioClient.PutObject(ctx, p.bucket, objectKey, hr, uploadSize, userMeta); err != nil {
		return ProductResult{
			SourceProductID: prod.SourceProductID,
			ObjectKey:       objectKey,
			Status:          StatusFailed,
			Error:           fmt.Errorf("minio put: %w", err),
		}
	}

	sha256Hex := hr.SumHex()

	// Size verification: check uploaded bytes match expected bytes.
	if prod.SizeBytes > 0 && hr.BytesRead() != prod.SizeBytes {
		return ProductResult{
			SourceProductID: prod.SourceProductID,
			ObjectKey:       objectKey,
			SizeBytes:       hr.BytesRead(),
			SHA256:          sha256Hex,
			Status:          StatusFailed,
			Error:           fmt.Errorf("stream size mismatch: read %d != expected %d", hr.BytesRead(), prod.SizeBytes),
		}
	}

	// Post-upload StatObject verification.
	statInfo, statExists, statErr := p.minioClient.StatObject(ctx, p.bucket, objectKey)
	if statErr != nil || !statExists {
		return ProductResult{
			SourceProductID: prod.SourceProductID,
			ObjectKey:       objectKey,
			SizeBytes:       hr.BytesRead(),
			SHA256:          sha256Hex,
			Status:          StatusFailed,
			Error:           fmt.Errorf("post-upload verify failed for %s: %v", objectKey, statErr),
		}
	}
	if prod.SizeBytes > 0 && statInfo.Size != prod.SizeBytes {
		return ProductResult{
			SourceProductID: prod.SourceProductID,
			ObjectKey:       objectKey,
			SizeBytes:       statInfo.Size,
			SHA256:          sha256Hex,
			Status:          StatusFailed,
			Error:           fmt.Errorf("post-upload size mismatch: %d != expected %d", statInfo.Size, prod.SizeBytes),
		}
	}

	p.log.Info("ingest: product stored and verified in MinIO",
		slog.String("kind", string(prod.Kind)),
		slog.String("object_key", objectKey),
		slog.Int64("size_bytes", hr.BytesRead()),
		slog.String("sha256", sha256Hex),
	)

	// Publish NATS JetStream event ONLY AFTER storage verification succeeds.
	if p.publisher != nil {
		eventID := uuid.NewString()
		evt, err := events.BuildBronzeEvent(eventID, p.bucket, prod, objectKey, sha256Hex)
		if err != nil {
			p.log.Error("ingest: build event failed", slog.Any("error", err))
			return ProductResult{
				SourceProductID: prod.SourceProductID,
				ObjectKey:       objectKey,
				SizeBytes:       hr.BytesRead(),
				SHA256:          sha256Hex,
				Status:          StatusStoredEventFailed,
				Error:           fmt.Errorf("build event: %w", err),
			}
		}

		if err := p.publisher.PublishBronzeReady(ctx, evt); err != nil {
			p.log.Warn("ingest: nats event publish failed after durable storage",
				slog.String("object_key", objectKey),
				slog.Any("error", err),
			)
			return ProductResult{
				SourceProductID: prod.SourceProductID,
				ObjectKey:       objectKey,
				SizeBytes:       hr.BytesRead(),
				SHA256:          sha256Hex,
				Status:          StatusStoredEventFailed,
				Error:           fmt.Errorf("nats publish: %w", err),
			}
		}

		p.log.Info("ingest: nats event published",
			slog.String("subject", subject),
			slog.String("event_id", eventID),
			slog.String("object_key", objectKey),
		)

		return ProductResult{
			SourceProductID: prod.SourceProductID,
			ObjectKey:       objectKey,
			SizeBytes:       hr.BytesRead(),
			SHA256:          sha256Hex,
			Status:          StatusPublished,
		}
	}

	return ProductResult{
		SourceProductID: prod.SourceProductID,
		ObjectKey:       objectKey,
		SizeBytes:       hr.BytesRead(),
		SHA256:          sha256Hex,
		Status:          StatusStored,
	}
}

// hashedReader wraps an io.Reader, computing SHA256 and tracking byte count on the fly.
type hashedReader struct {
	r         io.Reader
	h         hash.Hash
	bytesRead int64
}

func newHashedReader(r io.Reader) *hashedReader {
	return &hashedReader{
		r: r,
		h: sha256.New(),
	}
}

func (hr *hashedReader) Read(p []byte) (int, error) {
	n, err := hr.r.Read(p)
	if n > 0 {
		hr.h.Write(p[:n])
		hr.bytesRead += int64(n)
	}
	return n, err
}

func (hr *hashedReader) BytesRead() int64 {
	return hr.bytesRead
}

func (hr *hashedReader) SumHex() string {
	return hex.EncodeToString(hr.h.Sum(nil))
}
