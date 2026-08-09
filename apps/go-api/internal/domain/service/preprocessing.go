package service

import (
	"context"

	"go-api/internal/domain/entity"
)

type Preprocessing interface {
	Query(context.Context) (*entity.PreprocessingGraph, error)
}
