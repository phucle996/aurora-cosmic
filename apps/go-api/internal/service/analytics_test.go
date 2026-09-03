package service

import (
	"context"
	"strings"
	"testing"

	"go-api/internal/domain/entity"
)

type candidateReviewRepository struct {
	detail *entity.CandidateDetail
	saved  *entity.CandidateReview
}

func (r *candidateReviewRepository) Ping(context.Context) error { return nil }
func (r *candidateReviewRepository) ListCandidates(context.Context, int, string, entity.PageRequest) (entity.Page[entity.Candidate], error) {
	return entity.Page[entity.Candidate]{}, nil
}
func (r *candidateReviewRepository) GetCandidate(context.Context, string, string) (*entity.CandidateDetail, error) {
	return r.detail, nil
}
func (r *candidateReviewRepository) SaveCandidateReview(_ context.Context, review entity.CandidateReview) error {
	r.saved = &review
	return nil
}
func (r *candidateReviewRepository) ListAnomalies(context.Context, int, string, bool, entity.PageRequest) (entity.Page[entity.Anomaly], error) {
	return entity.Page[entity.Anomaly]{}, nil
}
func (r *candidateReviewRepository) GetAnomaly(context.Context, string, string) (*entity.Anomaly, error) {
	return nil, nil
}
func (r *candidateReviewRepository) ListTargets(context.Context, entity.TargetQuery) (entity.Page[entity.Target], error) {
	return entity.Page[entity.Target]{}, nil
}
func (r *candidateReviewRepository) GetTarget(context.Context, int64, int, string) (*entity.TargetDetail, error) {
	return nil, nil
}
func (r *candidateReviewRepository) GetLightcurve(context.Context, int64, int, entity.PageRequest) (*entity.Lightcurve, error) {
	return nil, nil
}

func TestReviewCandidatePersistsScientificDecisionOutsideTrainingLabels(t *testing.T) {
	repository := &candidateReviewRepository{detail: &entity.CandidateDetail{Candidate: entity.Candidate{
		PredictionID: "prediction-v1", SnapshotID: "gold-v1-test", SourceProductID: "mast:TESS/test.fits",
		TICID: 101, Sector: 2,
	}}}
	analytics := NewAnalyticsService(repository, nil)
	review, err := analytics.ReviewCandidate(context.Background(), "prediction-v1", "gold-v1-test", " confirmed ", " periodic evidence ")
	if err != nil {
		t.Fatalf("review candidate: %v", err)
	}
	if repository.saved == nil {
		t.Fatal("scientific review was not persisted")
	}
	if review.Decision != "CONFIRMED" || review.ReviewStatus != "REVIEWED" || review.Reviewer != "HUMAN_OPERATOR" {
		t.Fatalf("unexpected review: %#v", review)
	}
	if review.Note != "periodic evidence" || review.SourceProductID != "mast:TESS/test.fits" {
		t.Fatalf("review lost evidence identity: %#v", review)
	}
}

func TestReviewCandidateRejectsTrainingLabelVocabulary(t *testing.T) {
	repository := &candidateReviewRepository{detail: &entity.CandidateDetail{}}
	analytics := NewAnalyticsService(repository, nil)
	if _, err := analytics.ReviewCandidate(context.Background(), "prediction-v1", "gold-v1-test", "POSITIVE", ""); err == nil || !strings.Contains(err.Error(), "scientific decision") {
		t.Fatalf("expected scientific-decision validation error, got %v", err)
	}
	if repository.saved != nil {
		t.Fatal("invalid training label was persisted as a scientific review")
	}
}

func TestValidateAnomalyExplanationAcceptsRecordedModelEvidence(t *testing.T) {
	anomaly := entity.Anomaly{
		PredictionID:      "pred-anom-v1-test",
		SourceProductID:   "product-test",
		TICID:             123,
		Sector:            42,
		ReconstructionMSE: 0.25,
		Threshold:         0.20,
		AboveThreshold:    true,
		RegisteredModel:   "anomaly-ae-v1",
		SnapshotID:        "gold-v1-test",
		ValidationID:      "validation-test",
		RuntimePkgID:      "runtime-test",
	}
	explanation := entity.AnomalyExplanation{
		SchemaVersion:       1,
		ExplanationVersion:  "anomaly-explanation-v1",
		PredictionID:        anomaly.PredictionID,
		GoldSnapshotID:      anomaly.SnapshotID,
		SourceProductID:     anomaly.SourceProductID,
		TICID:               anomaly.TICID,
		Sector:              int64(anomaly.Sector),
		RuntimePackageID:    anomaly.RuntimePkgID,
		RuntimeValidationID: anomaly.ValidationID,
		RegisteredModelID:   anomaly.RegisteredModel,
		FeatureOrder:        []string{"feature_a", "feature_b"},
		ReconstructionMSE:   anomaly.ReconstructionMSE,
		DecisionThreshold:   anomaly.Threshold,
		AboveThreshold:      anomaly.AboveThreshold,
		Features: []entity.AnomalyExplanationFeature{
			{Name: "feature_a", ModelValue: 1, Mean: 0, Scale: 1, StandardizedInput: 1, Reconstruction: 0.5, Residual: 0.5, SquaredResidual: 0.25, Contribution: 0.5},
			{Name: "feature_b", ModelValue: 2, Mean: 0, Scale: 1, StandardizedInput: 2, Reconstruction: 1.5, Residual: 0.5, SquaredResidual: 0.25, Contribution: 0.5},
		},
	}
	if err := validateAnomalyExplanation(anomaly, explanation); err != nil {
		t.Fatalf("valid explanation rejected: %v", err)
	}
}

func TestValidateAnomalyExplanationRejectsMismatchedContribution(t *testing.T) {
	anomaly := entity.Anomaly{PredictionID: "pred-anom-v1-test", SourceProductID: "product-test", TICID: 123, Sector: 42, ReconstructionMSE: 0.25, Threshold: 0.20, AboveThreshold: true, RegisteredModel: "anomaly-ae-v1", SnapshotID: "gold-v1-test", ValidationID: "validation-test", RuntimePkgID: "runtime-test"}
	explanation := entity.AnomalyExplanation{
		SchemaVersion: 1, ExplanationVersion: "anomaly-explanation-v1", PredictionID: anomaly.PredictionID, GoldSnapshotID: anomaly.SnapshotID, SourceProductID: anomaly.SourceProductID, TICID: anomaly.TICID, Sector: int64(anomaly.Sector), RuntimePackageID: anomaly.RuntimePkgID, RuntimeValidationID: anomaly.ValidationID, RegisteredModelID: anomaly.RegisteredModel,
		FeatureOrder: []string{"feature_a", "feature_b"}, ReconstructionMSE: anomaly.ReconstructionMSE, DecisionThreshold: anomaly.Threshold, AboveThreshold: anomaly.AboveThreshold,
		Features: []entity.AnomalyExplanationFeature{
			{Name: "feature_a", ModelValue: 1, Mean: 0, Scale: 1, StandardizedInput: 1, Reconstruction: 0.5, Residual: 0.5, SquaredResidual: 0.25, Contribution: 0.9},
			{Name: "feature_b", ModelValue: 2, Mean: 0, Scale: 1, StandardizedInput: 2, Reconstruction: 1.5, Residual: 0.5, SquaredResidual: 0.25, Contribution: 0.5},
		},
	}
	if err := validateAnomalyExplanation(anomaly, explanation); err == nil {
		t.Fatal("mismatched contribution accepted")
	}
}
