package service

import (
	"context"

	"go-api/internal/domain/entity"
)

type Ticket interface {
	ListTickets(ctx context.Context, limit int) ([]entity.RunnerTicket, error)
	CreateTicket(ctx context.Context, ticketID string, description string) (*entity.RunnerTicket, error)
	ListRuns(ctx context.Context, pipeline string, limit int) ([]entity.PipelineRun, error)
	Detail(ctx context.Context, runID string) (*entity.PipelineRunDetail, error)
}
