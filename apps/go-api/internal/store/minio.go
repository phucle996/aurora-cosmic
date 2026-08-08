package store

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/minio/minio-go/v7"
	"github.com/minio/minio-go/v7/pkg/credentials"
)

// MinIOStore streams datasets, Parquet files, and manifests stored in MinIO S3 storage.
type MinIOStore struct {
	Endpoint string
	Bucket   string
	Client   *http.Client
	minio    *minio.Client
}

type ObjectInfo struct {
	Key          string
	Size         int64
	ETag         string
	LastModified time.Time
}

type ObjectStore interface {
	Ping(context.Context) error
	GetObject(context.Context, string) ([]byte, error)
	ListObjects(context.Context, string) ([]ObjectInfo, error)
	PutObject(context.Context, string, []byte, string) error
}

func NewMinIOStore(endpoint, bucket string) *MinIOStore {
	return NewMinIOStoreWithCredentials(endpoint, bucket, "minioadmin", "minioadmin")
}

func NewMinIOStoreWithCredentials(endpoint, bucket, accessKey, secretKey string) *MinIOStore {
	if endpoint == "" {
		endpoint = "http://minio:9000"
	}
	if bucket == "" {
		bucket = "aurora"
	}
	secure := strings.HasPrefix(strings.ToLower(endpoint), "https://")
	host := strings.TrimPrefix(strings.TrimPrefix(endpoint, "https://"), "http://")
	client, err := minio.New(host, &minio.Options{
		Creds:  credentials.NewStaticV4(accessKey, secretKey, ""),
		Secure: secure,
	})
	if err != nil {
		// NewMinIOStore is intentionally infallible for backwards compatibility;
		// subsequent operations return a clear unavailable-store error.
		client = nil
	}
	return &MinIOStore{
		Endpoint: endpoint,
		Bucket:   bucket,
		Client:   &http.Client{Timeout: 10 * time.Second},
		minio:    client,
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
	if m.minio == nil {
		return nil, fmt.Errorf("MinIO client is unavailable")
	}
	object, err := m.minio.GetObject(ctx, m.Bucket, key, minio.GetObjectOptions{})
	if err != nil {
		return nil, fmt.Errorf("MinIO connection failed: %w", err)
	}
	defer object.Close()
	data, err := io.ReadAll(object)
	if err != nil {
		return nil, fmt.Errorf("MinIO read object %s: %w", key, err)
	}
	return data, nil
}

func (m *MinIOStore) ListObjects(ctx context.Context, prefix string) ([]ObjectInfo, error) {
	if m.minio == nil {
		return nil, fmt.Errorf("MinIO client is unavailable")
	}
	objects := make([]ObjectInfo, 0)
	for object := range m.minio.ListObjects(ctx, m.Bucket, minio.ListObjectsOptions{Prefix: prefix, Recursive: true}) {
		if object.Err != nil {
			return nil, fmt.Errorf("MinIO list objects with prefix %q: %w", prefix, object.Err)
		}
		objects = append(objects, ObjectInfo{
			Key:          object.Key,
			Size:         object.Size,
			ETag:         object.ETag,
			LastModified: object.LastModified,
		})
	}
	return objects, nil
}

func (m *MinIOStore) PutObject(ctx context.Context, key string, data []byte, contentType string) error {
	if m.minio == nil {
		return fmt.Errorf("MinIO client is unavailable")
	}
	_, err := m.minio.PutObject(ctx, m.Bucket, key, bytes.NewReader(data), int64(len(data)), minio.PutObjectOptions{ContentType: contentType})
	if err != nil {
		return fmt.Errorf("MinIO put object %s: %w", key, err)
	}
	return nil
}
