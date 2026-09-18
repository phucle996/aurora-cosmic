package service

import (
	"context"

	"go-api/internal/domain/entity"
)

type FactoryHistory interface {
	ListRuns(context.Context, string, int) ([]entity.FactoryRun, error)
	GetRun(context.Context, string) (*entity.FactoryRunDetail, error)
	ListTickets(ctx context.Context, limit int) ([]entity.FactoryTicket, error)
	CreateTicket(ctx context.Context, ticketID string, description string) (*entity.FactoryTicket, error)
}
