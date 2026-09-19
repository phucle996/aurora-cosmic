package service

import (
	"context"

	"go-api/internal/domain/entity"
	"go-api/internal/domain/repo"
	domainService "go-api/internal/domain/service"
	"go-api/internal/physics"
)

// TargetService chịu trách nhiệm quản lý danh mục sao mục tiêu TIC và dữ liệu trắc quang quang phổ.
type TargetService struct {
	targetRepo repo.TargetRepository
}

// NewTargetService khởi tạo TargetService
func NewTargetService(targetRepo repo.TargetRepository) domainService.Target {
	return &TargetService{
		targetRepo: targetRepo,
	}
}

// ListTargets tìm kiếm và lọc danh sách các ngôi sao mục tiêu quan sát (TIC Targets)
func (s *TargetService) ListTargets(ctx context.Context, query entity.TargetQuery) (entity.Page[entity.Target], error) {
	return s.targetRepo.ListTargets(ctx, query)
}

// GetTarget truy vấn thông tin chi tiết một ngôi sao mục tiêu theo TIC ID và Sector,
// đồng thời tự động liên kết dữ liệu vật lý thực tế của ứng viên ngoại hành tinh nếu có.
func (s *TargetService) GetTarget(ctx context.Context, ticID int64, sector int, snapshotID string) (*entity.TargetDetail, error) {
	detail, err := s.targetRepo.GetTarget(ctx, ticID, sector, snapshotID)
	if err != nil {
		return nil, err
	}
	if detail.Evidence != nil {
		candidate := entity.Candidate{
			TICID:      detail.Target.TICID,
			Sector:     detail.Target.Sector,
			SnapshotID: detail.Target.GoldSnapshotID,
		}
		phys, hab := physics.DeriveCandidate(candidate, *detail.Evidence)
		detail.Physics = &phys
		detail.Habitability = &hab
	}
	return detail, nil
}

// GetLightcurve phân trang chuỗi dữ liệu đường cong ánh sáng (Flux time-series) của một ngôi sao
func (s *TargetService) GetLightcurve(ctx context.Context, ticID int64, sector int, page entity.PageRequest) (*entity.Lightcurve, error) {
	return s.targetRepo.GetLightcurve(ctx, ticID, sector, page)
}
