package http

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"sort"
	"strings"
	"time"

	"go-api/internal/store"

	"github.com/google/uuid"
)

type RuntimeModelManifest struct {
	RuntimePackageID      string   `json:"runtime_package_id"`
	Task                  string   `json:"task"`
	SourceModelID         string   `json:"source_model_id"`
	ModelVersion          string   `json:"model_version"`
	PreprocessingVersion  string   `json:"preprocessing_version"`
	PreprocessingSHA256   string   `json:"preprocessing_sha256"`
	ThresholdSHA256       string   `json:"threshold_sha256"`
	ParityFixtureSHA256   string   `json:"parity_fixture_sha256"`
	FeatureOrder          []string `json:"feature_order"`
	ONNXSizeBytes         int64    `json:"onnx_size_bytes"`
	ONNXSHA256            string   `json:"onnx_sha256"`
	DecisionThreshold     float64  `json:"decision_threshold"`
	PythonParityStatus    string   `json:"python_parity_status"`
	SourceEvaluationRunID string   `json:"source_evaluation_run_id"`
	CreatedAt             string   `json:"created_at"`
}

type ModelRecord struct {
	ModelID              string   `json:"model_id"`
	RuntimePackageID     string   `json:"runtime_package_id"`
	Task                 string   `json:"task"`
	ModelVersion         string   `json:"model_version"`
	Status               string   `json:"status"`
	RuntimeManifestKey   string   `json:"runtime_manifest_key"`
	PreprocessingVersion string   `json:"preprocessing_version"`
	FeatureCount         int      `json:"feature_count"`
	FeatureOrder         []string `json:"feature_order"`
	ONNXSizeBytes        int64    `json:"onnx_size_bytes"`
	ONNXSHA256           string   `json:"onnx_sha256"`
	DecisionThreshold    float64  `json:"decision_threshold"`
	ParityStatus         string   `json:"parity_status"`
	IntegrityStatus      string   `json:"integrity_status"`
	EvaluationRunID      string   `json:"evaluation_run_id"`
	CreatedAt            string   `json:"created_at"`
}

type InferenceJobManifest struct {
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

type InferenceJobRecord struct {
	JobID                   string `json:"job_id"`
	Task                    string `json:"task"`
	ModelID                 string `json:"model_id"`
	ModelVersion            string `json:"model_version"`
	RuntimePackageID        string `json:"runtime_package_id"`
	GoldSnapshotID          string `json:"gold_snapshot_id"`
	GoldArtifactKey         string `json:"gold_artifact_key"`
	Sector                  int    `json:"sector"`
	ExpectedPredictionCount int64  `json:"expected_prediction_count"`
	CreatedAt               string `json:"created_at"`
	Status                  string `json:"status"`
	OutputKey               string `json:"output_key,omitempty"`
}

func (r *Router) handleModels(w http.ResponseWriter, req *http.Request) {
	if r.minioStore == nil {
		writeStorageUnavailable(w)
		return
	}
	taskFilter := normalizeTask(req.URL.Query().Get("task"))
	objects, err := r.minioStore.ListObjects(req.Context(), "models/runtime/")
	if err != nil {
		writeStorageUnavailableWithError(w, err)
		return
	}
	models := make([]ModelRecord, 0)
	for _, object := range objects {
		parts := strings.Split(object.Key, "/")
		if len(parts) != 5 || parts[0] != "models" || parts[1] != "runtime" || parts[4] != "manifest.json" {
			continue
		}
		manifestBytes, err := r.minioStore.GetObject(req.Context(), object.Key)
		if err != nil {
			continue
		}
		var manifest RuntimeModelManifest
		if json.Unmarshal(manifestBytes, &manifest) != nil || manifest.RuntimePackageID == "" || manifest.SourceModelID == "" {
			continue
		}
		if taskFilter != "" && normalizeTask(manifest.Task) != taskFilter {
			continue
		}
		integrityOK := validateRuntimePackage(req.Context(), r.minioStore, object.Key, manifest)
		status := "validated"
		if manifest.PythonParityStatus != "PASS" || !integrityOK {
			status = "invalid"
		}
		if isChampion(req.Context(), r.minioStore, manifest.Task, manifest.SourceModelID) {
			status = "champion"
		}
		models = append(models, ModelRecord{
			ModelID:              manifest.SourceModelID,
			RuntimePackageID:     manifest.RuntimePackageID,
			Task:                 manifest.Task,
			ModelVersion:         manifest.ModelVersion,
			Status:               status,
			RuntimeManifestKey:   object.Key,
			PreprocessingVersion: manifest.PreprocessingVersion,
			FeatureCount:         len(manifest.FeatureOrder),
			FeatureOrder:         manifest.FeatureOrder,
			ONNXSizeBytes:        manifest.ONNXSizeBytes,
			ONNXSHA256:           manifest.ONNXSHA256,
			DecisionThreshold:    manifest.DecisionThreshold,
			ParityStatus:         manifest.PythonParityStatus,
			IntegrityStatus:      map[bool]string{true: "PASS", false: "FAIL"}[integrityOK],
			EvaluationRunID:      manifest.SourceEvaluationRunID,
			CreatedAt:            manifest.CreatedAt,
		})
	}
	sort.Slice(models, func(i, j int) bool {
		if models[i].Task == models[j].Task {
			return models[i].CreatedAt > models[j].CreatedAt
		}
		return models[i].Task < models[j].Task
	})
	writeJSON(w, http.StatusOK, map[string]any{
		"models": models,
		"count":  len(models),
		"source": "minio-runtime-registry",
	})
}

func validateRuntimePackage(ctx context.Context, objectStore store.ObjectStore, manifestKey string, manifest RuntimeModelManifest) bool {
	packagePrefix := strings.TrimSuffix(manifestKey, "manifest.json")
	checks := []struct {
		name string
		sum  string
	}{
		{name: "model.onnx", sum: manifest.ONNXSHA256},
		{name: "preprocessing.json", sum: manifest.PreprocessingSHA256},
		{name: "threshold.json", sum: manifest.ThresholdSHA256},
		{name: "parity-fixture.json", sum: manifest.ParityFixtureSHA256},
	}
	for _, check := range checks {
		if check.sum == "" {
			return false
		}
		data, err := objectStore.GetObject(ctx, packagePrefix+check.name)
		if err != nil {
			return false
		}
		digest := sha256.Sum256(data)
		if hex.EncodeToString(digest[:]) != check.sum {
			return false
		}
	}
	return true
}

func (r *Router) handleInferenceJobs(w http.ResponseWriter, req *http.Request) {
	if r.minioStore == nil {
		writeStorageUnavailable(w)
		return
	}
	taskFilter := normalizeTask(req.URL.Query().Get("task"))
	modelFilter := strings.TrimSpace(req.URL.Query().Get("model_id"))
	objects, err := r.minioStore.ListObjects(req.Context(), "manifests/inference-jobs/")
	if err != nil {
		writeStorageUnavailableWithError(w, err)
		return
	}
	jobs := make([]InferenceJobRecord, 0)
	for _, object := range objects {
		if !strings.HasSuffix(object.Key, ".json") {
			continue
		}
		manifestBytes, err := r.minioStore.GetObject(req.Context(), object.Key)
		if err != nil {
			continue
		}
		var manifest InferenceJobManifest
		if json.Unmarshal(manifestBytes, &manifest) != nil || manifest.JobID == "" {
			continue
		}
		if taskFilter != "" && normalizeTask(manifest.Task) != taskFilter {
			continue
		}
		if modelFilter != "" && manifest.ModelID != modelFilter {
			continue
		}
		outputKey := fmt.Sprintf("predictions/%s/%s/%s/part-00000.jsonl", manifest.Task, manifest.GoldSnapshotID, manifest.JobID)
		status := "planned"
		if outputs, listErr := r.minioStore.ListObjects(req.Context(), outputKey); listErr == nil && len(outputs) > 0 {
			status = "completed"
		}
		jobs = append(jobs, InferenceJobRecord{
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
	writeJSON(w, http.StatusOK, map[string]any{"jobs": jobs, "count": len(jobs)})
}

func (r *Router) handleRetryInferenceJob(w http.ResponseWriter, req *http.Request) {
	if r.minioStore == nil || r.dispatcher == nil {
		writeStorageUnavailable(w)
		return
	}
	jobID := strings.TrimSpace(req.PathValue("job_id"))
	if jobID == "" || strings.Contains(jobID, "/") {
		writeBadRequest(w, "job_id is required")
		return
	}
	objects, err := r.minioStore.ListObjects(req.Context(), "manifests/inference-jobs/")
	if err != nil {
		writeStorageUnavailableWithError(w, err)
		return
	}
	var manifestKey string
	for _, object := range objects {
		if strings.HasSuffix(object.Key, "/"+jobID+".json") {
			manifestKey = object.Key
			break
		}
	}
	if manifestKey == "" {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "inference job manifest not found"})
		return
	}
	manifestBytes, err := r.minioStore.GetObject(req.Context(), manifestKey)
	if err != nil {
		writeStorageUnavailableWithError(w, err)
		return
	}
	var manifest InferenceJobManifest
	if err := json.Unmarshal(manifestBytes, &manifest); err != nil || manifest.JobID != jobID || manifest.SchemaVersion != 1 {
		writeJSON(w, http.StatusConflict, map[string]string{"error": "invalid inference job manifest"})
		return
	}
	hash := sha256.Sum256(manifestBytes)
	event := map[string]any{
		"schema_version":            1,
		"event_id":                  "inference-request-" + uuid.NewString(),
		"event_type":                eventTypeForTask(manifest.Task),
		"occurred_at":               time.Now().UTC().Format(time.RFC3339Nano),
		"task":                      manifest.Task,
		"job_id":                    manifest.JobID,
		"job_manifest_bucket":       "aurora",
		"job_manifest_key":          manifestKey,
		"job_manifest_sha256":       hex.EncodeToString(hash[:]),
		"runtime_package_id":        manifest.RuntimePackageID,
		"gold_snapshot_id":          manifest.GoldSnapshotID,
		"gold_artifact_key":         manifest.GoldArtifactKey,
		"sector":                    manifest.Sector,
		"expected_prediction_count": manifest.ExpectedPredictionCount,
		"producer":                  "aurora-go-api",
	}
	payload, _ := json.Marshal(event)
	if err := r.dispatcher.Dispatch(req.Context(), manifest.Task, payload); err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": "failed to queue inference job"})
		return
	}
	writeJSON(w, http.StatusAccepted, map[string]any{
		"job_id": manifest.JobID,
		"status": "queued",
		"event":  event,
	})
}

func eventTypeForTask(task string) string {
	if task == "candidate_vetting" {
		return "aurora.v1.inference.candidate.requested"
	}
	return "aurora.v1.inference.anomaly.requested"
}

func normalizeTask(value string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "candidate", "candidate_vetting":
		return "candidate_vetting"
	case "anomaly", "astronomical_anomaly_detection":
		return "astronomical_anomaly_detection"
	default:
		return ""
	}
}

func isChampion(ctx context.Context, objectStore store.ObjectStore, task, modelID string) bool {
	data, err := objectStore.GetObject(ctx, fmt.Sprintf("models/%s/champion.json", taskDirectory(task)))
	if err != nil {
		return false
	}
	var pointer struct {
		ModelID string `json:"model_id"`
	}
	return json.Unmarshal(data, &pointer) == nil && pointer.ModelID == modelID
}

func taskDirectory(task string) string {
	if normalizeTask(task) == "candidate_vetting" {
		return "candidate"
	}
	return "anomaly"
}

func writeStorageUnavailable(w http.ResponseWriter) {
	writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "model storage is unavailable"})
}

func writeStorageUnavailableWithError(w http.ResponseWriter, err error) {
	_ = err
	writeStorageUnavailable(w)
}
