package repository

import (
	"context"
	"strings"
	"testing"

	"go-api/infra/clickhouse"
	"go-api/internal/domain/entity"

	"github.com/ClickHouse/clickhouse-go/v2/lib/driver"
)

type fakeProjectionConn struct {
	driver.Conn
	selectFn       func(ctx context.Context, dest any, query string, args ...any) error
	prepareBatchFn func(ctx context.Context, query string, opts ...driver.PrepareBatchOption) (driver.Batch, error)
}

func (f *fakeProjectionConn) Select(ctx context.Context, dest any, query string, args ...any) error {
	if f.selectFn != nil {
		return f.selectFn(ctx, dest, query, args...)
	}
	return nil
}

func (f *fakeProjectionConn) PrepareBatch(ctx context.Context, query string, opts ...driver.PrepareBatchOption) (driver.Batch, error) {
	if f.prepareBatchFn != nil {
		return f.prepareBatchFn(ctx, query, opts...)
	}
	return nil, nil
}

type fakeBatch struct {
	driver.Batch
	appended [][]any
	sent     bool
}

func (b *fakeBatch) Append(v ...any) error {
	b.appended = append(b.appended, v)
	return nil
}

func (b *fakeBatch) Send() error {
	b.sent = true
	return nil
}

func TestPredictionProjectionClickHouseReadsExactExistingIDs(t *testing.T) {
	fake := &fakeProjectionConn{
		selectFn: func(ctx context.Context, dest any, query string, args ...any) error {
			if !strings.Contains(query, "FROM candidate_predictions") {
				t.Fatalf("unexpected query: %s", query)
			}
			idsPtr, ok := dest.(*[]string)
			if !ok {
				t.Fatalf("dest is not *[]string")
			}
			*idsPtr = []string{"pred-cand-v1-existing"}
			return nil
		},
	}

	repository := NewPredictionProjectionClickHouse(clickhouse.NewClientWithConn(fake))
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

func TestPredictionProjectionClickHouseWritesBatch(t *testing.T) {
	batch := &fakeBatch{}
	fake := &fakeProjectionConn{
		prepareBatchFn: func(ctx context.Context, query string, opts ...driver.PrepareBatchOption) (driver.Batch, error) {
			if !strings.Contains(query, "INSERT INTO candidate_predictions") {
				t.Fatalf("unexpected prepare batch query: %s", query)
			}
			return batch, nil
		},
	}

	repository := NewPredictionProjectionClickHouse(clickhouse.NewClientWithConn(fake))
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
	if !batch.sent {
		t.Fatalf("expected batch to be sent")
	}
	if len(batch.appended) != 1 {
		t.Fatalf("expected 1 row appended, got %d", len(batch.appended))
	}
	if batch.appended[0][0] != "pred-cand-v1-new" {
		t.Fatalf("unexpected first argument: %v", batch.appended[0][0])
	}
}
