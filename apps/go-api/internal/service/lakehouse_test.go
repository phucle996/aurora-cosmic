package service

import (
	"context"
	"strings"
	"testing"
	"time"

	"go-api/internal/domain/entity"
	"go-api/internal/provider"
)

type fakeLakehouseStorage struct {
	objects map[string][]byte
}

func (f fakeLakehouseStorage) Ping(context.Context) error { return nil }

func (f fakeLakehouseStorage) GetObject(_ context.Context, key string) ([]byte, error) {
	data, ok := f.objects[key]
	if !ok {
		return nil, provider.ErrObjectNotFound
	}
	return data, nil
}

func (f fakeLakehouseStorage) ListObjects(_ context.Context, prefix string) ([]provider.ObjectInfo, error) {
	var list []provider.ObjectInfo
	for k, v := range f.objects {
		if prefix == "" || strings.HasPrefix(k, prefix) {
			list = append(list, provider.ObjectInfo{Key: k, Size: int64(len(v)), LastModified: time.Now()})
		}
	}
	return list, nil
}

func (f fakeLakehouseStorage) ListObjectsWithMetadata(ctx context.Context, prefix string) ([]provider.ObjectInfo, error) {
	return f.ListObjects(ctx, prefix)
}

func (f fakeLakehouseStorage) ListObjectsCursor(_ context.Context, prefix, cursor string, limit int) ([]provider.ObjectInfo, string, bool, error) {
	var list []provider.ObjectInfo
	for k, v := range f.objects {
		if prefix == "" || strings.HasPrefix(k, prefix) {
			list = append(list, provider.ObjectInfo{Key: k, Size: int64(len(v)), LastModified: time.Now()})
		}
	}
	return list, "", false, nil
}

func (f fakeLakehouseStorage) PutObject(_ context.Context, key string, data []byte, _ string) error {
	f.objects[key] = data
	return nil
}

func (f fakeLakehouseStorage) DeleteObject(_ context.Context, key string) error {
	delete(f.objects, key)
	return nil
}

func (f fakeLakehouseStorage) StatPrefix(_ context.Context, prefix string) (int, int64, error) {
	var total int
	var totalBytes int64
	for k, v := range f.objects {
		if strings.HasPrefix(k, prefix) {
			total++
			totalBytes += int64(len(v))
		}
	}
	return total, totalBytes, nil
}

func TestLakehouseService_List(t *testing.T) {
	store := fakeLakehouseStorage{
		objects: map[string][]byte{
			"bronze/tess/lightcurve/s1.fits":    []byte("fits-data"),
			"silver/tess/lightcurve/s1.parquet": []byte("pq-data-1"),
			"silver/tess/lightcurve/s2.parquet": []byte("pq-data-2"),
			"gold/snapshots/g1/manifest.json":   []byte("{}"),
		},
	}
	svc := NewLakehouseService(store, "aurora")

	// 1. Prefix filter
	listing, err := svc.List(context.Background(), entity.LakehouseListingQuery{Prefix: "silver/", Page: 1, Limit: 10})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if listing.Bucket != "aurora" {
		t.Errorf("expected bucket aurora, got %s", listing.Bucket)
	}
	if listing.Total != 2 {
		t.Errorf("expected 2 total silver objects, got %d", listing.Total)
	}

	// 2. Search filter
	searchListing, err := svc.List(context.Background(), entity.LakehouseListingQuery{Prefix: "silver/", Search: "s2", Page: 1, Limit: 10})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if searchListing.Total != 1 {
		t.Errorf("expected 1 matched object for 's2', got %d", searchListing.Total)
	}

	// 3. Random-access page jumping
	pageListing, err := svc.List(context.Background(), entity.LakehouseListingQuery{Prefix: "silver/", Page: 2, Limit: 1})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if pageListing.TotalPages != 2 {
		t.Errorf("expected 2 total pages, got %d", pageListing.TotalPages)
	}
	if len(pageListing.Objects) != 1 {
		t.Errorf("expected 1 object on page 2, got %d", len(pageListing.Objects))
	}
}

func TestLakehouseService_PreviewJSON(t *testing.T) {
	store := fakeLakehouseStorage{
		objects: map[string][]byte{
			"gold/snapshots/g1/manifest.json": []byte(`{"snapshot_id":"g1","status":"COMMITTED"}`),
		},
	}
	svc := NewLakehouseService(store, "aurora")

	resp, err := svc.Preview(context.Background(), entity.LakehousePreviewQuery{Key: "gold/snapshots/g1/manifest.json"})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if resp.Format != "json" {
		t.Errorf("expected json format, got %s", resp.Format)
	}
	if resp.Tier != "gold" {
		t.Errorf("expected gold tier, got %s", resp.Tier)
	}
	if resp.JSONContent == nil {
		t.Error("expected parsed JSONContent, got nil")
	}
}

func TestLakehouseService_Summary(t *testing.T) {
	store := fakeLakehouseStorage{
		objects: map[string][]byte{
			"bronze/tess/s1.fits":    []byte("12345"),
			"bronze/tess/s2.fits":    []byte("12345"),
			"silver/tess/s1.parquet": []byte("12345678"),
			"gold/snapshots/m.json":  []byte("123"),
		},
	}
	svc := NewLakehouseService(store, "aurora")

	summary, err := svc.Summary(context.Background())
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if summary.Bronze.Total != 2 || summary.Bronze.TotalBytes != 10 {
		t.Errorf("expected bronze total 2, bytes 10; got %d, %d", summary.Bronze.Total, summary.Bronze.TotalBytes)
	}
	if summary.Silver.Total != 1 || summary.Silver.TotalBytes != 8 {
		t.Errorf("expected silver total 1, bytes 8; got %d, %d", summary.Silver.Total, summary.Silver.TotalBytes)
	}
	if summary.Gold.Total != 1 || summary.Gold.TotalBytes != 3 {
		t.Errorf("expected gold total 1, bytes 3; got %d, %d", summary.Gold.Total, summary.Gold.TotalBytes)
	}
}
