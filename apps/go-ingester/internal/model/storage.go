package model

import (
	"context"
	"errors"
	"fmt"
	"io"
	"strings"
	"time"
)

// ErrObjectNotFound is returned by storage adapters when an object is absent.
// Callers can distinguish a normal first-run checkpoint miss from an actual
// storage/network failure instead of silently starting a new run.
var ErrObjectNotFound = errors.New("storage object not found")

// ObjectInfo metadata for a stored object in MinIO Bronze.
type ObjectInfo struct {
	Key          string            `json:"key"`
	Size         int64             `json:"size"`
	ETag         string            `json:"etag"`
	LastModified time.Time         `json:"last_modified"`
	UserMetadata map[string]string `json:"user_metadata"`
}

// Client defines the storage interface for interacting with MinIO Bronze.
type Client interface {
	EnsureBucket(ctx context.Context, bucket string) error
	PutObject(ctx context.Context, bucket, objectKey string, reader io.Reader, objectSize int64, userMetadata map[string]string) error
	StatObject(ctx context.Context, bucket, objectKey string) (*ObjectInfo, bool, error)
	GetObject(ctx context.Context, bucket, objectKey string) (io.ReadCloser, error)
}

// BuildObjectKey constructs a deterministic MinIO Bronze object key for a product.
func BuildObjectKey(p ManifestProduct) (string, error) {
	if p.Filename == "" {
		return "", fmt.Errorf("storage: filename cannot be empty")
	}
	if p.Sector < 0 || p.Sector > 9999 {
		return "", fmt.Errorf("storage: invalid sector %d (must be 0-9999)", p.Sector)
	}

	cleanFilename := strings.TrimSpace(p.Filename)

	switch p.Kind {
	case KindTargetPixel:
		if p.TICID <= 0 {
			return "", fmt.Errorf("storage: missing valid TIC ID for TARGET_PIXEL")
		}
		return fmt.Sprintf("bronze/tess/target-pixel/sector=%04d/tic=%d/%s", p.Sector, p.TICID, cleanFilename), nil

	case KindLightCurve:
		if p.TICID <= 0 {
			return "", fmt.Errorf("storage: missing valid TIC ID for LIGHT_CURVE")
		}
		return fmt.Sprintf("bronze/tess/lightcurve/sector=%04d/tic=%d/%s", p.Sector, p.TICID, cleanFilename), nil

	case KindFFI:
		return fmt.Sprintf("bronze/tess/ffi/sector=%04d/camera=%d/ccd=%d/%s", p.Sector, p.Camera, p.CCD, cleanFilename), nil

	default:
		return "", fmt.Errorf("storage: unsupported product kind %q", p.Kind)
	}
}
