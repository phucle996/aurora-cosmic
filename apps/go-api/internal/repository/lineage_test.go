package repository

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"go-api/infra/clickhouse"
	"go-api/internal/domain/entity"
)

func TestLineageClickHouseTracesMatchedInputs(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		query := r.URL.Query().Get("query")
		if !strings.Contains(query, "gold_lineage_inputs_v1") {
			t.Fatalf("unexpected query: %s", query)
		}
		if !strings.Contains(query, "WITH matched_inputs AS") {
			t.Fatalf("expected CTE-first query, got: %s", query)
		}
		_, _ = io.WriteString(w, `{"data":[{"source_product_id":"source-1","silver_object_key":"silver/tess/1.parquet","snapshot_id":"gold-v1-snap","datasets":["candidate","label"],"status":"EXTRACTED"}]}`)
	}))
	defer server.Close()

	repo := NewLineageClickHouse(clickhouse.NewClient(server.URL, "aurora", "", ""))
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
	repo := NewLineageClickHouse(clickhouse.NewClient("http://127.0.0.1:9999", "aurora", "", ""))
	resolutions, err := repo.TraceLineage(context.Background(), nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(resolutions) != 0 {
		t.Fatalf("expected 0 resolutions, got %d", len(resolutions))
	}
}
