package service

import (
	"context"

	"go-api/internal/domain/entity"
	"go-api/internal/domain/repo"
	domainService "go-api/internal/domain/service"
	"go-api/internal/physics"
)

// CandidateService chịu trách nhiệm quản lý ứng viên ngoại hành tinh và quy trình thẩm định.
type CandidateService struct {
	repository repo.CandidateRepository
}

// NewCandidateService khởi tạo CandidateService
func NewCandidateService(repository repo.CandidateRepository) domainService.Candidate {
	return &CandidateService{repository: repository}
}

// ListCandidates phân trang danh sách các ứng viên ngoại hành tinh theo CandidateQuery
func (s *CandidateService) ListCandidates(ctx context.Context, query entity.CandidateQuery) (entity.Page[entity.Candidate], error) {
	return s.repository.ListCandidates(ctx, query)
}

// GetCandidate truy vấn chi tiết một ứng viên ngoại hành tinh:
// 1. Lấy thông tin dự đoán ML (Candidate) và bằng chứng quan sát (Evidence) từ ClickHouse.
// 2. Chạy thuật toán vật lý `physics.DeriveCandidate()` để tính toán bán kính, nhiệt độ, và chấm điểm Habitability Score.
func (s *CandidateService) GetCandidate(ctx context.Context, predictionID string, snapshotID string) (*entity.CandidateDetail, error) {
	detail, err := s.repository.GetCandidate(ctx, predictionID, snapshotID)
	if err != nil {
		return nil, err
	}

	// Bổ sung tầng tính toán vật lý và phân loại Habitable Zone trực tiếp
	detail.Physics, detail.Habitability = physics.DeriveCandidate(detail.Candidate, detail.Evidence)
	return detail, nil
}

// ReviewCandidate chuyển tiếp yêu cầu thẩm định chuyên gia tới repository
func (s *CandidateService) ReviewCandidate(ctx context.Context, input entity.CandidateReviewInput) (*entity.CandidateReview, error) {
	return s.repository.SaveCandidateReview(ctx, input)
}
