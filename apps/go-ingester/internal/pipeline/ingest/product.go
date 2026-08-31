package ingest

import (
	"context"
	"crypto/sha256"
	"fmt"
	"io"
	"log/slog"

	"go-ingester/internal/model"
	"go-ingester/internal/pipeline/storage"
)

// ingestProduct processes a single ManifestProduct: key building -> MAST streaming -> MinIO PutObject -> verification -> NATS event publish.

// existingObjectMatchesExpected treats a zero manifest size as unknown. MAST
// does not provide byte sizes for every product, so an existing non-empty
// Bronze object is still reusable when no expected size was advertised.
func existingObjectMatchesExpected(actual, expected int64) bool {
	if expected <= 0 {
		return actual > 0
	}
	return actual == expected
}

func (p *Pipeline) ingestProduct(ctx context.Context, prod model.ManifestProduct) model.ProductResult {
	objectKey, err := storage.ObjectKeyFor(prod)
	if err != nil {
		return model.ProductResult{
			SourceProductID: prod.SourceProductID,
			Status:          model.StatusFailed,
			Error:           fmt.Errorf("build key: %w", err),
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
		sha, hashErr := p.resolveStoredSHA(ctx, objectKey, info.UserMetadata["sha256"])
		if hashErr != nil {
			return model.ProductResult{SourceProductID: prod.SourceProductID, ObjectKey: objectKey, SizeBytes: info.Size, Status: model.StatusFailed, Error: hashErr}
		}
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
	// A run can be much larger than Bronze's rolling window. Admission is
	// therefore checked immediately before each new object, after existing
	// objects have been handled by the resume path above. When Bronze reaches
	// the high watermark this blocks until pre-processing commits eligible
	// lineage and the lifecycle manager evicts the oldest safe raw objects.
	capacityReleases := make([]func(), 0, 2)
	defer func() {
		for index := len(capacityReleases) - 1; index >= 0; index-- {
			capacityReleases[index]()
		}
	}()
	if p.capacityGate != nil && prod.SizeBytes > 0 {
		release, err := p.capacityGate.Acquire(ctx, prod.SizeBytes)
		if err != nil {
			return model.ProductResult{SourceProductID: prod.SourceProductID, ObjectKey: objectKey, Status: model.StatusFailed, Error: fmt.Errorf("wait for Bronze capacity: %w", err)}
		}
		capacityReleases = append(capacityReleases, release)
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
	if p.capacityGate != nil && uploadSize <= 0 {
		return model.ProductResult{SourceProductID: prod.SourceProductID, ObjectKey: objectKey, Status: model.StatusFailed, Error: fmt.Errorf("cannot enforce Bronze capacity: source did not provide a content length")}
	}
	// Content-Length is authoritative for this transfer. Reserve any delta over
	// the catalog estimate before MinIO receives a byte, otherwise concurrent
	// workers could collectively push the rolling Bronze window over 100 GB.
	additionalCapacity := uploadSize - prod.SizeBytes
	if prod.SizeBytes <= 0 {
		additionalCapacity = uploadSize
	}
	if p.capacityGate != nil && additionalCapacity > 0 {
		release, err := p.capacityGate.Acquire(ctx, additionalCapacity)
		if err != nil {
			return model.ProductResult{SourceProductID: prod.SourceProductID, ObjectKey: objectKey, Status: model.StatusFailed, Error: fmt.Errorf("wait for Bronze capacity: %w", err)}
		}
		capacityReleases = append(capacityReleases, release)
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
		return model.ProductResult{
			SourceProductID: prod.SourceProductID,
			ObjectKey:       objectKey,
			Status:          model.StatusFailed,
			Error:           fmt.Errorf("minio put: %w", err),
		}
	}

	sha256Hex := hr.sumHex()

	// Size advisory check: MAST catalog sizes are estimates. Log divergence but
	// do not fail — the actual bytes written to MinIO are authoritative.
	if prod.SizeBytes > 0 && hr.bytesRead() != prod.SizeBytes {
		p.log.Warn("ingest: stream size diverges from MAST catalog estimate (non-fatal)",
			slog.String("object_key", objectKey),
			slog.Int64("bytes_read", hr.bytesRead()),
			slog.Int64("mast_estimate", prod.SizeBytes),
		)
	}

	// Post-upload StatObject verification.
	statInfo, statExists, statErr := p.minioClient.StatObject(ctx, p.bucket, objectKey)
	if statErr != nil || !statExists {
		return model.ProductResult{
			SourceProductID: prod.SourceProductID,
			ObjectKey:       objectKey,
			SizeBytes:       hr.bytesRead(),
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
		slog.Int64("size_bytes", hr.bytesRead()),
		slog.String("sha256", sha256Hex),
	)

	// Publish NATS JetStream event ONLY AFTER storage verification succeeds.
	return p.publishOnly(ctx, prod, objectKey, hr.bytesRead(), sha256Hex)
}

// resolveStoredSHA makes an object uploaded outside the current checkpoint
// recoverable. New uploads already have a streaming checksum; an orphan
// Bronze object is hashed once before its readiness event is emitted.
func (p *Pipeline) resolveStoredSHA(ctx context.Context, objectKey, knownSHA string) (string, error) {
	if knownSHA != "" {
		return knownSHA, nil
	}
	reader, err := p.minioClient.GetObject(ctx, p.bucket, objectKey)
	if err != nil {
		return "", fmt.Errorf("read existing Bronze object for checksum: %w", err)
	}
	defer reader.Close()
	hash := sha256.New()
	if _, err := io.Copy(hash, reader); err != nil {
		return "", fmt.Errorf("hash existing Bronze object: %w", err)
	}
	return fmt.Sprintf("%x", hash.Sum(nil)), nil
}
