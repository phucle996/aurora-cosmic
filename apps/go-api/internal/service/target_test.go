package service

import (
	"context"
	"testing"

	"go-api/internal/domain/entity"
)

type mockTargetRepo struct {
	target *entity.TargetInsightRecord
	lc     *entity.Lightcurve
}

func (r *mockTargetRepo) ListTargets(context.Context, entity.TargetQuery) (entity.Page[entity.Target], error) {
	return entity.Page[entity.Target]{}, nil
}

func (r *mockTargetRepo) GetTargetInsight(context.Context, int64, int, string) (*entity.TargetInsightRecord, error) {
	return r.target, nil
}

func (r *mockTargetRepo) GetLightcurve(context.Context, int64, int, entity.PageRequest) (*entity.Lightcurve, error) {
	return r.lc, nil
}

func (r *mockTargetRepo) GetTargetObservation(context.Context, int64, int, int) (*entity.TargetObservationResponse, error) {
	return &entity.TargetObservationResponse{
		TICID:  12345,
		Sector: 1,
		Lightcurve: entity.TargetObservationLC{
			Points: 10,
			Time:   make([]float64, 10),
			Flux:   make([]float64, 10),
		},
	}, nil
}

func TestTargetServiceGetTargetInsightDerivesPhysicsAndInsights(t *testing.T) {
	targetRepo := &mockTargetRepo{
		target: &entity.TargetInsightRecord{
			Target: entity.Target{
				TICID:                 12345,
				Sector:                1,
				GoldSnapshotID:        "gold-1",
				HasCandidate:          true,
				CandidatePredictionID: "pred-1",
				EffectiveT:            5800,
				Radius:                1.1,
			},
			Evidence: &entity.TargetEvidence{
				BLSAvailable: true,
				BLSPeriod:    10.5,
				BLSDepth:     0.01,
				Teff:         5800,
				StellarRadius: 1.1,
			},
		},
	}

	targetSvc := NewTargetService(targetRepo)
	resp, err := targetSvc.GetTargetInsight(context.Background(), 12345, 1, "gold-1")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if resp == nil {
		t.Fatal("expected target insight response, got nil")
	}
	if resp.Insights.Observation.Sector != 1 {
		t.Errorf("expected observation sector 1, got %d", resp.Insights.Observation.Sector)
	}
	if resp.Insights.StellarPhysics.Teff != 5800 {
		t.Errorf("expected stellar physics teff 5800, got %f", resp.Insights.StellarPhysics.Teff)
	}
	if resp.Insights.AIInsights.BLSPeriodDays == nil || *resp.Insights.AIInsights.BLSPeriodDays != 10.5 {
		t.Fatal("expected BLS period 10.5 in AI insights")
	}
	if resp.Insights.StellarPhysics.SpectralClassLabel == "" {
		t.Fatal("expected non-empty spectral class label")
	}
}
