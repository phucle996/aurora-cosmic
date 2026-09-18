package service

import (
	"context"
	"testing"

	"go-api/internal/domain/entity"
)

type mockTargetRepo struct {
	target *entity.TargetDetail
	lc     *entity.Lightcurve
}

func (r *mockTargetRepo) ListTargets(context.Context, entity.TargetQuery) (entity.Page[entity.Target], error) {
	return entity.Page[entity.Target]{}, nil
}

func (r *mockTargetRepo) GetTarget(context.Context, int64, int, string) (*entity.TargetDetail, error) {
	return r.target, nil
}

func (r *mockTargetRepo) GetLightcurve(context.Context, int64, int, entity.PageRequest) (*entity.Lightcurve, error) {
	return r.lc, nil
}

func TestTargetServiceGetTargetLinksCandidatePhysics(t *testing.T) {
	targetRepo := &mockTargetRepo{
		target: &entity.TargetDetail{
			Target: entity.Target{
				TICID:                 12345,
				Sector:                1,
				GoldSnapshotID:        "gold-1",
				HasCandidate:          true,
				CandidatePredictionID: "pred-1",
			},
		},
	}
	candRepo := &mockCandidateRepo{
		detail: &entity.CandidateDetail{
			Candidate: entity.Candidate{
				PredictionID: "pred-1",
				TICID:        12345,
				Sector:       1,
				SnapshotID:   "gold-1",
			},
			Evidence: entity.CandidateEvidence{
				BLSAvailable: true,
				BLSPeriod:    10.5,
				BLSDepth:     0.01,
			},
		},
	}

	targetSvc := NewTargetService(targetRepo, candRepo)
	detail, err := targetSvc.GetTarget(context.Background(), 12345, 1, "gold-1")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if detail == nil {
		t.Fatal("expected target detail, got nil")
	}
	if detail.Physics == nil {
		t.Fatal("expected physics calculation to be attached")
	}
	if detail.Habitability == nil {
		t.Fatal("expected habitability assessment to be attached")
	}
}
