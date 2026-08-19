package repository

import (
	"context"

	"go-api/infra/minio"
	"go-api/internal/domain/repo"
)

// ============================================================================
// OBJECT MINIO REPOSITORY (Adapter truy cập MinIO Object Storage)
// ============================================================================
// ObjectMinIO thực thi interface repo.ObjectRepository, cung cấp các thao tác
// cơ bản (Ping, ListObjects, GetObject) tới MinIO S3 bucket mà không chứa logic nghiệp vụ.
type ObjectMinIO struct {
	client *minio.Client // MinIO S3 Client
}

// NewObjectMinIO khởi tạo thể hiện ObjectMinIO repository adapter
func NewObjectMinIO(client *minio.Client) repo.ObjectRepository {
	return &ObjectMinIO{client: client}
}

// Ping kiểm tra kết nối tới máy chủ MinIO
func (r *ObjectMinIO) Ping(ctx context.Context) error {
	return r.client.Ping(ctx)
}

// ListObjects liệt kê danh sách đối tượng có tiền tố (prefix) trong bucket MinIO
func (r *ObjectMinIO) ListObjects(ctx context.Context, prefix string) ([]repo.ObjectInfo, error) {
	return r.client.ListObjects(ctx, prefix)
}

// GetObject tải về toàn bộ nội dung dạng bytes của một object theo key trong bucket MinIO
func (r *ObjectMinIO) GetObject(ctx context.Context, key string) ([]byte, error) {
	return r.client.GetObject(ctx, key)
}

// PutObject ghi dữ liệu dạng bytes lên object theo key trong bucket MinIO
func (r *ObjectMinIO) PutObject(ctx context.Context, key string, data []byte, contentType string) error {
	return r.client.PutObject(ctx, key, data, contentType)
}
