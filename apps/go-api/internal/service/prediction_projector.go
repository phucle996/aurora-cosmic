package service

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"sort"
	"strings"
	"time"

	"go-api/internal/domain/entity"
	"go-api/internal/domain/repo"
	domainService "go-api/internal/domain/service"
)

const (
	candidateTask = "candidate_vetting"
	anomalyTask   = "astronomical_anomaly_detection"
)

type PredictionProjectorService struct {
	objects        repo.ObjectRepository
	predictions    repo.PredictionProjectionRepository
	expectedBucket string
}

type inferenceCompletionEvent struct {
	SchemaVersion    int    `json:"schema_version"`
	EventID          string `json:"event_id"`
	EventType        string `json:"event_type"`
	OccurredAt       string `json:"occurred_at"`
	Task             string `json:"task"`
	JobID            string `json:"job_id"`
	GoldSnapshotID   string `json:"gold_snapshot_id"`
	RuntimePackageID string `json:"runtime_package_id"`
	OutputBucket     string `json:"output_bucket"`
	OutputKey        string `json:"output_key"`
	OutputSHA256     string `json:"output_sha256"`
	ProcessedRows    int64  `json:"processed_rows"`
	Producer         string `json:"producer"`
}

type predictionEnvelope struct {
	SchemaVersion    int    `json:"schema_version"`
	Task             string `json:"task"`
	JobID            string `json:"job_id"`
	GoldSnapshotID   string `json:"gold_snapshot_id"`
	RuntimePackageID string `json:"runtime_package_id"`
}

type candidatePredictionRecord struct {
	predictionEnvelope
	PredictionID        string  `json:"prediction_id"`
	SourceProductID     string  `json:"source_product_id"`
	TICID               int64   `json:"tic_id"`
	Sector              int64   `json:"sector"`
	RawLogit            float64 `json:"raw_logit"`
	CandidateScore      float64 `json:"candidate_score"`
	DecisionThreshold   float64 `json:"decision_threshold"`
	AboveThreshold      bool    `json:"above_threshold"`
	RegisteredModelID   string  `json:"registered_model_id"`
	RuntimeValidationID string  `json:"runtime_validation_id"`
	PredictedAt         string  `json:"predicted_at"`
	Producer            string  `json:"producer"`
}

type anomalyPredictionRecord struct {
	predictionEnvelope
	PredictionID        string  `json:"prediction_id"`
	SourceProductID     string  `json:"source_product_id"`
	TICID               int64   `json:"tic_id"`
	Sector              int64   `json:"sector"`
	ReconstructionMSE   float64 `json:"reconstruction_mse"`
	DecisionThreshold   float64 `json:"decision_threshold"`
	AboveThreshold      bool    `json:"above_threshold"`
	RegisteredModelID   string  `json:"registered_model_id"`
	RuntimeValidationID string  `json:"runtime_validation_id"`
	PredictedAt         string  `json:"predicted_at"`
	Producer            string  `json:"producer"`
}

type projectionJobManifest struct {
	SchemaVersion  int    `json:"schema_version"`
	JobID          string `json:"job_id"`
	Task           string `json:"task"`
	ModelVersion   string `json:"model_version"`
	GoldSnapshotID string `json:"gold_snapshot_id"`
	RuntimePackage string `json:"runtime_package_id"`
}

func NewPredictionProjectorService(
	objects repo.ObjectRepository,
	predictions repo.PredictionProjectionRepository,
	expectedBucket string,
) domainService.PredictionProjector {
	return &PredictionProjectorService{
		objects:        objects,
		predictions:    predictions,
		expectedBucket: expectedBucket,
	}
}

func (s *PredictionProjectorService) ProjectCompletion(ctx context.Context, payload []byte) (entity.PredictionProjectionResult, error) {
	var event inferenceCompletionEvent
	decoder := json.NewDecoder(bytes.NewReader(payload))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&event); err != nil {
		return entity.PredictionProjectionResult{}, fmt.Errorf("decode inference completion event: %w", err)
	}
	if err := s.validateCompletion(event); err != nil {
		return entity.PredictionProjectionResult{}, err
	}
	return s.projectObject(ctx, event.OutputKey, event.OutputSHA256, &event)
}

func (s *PredictionProjectorService) Reconcile(ctx context.Context) (int64, error) {
	objects, err := s.objects.ListObjects(ctx, "predictions/")
	if err != nil {
		return 0, fmt.Errorf("list prediction outputs: %w", err)
	}
	sort.Slice(objects, func(i, j int) bool { return objects[i].Key < objects[j].Key })
	var inserted int64
	var projectionErrors []error
	for _, object := range objects {
		if !strings.HasSuffix(object.Key, ".jsonl") {
			continue
		}
		result, projectErr := s.projectObject(ctx, object.Key, "", nil)
		if projectErr != nil {
			projectionErrors = append(projectionErrors, fmt.Errorf("%s: %w", object.Key, projectErr))
			continue
		}
		inserted += result.InsertedRows
	}
	return inserted, errors.Join(projectionErrors...)
}

func (s *PredictionProjectorService) validateCompletion(event inferenceCompletionEvent) error {
	if event.SchemaVersion != 1 || event.EventID == "" || event.JobID == "" {
		return fmt.Errorf("invalid inference completion identity")
	}
	if _, err := time.Parse(time.RFC3339Nano, event.OccurredAt); err != nil {
		return fmt.Errorf("inference completion timestamp is invalid")
	}
	expectedType := ""
	switch event.Task {
	case candidateTask:
		expectedType = "aurora.v1.inference.candidate.completed"
	case anomalyTask:
		expectedType = "aurora.v1.inference.anomaly.completed"
	default:
		return fmt.Errorf("unsupported inference completion task %q", event.Task)
	}
	if event.EventType != expectedType {
		return fmt.Errorf("inference completion subject conflicts with task")
	}
	if event.Producer != "rust-inference" {
		return fmt.Errorf("inference completion producer must be rust-inference")
	}
	if event.OutputBucket != s.expectedBucket {
		return fmt.Errorf("inference completion output bucket %q is unsupported", event.OutputBucket)
	}
	if !strings.HasPrefix(event.OutputKey, "predictions/") || !strings.HasSuffix(event.OutputKey, ".jsonl") {
		return fmt.Errorf("inference completion output key is outside predictions/")
	}
	if !validSHA256(event.OutputSHA256) {
		return fmt.Errorf("inference completion output SHA-256 is invalid")
	}
	if event.ProcessedRows < 1 || event.GoldSnapshotID == "" || event.RuntimePackageID == "" {
		return fmt.Errorf("inference completion row or lineage contract is invalid")
	}
	return nil
}

func (s *PredictionProjectorService) projectObject(
	ctx context.Context,
	key string,
	expectedSHA string,
	event *inferenceCompletionEvent,
) (entity.PredictionProjectionResult, error) {
	content, err := s.objects.GetObject(ctx, key)
	if err != nil {
		return entity.PredictionProjectionResult{}, fmt.Errorf("read prediction output: %w", err)
	}
	contentSHA := sha256.Sum256(content)
	if expectedSHA != "" && hex.EncodeToString(contentSHA[:]) != expectedSHA {
		return entity.PredictionProjectionResult{}, fmt.Errorf("prediction output checksum mismatch")
	}
	lines := bytes.Split(bytes.TrimSpace(content), []byte("\n"))
	if len(lines) == 0 || len(lines[0]) == 0 {
		return entity.PredictionProjectionResult{}, fmt.Errorf("prediction output is empty")
	}
	var envelope predictionEnvelope
	if err := json.Unmarshal(lines[0], &envelope); err != nil {
		return entity.PredictionProjectionResult{}, fmt.Errorf("decode prediction envelope: %w", err)
	}
	if envelope.Task != candidateTask && envelope.Task != anomalyTask {
		return entity.PredictionProjectionResult{}, fmt.Errorf("unsupported prediction task %q", envelope.Task)
	}
	if event != nil {
		if int64(len(lines)) != event.ProcessedRows {
			return entity.PredictionProjectionResult{}, fmt.Errorf("prediction row count does not match completion event")
		}
		if envelope.Task != event.Task || envelope.JobID != event.JobID ||
			envelope.GoldSnapshotID != event.GoldSnapshotID || envelope.RuntimePackageID != event.RuntimePackageID {
			return entity.PredictionProjectionResult{}, fmt.Errorf("prediction lineage conflicts with completion event")
		}
	}
	manifest, err := s.loadManifest(ctx, envelope)
	if err != nil {
		return entity.PredictionProjectionResult{}, err
	}

	result := entity.PredictionProjectionResult{
		JobID:        envelope.JobID,
		OutputKey:    key,
		ExpectedRows: int64(len(lines)),
	}
	if event != nil {
		result.SourceEventID = event.EventID
	}
	if envelope.Task == candidateTask {
		rows, parseErr := parseCandidateRows(lines, envelope, manifest.ModelVersion)
		if parseErr != nil {
			return entity.PredictionProjectionResult{}, parseErr
		}
		filtered, filterErr := s.filterCandidateRows(ctx, rows)
		if filterErr != nil {
			return entity.PredictionProjectionResult{}, filterErr
		}
		if err := s.predictions.InsertCandidatePredictions(ctx, filtered); err != nil {
			return entity.PredictionProjectionResult{}, fmt.Errorf("insert candidate predictions: %w", err)
		}
		result.InsertedRows = int64(len(filtered))
		return result, nil
	}

	rows, err := parseAnomalyRows(lines, envelope, manifest.ModelVersion)
	if err != nil {
		return entity.PredictionProjectionResult{}, err
	}
	filtered, err := s.filterAnomalyRows(ctx, rows)
	if err != nil {
		return entity.PredictionProjectionResult{}, err
	}
	if err := s.predictions.InsertAnomalyPredictions(ctx, filtered); err != nil {
		return entity.PredictionProjectionResult{}, fmt.Errorf("insert anomaly predictions: %w", err)
	}
	result.InsertedRows = int64(len(filtered))
	return result, nil
}

func (s *PredictionProjectorService) loadManifest(ctx context.Context, envelope predictionEnvelope) (projectionJobManifest, error) {
	taskDir := "candidate"
	if envelope.Task == anomalyTask {
		taskDir = "anomaly"
	}
	key := fmt.Sprintf("manifests/inference-jobs/%s/%s.json", taskDir, envelope.JobID)
	content, err := s.objects.GetObject(ctx, key)
	if err != nil {
		return projectionJobManifest{}, fmt.Errorf("read inference job manifest: %w", err)
	}
	var manifest projectionJobManifest
	if err := json.Unmarshal(content, &manifest); err != nil {
		return projectionJobManifest{}, fmt.Errorf("decode inference job manifest: %w", err)
	}
	if manifest.SchemaVersion != 1 || manifest.JobID != envelope.JobID || manifest.Task != envelope.Task ||
		manifest.GoldSnapshotID != envelope.GoldSnapshotID || manifest.RuntimePackage != envelope.RuntimePackageID ||
		manifest.ModelVersion == "" {
		return projectionJobManifest{}, fmt.Errorf("inference job manifest conflicts with prediction lineage")
	}
	return manifest, nil
}

func (s *PredictionProjectorService) filterCandidateRows(ctx context.Context, rows []entity.CandidatePredictionProjection) ([]entity.CandidatePredictionProjection, error) {
	ids := make([]string, len(rows))
	for i := range rows {
		ids[i] = rows[i].PredictionID
	}
	existing, err := s.predictions.ExistingPredictionIDs(ctx, candidateTask, ids)
	if err != nil {
		return nil, fmt.Errorf("query existing candidate predictions: %w", err)
	}
	filtered := make([]entity.CandidatePredictionProjection, 0, len(rows))
	for _, row := range rows {
		if _, found := existing[row.PredictionID]; !found {
			filtered = append(filtered, row)
		}
	}
	return filtered, nil
}

func (s *PredictionProjectorService) filterAnomalyRows(ctx context.Context, rows []entity.AnomalyPredictionProjection) ([]entity.AnomalyPredictionProjection, error) {
	ids := make([]string, len(rows))
	for i := range rows {
		ids[i] = rows[i].PredictionID
	}
	existing, err := s.predictions.ExistingPredictionIDs(ctx, anomalyTask, ids)
	if err != nil {
		return nil, fmt.Errorf("query existing anomaly predictions: %w", err)
	}
	filtered := make([]entity.AnomalyPredictionProjection, 0, len(rows))
	for _, row := range rows {
		if _, found := existing[row.PredictionID]; !found {
			filtered = append(filtered, row)
		}
	}
	return filtered, nil
}

func parseCandidateRows(lines [][]byte, envelope predictionEnvelope, modelVersion string) ([]entity.CandidatePredictionProjection, error) {
	rows := make([]entity.CandidatePredictionProjection, 0, len(lines))
	seen := make(map[string]struct{}, len(lines))
	for _, line := range lines {
		var record candidatePredictionRecord
		if err := json.Unmarshal(line, &record); err != nil {
			return nil, fmt.Errorf("decode candidate prediction: %w", err)
		}
		if err := validatePredictionEnvelope(record.predictionEnvelope, envelope); err != nil {
			return nil, err
		}
		if record.Producer != "rust-inference" || record.SourceProductID == "" || record.RegisteredModelID == "" || record.RuntimeValidationID == "" ||
			!projectionFinite(record.RawLogit) || !probability(record.CandidateScore) || !probability(record.DecisionThreshold) ||
			record.AboveThreshold != (record.CandidateScore >= record.DecisionThreshold) {
			return nil, fmt.Errorf("candidate prediction scientific contract is invalid")
		}
		if record.PredictionID != deterministicPredictionID("pred-cand-v1", envelope.RuntimePackageID, envelope.GoldSnapshotID, record.SourceProductID) {
			return nil, fmt.Errorf("candidate prediction ID does not match immutable lineage")
		}
		if _, duplicate := seen[record.PredictionID]; duplicate {
			return nil, fmt.Errorf("duplicate candidate prediction ID %s", record.PredictionID)
		}
		seen[record.PredictionID] = struct{}{}
		predictedAt, err := projectionTimestamp(record.PredictedAt)
		if err != nil {
			return nil, err
		}
		rows = append(rows, entity.CandidatePredictionProjection{
			PredictionID: record.PredictionID, SourceProductID: record.SourceProductID,
			TICID: record.TICID, Sector: record.Sector, RawLogit: record.RawLogit,
			CandidateScore: record.CandidateScore, DecisionThreshold: record.DecisionThreshold,
			AboveThreshold: record.AboveThreshold, ModelVersion: modelVersion,
			RegisteredModelID: record.RegisteredModelID, GoldSnapshotID: envelope.GoldSnapshotID,
			RuntimeValidation: record.RuntimeValidationID, RuntimePackageID: envelope.RuntimePackageID,
			PredictedAt: predictedAt,
		})
	}
	return rows, nil
}

func parseAnomalyRows(lines [][]byte, envelope predictionEnvelope, modelVersion string) ([]entity.AnomalyPredictionProjection, error) {
	rows := make([]entity.AnomalyPredictionProjection, 0, len(lines))
	seen := make(map[string]struct{}, len(lines))
	for _, line := range lines {
		var record anomalyPredictionRecord
		if err := json.Unmarshal(line, &record); err != nil {
			return nil, fmt.Errorf("decode anomaly prediction: %w", err)
		}
		if err := validatePredictionEnvelope(record.predictionEnvelope, envelope); err != nil {
			return nil, err
		}
		if record.Producer != "rust-inference" || record.SourceProductID == "" || record.RegisteredModelID == "" || record.RuntimeValidationID == "" ||
			!projectionFinite(record.ReconstructionMSE) || record.ReconstructionMSE < 0 || !projectionFinite(record.DecisionThreshold) || record.DecisionThreshold < 0 ||
			record.AboveThreshold != (record.ReconstructionMSE >= record.DecisionThreshold) {
			return nil, fmt.Errorf("anomaly prediction scientific contract is invalid")
		}
		if record.PredictionID != deterministicPredictionID("pred-anom-v1", envelope.RuntimePackageID, envelope.GoldSnapshotID, record.SourceProductID) {
			return nil, fmt.Errorf("anomaly prediction ID does not match immutable lineage")
		}
		if _, duplicate := seen[record.PredictionID]; duplicate {
			return nil, fmt.Errorf("duplicate anomaly prediction ID %s", record.PredictionID)
		}
		seen[record.PredictionID] = struct{}{}
		predictedAt, err := projectionTimestamp(record.PredictedAt)
		if err != nil {
			return nil, err
		}
		rows = append(rows, entity.AnomalyPredictionProjection{
			PredictionID: record.PredictionID, SourceProductID: record.SourceProductID,
			TICID: record.TICID, Sector: record.Sector, ReconstructionMSE: record.ReconstructionMSE,
			DecisionThreshold: record.DecisionThreshold, AboveThreshold: record.AboveThreshold,
			ModelVersion: modelVersion, RegisteredModelID: record.RegisteredModelID,
			GoldSnapshotID: envelope.GoldSnapshotID, RuntimeValidation: record.RuntimeValidationID,
			RuntimePackageID: envelope.RuntimePackageID, PredictedAt: predictedAt,
		})
	}
	return rows, nil
}

func validatePredictionEnvelope(value, expected predictionEnvelope) error {
	if value.SchemaVersion != 1 || value.Task != expected.Task || value.JobID != expected.JobID ||
		value.GoldSnapshotID != expected.GoldSnapshotID || value.RuntimePackageID != expected.RuntimePackageID {
		return fmt.Errorf("prediction rows contain mixed or invalid lineage")
	}
	return nil
}

func deterministicPredictionID(prefix, runtimePackageID, snapshotID, sourceProductID string) string {
	canonical := fmt.Sprintf("%s:%s:%s:%s", prefix, runtimePackageID, snapshotID, sourceProductID)
	digest := sha256.Sum256([]byte(canonical))
	return prefix + "-" + hex.EncodeToString(digest[:])[:16]
}

func projectionTimestamp(value string) (string, error) {
	parsed, err := time.Parse(time.RFC3339Nano, value)
	if err != nil {
		return "", fmt.Errorf("prediction timestamp is invalid: %w", err)
	}
	return parsed.UTC().Format("2006-01-02 15:04:05"), nil
}

func validSHA256(value string) bool {
	if len(value) != sha256.Size*2 {
		return false
	}
	_, err := hex.DecodeString(value)
	return err == nil && value == strings.ToLower(value)
}

func projectionFinite(value float64) bool { return !math.IsNaN(value) && !math.IsInf(value, 0) }
func probability(value float64) bool      { return projectionFinite(value) && value >= 0 && value <= 1 }
