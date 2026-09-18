package service

import (
	"context"
	"fmt"
	"strings"

	"go-api/internal/domain/entity"
	"go-api/internal/domain/repo"
	domainService "go-api/internal/domain/service"
)

type FactoryHistoryService struct{ repository repo.FactoryHistoryRepository }

func NewFactoryHistoryService(repository repo.FactoryHistoryRepository) domainService.FactoryHistory {
	return &FactoryHistoryService{repository: repository}
}

func (s *FactoryHistoryService) ListRuns(ctx context.Context, pipeline string, limit int) ([]entity.FactoryRun, error) {
	if s == nil || s.repository == nil {
		return nil, fmt.Errorf("factory history is unavailable")
	}
	if limit <= 0 || limit > 100 {
		limit = 50
	}
	return s.repository.ListRuns(ctx, strings.TrimSpace(pipeline), limit)
}

func (s *FactoryHistoryService) GetRun(ctx context.Context, runID string) (*entity.FactoryRunDetail, error) {
	if s == nil || s.repository == nil {
		return nil, fmt.Errorf("factory history is unavailable")
	}
	runID = strings.TrimSpace(runID)
	if runID == "" {
		return nil, fmt.Errorf("run_id is required")
	}
	return s.repository.GetRun(ctx, runID)
}

func (s *FactoryHistoryService) ListTickets(ctx context.Context, limit int) ([]entity.FactoryTicket, error) {
	if s == nil || s.repository == nil {
		return nil, fmt.Errorf("factory history is unavailable")
	}
	if limit <= 0 || limit > 200 {
		limit = 100
	}
	return s.repository.ListTickets(ctx, limit)
}

func (s *FactoryHistoryService) CreateTicket(ctx context.Context, ticketID string, description string) (*entity.FactoryTicket, error) {
	if s == nil || s.repository == nil {
		return nil, fmt.Errorf("factory history is unavailable")
	}
	ticketID = strings.TrimSpace(ticketID)
	return s.repository.CreateTicket(ctx, ticketID, strings.TrimSpace(description))
}
