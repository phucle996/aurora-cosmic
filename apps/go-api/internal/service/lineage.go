package service

import (
	"context"
	"fmt"
	"strings"

	"go-api/internal/domain/entity"
	"go-api/internal/domain/repo"
	domainService "go-api/internal/domain/service"
)

const maxLineageTraceInputs = 100

type lineageService struct {
	repo repo.LineageRepository
}

func NewLineageService(repo repo.LineageRepository) domainService.LineageService {
	return &lineageService{repo: repo}
}

func (s *lineageService) TraceLineage(ctx context.Context, inputs []entity.LineageLookup) ([]entity.LineageResolution, error) {
	if len(inputs) > maxLineageTraceInputs {
		return nil, fmt.Errorf("at most %d lineage trace inputs are allowed", maxLineageTraceInputs)
	}
	if s.repo == nil || len(inputs) == 0 {
		resolutions := make([]entity.LineageResolution, len(inputs))
		for index, input := range inputs {
			resolutions[index] = entity.LineageResolution{
				SourceProductID: strings.TrimSpace(input.SourceProductID),
				SilverObjectKey: strings.TrimSpace(input.SilverObjectKey),
				Status:          "PENDING",
			}
		}
		return resolutions, nil
	}
	return s.repo.TraceLineage(ctx, inputs)
}
