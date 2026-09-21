package service

import (
	"context"
	"testing"
	"time"

	"go-api/internal/domain/entity"
	"go-api/internal/provider"
)

type fakeLineageRepo struct {
	resolutions map[string]entity.LineageResolution
}

func (f *fakeLineageRepo) TraceLineage(_ context.Context, lookups []entity.LineageLookup) ([]entity.LineageResolution, error) {
	result := make([]entity.LineageResolution, len(lookups))
	for i, lookup := range lookups {
		if res, ok := f.resolutions[lookup.SourceProductID]; ok {
			result[i] = res
		} else {
			result[i] = entity.LineageResolution{
				SourceProductID: lookup.SourceProductID,
				SilverObjectKey: lookup.SilverObjectKey,
				Status:          "PENDING",
			}
		}
	}
	return result, nil
}

type fakeObjectStorage struct {
	objects map[string][]provider.ObjectInfo
}

func (f *fakeObjectStorage) Ping(_ context.Context) error { return nil }
func (f *fakeObjectStorage) ListObjects(_ context.Context, prefix string) ([]provider.ObjectInfo, error) {
	return f.objects[prefix], nil
}
func (f *fakeObjectStorage) ListObjectsWithMetadata(_ context.Context, prefix string) ([]provider.ObjectInfo, error) {
	return f.objects[prefix], nil
}
func (f *fakeObjectStorage) ListObjectsCursor(_ context.Context, prefix string, _ string, _ int) ([]provider.ObjectInfo, string, bool, error) {
	return f.objects[prefix], "", false, nil
}
func (f *fakeObjectStorage) GetObject(_ context.Context, _ string) ([]byte, error) { return nil, nil }
func (f *fakeObjectStorage) PutObject(_ context.Context, _ string, _ []byte, _ string) error {
	return nil
}
func (f *fakeObjectStorage) DeleteObject(_ context.Context, _ string) error { return nil }
func (f *fakeObjectStorage) StatPrefix(_ context.Context, _ string) (int, int64, error) {
	return 0, 0, nil
}

func TestLineageServiceTracesCommittedInputs(t *testing.T) {
	repo := &fakeLineageRepo{
		resolutions: map[string]entity.LineageResolution{
			"tess-lc-1": {
				SourceProductID: "tess-lc-1",
				SilverObjectKey: "silver/tess/lc-1.parquet",
				Status:          "EXTRACTED",
				SnapshotID:      "gold-v1-committed",
				Datasets:        []string{"candidate"},
			},
		},
	}
	svc := NewLineageService(repo, nil)
	resolved, err := svc.TraceLineage(context.Background(), []entity.LineageLookup{
		{SourceProductID: "tess-lc-1"}, {SourceProductID: "tess-lc-2"}, {SourceProductID: "missing"},
	})
	if err != nil {
		t.Fatal(err)
	}
	if resolved[0].Status != "EXTRACTED" || resolved[0].SnapshotID != "gold-v1-committed" || len(resolved[0].Datasets) != 1 {
		t.Fatalf("expected committed input to be extracted, got %#v", resolved[0])
	}
	if resolved[1].Status != "PENDING" || resolved[2].Status != "PENDING" {
		t.Fatalf("pending or missing inputs must not be inferred as extracted: %#v", resolved)
	}
}

func TestLineageServiceWithoutRepoDefaultsToPending(t *testing.T) {
	svc := NewLineageService(nil, nil)
	resolved, err := svc.TraceLineage(context.Background(), []entity.LineageLookup{{SourceProductID: "tess-lc-legacy"}})
	if err != nil {
		t.Fatal(err)
	}
	if len(resolved) != 1 || resolved[0].Status != "PENDING" {
		t.Fatalf("expected pending status without repo, got %#v", resolved)
	}
}

func TestLineageServiceGetLedger(t *testing.T) {
	now := time.Date(2026, 9, 20, 12, 0, 0, 0, time.UTC)
	fakeStorage := &fakeObjectStorage{
		objects: map[string][]provider.ObjectInfo{
			"bronze/tess/lightcurve/": {
				{
					Key:          "bronze/tess/lightcurve/sector=0001/tic=117516398/tess2018206045859-s0001-0000000117516398-0120-s_lc.fits",
					Size:         2039040,
					ETag:         "\"etag-b1\"",
					LastModified: now,
				},
				{
					Key:          "bronze/tess/lightcurve/sector=0001/tic=25155310/tess2018206045859-s0001-0000000025155310-0120-s_lc.fits",
					Size:         2039040,
					ETag:         "\"etag-b2\"",
					LastModified: now,
				},
			},
			"silver/tess/lightcurve/": {
				{
					Key:          "silver/tess/lightcurve/processor=lc-preprocess-v1/config=cfg1/sector=0001/tic=117516398/mast:TESS/product/tess2018206045859-s0001-0000000117516398-0120-s_lc.fits.parquet",
					Size:         318800,
					ETag:         "\"etag-s1\"",
					LastModified: now,
				},
				{
					Key:          "silver/tess/lightcurve/processor=lc-preprocess-v1/sector=0001/tic=25155310/tess2018206045859-s0001-0000000025155310-0120-s.parquet",
					Size:         339436,
					ETag:         "\"etag-s2\"",
					LastModified: now,
				},
			},
			"lineage/v1/tess/lightcurve/": {
				{
					// sha256(mast:TESS/product/tess2018206045859-s0001-0000000117516398-0120-s_lc.fits:lc-preprocess-v1)
					Key:          "lineage/v1/tess/lightcurve/4d536ed75ce0cd004a53144ad90791c1900051b66ebb9c6dea038eadbfc3dd9e.json",
					Size:         1993,
					ETag:         "\"etag-l1\"",
					LastModified: now,
				},
				{
					// sha256(tess2018206045859-s0001-0000000025155310-0120-s:lc-preprocess-v1)
					Key:          "lineage/v1/tess/lightcurve/3c411465d3d8eaa8317a8aada0a2f17c3ca9b87d69f2dc8c005c89e8c1005fc5.json",
					Size:         850,
					ETag:         "\"etag-l2\"",
					LastModified: now,
				},
			},
		},
	}

	repo := &fakeLineageRepo{
		resolutions: map[string]entity.LineageResolution{
			"mast:TESS/product/tess2018206045859-s0001-0000000117516398-0120-s_lc.fits": {
				SourceProductID: "mast:TESS/product/tess2018206045859-s0001-0000000117516398-0120-s_lc.fits",
				Status:          "EXTRACTED",
				SnapshotID:      "gold-snap-100",
				Datasets:        []string{"gold_dataset"},
			},
		},
	}

	svc := NewLineageService(repo, fakeStorage)

	resp, err := svc.GetLedger(context.Background(), entity.LineageLedgerQuery{
		ProductKind: "lightcurve",
		Page:        1,
		PageSize:    10,
	})
	if err != nil {
		t.Fatalf("GetLedger returned error: %v", err)
	}

	if resp.Total != 2 {
		t.Fatalf("expected total 2, got %d", resp.Total)
	}
	if resp.Inventory.Bronze != 2 || resp.Inventory.Silver != 2 || resp.Inventory.Lineage != 2 || resp.Inventory.Gold != 1 {
		t.Fatalf("unexpected inventory counts: %+v", resp.Inventory)
	}

	rec1 := resp.Items[0]
	if rec1.Silver == nil {
		t.Fatalf("expected item 0 to have matched silver, got nil")
	}
	if rec1.Lineage == nil {
		t.Fatalf("expected item 0 to have matched lineage, got nil")
	}
	if rec1.Gold == nil || rec1.Gold.Status != "EXTRACTED" {
		t.Fatalf("expected item 0 to be Gold EXTRACTED, got %+v", rec1.Gold)
	}

	// Filter by stage "silver" (item 0 is gold, item 1 is silver)
	respSilver, err := svc.GetLedger(context.Background(), entity.LineageLedgerQuery{
		ProductKind: "lightcurve",
		StageFilter: "silver",
		Page:        1,
		PageSize:    10,
	})
	if err != nil {
		t.Fatalf("GetLedger stage filter failed: %v", err)
	}
	if respSilver.Total != 1 || respSilver.Items[0].TICID != "25155310" {
		t.Fatalf("expected 1 silver-stage item (TIC 25155310), got total %d", respSilver.Total)
	}

	// Filter by stage "gold"
	respGold, err := svc.GetLedger(context.Background(), entity.LineageLedgerQuery{
		ProductKind: "lightcurve",
		StageFilter: "gold",
		Page:        1,
		PageSize:    10,
	})
	if err != nil {
		t.Fatalf("GetLedger gold stage filter failed: %v", err)
	}
	if respGold.Total != 1 || respGold.Items[0].TICID != "117516398" {
		t.Fatalf("expected 1 gold-stage item (TIC 117516398), got total %d", respGold.Total)
	}

	// Filter by search "117516398"
	respSearch, err := svc.GetLedger(context.Background(), entity.LineageLedgerQuery{
		ProductKind: "lightcurve",
		Search:      "117516398",
		Page:        1,
		PageSize:    10,
	})
	if err != nil {
		t.Fatalf("GetLedger search failed: %v", err)
	}
	if respSearch.Total != 1 || respSearch.Items[0].TICID != "117516398" {
		t.Fatalf("expected 1 search result with TIC 117516398, got %d", respSearch.Total)
	}
}
