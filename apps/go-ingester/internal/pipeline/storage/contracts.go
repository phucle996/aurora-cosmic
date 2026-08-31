// Package storage defines the object-store port shared by ingestion and
// checkpoint persistence. Concrete MinIO code stays in infra/storage.
package storage

import (
	"context"
	"errors"
	"fmt"
	"io"
	"strings"
	"time"

	"go-ingester/internal/model"
)

var ErrObjectNotFound = errors.New("storage object not found")

type ObjectInfo struct {
	Key          string
	Size         int64
	ETag         string
	LastModified time.Time
	UserMetadata map[string]string
}

type Client interface {
	EnsureBucket(context.Context, string) error
	PutObject(context.Context, string, string, io.Reader, int64, map[string]string) error
	StatObject(context.Context, string, string) (*ObjectInfo, bool, error)
	GetObject(context.Context, string, string) (io.ReadCloser, error)
	ListObjectsWithPrefix(context.Context, string, string) ([]ObjectInfo, error)
}

func ObjectKeyFor(product model.ManifestProduct) (string, error) {
	if product.Filename == "" {
		return "", fmt.Errorf("storage: filename cannot be empty")
	}
	if product.Sector < 0 || product.Sector > 9999 {
		return "", fmt.Errorf("storage: invalid sector %d (must be 0-9999)", product.Sector)
	}

	filename := strings.TrimSpace(product.Filename)
	switch product.Kind {
	case model.KindTargetPixel:
		if product.TICID <= 0 {
			return "", fmt.Errorf("storage: missing valid TIC ID for TARGET_PIXEL")
		}
		return fmt.Sprintf("bronze/tess/target-pixel/sector=%04d/tic=%d/%s", product.Sector, product.TICID, filename), nil
	case model.KindLightCurve:
		if product.TICID <= 0 {
			return "", fmt.Errorf("storage: missing valid TIC ID for LIGHT_CURVE")
		}
		return fmt.Sprintf("bronze/tess/lightcurve/sector=%04d/tic=%d/%s", product.Sector, product.TICID, filename), nil
	default:
		return "", fmt.Errorf("storage: unsupported product kind %q", product.Kind)
	}
}
