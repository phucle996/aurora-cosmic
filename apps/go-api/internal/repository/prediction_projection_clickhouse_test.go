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

func TestPredictionProjectionClickHouseReadsExactExistingIDs(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !strings.Contains(r.URL.Query().Get("query"), "FROM candidate_predictions") {
			t.Fatalf("unexpected query: %s", r.URL.Query().Get("query"))
		}
		_, _ = io.WriteString(w, `{"data":[{"prediction_id":"pred-cand-v1-existing"}]}`)
	}))
	defer server.Close()

	repository := NewPredictionProjectionClickHouse(clickhouse.NewClient(server.URL, "aurora", "", ""))
	existing, err := repository.ExistingPredictionIDs(
		context.Background(),
		"candidate_vetting",
		[]string{"pred-cand-v1-existing", "pred-cand-v1-new"},
	)
	if err != nil {
		t.Fatal(err)
	}
	if _, found := existing["pred-cand-v1-existing"]; !found || len(existing) != 1 {
		t.Fatalf("unexpected existing IDs: %#v", existing)
	}
}

func TestPredictionProjectionClickHouseWritesJSONEachRow(t *testing.T) {
	var inserted string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, err := io.ReadAll(r.Body)
		if err != nil {
			t.Fatal(err)
		}
		inserted = string(body)
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()

	repository := NewPredictionProjectionClickHouse(clickhouse.NewClient(server.URL, "aurora", "", ""))
	err := repository.InsertCandidatePredictions(context.Background(), []entity.CandidatePredictionProjection{{
		PredictionID: "pred-cand-v1-new", SourceProductID: "source-1", TICID: 1,
		Sector: 2, CandidateScore: 0.8, DecisionThreshold: 0.6,
		ModelVersion: "candidate-v1", RegisteredModelID: "model-v1",
		GoldSnapshotID: "gold-v1", RuntimeValidation: "validation-v1",
		RuntimePackageID: "runtime-v1", PredictedAt: "2026-09-03 01:02:03",
	}})
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(inserted, "INSERT INTO candidate_predictions FORMAT JSONEachRow\n") ||
		!strings.Contains(inserted, `"prediction_id":"pred-cand-v1-new"`) ||
		!strings.Contains(inserted, `"predicted_at":"2026-09-03 01:02:03"`) {
		t.Fatalf("unexpected insert payload: %s", inserted)
	}
}
