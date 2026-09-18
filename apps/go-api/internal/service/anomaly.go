package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math"

	"go-api/internal/domain/entity"
	"go-api/internal/domain/repo"
	domainService "go-api/internal/domain/service"
	"go-api/internal/provider"
)

// AnomalyService chịu trách nhiệm quản lý dị thường trắc quang và tích hợp sidecar giải thích mô hình từ object storage.
type AnomalyService struct {
	repository repo.AnomalyRepository
	storage    provider.ObjectStorage
}

// NewAnomalyService khởi tạo AnomalyService
func NewAnomalyService(repository repo.AnomalyRepository, storage provider.ObjectStorage) domainService.Anomaly {
	return &AnomalyService{repository: repository, storage: storage}
}

// ListAnomalies phân trang danh sách các dị thường trắc quang được phát hiện bởi mô hình Autoencoder
func (s *AnomalyService) ListAnomalies(ctx context.Context, sector int, snapshotID string, flaggedOnly bool, page entity.PageRequest) (entity.Page[entity.Anomaly], error) {
	return s.repository.ListAnomalies(ctx, sector, snapshotID, flaggedOnly, page)
}

// GetAnomalyDetail truy vấn chi tiết một dị thường và giải mã sidecar giải thích từ object storage nếu có
func (s *AnomalyService) GetAnomalyDetail(ctx context.Context, predictionID string, snapshotID string) (*entity.AnomalyDetail, error) {
	anomaly, err := s.repository.GetAnomaly(ctx, predictionID, snapshotID)
	if err != nil {
		return nil, err
	}
	detail := &entity.AnomalyDetail{Anomaly: *anomaly}
	if s.storage == nil {
		return detail, nil
	}
	bytes, err := s.storage.GetObject(ctx, "explanations/anomaly/"+predictionID+".json")
	if err != nil {
		if errors.Is(err, provider.ErrObjectNotFound) {
			// Old predictions predate the explanation sidecar. Keep their summary
			// reviewable instead of making the entire detail endpoint unavailable.
			return detail, nil
		}
		return nil, fmt.Errorf("read anomaly explanation: %w", err)
	}
	var explanation entity.AnomalyExplanation
	if err := json.Unmarshal(bytes, &explanation); err != nil {
		return nil, fmt.Errorf("decode anomaly explanation: %w", err)
	}

	if explanation.SchemaVersion != 1 || explanation.ExplanationVersion != "anomaly-explanation-v1" {
		return nil, fmt.Errorf("invalid anomaly explanation contract")
	}
	if explanation.PredictionID != anomaly.PredictionID || explanation.GoldSnapshotID != anomaly.SnapshotID ||
		explanation.SourceProductID != anomaly.SourceProductID || explanation.TICID != anomaly.TICID ||
		int(explanation.Sector) != anomaly.Sector || explanation.RuntimePackageID != anomaly.RuntimePkgID ||
		explanation.RuntimeValidationID != anomaly.ValidationID || explanation.RegisteredModelID != anomaly.RegisteredModel ||
		explanation.AboveThreshold != anomaly.AboveThreshold {
		return nil, fmt.Errorf("anomaly explanation identity does not match prediction")
	}

	closeEnough := func(left, right float64) bool {
		return math.Abs(left-right) <= 1e-8*math.Max(1, math.Max(math.Abs(left), math.Abs(right)))
	}

	if !closeEnough(explanation.ReconstructionMSE, anomaly.ReconstructionMSE) || !closeEnough(explanation.DecisionThreshold, anomaly.Threshold) {
		return nil, fmt.Errorf("anomaly explanation score does not match prediction")
	}
	if len(explanation.FeatureOrder) == 0 || len(explanation.Features) != len(explanation.FeatureOrder) {
		return nil, fmt.Errorf("anomaly explanation feature set is invalid")
	}
	var totalSquared float64
	for index, feature := range explanation.Features {
		if feature.Name != explanation.FeatureOrder[index] ||
			math.IsNaN(feature.StandardizedInput) || math.IsInf(feature.StandardizedInput, 0) ||
			math.IsNaN(feature.Reconstruction) || math.IsInf(feature.Reconstruction, 0) ||
			math.IsNaN(feature.ModelValue) || math.IsInf(feature.ModelValue, 0) ||
			math.IsNaN(feature.Mean) || math.IsInf(feature.Mean, 0) ||
			math.IsNaN(feature.Scale) || math.IsInf(feature.Scale, 0) ||
			math.IsNaN(feature.Residual) || math.IsInf(feature.Residual, 0) ||
			math.IsNaN(feature.SquaredResidual) || math.IsInf(feature.SquaredResidual, 0) ||
			math.IsNaN(feature.Contribution) || math.IsInf(feature.Contribution, 0) ||
			feature.SquaredResidual < 0 || feature.Contribution < 0 {
			return nil, fmt.Errorf("anomaly explanation feature %d is invalid", index)
		}
		residual := feature.StandardizedInput - feature.Reconstruction
		if !closeEnough(feature.Residual, residual) || !closeEnough(feature.SquaredResidual, residual*residual) {
			return nil, fmt.Errorf("anomaly explanation residual %q is invalid", feature.Name)
		}
		totalSquared += feature.SquaredResidual
	}
	if !closeEnough(explanation.ReconstructionMSE, totalSquared/float64(len(explanation.Features))) {
		return nil, fmt.Errorf("anomaly explanation MSE is invalid")
	}
	for _, feature := range explanation.Features {
		expectedContribution := 0.0
		if totalSquared > 0 {
			expectedContribution = feature.SquaredResidual / totalSquared
		}
		if !closeEnough(feature.Contribution, expectedContribution) {
			return nil, fmt.Errorf("anomaly explanation contribution %q is invalid", feature.Name)
		}
	}

	detail.ExplanationAvailable = true
	detail.Explanation = &explanation
	return detail, nil
}
