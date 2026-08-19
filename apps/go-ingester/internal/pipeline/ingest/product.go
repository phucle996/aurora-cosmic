package ingest

import (
	"context"
	"errors"
	"fmt"
	"io"
	"log/slog"

	"go-ingester/internal/model"
)

// ingestProduct processes a single ManifestProduct: key building -> MAST streaming -> MinIO PutObject -> verification -> NATS event publish.
var errRunByteBudget = errors.New("ingest run byte budget reached")

// existingObjectMatchesExpected treats a zero manifest size as unknown. MAST
// does not provide byte sizes for every product, so an existing non-empty
// Bronze object is still reusable when no expected size was advertised.
func existingObjectMatchesExpected(actual, expected int64) bool {
	if expected <= 0 {
		return actual > 0
	}
	return actual == expected
}

type budgetReader struct {
	source io.Reader
	budget *runByteBudget
}

func (r *budgetReader) Read(p []byte) (int, error) {
	if r.budget == nil || r.budget.limit <= 0 {
		return r.source.Read(p)
	}
	allowed := len(p)
	for allowed > 0 {
		if r.budget.reserve(int64(allowed)) {
			break
		}
		allowed /= 2
	}
	if allowed == 0 {
		return 0, errRunByteBudget
	}
	n, err := r.source.Read(p[:allowed])
	if n < allowed {
		r.budget.release(int64(allowed - n))
	}
	return n, err
}

func (p *Pipeline) ingestProduct(ctx context.Context, prod model.ManifestProduct, dryRun bool, budget *runByteBudget) model.ProductResult {
	objectKey, err := model.BuildObjectKey(prod)
	if err != nil {
		return model.ProductResult{
			SourceProductID: prod.SourceProductID,
			Status:          model.StatusFailed,
			Error:           fmt.Errorf("build key: %w", err),
		}
	}

	subject, _ := model.SubjectForKind(prod.Kind)

	if dryRun {
		p.log.Info("[DRY-RUN] plan object key and event",
			slog.String("kind", string(prod.Kind)),
			slog.String("uri", prod.DataURI),
			slog.String("object_key", objectKey),
			slog.String("event_subject", subject),
		)
		return model.ProductResult{
			SourceProductID: prod.SourceProductID,
			ObjectKey:       objectKey,
			SizeBytes:       prod.SizeBytes,
			Status:          model.StatusSkipped,
		}
	}

	// Check if an existing valid object in MinIO can be reused (cross-run resume).
	// MAST catalog sizes are advisory estimates — a non-empty stored object is
	// always accepted even when its size diverges from the catalog manifest.
	info, exists, err := p.minioClient.StatObject(ctx, p.bucket, objectKey)
	if err != nil {
		p.log.Warn("ingest: stat existing object failed",
			slog.String("object_key", objectKey),
			slog.Any("error", err),
		)
	} else if exists && info.Size > 0 {
		// Accept any non-empty stored object. Log a warning if the MAST catalog
		// advertised a specific size that doesn't match so operators can audit.
		if prod.SizeBytes > 0 && info.Size != prod.SizeBytes {
			p.log.Warn("ingest: reusing existing Bronze object with size divergence from MAST estimate (resume)",
				slog.String("object_key", objectKey),
				slog.Int64("stored_size", info.Size),
				slog.Int64("mast_estimate", prod.SizeBytes),
			)
		} else {
			p.log.Info("ingest: skipping existing valid Bronze object (resume)",
				slog.String("object_key", objectKey),
				slog.Int64("size", info.Size),
			)
		}
		sha := info.UserMetadata["sha256"]
		res := p.publishOnly(ctx, prod, objectKey, info.Size, sha)
		if res.Status == model.StatusStored {
			res.Status = model.StatusSkipped
		}
		return res
	}

	// Stream product from MAST API.
	if p.sourceReader == nil {
		return model.ProductResult{
			SourceProductID: prod.SourceProductID,
			ObjectKey:       objectKey,
			Status:          model.StatusFailed,
			Error:           fmt.Errorf("source reader is not configured"),
		}
	}

	stream, streamSize, err := p.sourceReader.OpenProduct(ctx, prod.DataURI)
	if err != nil {
		return model.ProductResult{
			SourceProductID: prod.SourceProductID,
			ObjectKey:       objectKey,
			Status:          model.StatusFailed,
			Error:           fmt.Errorf("open mast stream: %w", err),
		}
	}
	defer stream.Close()

	uploadSize := streamSize
	if uploadSize <= 0 {
		uploadSize = prod.SizeBytes
	}
	reservedBytes := int64(0)
	if uploadSize > 0 {
		if !budget.reserve(uploadSize) {
			return model.ProductResult{SourceProductID: prod.SourceProductID, ObjectKey: objectKey, Status: model.StatusSkipped, Error: errRunByteBudget}
		}
		reservedBytes = uploadSize
	}

	readStream := io.Reader(stream)
	if uploadSize <= 0 {
		readStream = &budgetReader{source: stream, budget: budget}
	}
	hr := model.NewHashedReader(readStream)

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
		budget.release(reservedBytes)
		status := model.StatusFailed
		if errors.Is(err, errRunByteBudget) {
			status = model.StatusSkipped
		}
		return model.ProductResult{
			SourceProductID: prod.SourceProductID,
			ObjectKey:       objectKey,
			Status:          status,
			Error:           fmt.Errorf("minio put: %w", err),
		}
	}

	sha256Hex := hr.SumHex()

	// Size advisory check: MAST catalog sizes are estimates. Log divergence but
	// do not fail — the actual bytes written to MinIO are authoritative.
	if prod.SizeBytes > 0 && hr.BytesRead() != prod.SizeBytes {
		p.log.Warn("ingest: stream size diverges from MAST catalog estimate (non-fatal)",
			slog.String("object_key", objectKey),
			slog.Int64("bytes_read", hr.BytesRead()),
			slog.Int64("mast_estimate", prod.SizeBytes),
		)
	}

	// Post-upload StatObject verification.
	statInfo, statExists, statErr := p.minioClient.StatObject(ctx, p.bucket, objectKey)
	if statErr != nil || !statExists {
		return model.ProductResult{
			SourceProductID: prod.SourceProductID,
			ObjectKey:       objectKey,
			SizeBytes:       hr.BytesRead(),
			SHA256:          sha256Hex,
			Status:          model.StatusFailed,
			Error:           fmt.Errorf("post-upload verify failed for %s: %v", objectKey, statErr),
		}
	}
	if prod.SizeBytes > 0 && statInfo.Size != prod.SizeBytes {
		p.log.Warn("ingest: post-upload size diverges from MAST catalog estimate (non-fatal)",
			slog.String("object_key", objectKey),
			slog.Int64("stored_size", statInfo.Size),
			slog.Int64("mast_estimate", prod.SizeBytes),
		)
	}

	p.log.Info("ingest: product stored and verified in MinIO",
		slog.String("kind", string(prod.Kind)),
		slog.String("object_key", objectKey),
		slog.Int64("size_bytes", hr.BytesRead()),
		slog.String("sha256", sha256Hex),
	)

	// Publish NATS JetStream event ONLY AFTER storage verification succeeds.
	return p.publishOnly(ctx, prod, objectKey, hr.BytesRead(), sha256Hex)
}
