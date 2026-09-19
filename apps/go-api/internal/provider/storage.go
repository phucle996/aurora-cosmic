package provider

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"strings"
	"time"

	"go-api/infra/minio"

	minioSDK "github.com/minio/minio-go/v7"
)

var ErrObjectNotFound = errors.New("object not found")

type ObjectInfo struct {
	Key          string
	Size         int64
	ETag         string
	LastModified time.Time
	UserMetadata map[string]string
}

// ObjectStorage định nghĩa interface truy cập MinIO / S3 Object Storage provider
type ObjectStorage interface {
	Ping(ctx context.Context) error
	ListObjects(ctx context.Context, prefix string) ([]ObjectInfo, error)
	ListObjectsWithMetadata(ctx context.Context, prefix string) ([]ObjectInfo, error)
	ListObjectsCursor(ctx context.Context, prefix string, cursor string, limit int) ([]ObjectInfo, string, bool, error)
	GetObject(ctx context.Context, key string) ([]byte, error)
	PutObject(ctx context.Context, key string, data []byte, contentType string) error
	DeleteObject(ctx context.Context, key string) error
}

// minioObjectStorage thực thi interface ObjectStorage
type minioObjectStorage struct {
	client *minio.Client
}

// NewObjectStorage khởi tạo thể hiện ObjectStorage provider. Fail-fast nếu client nil.
func NewObjectStorage(client *minio.Client) ObjectStorage {
	if client == nil {
		panic("provider: minio client cannot be nil")
	}
	return &minioObjectStorage{client: client}
}

// Ping kiểm tra kết nối tới máy chủ MinIO
func (r *minioObjectStorage) Ping(ctx context.Context) error {
	return r.client.Ping(ctx)
}

func (r *minioObjectStorage) GetObject(ctx context.Context, key string) ([]byte, error) {
	if r.client.SDK == nil {
		return nil, fmt.Errorf("MinIO client is unavailable")
	}
	object, err := r.client.SDK.GetObject(ctx, r.client.Bucket, key, minioSDK.GetObjectOptions{})
	if err != nil {
		return nil, fmt.Errorf("MinIO get object %s: %w", key, err)
	}
	defer object.Close()
	data, err := io.ReadAll(object)
	if err != nil {
		response := minioSDK.ToErrorResponse(err)
		if response.Code == "NoSuchKey" || response.Code == "NoSuchObject" {
			return nil, fmt.Errorf("%w: %s", ErrObjectNotFound, key)
		}
		return nil, fmt.Errorf("MinIO read object %s: %w", key, err)
	}
	return data, nil
}

func (r *minioObjectStorage) PutObject(ctx context.Context, key string, data []byte, contentType string) error {
	if r.client.SDK == nil {
		return fmt.Errorf("MinIO client is unavailable")
	}
	_, err := r.client.SDK.PutObject(ctx, r.client.Bucket, key, bytes.NewReader(data), int64(len(data)), minioSDK.PutObjectOptions{ContentType: contentType})
	return err
}

func (r *minioObjectStorage) DeleteObject(ctx context.Context, key string) error {
	if r.client.SDK == nil {
		return fmt.Errorf("MinIO client is unavailable")
	}
	return r.client.SDK.RemoveObject(ctx, r.client.Bucket, key, minioSDK.RemoveObjectOptions{})
}

func (r *minioObjectStorage) ListObjects(ctx context.Context, prefix string) ([]ObjectInfo, error) {
	return r.listObjects(ctx, prefix, false)
}

func (r *minioObjectStorage) ListObjectsWithMetadata(ctx context.Context, prefix string) ([]ObjectInfo, error) {
	return r.listObjects(ctx, prefix, true)
}

func (r *minioObjectStorage) listObjects(ctx context.Context, prefix string, withMetadata bool) ([]ObjectInfo, error) {
	if r.client.SDK == nil {
		return nil, fmt.Errorf("MinIO client is unavailable")
	}
	objects := make([]ObjectInfo, 0)
	for object := range r.client.SDK.ListObjects(ctx, r.client.Bucket, minioSDK.ListObjectsOptions{Prefix: prefix, Recursive: true, WithMetadata: withMetadata}) {
		if object.Err != nil {
			return nil, fmt.Errorf("MinIO list objects with prefix %q: %w", prefix, object.Err)
		}
		metadata := make(map[string]string, len(object.Metadata)+len(object.UserMetadata))
		for key, values := range object.Metadata {
			if len(values) == 0 {
				continue
			}
			normalized := strings.TrimPrefix(strings.ToLower(key), "x-amz-meta-")
			metadata[normalized] = values[0]
		}
		for key, value := range object.UserMetadata {
			metadata[strings.TrimPrefix(strings.ToLower(key), "x-amz-meta-")] = value
		}
		objects = append(objects, ObjectInfo{Key: object.Key, Size: object.Size, ETag: object.ETag, LastModified: object.LastModified, UserMetadata: metadata})
	}
	return objects, nil
}

// ListObjectsCursor streams objects with prefix starting after cursor, up to limit items.
// It detects whether further pages exist and returns nextCursor and truncated.
func (r *minioObjectStorage) ListObjectsCursor(ctx context.Context, prefix string, cursor string, limit int) ([]ObjectInfo, string, bool, error) {
	if r.client.SDK == nil {
		return nil, "", false, fmt.Errorf("MinIO client is unavailable")
	}
	if limit <= 0 {
		limit = 100
	}

	streamCtx, cancel := context.WithCancel(ctx)
	defer cancel()

	opts := minioSDK.ListObjectsOptions{
		Prefix:     prefix,
		StartAfter: cursor,
		Recursive:  true,
	}

	objects := make([]ObjectInfo, 0, limit)
	var nextCursor string
	truncated := false

	for object := range r.client.SDK.ListObjects(streamCtx, r.client.Bucket, opts) {
		if object.Err != nil {
			return nil, "", false, fmt.Errorf("MinIO stream objects with prefix %q: %w", prefix, object.Err)
		}

		if strings.HasPrefix(prefix, "bronze/") && !isProcessableBronzeFITS(object.Key) {
			continue
		}

		if len(objects) < limit {
			objects = append(objects, ObjectInfo{
				Key:          object.Key,
				Size:         object.Size,
				ETag:         object.ETag,
				LastModified: object.LastModified,
			})
		} else {
			truncated = true
			nextCursor = objects[len(objects)-1].Key
			break
		}
	}

	return objects, nextCursor, truncated, nil
}

func isProcessableBronzeFITS(key string) bool {
	key = strings.ToLower(strings.TrimSpace(key))
	return strings.HasSuffix(key, ".fits") || strings.HasSuffix(key, ".fit") ||
		strings.HasSuffix(key, ".fits.gz") || strings.HasSuffix(key, ".fit.gz")
}
