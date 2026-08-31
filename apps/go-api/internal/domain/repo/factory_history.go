package repo

import (
	"context"

	"go-api/internal/domain/entity"
)

type FactoryHistoryRepository interface {
	ListRuns(context.Context, string, int) ([]entity.FactoryRun, error)
	GetRun(context.Context, string) (*entity.FactoryRunDetail, error)
}
