package service

import (
	"context"
	"testing"

	"go-api/internal/domain/entity"
)

type mockCandidateRepo struct {
	detail *entity.CandidateDetail
	input  *entity.CandidateReviewInput
	review *entity.CandidateReview
}

func (r *mockCandidateRepo) ListCandidates(context.Context, entity.CandidateQuery) (entity.Page[entity.Candidate], error) {
	return entity.Page[entity.Candidate]{}, nil
}

func (r *mockCandidateRepo) GetCandidate(context.Context, string, string) (*entity.CandidateDetail, error) {
	return r.detail, nil
}

func (r *mockCandidateRepo) SaveCandidateReview(_ context.Context, input entity.CandidateReviewInput) (*entity.CandidateReview, error) {
	r.input = &input
	return r.review, nil
}

func TestReviewCandidateDelegatesDirectlyToRepository(t *testing.T) {
	expectedReview := &entity.CandidateReview{
		SnapshotID:   "gold-v1-test",
		PredictionID: "prediction-v1",
		Decision:     "CONFIRMED",
		ReviewStatus: "REVIEWED",
		Reviewer:     "HUMAN_OPERATOR",
		Note:         "periodic evidence",
	}
	repository := &mockCandidateRepo{review: expectedReview}
	candidateSvc := NewCandidateService(repository)

	input := entity.CandidateReviewInput{
		PredictionID: "prediction-v1",
		SnapshotID:   "gold-v1-test",
		Decision:     "CONFIRMED",
		ReviewStatus: "REVIEWED",
		Reviewer:     "HUMAN_OPERATOR",
		Note:         "periodic evidence",
	}

	review, err := candidateSvc.ReviewCandidate(context.Background(), input)
	if err != nil {
		t.Fatalf("review candidate: %v", err)
	}
	if repository.input == nil {
		t.Fatal("scientific review input was not delegated to repository")
	}
	if repository.input.PredictionID != "prediction-v1" || repository.input.Decision != "CONFIRMED" {
		t.Fatalf("input not preserved: %#v", repository.input)
	}
	if review.Decision != "CONFIRMED" || review.ReviewStatus != "REVIEWED" || review.Reviewer != "HUMAN_OPERATOR" {
		t.Fatalf("unexpected review: %#v", review)
	}
}
