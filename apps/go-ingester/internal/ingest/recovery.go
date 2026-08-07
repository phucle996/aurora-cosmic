package ingest

import (
	"context"
	"fmt"
	"log/slog"

	"go-ingester/internal/checkpoint"
	"go-ingester/internal/events"
	"go-ingester/internal/manifest"
	"go-ingester/internal/storage"

	"github.com/google/uuid"
)

// recoverCheckpointProduct inspects a product's checkpoint state and determines if it can be recovered without redownloading FITS.
func (p *Pipeline) recoverCheckpointProduct(ctx context.Context, prod manifest.ManifestProduct, pc checkpoint.ProductCheckpoint) (ProductResult, bool) {
	// Rule 1: PUBLISHED -> Skip completely
	if pc.State == checkpoint.StatePublished {
		return ProductResult{
			SourceProductID: prod.SourceProductID,
			ObjectKey:       pc.ObjectKey,
			SizeBytes:       pc.SizeBytes,
			SHA256:          pc.SHA256,
			Status:          StatusSkipped,
		}, true
	}

	// Rule 2: STORED (or DOWNLOADING with valid object) -> Recovery mode! Publish NATS event without redownloading FITS!
	if pc.State == checkpoint.StateStored || pc.State == checkpoint.StateDownloading {
		key := pc.ObjectKey
		if key == "" {
			key, _ = storage.BuildObjectKey(prod)
		}
		info, exists, statErr := p.minioClient.StatObject(ctx, p.bucket, key)
		if statErr == nil && exists && info.Size == prod.SizeBytes {
			p.log.Info("ingest: checkpoint recovery - valid Bronze object found, publishing NATS event",
				slog.String("object_key", key),
				slog.Int64("size", info.Size),
			)
			sha := pc.SHA256
			if sha == "" {
				sha = info.UserMetadata["sha256"]
			}

			res := p.publishOnly(ctx, prod, key, info.Size, sha)
			if res.Status == StatusPublished {
				p.cpManager.UpdateProductState(prod.SourceProductID, checkpoint.StatePublished, info.Size, sha, nil)
			} else {
				p.cpManager.UpdateProductState(prod.SourceProductID, checkpoint.StateStored, info.Size, sha, res.Error)
			}
			_ = p.cpManager.Flush(ctx)
			return res, true
		}
	}

	// Rule 3: FAILED with attempts >= 5 -> Skip automatically
	if pc.State == checkpoint.StateFailed && pc.Attempts >= 5 {
		p.log.Warn("ingest: product reached max attempts limit, skipping", slog.String("product_id", prod.SourceProductID))
		return ProductResult{
			SourceProductID: prod.SourceProductID,
			Status:          StatusFailed,
			Error:           fmt.Errorf("max attempts limit reached (%d)", pc.Attempts),
		}, true
	}

	return ProductResult{}, false
}

// publishOnly handles NATS JetStream event publishing for already-stored MinIO objects.
func (p *Pipeline) publishOnly(ctx context.Context, prod manifest.ManifestProduct, objectKey string, size int64, sha256Hex string) ProductResult {
	if p.publisher == nil {
		return ProductResult{
			SourceProductID: prod.SourceProductID,
			ObjectKey:       objectKey,
			SizeBytes:       size,
			SHA256:          sha256Hex,
			Status:          StatusStored,
		}
	}

	eventID := uuid.NewString()
	evt, err := events.BuildBronzeEvent(eventID, p.bucket, prod, objectKey, sha256Hex)
	if err != nil {
		return ProductResult{
			SourceProductID: prod.SourceProductID,
			ObjectKey:       objectKey,
			SizeBytes:       size,
			SHA256:          sha256Hex,
			Status:          StatusStoredEventFailed,
			Error:           fmt.Errorf("build event: %w", err),
		}
	}

	if err := p.publisher.PublishBronzeReady(ctx, evt); err != nil {
		return ProductResult{
			SourceProductID: prod.SourceProductID,
			ObjectKey:       objectKey,
			SizeBytes:       size,
			SHA256:          sha256Hex,
			Status:          StatusStoredEventFailed,
			Error:           fmt.Errorf("nats publish: %w", err),
		}
	}

	return ProductResult{
		SourceProductID: prod.SourceProductID,
		ObjectKey:       objectKey,
		SizeBytes:       size,
		SHA256:          sha256Hex,
		Status:          StatusPublished,
	}
}
