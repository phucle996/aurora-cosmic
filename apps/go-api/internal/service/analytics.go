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
	"go-api/internal/physics"
)

// ============================================================================
// ANALYTICS SERVICE (Dịch vụ truy vấn dữ liệu khoa học & phân tích thiên văn)
// ============================================================================
// AnalyticsService chịu trách nhiệm:
// 1. Phục vụ truy vấn dữ liệu khoa học từ ClickHouse (Candidates, Anomalies, Targets, Light Curves).
// 2. Tích hợp tính toán vật lý thiên văn (Astrophysics Habitability) theo thời gian thực khi xem Candidate.
type AnalyticsService struct {
	repository repo.AnalyticsRepository // Repository truy vấn cơ sở dữ liệu phân tích ClickHouse
	objects    repo.ObjectRepository
}

// NewAnalyticsService khởi tạo thể hiện của AnalyticsService
func NewAnalyticsService(repository repo.AnalyticsRepository, objects repo.ObjectRepository) domainService.Analytics {
	return &AnalyticsService{repository: repository, objects: objects}
}

// ListCandidates phân trang danh sách các ứng viên ngoại hành tinh theo Sector và Snapshot ID
func (s *AnalyticsService) ListCandidates(ctx context.Context, sector int, snapshotID string, page entity.PageRequest) (entity.Page[entity.Candidate], error) {
	return s.repository.ListCandidates(ctx, sector, snapshotID, page)
}

// GetCandidate truy vấn chi tiết một ứng viên ngoại hành tinh:
// 1. Lấy thông tin dự đoán ML (Candidate) và bằng chứng quan sát (Evidence) từ ClickHouse.
// 2. Chạy thuật toán vật lý `physics.DeriveCandidate()` để tính toán bán kính, nhiệt độ, và chấm điểm Habitability Score.
func (s *AnalyticsService) GetCandidate(ctx context.Context, predictionID string, snapshotID string) (*entity.CandidateDetail, error) {
	detail, err := s.repository.GetCandidate(ctx, predictionID, snapshotID)
	if err != nil {
		return nil, err
	}

	// Bổ sung tầng tính toán vật lý và phân loại Habitable Zone trực tiếp
	detail.Physics, detail.Habitability = physics.DeriveCandidate(detail.Candidate, detail.Evidence)
	return detail, nil
}

// ListAnomalies phân trang danh sách các dị thường trắc quang được phát hiện bởi mô hình Autoencoder
func (s *AnalyticsService) ListAnomalies(ctx context.Context, sector int, snapshotID string, flaggedOnly bool, page entity.PageRequest) (entity.Page[entity.Anomaly], error) {
	return s.repository.ListAnomalies(ctx, sector, snapshotID, flaggedOnly, page)
}

func (s *AnalyticsService) GetAnomalyDetail(ctx context.Context, predictionID string, snapshotID string) (*entity.AnomalyDetail, error) {
	anomaly, err := s.repository.GetAnomaly(ctx, predictionID, snapshotID)
	if err != nil {
		return nil, err
	}
	detail := &entity.AnomalyDetail{Anomaly: *anomaly}
	if s.objects == nil {
		return detail, nil
	}
	bytes, err := s.objects.GetObject(ctx, "explanations/anomaly/"+predictionID+".json")
	if err != nil {
		if errors.Is(err, repo.ErrObjectNotFound) {
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
	if err := validateAnomalyExplanation(*anomaly, explanation); err != nil {
		return nil, err
	}
	detail.ExplanationAvailable = true
	detail.Explanation = &explanation
	return detail, nil
}

func validateAnomalyExplanation(anomaly entity.Anomaly, explanation entity.AnomalyExplanation) error {
	if explanation.SchemaVersion != 1 || explanation.ExplanationVersion != "anomaly-explanation-v1" {
		return fmt.Errorf("invalid anomaly explanation contract")
	}
	if explanation.PredictionID != anomaly.PredictionID || explanation.GoldSnapshotID != anomaly.SnapshotID ||
		explanation.SourceProductID != anomaly.SourceProductID || explanation.TICID != anomaly.TICID ||
		int(explanation.Sector) != anomaly.Sector || explanation.RuntimePackageID != anomaly.RuntimePkgID ||
		explanation.RuntimeValidationID != anomaly.ValidationID || explanation.RegisteredModelID != anomaly.RegisteredModel ||
		explanation.AboveThreshold != anomaly.AboveThreshold {
		return fmt.Errorf("anomaly explanation identity does not match prediction")
	}
	if !closeEnough(explanation.ReconstructionMSE, anomaly.ReconstructionMSE) || !closeEnough(explanation.DecisionThreshold, anomaly.Threshold) {
		return fmt.Errorf("anomaly explanation score does not match prediction")
	}
	if len(explanation.FeatureOrder) == 0 || len(explanation.Features) != len(explanation.FeatureOrder) {
		return fmt.Errorf("anomaly explanation feature set is invalid")
	}
	var totalSquared float64
	for index, feature := range explanation.Features {
		if feature.Name != explanation.FeatureOrder[index] || !finite(feature.StandardizedInput) || !finite(feature.Reconstruction) ||
			!finite(feature.ModelValue) || !finite(feature.Mean) || !finite(feature.Scale) || !finite(feature.Residual) ||
			!finite(feature.SquaredResidual) || !finite(feature.Contribution) || feature.SquaredResidual < 0 || feature.Contribution < 0 {
			return fmt.Errorf("anomaly explanation feature %d is invalid", index)
		}
		residual := feature.StandardizedInput - feature.Reconstruction
		if !closeEnough(feature.Residual, residual) || !closeEnough(feature.SquaredResidual, residual*residual) {
			return fmt.Errorf("anomaly explanation residual %q is invalid", feature.Name)
		}
		totalSquared += feature.SquaredResidual
	}
	if !closeEnough(explanation.ReconstructionMSE, totalSquared/float64(len(explanation.Features))) {
		return fmt.Errorf("anomaly explanation MSE is invalid")
	}
	for _, feature := range explanation.Features {
		expectedContribution := 0.0
		if totalSquared > 0 {
			expectedContribution = feature.SquaredResidual / totalSquared
		}
		if !closeEnough(feature.Contribution, expectedContribution) {
			return fmt.Errorf("anomaly explanation contribution %q is invalid", feature.Name)
		}
	}
	return nil
}

func closeEnough(left, right float64) bool {
	return math.Abs(left-right) <= 1e-8*math.Max(1, math.Max(math.Abs(left), math.Abs(right)))
}

func finite(value float64) bool { return !math.IsNaN(value) && !math.IsInf(value, 0) }

// ListTargets tìm kiếm và lọc danh sách các ngôi sao mục tiêu quan sát (TIC Targets)
func (s *AnalyticsService) ListTargets(ctx context.Context, query entity.TargetQuery) (entity.Page[entity.Target], error) {
	return s.repository.ListTargets(ctx, query)
}

// GetTarget truy vấn thông tin chi tiết một ngôi sao mục tiêu theo TIC ID và Sector,
// đồng thời tự động liên kết dữ liệu vật lý thực tế của ứng viên ngoại hành tinh nếu có.
func (s *AnalyticsService) GetTarget(ctx context.Context, ticID int64, sector int) (*entity.TargetDetail, error) {
	detail, err := s.repository.GetTarget(ctx, ticID, sector)
	if err != nil {
		return nil, err
	}
	if detail.Target.HasCandidate && detail.Target.CandidatePredictionID != "" {
		candDetail, candErr := s.repository.GetCandidate(ctx, detail.Target.CandidatePredictionID, "")
		if candErr == nil && candDetail != nil {
			phys, hab := physics.DeriveCandidate(candDetail.Candidate, candDetail.Evidence)
			detail.Physics = &phys
			detail.Habitability = &hab
			detail.Evidence = &candDetail.Evidence
		}
	}
	return detail, nil
}

// GetLightcurve phân trang chuỗi dữ liệu đường cong ánh sáng (Flux time-series) của một ngôi sao
func (s *AnalyticsService) GetLightcurve(ctx context.Context, ticID int64, sector int, page entity.PageRequest) (*entity.Lightcurve, error) {
	return s.repository.GetLightcurve(ctx, ticID, sector, page)
}
