package service

import (
	"context"
	"encoding/json"
	"testing"

	"go-api/internal/domain/entity"
	"go-api/internal/provider"
)

type mockAnomalyRepo struct {
	anomaly *entity.Anomaly
}

func (r *mockAnomalyRepo) ListAnomalies(context.Context, int, string, bool, entity.PageRequest) (entity.Page[entity.Anomaly], error) {
	return entity.Page[entity.Anomaly]{}, nil
}

func (r *mockAnomalyRepo) GetAnomaly(context.Context, string, string) (*entity.Anomaly, error) {
	return r.anomaly, nil
}

func TestAnomalyService_GetAnomalyDetail_RejectsMismatchedContribution(t *testing.T) {
	anomaly := &entity.Anomaly{
		PredictionID:      "pred-anom-v1-test",
		SourceProductID:   "product-test",
		TICID:             123,
		Sector:            42,
		ReconstructionMSE: 0.25,
		Threshold:         0.20,
		AboveThreshold:    true,
		RegisteredModel:   "anomaly-ae-v1",
		SnapshotID:        "gold-v1-test",
		ValidationID:      "validation-test",
		RuntimePkgID:      "runtime-test",
	}
	explanation := entity.AnomalyExplanation{
		SchemaVersion:       1,
		ExplanationVersion:  "anomaly-explanation-v1",
		PredictionID:        anomaly.PredictionID,
		GoldSnapshotID:      anomaly.SnapshotID,
		SourceProductID:     anomaly.SourceProductID,
		TICID:               anomaly.TICID,
		Sector:              int64(anomaly.Sector),
		RuntimePackageID:    anomaly.RuntimePkgID,
		RuntimeValidationID: anomaly.ValidationID,
		RegisteredModelID:   anomaly.RegisteredModel,
		FeatureOrder:        []string{"feature_a", "feature_b"},
		ReconstructionMSE:   anomaly.ReconstructionMSE,
		DecisionThreshold:   anomaly.Threshold,
		AboveThreshold:      anomaly.AboveThreshold,
		Features: []entity.AnomalyExplanationFeature{
			{Name: "feature_a", ModelValue: 1, Mean: 0, Scale: 1, StandardizedInput: 1, Reconstruction: 0.5, Residual: 0.5, SquaredResidual: 0.25, Contribution: 0.9},
			{Name: "feature_b", ModelValue: 2, Mean: 0, Scale: 1, StandardizedInput: 2, Reconstruction: 1.5, Residual: 0.5, SquaredResidual: 0.25, Contribution: 0.5},
		},
	}
	bytes, err := json.Marshal(explanation)
	if err != nil {
		t.Fatalf("marshal explanation: %v", err)
	}
	storage := &mockStorage{
		data: map[string][]byte{
			"explanations/anomaly/pred-anom-v1-test.json": bytes,
		},
	}
	svc := NewAnomalyService(&mockAnomalyRepo{anomaly: anomaly}, storage)
	detail, err := svc.GetAnomalyDetail(context.Background(), "pred-anom-v1-test", "gold-v1-test")
	if err == nil {
		t.Fatal("expected error on mismatched contribution, got nil")
	}
	if detail != nil {
		t.Fatalf("expected nil detail on error, got %+v", detail)
	}
}

type mockStorage struct {
	data map[string][]byte
	err  error
}

func (m *mockStorage) Ping(ctx context.Context) error { return nil }
func (m *mockStorage) ListObjects(ctx context.Context, prefix string) ([]provider.ObjectInfo, error) {
	return nil, nil
}
func (m *mockStorage) ListObjectsWithMetadata(ctx context.Context, prefix string) ([]provider.ObjectInfo, error) {
	return nil, nil
}
func (m *mockStorage) GetObject(ctx context.Context, key string) ([]byte, error) {
	if m.err != nil {
		return nil, m.err
	}
	b, ok := m.data[key]
	if !ok {
		return nil, provider.ErrObjectNotFound
	}
	return b, nil
}
func (m *mockStorage) PutObject(ctx context.Context, key string, data []byte, contentType string) error {
	return nil
}
func (m *mockStorage) DeleteObject(ctx context.Context, key string) error { return nil }

func TestAnomalyService_GetAnomalyDetail_NotFoundStorage(t *testing.T) {
	anomaly := &entity.Anomaly{
		PredictionID: "pred-1",
		SnapshotID:   "snap-1",
	}
	svc := NewAnomalyService(&mockAnomalyRepo{anomaly: anomaly}, &mockStorage{})
	detail, err := svc.GetAnomalyDetail(context.Background(), "pred-1", "snap-1")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if detail.Anomaly.PredictionID != "pred-1" {
		t.Errorf("expected pred-1, got %s", detail.Anomaly.PredictionID)
	}
	if detail.ExplanationAvailable {
		t.Errorf("expected explanation to be false when storage has no file")
	}
}

func TestAnomalyService_ListAnomalies(t *testing.T) {
	svc := NewAnomalyService(&mockAnomalyRepo{}, &mockStorage{})
	page, err := svc.ListAnomalies(context.Background(), 1, "snap-1", false, entity.PageRequest{})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(page.Items) != 0 {
		t.Errorf("expected empty page, got %d", len(page.Items))
	}
}

func TestAnomalyService_GetAnomalyDetail_WithValidExplanation(t *testing.T) {
	anomaly := &entity.Anomaly{
		PredictionID:      "pred-anom-v1-test",
		SourceProductID:   "product-test",
		TICID:             123,
		Sector:            42,
		ReconstructionMSE: 0.25,
		Threshold:         0.20,
		AboveThreshold:    true,
		RegisteredModel:   "anomaly-ae-v1",
		SnapshotID:        "gold-v1-test",
		ValidationID:      "validation-test",
		RuntimePkgID:      "runtime-test",
	}
	explanation := entity.AnomalyExplanation{
		SchemaVersion:       1,
		ExplanationVersion:  "anomaly-explanation-v1",
		PredictionID:        anomaly.PredictionID,
		GoldSnapshotID:      anomaly.SnapshotID,
		SourceProductID:     anomaly.SourceProductID,
		TICID:               anomaly.TICID,
		Sector:              int64(anomaly.Sector),
		RuntimePackageID:    anomaly.RuntimePkgID,
		RuntimeValidationID: anomaly.ValidationID,
		RegisteredModelID:   anomaly.RegisteredModel,
		FeatureOrder:        []string{"feature_a", "feature_b"},
		ReconstructionMSE:   anomaly.ReconstructionMSE,
		DecisionThreshold:   anomaly.Threshold,
		AboveThreshold:      anomaly.AboveThreshold,
		Features: []entity.AnomalyExplanationFeature{
			{Name: "feature_a", ModelValue: 1, Mean: 0, Scale: 1, StandardizedInput: 1, Reconstruction: 0.5, Residual: 0.5, SquaredResidual: 0.25, Contribution: 0.5},
			{Name: "feature_b", ModelValue: 2, Mean: 0, Scale: 1, StandardizedInput: 2, Reconstruction: 1.5, Residual: 0.5, SquaredResidual: 0.25, Contribution: 0.5},
		},
	}
	bytes, err := json.Marshal(explanation)
	if err != nil {
		t.Fatalf("marshal explanation: %v", err)
	}
	storage := &mockStorage{
		data: map[string][]byte{
			"explanations/anomaly/pred-anom-v1-test.json": bytes,
		},
	}
	svc := NewAnomalyService(&mockAnomalyRepo{anomaly: anomaly}, storage)
	detail, err := svc.GetAnomalyDetail(context.Background(), "pred-anom-v1-test", "gold-v1-test")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !detail.ExplanationAvailable {
		t.Fatalf("expected explanation to be available")
	}
	if detail.Explanation == nil || detail.Explanation.PredictionID != "pred-anom-v1-test" {
		t.Fatalf("explanation not properly decoded: %+v", detail.Explanation)
	}
}


