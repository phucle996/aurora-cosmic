package repo

import (
	"context"
	"time"
)

// CatalogObject ánh xạ một đối tượng dữ liệu lưu trữ trong Lakehouse (FITS, lightcurve, v.v.)
type CatalogObject struct {
	Tier         string
	ObjectKey    string
	SizeBytes    int64
	ETag         string
	Sector       int32
	TICID        int64
	ProductType  string
	LastModified time.Time
}

// LakehouseCatalogRepository định nghĩa các thao tác quản lý catalog trong ClickHouse
type LakehouseCatalogRepository interface {
	EnsureSchema(ctx context.Context) error
	UpsertObjects(ctx context.Context, objects []CatalogObject) error
	ListObjects(ctx context.Context, tier, prefix string, page, limit int) ([]CatalogObject, int64, int64, error)
	CountObjects(ctx context.Context, tier string) (int64, int64, error)
}
