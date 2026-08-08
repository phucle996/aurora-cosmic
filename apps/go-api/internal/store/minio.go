package store

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"time"
)

// MinIOStore streams datasets, Parquet files, and manifests stored in MinIO S3 storage.
type MinIOStore struct {
	Endpoint string
	Bucket   string
	Client   *http.Client
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

// GetObject streams raw object bytes directly from MinIO.
func (m *MinIOStore) GetObject(ctx context.Context, key string) ([]byte, error) {
	reqURL := fmt.Sprintf("%s/%s/%s", m.Endpoint, m.Bucket, key)
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
