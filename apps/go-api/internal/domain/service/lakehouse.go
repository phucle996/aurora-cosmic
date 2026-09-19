package service

import (
	"context"

	"go-api/internal/domain/entity"
)

// Lakehouse defines the domain service port for browsing and inspecting Medallion Lakehouse artifacts.
type Lakehouse interface {
	List(ctx context.Context, query entity.LakehouseListingQuery) (*entity.LakehouseListing, error)
	Preview(ctx context.Context, query entity.LakehousePreviewQuery) (*entity.LakehousePreviewResponse, error)
}
