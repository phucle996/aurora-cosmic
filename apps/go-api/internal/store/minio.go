package store

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// MinIOStore streams datasets, Parquet files, and manifests stored in MinIO S3 storage.
type MinIOStore struct {
	Endpoint string
	Bucket   string
	Client   *http.Client
}

type ObjectStore interface {
	Ping(context.Context) error
	GetObject(context.Context, string) ([]byte, error)
}

func NewMinIOStore(endpoint, bucket string) *MinIOStore {
	if endpoint == "" {
		endpoint = "http://minio:9000"
	}
	if bucket == "" {
		bucket = "aurora"
	}
	return &MinIOStore{
		Endpoint: endpoint,
		Bucket:   bucket,
		Client:   &http.Client{Timeout: 10 * time.Second},
	}
}

// Ping checks MinIO's unauthenticated liveness endpoint. Object requests
// still use the configured endpoint and bucket, while readiness stays cheap.
func (m *MinIOStore) Ping(ctx context.Context) error {
	reqURL := fmt.Sprintf("%s/minio/health/live", m.Endpoint)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, reqURL, nil)
	if err != nil {
		return fmt.Errorf("failed to create MinIO health request: %w", err)
	}
	resp, err := m.Client.Do(req)
	if err != nil {
		return fmt.Errorf("MinIO health check failed: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("MinIO health returned HTTP %d", resp.StatusCode)
	}
	return nil
}

// GetObject streams raw object bytes directly from MinIO.
func (m *MinIOStore) GetObject(ctx context.Context, key string) ([]byte, error) {
	base, err := url.Parse(strings.TrimRight(m.Endpoint, "/"))
	if err != nil {
		return nil, fmt.Errorf("invalid MinIO endpoint: %w", err)
	}
	base.Path = strings.TrimRight(base.Path, "/") + "/" + m.Bucket + "/" + key
	reqURL := base.String()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, reqURL, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to create MinIO request: %w", err)
	}

	resp, err := m.Client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("MinIO connection failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("MinIO returned HTTP %d for key %s", resp.StatusCode, key)
	}

	return io.ReadAll(resp.Body)
}
