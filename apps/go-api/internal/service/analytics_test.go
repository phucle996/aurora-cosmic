package service

import (
	"testing"

	"go-api/internal/domain/entity"
)

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
