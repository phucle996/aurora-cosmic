package repository

import (
	"context"
	"strings"
	"testing"

	"go-api/infra/clickhouse"
	"go-api/internal/domain/entity"

	"github.com/ClickHouse/clickhouse-go/v2/lib/driver"
)

type fakeLineageConn struct {
	driver.Conn
	selectFn func(ctx context.Context, dest any, query string, args ...any) error
}

func (f *fakeLineageConn) Select(ctx context.Context, dest any, query string, args ...any) error {
	if f.selectFn != nil {
		return f.selectFn(ctx, dest, query, args...)
	}
	return nil
}

func TestLineageClickHouseTracesMatchedInputs(t *testing.T) {
	fake := &fakeLineageConn{
		selectFn: func(ctx context.Context, dest any, query string, args ...any) error {
			if !strings.Contains(query, "gold_lineage_inputs_v1") {
				t.Fatalf("unexpected query: %s", query)
			}
			if !strings.Contains(query, "WITH matched_inputs AS") {
				t.Fatalf("expected CTE-first query, got: %s", query)
			}
			rowsPtr, ok := dest.(*[]entity.GoldLineageInput)
			if !ok {
				t.Fatalf("dest is not *[]entity.GoldLineageInput")
			}
			*rowsPtr = []entity.GoldLineageInput{
				{
					SourceProductID: "source-1",
					SilverObjectKey: "silver/tess/1.parquet",
					SnapshotID:      "gold-v1-snap",
					Datasets:        []string{"candidate", "label"},
					Status:          "EXTRACTED",
				},
			}
			return nil
		},
	}

	repo := NewLineageClickHouse(clickhouse.NewClientWithConn(fake))
	resolutions, err := repo.TraceLineage(context.Background(), []entity.LineageLookup{
		{SourceProductID: "source-1", SilverObjectKey: "silver/tess/1.parquet"},
		{SourceProductID: "source-2", SilverObjectKey: "silver/tess/2.parquet"},
	})
	if err != nil {
		t.Fatalf("trace lineage: %v", err)
	}
	if len(resolutions) != 2 {
		t.Fatalf("expected 2 resolutions, got %d", len(resolutions))
	}
	if resolutions[0].Status != "EXTRACTED" || resolutions[0].SnapshotID != "gold-v1-snap" || len(resolutions[0].Datasets) != 2 {
		t.Fatalf("unexpected resolution 0: %#v", resolutions[0])
	}
	if resolutions[1].Status != "PENDING" || resolutions[1].SnapshotID != "" {
		t.Fatalf("expected resolution 1 to be PENDING, got %#v", resolutions[1])
	}
}

func TestLineageClickHouseEmptyLookups(t *testing.T) {
	fake := &fakeLineageConn{}
	repo := NewLineageClickHouse(clickhouse.NewClientWithConn(fake))
	resolutions, err := repo.TraceLineage(context.Background(), nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(resolutions) != 0 {
		t.Fatalf("expected 0 resolutions, got %d", len(resolutions))
	}
}
