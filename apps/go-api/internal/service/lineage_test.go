package service

import (
	"context"
	"testing"

	"go-api/internal/domain/entity"
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
	svc := NewLineageService(repo)
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
	svc := NewLineageService(nil)
	resolved, err := svc.TraceLineage(context.Background(), []entity.LineageLookup{{SourceProductID: "tess-lc-legacy"}})
	if err != nil {
		t.Fatal(err)
	}
	if len(resolved) != 1 || resolved[0].Status != "PENDING" {
		t.Fatalf("expected pending status without repo, got %#v", resolved)
	}
}
