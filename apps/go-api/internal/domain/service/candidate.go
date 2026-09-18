package service

import (
	"context"

	"go-api/internal/domain/entity"
)

// Candidate định nghĩa service contract cho ứng viên ngoại hành tinh và quy trình thẩm định.
type Candidate interface {
	ListCandidates(ctx context.Context, query entity.CandidateQuery) (entity.Page[entity.Candidate], error)
	GetCandidate(ctx context.Context, predictionID string, snapshotID string) (*entity.CandidateDetail, error)
	ReviewCandidate(ctx context.Context, input entity.CandidateReviewInput) (*entity.CandidateReview, error)
}
