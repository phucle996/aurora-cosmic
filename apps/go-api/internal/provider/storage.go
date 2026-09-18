package provider

import (
	"context"

	"go-api/infra/minio"
)

var ErrObjectNotFound = minio.ErrObjectNotFound

type ObjectInfo = minio.ObjectInfo

// ObjectStorage định nghĩa interface truy cập MinIO / S3 Object Storage provider
type ObjectStorage interface {
	Ping(ctx context.Context) error
	ListObjects(ctx context.Context, prefix string) ([]ObjectInfo, error)
	ListObjectsWithMetadata(ctx context.Context, prefix string) ([]ObjectInfo, error)
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

// ListObjects liệt kê danh sách đối tượng có tiền tố (prefix) trong bucket
func (r *minioObjectStorage) ListObjects(ctx context.Context, prefix string) ([]ObjectInfo, error) {
	return r.client.ListObjects(ctx, prefix)
}

// ListObjectsWithMetadata returns lightweight user metadata required for
// durable scientific evidence aggregation.
func (r *minioObjectStorage) ListObjectsWithMetadata(ctx context.Context, prefix string) ([]ObjectInfo, error) {
	return r.client.ListObjectsWithMetadata(ctx, prefix)
}

// GetObject tải về toàn bộ nội dung dạng bytes của một object theo key trong bucket
func (r *minioObjectStorage) GetObject(ctx context.Context, key string) ([]byte, error) {
	return r.client.GetObject(ctx, key)
}

// PutObject ghi dữ liệu dạng bytes lên object theo key trong bucket
func (r *minioObjectStorage) PutObject(ctx context.Context, key string, data []byte, contentType string) error {
	return r.client.PutObject(ctx, key, data, contentType)
}

// DeleteObject xóa một object theo key trong bucket
func (r *minioObjectStorage) DeleteObject(ctx context.Context, key string) error {
	return r.client.DeleteObject(ctx, key)
}
