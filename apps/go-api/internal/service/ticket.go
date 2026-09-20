package service

import (
	"context"

	"go-api/internal/domain/entity"
	"go-api/internal/domain/repo"
	domainService "go-api/internal/domain/service"
)

type TicketService struct{ repository repo.TicketRepository }

func NewTicketService(repository repo.TicketRepository) domainService.Ticket {
	return &TicketService{repository: repository}
}

func (s *TicketService) ListTickets(ctx context.Context, limit int) ([]entity.RunnerTicket, error) {
	return s.repository.ListTickets(ctx, limit)
}

func (s *TicketService) CreateTicket(ctx context.Context, ticketID string, description string) (*entity.RunnerTicket, error) {
	return s.repository.CreateTicket(ctx, ticketID, description)
}

func (s *TicketService) ListRuns(ctx context.Context, pipeline string, limit int) ([]entity.PipelineRun, error) {
	return s.repository.ListRuns(ctx, pipeline, limit)
}

func (s *TicketService) Detail(ctx context.Context, runID string) (*entity.PipelineRunDetail, error) {
	return s.repository.Detail(ctx, runID)
}
