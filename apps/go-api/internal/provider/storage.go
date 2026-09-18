package provider

import (
	"context"

	"go-api/infra/minio"
	"go-api/internal/domain/repo"
)

// ============================================================================
// OBJECT STORAGE PROVIDER (Adapter truy cập MinIO / S3 Object Storage)
// ============================================================================
// ObjectStorage thực thi interface repo.ObjectRepository và repo.ObjectMetadataRepository,
// cung cấp các thao tác kỹ thuật thuần túy (Ping, ListObjects, GetObject, PutObject, DeleteObject)
// tới object storage mà không chứa logic nghiệp vụ ứng dụng.
type ObjectStorage struct {
	client *minio.Client
}

// NewObjectStorage khởi tạo thể hiện ObjectStorage provider
func NewObjectStorage(client *minio.Client) repo.ObjectRepository {
	return &ObjectStorage{client: client}
}

// Ping kiểm tra kết nối tới máy chủ MinIO
func (r *ObjectStorage) Ping(ctx context.Context) error {
	return r.client.Ping(ctx)
}

// ListObjects liệt kê danh sách đối tượng có tiền tố (prefix) trong bucket
func (r *ObjectStorage) ListObjects(ctx context.Context, prefix string) ([]repo.ObjectInfo, error) {
	return r.client.ListObjects(ctx, prefix)
}

// ListObjectsWithMetadata returns lightweight user metadata required for
// durable scientific evidence aggregation.
func (r *ObjectStorage) ListObjectsWithMetadata(ctx context.Context, prefix string) ([]repo.ObjectInfo, error) {
	return r.client.ListObjectsWithMetadata(ctx, prefix)
}

// GetObject tải về toàn bộ nội dung dạng bytes của một object theo key trong bucket
func (r *ObjectStorage) GetObject(ctx context.Context, key string) ([]byte, error) {
	return r.client.GetObject(ctx, key)
}

// PutObject ghi dữ liệu dạng bytes lên object theo key trong bucket
func (r *ObjectStorage) PutObject(ctx context.Context, key string, data []byte, contentType string) error {
	return r.client.PutObject(ctx, key, data, contentType)
}

// DeleteObject xóa một object theo key trong bucket
func (r *ObjectStorage) DeleteObject(ctx context.Context, key string) error {
	return r.client.DeleteObject(ctx, key)
}
