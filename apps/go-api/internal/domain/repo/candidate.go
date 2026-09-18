package repo

import (
	"context"

	"go-api/internal/domain/entity"
)

// CandidateRepository định nghĩa các thao tác truy xuất và lưu trữ thẩm định ứng viên ngoại hành tinh.
type CandidateRepository interface {
	ListCandidates(ctx context.Context, query entity.CandidateQuery) (entity.Page[entity.Candidate], error)
	GetCandidate(ctx context.Context, predictionID string, snapshotID string) (*entity.CandidateDetail, error)
	SaveCandidateReview(ctx context.Context, input entity.CandidateReviewInput) (*entity.CandidateReview, error)
}
