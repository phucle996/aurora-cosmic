package ingest

import (
	"context"
	"fmt"
	"log/slog"

	"go-ingester/internal/model"

	"github.com/google/uuid"
)

// recoverCheckpointProduct inspects a product's checkpoint state and determines if it can be recovered without redownloading FITS.
func (p *Pipeline) recoverCheckpointProduct(ctx context.Context, prod model.ManifestProduct, pc model.ProductCheckpoint) (model.ProductResult, bool) {
	// Rule 1: PUBLISHED -> Skip completely
	if pc.State == model.StatePublished {
		return model.ProductResult{
			SourceProductID: prod.SourceProductID,
			ObjectKey:       pc.ObjectKey,
			SizeBytes:       pc.SizeBytes,
			SHA256:          pc.SHA256,
			Status:          model.StatusSkipped,
		}, true
	}

	// Rule 2: STORED (or DOWNLOADING with valid object) -> Recovery mode! Publish NATS event without redownloading FITS!
	if pc.State == model.StateStored || pc.State == model.StateDownloading {
		key := pc.ObjectKey
		if key == "" {
			key, _ = model.BuildObjectKey(prod)
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
			if res.Status == model.StatusPublished {
				p.cpManager.UpdateProductState(prod.SourceProductID, model.StatePublished, info.Size, sha, nil)
			} else {
				p.cpManager.UpdateProductState(prod.SourceProductID, model.StateStored, info.Size, sha, res.Error)
			}
			return res, true
		}
	}

	// Rule 3: FAILED with attempts >= 5 -> Skip automatically
	if pc.State == model.StateFailed && pc.Attempts >= 5 {
		p.log.Warn("ingest: product reached max attempts limit, skipping", slog.String("product_id", prod.SourceProductID))
		return model.ProductResult{
			SourceProductID: prod.SourceProductID,
			Status:          model.StatusFailed,
			Error:           fmt.Errorf("max attempts limit reached (%d)", pc.Attempts),
		}, true
	}

	return model.ProductResult{}, false
}

// publishOnly handles NATS JetStream event publishing for already-stored MinIO objects.
func (p *Pipeline) publishOnly(ctx context.Context, prod model.ManifestProduct, objectKey string, size int64, sha256Hex string) model.ProductResult {
	if p.publisher == nil {
		return model.ProductResult{
			SourceProductID: prod.SourceProductID,
			ObjectKey:       objectKey,
			SizeBytes:       size,
			SHA256:          sha256Hex,
			Status:          model.StatusStored,
		}
	}

	eventID := uuid.NewString()
	evt, err := model.BuildBronzeEvent(eventID, p.bucket, prod, objectKey, sha256Hex)
	if err != nil {
		return model.ProductResult{
			SourceProductID: prod.SourceProductID,
			ObjectKey:       objectKey,
			SizeBytes:       size,
			SHA256:          sha256Hex,
			Status:          model.StatusStoredEventFailed,
			Error:           fmt.Errorf("build event: %w", err),
		}
	}

	if err := p.publisher.PublishBronzeReady(ctx, evt); err != nil {
		return model.ProductResult{
			SourceProductID: prod.SourceProductID,
			ObjectKey:       objectKey,
			SizeBytes:       size,
			SHA256:          sha256Hex,
			Status:          model.StatusStoredEventFailed,
			Error:           fmt.Errorf("nats publish: %w", err),
		}
	}

	return model.ProductResult{
		SourceProductID: prod.SourceProductID,
		ObjectKey:       objectKey,
		SizeBytes:       size,
		SHA256:          sha256Hex,
		Status:          model.StatusPublished,
	}
}
