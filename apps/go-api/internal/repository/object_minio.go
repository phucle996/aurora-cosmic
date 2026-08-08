package repository

import (
	"context"

	"go-api/infra/minio"
	"go-api/internal/domain/repo"
)

// ObjectMinIO is the repository adapter for raw object access. Business
// workflows such as model integrity and champion selection stay in services.
type ObjectMinIO struct{ client *minio.Client }

func NewObjectMinIO(client *minio.Client) repo.ObjectRepository {
	return &ObjectMinIO{client: client}
}
func (r *ObjectMinIO) Ping(ctx context.Context) error { return r.client.Ping(ctx) }
func (r *ObjectMinIO) ListObjects(ctx context.Context, prefix string) ([]repo.ObjectInfo, error) {
	return r.client.ListObjects(ctx, prefix)
}
func (r *ObjectMinIO) GetObject(ctx context.Context, key string) ([]byte, error) {
	return r.client.GetObject(ctx, key)
}
