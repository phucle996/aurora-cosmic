package service

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"

	"go-api/internal/domain/entity"
	"go-api/internal/domain/repo"
	"go-api/internal/taxonomy"
)

const candidateInferenceSelectionPolicy = "candidate-inference-selection-v1"

type championPointerDTO struct {
	RuntimePackageID    string `json:"runtime_package_id"`
	ModelID             string `json:"model_id"`
	Task                string `json:"task"`
	PromotedAt          string `json:"promoted_at"`
	RuntimeValidationID string `json:"runtime_validation_id"`
}

type resolvedChampion struct {
	pointer            championPointerDTO
	runtime            runtimeManifestDTO
	runtimeManifestKey string
	runtimeManifestSHA string
}

// EnsureChampionCoverage plans and dispatches missing work for one committed
// candidate snapshot. The immutable job identity makes repeated Gold events
// safe and the durable status prevents completed work from being rerun.
func (s *InferenceService) EnsureChampionCoverage(ctx context.Context, snapshotID string) (int, error) {
	champion, exists, err := s.resolveChampion(ctx)
	if err != nil || !exists {
		return 0, err
	}
	return s.ensureSnapshotCoverage(ctx, strings.TrimSpace(snapshotID), champion)
}

// ReconcileChampionCoverage repairs event gaps after Go API restarts and also
// scores existing snapshots when a different runtime becomes champion.
func (s *InferenceService) ReconcileChampionCoverage(ctx context.Context) (int, error) {
	champion, exists, err := s.resolveChampion(ctx)
	if err != nil || !exists {
		return 0, err
	}
	objects, err := s.objects.ListObjects(ctx, "gold/snapshots/")
	if err != nil {
		return 0, fmt.Errorf("list Gold snapshots for champion inference: %w", err)
	}
	ids := make(map[string]struct{})
	for _, object := range objects {
		if !strings.HasSuffix(object.Key, "/manifest.json") {
			continue
		}
		parts := strings.Split(object.Key, "/")
		if len(parts) == 4 && strings.HasPrefix(parts[2], "gold-v1-") {
			ids[parts[2]] = struct{}{}
		}
	}
	ordered := make([]string, 0, len(ids))
	for id := range ids {
		ordered = append(ordered, id)
	}
	sort.Strings(ordered)

	dispatched := 0
	var reconciliationErrors []error
	for _, id := range ordered {
		count, ensureErr := s.ensureSnapshotCoverage(ctx, id, champion)
		dispatched += count
		if ensureErr != nil {
			reconciliationErrors = append(reconciliationErrors, fmt.Errorf("snapshot %s: %w", id, ensureErr))
		}
	}
	return dispatched, errors.Join(reconciliationErrors...)
}

func (s *InferenceService) resolveChampion(ctx context.Context) (resolvedChampion, bool, error) {
	data, err := s.objects.GetObject(ctx, "models/candidate/champion.json")
	if err != nil {
		if errors.Is(err, repo.ErrObjectNotFound) {
			return resolvedChampion{}, false, nil
		}
		return resolvedChampion{}, false, fmt.Errorf("read candidate champion pointer: %w", err)
	}
	var pointer championPointerDTO
	if err := json.Unmarshal(data, &pointer); err != nil {
		return resolvedChampion{}, false, fmt.Errorf("decode candidate champion pointer: %w", err)
	}
	if pointer.RuntimePackageID == "" || pointer.Task != taxonomy.TaskCandidateVetting {
		return resolvedChampion{}, false, fmt.Errorf("candidate champion pointer is invalid")
	}

	objects, err := s.objects.ListObjects(ctx, "models/runtime/")
	if err != nil {
		return resolvedChampion{}, false, fmt.Errorf("list runtime packages: %w", err)
	}
	for _, object := range objects {
		if !strings.HasSuffix(object.Key, "/manifest.json") {
			continue
		}
		raw, readErr := s.objects.GetObject(ctx, object.Key)
		if readErr != nil {
			continue
		}
		var runtime runtimeManifestDTO
		if json.Unmarshal(raw, &runtime) != nil || runtime.RuntimePackageID != pointer.RuntimePackageID {
			continue
		}
		if runtime.Task != taxonomy.TaskCandidateVetting || runtime.SourceModelID == "" || len(runtime.FeatureOrder) == 0 {
			return resolvedChampion{}, false, fmt.Errorf("champion runtime manifest is incompatible with candidate inference")
		}
		validationID := strings.TrimSpace(pointer.RuntimeValidationID)
		if validationID == "" && len(runtime.RuntimeFingerprint) >= 12 {
			validationID = "rval-v1-" + runtime.RuntimeFingerprint[:12]
		}
		if validationID == "" {
			return resolvedChampion{}, false, fmt.Errorf("champion runtime validation identity is missing")
		}
		pointer.RuntimeValidationID = validationID
		digest := sha256.Sum256(raw)
		return resolvedChampion{
			pointer: pointer, runtime: runtime, runtimeManifestKey: object.Key,
			runtimeManifestSHA: hex.EncodeToString(digest[:]),
		}, true, nil
	}
	return resolvedChampion{}, false, fmt.Errorf("runtime package %s referenced by champion was not found", pointer.RuntimePackageID)
}

func (s *InferenceService) ensureSnapshotCoverage(ctx context.Context, snapshotID string, champion resolvedChampion) (int, error) {
	if !strings.HasPrefix(snapshotID, "gold-v1-") || strings.Contains(snapshotID, "/") {
		return 0, fmt.Errorf("invalid Gold snapshot ID %q", snapshotID)
	}
	manifestKey := "gold/snapshots/" + snapshotID + "/manifest.json"
	raw, err := s.objects.GetObject(ctx, manifestKey)
	if err != nil {
		return 0, fmt.Errorf("read Gold manifest: %w", err)
	}
	var snapshot entity.GoldSnapshotDetail
	if err := json.Unmarshal(raw, &snapshot); err != nil {
		return 0, fmt.Errorf("decode Gold manifest: %w", err)
	}
	if snapshot.SnapshotID != snapshotID || snapshot.Status != "COMMITTED" {
		return 0, fmt.Errorf("Gold snapshot is not committed")
	}
	manifestDigest := sha256.Sum256(raw)
	goldManifestSHA := hex.EncodeToString(manifestDigest[:])
	dispatched := 0
	for _, artifact := range snapshot.Artifacts {
		if artifact.Dataset != "candidate" || artifact.RowCount < 1 || artifact.ObjectKey == "" {
			continue
		}
		artifactSHA := strings.TrimSpace(artifact.ParquetSHA256)
		if artifactSHA == "" {
			artifactSHA = strings.TrimSpace(artifact.ContentSHA256)
		}
		if len(artifactSHA) != 64 {
			return dispatched, fmt.Errorf("candidate artifact %s has no verifiable Parquet SHA-256", artifact.ObjectKey)
		}
		job, err := buildChampionInferenceJob(snapshot, artifact, goldManifestSHA, manifestKey, champion)
		if err != nil {
			return dispatched, err
		}
		queued, err := s.persistAndDispatchChampionJob(ctx, job)
		if err != nil {
			return dispatched, err
		}
		if queued {
			dispatched++
		}
	}
	return dispatched, nil
}

func buildChampionInferenceJob(snapshot entity.GoldSnapshotDetail, artifact entity.GoldArtifact, goldManifestSHA, goldManifestKey string, champion resolvedChampion) (inferenceJobManifestDTO, error) {
	artifactSHA := strings.TrimSpace(artifact.ParquetSHA256)
	if artifactSHA == "" {
		artifactSHA = strings.TrimSpace(artifact.ContentSHA256)
	}
	fingerprintPayload := map[string]string{
		"task":                         taxonomy.TaskCandidateVetting,
		"selection_policy_version":     candidateInferenceSelectionPolicy,
		"gold_snapshot_id":             snapshot.SnapshotID,
		"gold_manifest_sha256":         goldManifestSHA,
		"gold_artifact_key":            artifact.ObjectKey,
		"gold_artifact_content_sha256": artifactSHA,
		"runtime_package_id":           champion.runtime.RuntimePackageID,
		"runtime_manifest_sha256":      champion.runtimeManifestSHA,
		"runtime_validation_id":        champion.pointer.RuntimeValidationID,
	}
	canonical, err := json.Marshal(fingerprintPayload)
	if err != nil {
		return inferenceJobManifestDTO{}, fmt.Errorf("marshal inference fingerprint: %w", err)
	}
	digest := sha256.Sum256(canonical)
	fingerprint := hex.EncodeToString(digest[:])
	createdAt := champion.runtime.CreatedAt
	if createdAt == "" {
		createdAt = champion.pointer.PromotedAt
	}
	if createdAt == "" {
		createdAt = time.Unix(0, 0).UTC().Format(time.RFC3339)
	}
	datasetVersion := champion.runtime.DatasetViewVersion
	if datasetVersion == "" {
		datasetVersion = "gold-v1"
	}
	return inferenceJobManifestDTO{
		SchemaVersion:             1,
		JobID:                     "inference-job-v1-" + fingerprint[:16],
		JobFingerprint:            fingerprint,
		Task:                      taxonomy.TaskCandidateVetting,
		SelectionPolicyVersion:    candidateInferenceSelectionPolicy,
		GoldSnapshotID:            snapshot.SnapshotID,
		GoldManifestKey:           goldManifestKey,
		GoldManifestSHA256:        goldManifestSHA,
		GoldDataset:               "candidate",
		GoldSchemaVersion:         snapshot.GoldSchemaVersion,
		GoldArtifactKey:           artifact.ObjectKey,
		GoldArtifactContentSHA256: artifactSHA,
		GoldArtifactParquetSHA256: artifact.ParquetSHA256,
		GoldArtifactSizeBytes:     artifact.SizeBytes,
		GoldArtifactRowCount:      int64(artifact.RowCount),
		Sector:                    artifact.Sector,
		RuntimePackageID:          champion.runtime.RuntimePackageID,
		RuntimeManifestKey:        champion.runtimeManifestKey,
		RuntimeManifestSHA256:     champion.runtimeManifestSHA,
		RuntimeValidationID:       champion.pointer.RuntimeValidationID,
		ModelID:                   champion.runtime.SourceModelID,
		ModelVersion:              champion.runtime.ModelVersion,
		EvaluationRunID:           champion.runtime.SourceEvaluationRunID,
		DatasetViewVersion:        datasetVersion,
		DatasetViewFingerprint:    champion.runtime.DatasetViewFingerprint,
		FeatureNames:              append([]string(nil), champion.runtime.FeatureOrder...),
		ExpectedPredictionCount:   int64(artifact.RowCount),
		CreatedAt:                 createdAt,
		Producer:                  "aurora-go-api",
	}, nil
}

func (s *InferenceService) persistAndDispatchChampionJob(ctx context.Context, planned inferenceJobManifestDTO) (bool, error) {
	jobKey := fmt.Sprintf("manifests/inference-jobs/candidate/%s.json", planned.JobID)
	jobRaw, err := json.Marshal(planned)
	if err != nil {
		return false, fmt.Errorf("marshal inference job: %w", err)
	}
	existing, err := s.objects.GetObject(ctx, jobKey)
	if err == nil {
		var persisted inferenceJobManifestDTO
		if json.Unmarshal(existing, &persisted) != nil || persisted.JobFingerprint != planned.JobFingerprint {
			return false, fmt.Errorf("INFERENCE_JOB_CONFLICT: %s", jobKey)
		}
		jobRaw = existing
	} else if errors.Is(err, repo.ErrObjectNotFound) {
		if err := s.objects.PutObject(ctx, jobKey, jobRaw, "application/json"); err != nil {
			return false, fmt.Errorf("persist inference job: %w", err)
		}
	} else {
		return false, fmt.Errorf("inspect inference job: %w", err)
	}

	statusKey := fmt.Sprintf("inference/status/%s.json", planned.JobID)
	if statusRaw, statusErr := s.results.GetObject(ctx, statusKey); statusErr == nil {
		var status inferenceJobStatusDTO
		if json.Unmarshal(statusRaw, &status) == nil && status.JobFingerprint == planned.JobFingerprint {
			switch status.Status {
			case taxonomy.JobStatusRunning, taxonomy.JobStatusRetrying, taxonomy.JobStatusFailed, taxonomy.JobStatusCompleted:
				return false, nil
			}
		}
	} else if !errors.Is(statusErr, repo.ErrObjectNotFound) {
		return false, fmt.Errorf("inspect inference status: %w", statusErr)
	}

	jobDigest := sha256.Sum256(jobRaw)
	event := map[string]any{
		"schema_version":            1,
		"event_id":                  "inference-request-" + planned.JobID,
		"event_type":                "aurora.v1.inference.candidate.requested",
		"occurred_at":               planned.CreatedAt,
		"task":                      planned.Task,
		"job_id":                    planned.JobID,
		"job_manifest_bucket":       s.manifestBucket,
		"job_manifest_key":          jobKey,
		"job_manifest_sha256":       hex.EncodeToString(jobDigest[:]),
		"runtime_package_id":        planned.RuntimePackageID,
		"gold_snapshot_id":          planned.GoldSnapshotID,
		"gold_artifact_key":         planned.GoldArtifactKey,
		"sector":                    planned.Sector,
		"expected_prediction_count": planned.ExpectedPredictionCount,
		"producer":                  "aurora-go-api",
	}
	payload, err := json.Marshal(event)
	if err != nil {
		return false, fmt.Errorf("marshal inference request: %w", err)
	}
	if s.dispatcher == nil {
		return false, fmt.Errorf("inference dispatcher is unavailable")
	}
	if err := s.dispatcher.Dispatch(ctx, taxonomy.TaskCandidateVetting, payload); err != nil {
		return false, fmt.Errorf("dispatch inference request: %w", err)
	}
	return true, nil
}
