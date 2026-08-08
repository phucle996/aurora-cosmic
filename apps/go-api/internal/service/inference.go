package service

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/google/uuid"
	"go-api/internal/domain/entity"
	"go-api/internal/domain/repo"
	domainService "go-api/internal/domain/service"
)

type InferenceService struct {
	objects    repo.ObjectRepository
	dispatcher repo.InferenceDispatcher
}

func NewInferenceService(objects repo.ObjectRepository, dispatcher repo.InferenceDispatcher) domainService.Inference {
	return &InferenceService{objects: objects, dispatcher: dispatcher}
}

type inferenceJobManifestDTO struct {
	SchemaVersion             int    `json:"schema_version"`
	JobID                     string `json:"job_id"`
	JobFingerprint            string `json:"job_fingerprint"`
	Task                      string `json:"task"`
	GoldSnapshotID            string `json:"gold_snapshot_id"`
	GoldManifestKey           string `json:"gold_manifest_key"`
	GoldArtifactKey           string `json:"gold_artifact_key"`
	GoldArtifactContentSHA256 string `json:"gold_artifact_content_sha256"`
	GoldArtifactRowCount      int64  `json:"gold_artifact_row_count"`
	Sector                    int    `json:"sector"`
	RuntimePackageID          string `json:"runtime_package_id"`
	RuntimeManifestKey        string `json:"runtime_manifest_key"`
	RuntimeManifestSHA256     string `json:"runtime_manifest_sha256"`
	RuntimeValidationID       string `json:"runtime_validation_id"`
	ModelID                   string `json:"model_id"`
	ModelVersion              string `json:"model_version"`
	EvaluationRunID           string `json:"evaluation_run_id"`
	ExpectedPredictionCount   int64  `json:"expected_prediction_count"`
	CreatedAt                 string `json:"created_at"`
}

func (s *InferenceService) ListJobs(ctx context.Context, task, model string) ([]entity.InferenceJob, error) {
	objects, err := s.objects.ListObjects(ctx, "manifests/inference-jobs/")
	if err != nil {
		return nil, err
	}
	jobs := make([]entity.InferenceJob, 0)
	for _, object := range objects {
		if !strings.HasSuffix(object.Key, ".json") {
			continue
		}
		data, err := s.objects.GetObject(ctx, object.Key)
		if err != nil {
			continue
		}
		var manifest inferenceJobManifestDTO
		if json.Unmarshal(data, &manifest) != nil || manifest.JobID == "" {
			continue
		}

		normTask := entity.TaskAnomalyDetection
		if strings.EqualFold(strings.TrimSpace(manifest.Task), "candidate") || strings.EqualFold(strings.TrimSpace(manifest.Task), string(entity.TaskCandidateVetting)) {
			normTask = entity.TaskCandidateVetting
		}
		if task != "" && string(normTask) != task {
			continue
		}
		if model != "" && manifest.ModelID != model {
			continue
		}
		outputKey := fmt.Sprintf("predictions/%s/%s/%s/part-00000.jsonl", manifest.Task, manifest.GoldSnapshotID, manifest.JobID)
		status := string(entity.JobStatusPlanned)
		if outputs, listErr := s.objects.ListObjects(ctx, outputKey); listErr == nil && len(outputs) > 0 {
			status = string(entity.JobStatusCompleted)
		}
		jobs = append(jobs, entity.InferenceJob{
			JobID:                   manifest.JobID,
			Task:                    manifest.Task,
			ModelID:                 manifest.ModelID,
			ModelVersion:            manifest.ModelVersion,
			RuntimePackageID:        manifest.RuntimePackageID,
			GoldSnapshotID:          manifest.GoldSnapshotID,
			GoldArtifactKey:         manifest.GoldArtifactKey,
			Sector:                  manifest.Sector,
			ExpectedPredictionCount: manifest.ExpectedPredictionCount,
			CreatedAt:               manifest.CreatedAt,
			Status:                  status,
			OutputKey:               outputKey,
		})
	}
	sort.Slice(jobs, func(i, j int) bool { return jobs[i].CreatedAt > jobs[j].CreatedAt })
	return jobs, nil
}

func (s *InferenceService) RetryJob(ctx context.Context, jobID string) (entity.InferenceJobManifest, map[string]any, error) {
	objects, err := s.objects.ListObjects(ctx, "manifests/inference-jobs/")
	if err != nil {
		return entity.InferenceJobManifest{}, nil, err
	}
	var manifest inferenceJobManifestDTO
	var raw []byte
	var manifestKey string
	found := false
	for _, object := range objects {
		if !strings.HasSuffix(object.Key, "/"+jobID+".json") {
			continue
		}
		data, err := s.objects.GetObject(ctx, object.Key)
		if err != nil {
			return entity.InferenceJobManifest{}, nil, err
		}
		if err := json.Unmarshal(data, &manifest); err != nil || manifest.JobID != jobID || manifest.SchemaVersion != 1 {
			return entity.InferenceJobManifest{}, nil, fmt.Errorf("invalid inference job manifest")
		}
		raw = data
		manifestKey = object.Key
		found = true
		break
	}
	if !found {
		return entity.InferenceJobManifest{}, nil, fmt.Errorf("job %s not found", jobID)
	}

	eventType := "aurora.v1.inference.anomaly.requested"
	if manifest.Task == string(entity.TaskCandidateVetting) || manifest.Task == "candidate" {
		eventType = "aurora.v1.inference.candidate.requested"
	}
	sum := sha256.Sum256(raw)
	event := map[string]any{
		"schema_version":            1,
		"event_id":                  "inference-request-" + uuid.NewString(),
		"event_type":                eventType,
		"occurred_at":               time.Now().UTC().Format(time.RFC3339Nano),
		"task":                      manifest.Task,
		"job_id":                    manifest.JobID,
		"job_manifest_bucket":       "aurora",
		"job_manifest_key":          manifestKey,
		"job_manifest_sha256":       fmt.Sprintf("%x", sum[:]),
		"runtime_package_id":        manifest.RuntimePackageID,
		"gold_snapshot_id":          manifest.GoldSnapshotID,
		"gold_artifact_key":         manifest.GoldArtifactKey,
		"sector":                    manifest.Sector,
		"expected_prediction_count": manifest.ExpectedPredictionCount,
		"producer":                  "aurora-go-api",
	}
	payload, err := json.Marshal(event)
	if err != nil {
		return entity.InferenceJobManifest{}, nil, err
	}
	if s.dispatcher == nil {
		return entity.InferenceJobManifest{}, nil, fmt.Errorf("inference dispatcher is unavailable")
	}
	if err := s.dispatcher.Dispatch(ctx, manifest.Task, payload); err != nil {
		return entity.InferenceJobManifest{}, nil, err
	}
	domainManifest := entity.InferenceJobManifest{
		SchemaVersion:             manifest.SchemaVersion,
		JobID:                     manifest.JobID,
		JobFingerprint:            manifest.JobFingerprint,
		Task:                      manifest.Task,
		GoldSnapshotID:            manifest.GoldSnapshotID,
		GoldManifestKey:           manifest.GoldManifestKey,
		GoldArtifactKey:           manifest.GoldArtifactKey,
		GoldArtifactContentSHA256: manifest.GoldArtifactContentSHA256,
		GoldArtifactRowCount:      manifest.GoldArtifactRowCount,
		Sector:                    manifest.Sector,
		RuntimePackageID:          manifest.RuntimePackageID,
		RuntimeManifestKey:        manifest.RuntimeManifestKey,
		RuntimeManifestSHA256:     manifest.RuntimeManifestSHA256,
		RuntimeValidationID:       manifest.RuntimeValidationID,
		ModelID:                   manifest.ModelID,
		ModelVersion:              manifest.ModelVersion,
		EvaluationRunID:           manifest.EvaluationRunID,
		ExpectedPredictionCount:   manifest.ExpectedPredictionCount,
		CreatedAt:                 manifest.CreatedAt,
	}
	return domainManifest, event, nil
}
