package service

import (
	"context"

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
}

// NewAnalyticsService khởi tạo thể hiện của AnalyticsService
func NewAnalyticsService(repository repo.AnalyticsRepository) domainService.Analytics {
	return &AnalyticsService{repository: repository}
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

// ListTargets tìm kiếm và lọc danh sách các ngôi sao mục tiêu quan sát (TIC Targets)
func (s *AnalyticsService) ListTargets(ctx context.Context, query entity.TargetQuery) (entity.Page[entity.Target], error) {
	return s.repository.ListTargets(ctx, query)
}

// GetTarget truy vấn thông tin chi tiết một ngôi sao mục tiêu theo TIC ID và Sector
func (s *AnalyticsService) GetTarget(ctx context.Context, ticID int64, sector int) (*entity.TargetDetail, error) {
	return s.repository.GetTarget(ctx, ticID, sector)
}

// GetLightcurve phân trang chuỗi dữ liệu đường cong ánh sáng (Flux time-series) của một ngôi sao
func (s *AnalyticsService) GetLightcurve(ctx context.Context, ticID int64, sector int, page entity.PageRequest) (*entity.Lightcurve, error) {
	return s.repository.GetLightcurve(ctx, ticID, sector, page)
}
