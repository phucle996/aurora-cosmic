package ingest

import (
	"context"
	"fmt"
	"log/slog"

	"go-ingester/internal/model"
)

// ingestProduct processes a single ManifestProduct: key building -> MAST streaming -> MinIO PutObject -> verification -> NATS event publish.
func (p *Pipeline) ingestProduct(ctx context.Context, prod model.ManifestProduct, dryRun bool) model.ProductResult {
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
			sha := info.UserMetadata["sha256"]
			res := p.publishOnly(ctx, prod, objectKey, info.Size, sha)
			if res.Status == model.StatusStored {
				res.Status = model.StatusSkipped
			}
			return res
		}
		p.log.Error("ingest: existing object size mismatch",
			slog.String("object_key", objectKey),
			slog.Int64("existing_size", info.Size),
			slog.Int64("expected_size", prod.SizeBytes),
		)
		return model.ProductResult{
			SourceProductID: prod.SourceProductID,
			ObjectKey:       objectKey,
			SizeBytes:       info.Size,
			Status:          model.StatusFailed,
			Error:           fmt.Errorf("existing size %d != expected %d", info.Size, prod.SizeBytes),
		}
	}

	// Stream product from MAST API.
	stream, streamSize, err := p.mastClient.OpenProduct(ctx, prod.DataURI)
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

	hr := model.NewHashedReader(stream)

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

	sha256Hex := hr.SumHex()

	// Size verification: check uploaded bytes match expected bytes.
	if prod.SizeBytes > 0 && hr.BytesRead() != prod.SizeBytes {
		return model.ProductResult{
			SourceProductID: prod.SourceProductID,
			ObjectKey:       objectKey,
			SizeBytes:       hr.BytesRead(),
			SHA256:          sha256Hex,
			Status:          model.StatusFailed,
			Error:           fmt.Errorf("stream size mismatch: read %d != expected %d", hr.BytesRead(), prod.SizeBytes),
		}
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
		return model.ProductResult{
			SourceProductID: prod.SourceProductID,
			ObjectKey:       objectKey,
			SizeBytes:       statInfo.Size,
			SHA256:          sha256Hex,
			Status:          model.StatusFailed,
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
	return p.publishOnly(ctx, prod, objectKey, hr.BytesRead(), sha256Hex)
}
