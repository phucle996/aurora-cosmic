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
	"sync"
	"time"

	"go-api/infra/nats"
	"go-api/internal/domain/entity"
	"go-api/internal/domain/repo"
	domainService "go-api/internal/domain/service"
	"go-api/internal/provider"
	"go-api/internal/taxonomy"

	natsio "github.com/nats-io/nats.go"
)

// ModelService implements domainService.Model for Model domain workflows.
type ModelService struct {
	objects provider.ObjectStorage
	nats    *nats.Client
	repo    repo.ModelRepository

	mu          sync.RWMutex
	activeRuns  map[string]*entity.TrainingActiveState
	recentOrder []string
}

// NewModelService initializes a new ModelService instance.
func NewModelService(objects provider.ObjectStorage, natsClient *nats.Client, modelRepo repo.ModelRepository) domainService.Model {
	return &ModelService{
		objects:     objects,
		nats:        natsClient,
		repo:        modelRepo,
		activeRuns:  make(map[string]*entity.TrainingActiveState),
		recentOrder: make([]string, 0),
	}
}

// TrainingPreflight verifies that the selected Gold snapshots are committed in object storage
// and evaluates their supervised learning readiness and class balance against ClickHouse.
func (s *ModelService) TrainingPreflight(ctx context.Context, snapshotIDs []string) (*entity.TrainingPreflight, error) {
	// 1. Verify existence of Gold snapshots in Object Storage (MinIO)
	for _, id := range snapshotIDs {
		if _, err := s.objects.GetObject(ctx, "gold/snapshots/"+id+"/manifest.json"); err != nil {
			if errors.Is(err, provider.ErrObjectNotFound) {
				return nil, fmt.Errorf("%w: Gold snapshot %s was not found in object storage", taxonomy.ErrInvalidRequest, id)
			}
			return nil, fmt.Errorf("read Gold snapshot %s: %w", id, err)
		}
	}

	// 2. Delegate to repository
	preflight, err := s.repo.TrainingPreflight(ctx, snapshotIDs)
	if err != nil {
		return nil, err
	}
	return preflight, nil
}

// ListTrainingSnapshots retrieves the latest indexed Gold snapshots with candidate cohort metrics from the repository.
func (s *ModelService) ListTrainingSnapshots(ctx context.Context, limit int) ([]entity.ModelTrainingSnapshot, error) {
	snapshots, err := s.repo.ListTrainingSnapshots(ctx, limit)
	if err != nil {
		return nil, err
	}
	return snapshots, nil
}

// StartTraining validates readiness via the Preflight Gate and dispatches the training run to NATS JetStream.
func (s *ModelService) StartTraining(ctx context.Context, spec entity.StartTrainingSpec) (*entity.TrainingResult, error) {
	if s.nats == nil {
		return nil, errors.New("training dispatcher is unavailable")
	}

	// 1. Mandatory Preflight Gate check
	preflight, err := s.TrainingPreflight(ctx, spec.SnapshotIDs)
	if err != nil {
		return nil, err
	}
	if preflight.Tier == "BLOCKED" {
		return nil, fmt.Errorf("%w: Gold snapshot cohort does not meet minimum supervised training requirements (tier: %s)", taxonomy.ErrInvalidRequest, preflight.Tier)
	}

	// 2. Dispatch training request to JetStream using ticket_id as first-class identity
	createdAt := time.Now().UTC().Format(time.RFC3339)
	payload, err := json.Marshal(map[string]any{
		"ticket_id":         spec.TicketID,
		"task":              spec.Task,
		"gold_snapshot_ids": spec.SnapshotIDs,
		"training_mode":     spec.TrainingMode,
		"base_model_id":     spec.BaseModelID,
		"compute_target":    spec.ComputeTarget,
		"epochs":            spec.Epochs,
		"batch_size":        spec.BatchSize,
		"learning_rate":     spec.LearningRate,
		"seed":              spec.Seed,
		"auto_promote":      false,
		"created_at":        createdAt,
	})
	if err != nil {
		return nil, fmt.Errorf("marshal training request: %w", err)
	}

	subject := "aurora.v1.ml.training.requested"
	message := natsio.NewMsg(subject)
	message.Data = payload
	digest := sha256.Sum256(append(append([]byte(subject+":"), payload...), byte(0)))
	message.Header.Set(natsio.MsgIdHdr, fmt.Sprintf("%x", digest[:]))
	if err := s.nats.PublishDurable(ctx, message); err != nil {
		return nil, fmt.Errorf("publish durable request: %w", err)
	}

	// 3. Register in soft state tracker
	s.mu.Lock()
	state := &entity.TrainingActiveState{
		TicketID:        spec.TicketID,
		Task:            spec.Task,
		SnapshotCount:   len(spec.SnapshotIDs),
		BaseModelID:     spec.BaseModelID,
		ComputeTarget:   spec.ComputeTarget,
		Status:          "queued",
		Phase:           "queued",
		ProgressPercent: 0,
		CurrentEpoch:    0,
		TotalEpochs:     spec.Epochs,
		LossHistory:     make([]entity.LossPoint, 0),
		Logs: []entity.TrainingLogEntry{
			{
				Timestamp: createdAt,
				Message:   fmt.Sprintf("Training run %s queued for dispatch (%s branch)", spec.TicketID, spec.ComputeTarget),
				Level:     "info",
			},
		},
		StartedAt: time.Now().UTC().UnixMilli(),
		UpdatedAt: createdAt,
	}
	s.activeRuns[spec.TicketID] = state
	s.recentOrder = append(s.recentOrder, spec.TicketID)
	if len(s.recentOrder) > 50 {
		evict := s.recentOrder[0]
		s.recentOrder = s.recentOrder[1:]
		delete(s.activeRuns, evict)
	}
	s.mu.Unlock()

	return &entity.TrainingResult{
		TicketID:      spec.TicketID,
		Task:          spec.Task,
		SnapshotIDs:   spec.SnapshotIDs,
		TrainingMode:  spec.TrainingMode,
		BaseModelID:   spec.BaseModelID,
		ComputeTarget: spec.ComputeTarget,
		Status:        "queued",
		CreatedAt:     createdAt,
		Message:       fmt.Sprintf("Training run %s queued for dispatch (%s branch).", spec.TicketID, spec.ComputeTarget),
	}, nil
}

// ControlTraining publishes an intervention signal (cancel or checkpoint) for an in-flight training run.
func (s *ModelService) ControlTraining(ctx context.Context, spec entity.TrainingControlSpec) (*entity.TrainingControlResult, error) {
	payload, err := json.Marshal(map[string]string{
		"ticket_id": spec.TicketID,
		"action":    spec.Action,
	})
	if err != nil {
		return nil, fmt.Errorf("marshal training control payload: %w", err)
	}

	subject := "aurora.v1.ml.training.control"
	if err := s.nats.Publish(ctx, subject, payload); err != nil {
		return nil, fmt.Errorf("publish training control signal: %w", err)
	}

	// Update in-flight state immediately for fast feedback
	nowStr := time.Now().UTC().Format(time.RFC3339)
	s.mu.Lock()
	if st, ok := s.activeRuns[spec.TicketID]; ok {
		msg := fmt.Sprintf("Operator issued control action: %s", spec.Action)
		lvl := "warn"
		if spec.Action == "cancel" {
			st.Status = "cancelling"
		}
		st.Logs = append(st.Logs, entity.TrainingLogEntry{
			Timestamp: nowStr,
			Message:   msg,
			Level:     lvl,
		})
		st.UpdatedAt = nowStr
	}
	s.mu.Unlock()

	return &entity.TrainingControlResult{
		TicketID:  spec.TicketID,
		Action:    spec.Action,
		Status:    "dispatched",
		Timestamp: nowStr,
	}, nil
}

// GetActiveTraining queries the in-memory soft state for an active training run or latest run.
func (s *ModelService) GetActiveTraining(_ context.Context, ticketID string) (*entity.TrainingActiveState, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	ticketID = strings.TrimSpace(ticketID)
	if ticketID != "" {
		if state, exists := s.activeRuns[ticketID]; exists {
			cp := *state
			cp.LossHistory = append([]entity.LossPoint(nil), state.LossHistory...)
			cp.Logs = append([]entity.TrainingLogEntry(nil), state.Logs...)
			return &cp, nil
		}
		return nil, nil
	}

	// If no ticketID specified, find the latest running or queued run
	for i := len(s.recentOrder) - 1; i >= 0; i-- {
		tid := s.recentOrder[i]
		if state, ok := s.activeRuns[tid]; ok {
			if state.Status == "running" || state.Status == "queued" || state.Status == "cancelling" {
				cp := *state
				cp.LossHistory = append([]entity.LossPoint(nil), state.LossHistory...)
				cp.Logs = append([]entity.TrainingLogEntry(nil), state.Logs...)
				return &cp, nil
			}
		}
	}

	// If no active run, return the most recent run
	if len(s.recentOrder) > 0 {
		lastID := s.recentOrder[len(s.recentOrder)-1]
		if state, ok := s.activeRuns[lastID]; ok {
			cp := *state
			cp.LossHistory = append([]entity.LossPoint(nil), state.LossHistory...)
			cp.Logs = append([]entity.TrainingLogEntry(nil), state.Logs...)
			return &cp, nil
		}
	}

	return nil, nil
}

// ObserveTrainingProgress updates the in-memory soft state when worker telemetry arrives.
func (s *ModelService) ObserveTrainingProgress(_ context.Context, event map[string]any) error {
	ticketID, _ := event["ticket_id"].(string)
	ticketID = strings.TrimSpace(ticketID)
	if ticketID == "" {
		return nil
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	state, exists := s.activeRuns[ticketID]
	if !exists {
		task, _ := event["task"].(string)
		state = &entity.TrainingActiveState{
			TicketID:    ticketID,
			Task:        task,
			Status:      "running",
			Phase:       "training",
			StartedAt:   time.Now().UTC().UnixMilli(),
			LossHistory: make([]entity.LossPoint, 0),
			Logs:        make([]entity.TrainingLogEntry, 0),
		}
		s.activeRuns[ticketID] = state
		s.recentOrder = append(s.recentOrder, ticketID)
	}

	if st, ok := event["status"].(string); ok && st != "" {
		state.Status = st
	}
	if ph, ok := event["phase"].(string); ok && ph != "" {
		state.Phase = ph
	}
	if p, ok := event["progress_percent"].(float64); ok {
		state.ProgressPercent = p
	}
	if ep, ok := event["current_epoch"].(float64); ok {
		state.CurrentEpoch = int(ep)
	} else if ep, ok := event["current_epoch"].(int); ok {
		state.CurrentEpoch = ep
	}
	if tot, ok := event["total_epochs"].(float64); ok {
		state.TotalEpochs = int(tot)
	} else if tot, ok := event["total_epochs"].(int); ok {
		state.TotalEpochs = tot
	}
	if bep, ok := event["best_epoch"].(float64); ok {
		state.BestEpoch = int(bep)
	} else if bep, ok := event["best_epoch"].(int); ok {
		state.BestEpoch = bep
	}
	if bvl, ok := event["best_val_loss"].(float64); ok {
		state.BestValLoss = bvl
	}
	if tl, ok := event["train_loss"].(float64); ok {
		state.TrainLoss = tl
	}
	if vl, ok := event["val_loss"].(float64); ok {
		state.ValLoss = vl
	}
	if errStr, ok := event["error"].(string); ok && errStr != "" {
		state.Error = errStr
	}

	// Append epoch loss history
	if state.CurrentEpoch > 0 && event["val_loss"] != nil {
		point := entity.LossPoint{
			Epoch:     state.CurrentEpoch,
			TrainLoss: state.TrainLoss,
			ValLoss:   state.ValLoss,
			IsBest:    state.CurrentEpoch == state.BestEpoch,
		}
		existsIdx := -1
		for i, lp := range state.LossHistory {
			if lp.Epoch == point.Epoch {
				existsIdx = i
				break
			}
		}
		if existsIdx >= 0 {
			state.LossHistory[existsIdx] = point
		} else {
			state.LossHistory = append(state.LossHistory, point)
		}
	}

	state.UpdatedAt = time.Now().UTC().Format(time.RFC3339)
	return nil
}

// ObserveTrainingLog appends an in-flight log entry from the worker.
func (s *ModelService) ObserveTrainingLog(_ context.Context, ticketID string, entry entity.TrainingLogEntry) error {
	ticketID = strings.TrimSpace(ticketID)
	if ticketID == "" {
		return nil
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	state, exists := s.activeRuns[ticketID]
	if !exists {
		return nil
	}

	if entry.Timestamp == "" {
		entry.Timestamp = time.Now().UTC().Format(time.RFC3339)
	}
	state.Logs = append(state.Logs, entry)
	if len(state.Logs) > 200 {
		state.Logs = state.Logs[len(state.Logs)-200:]
	}
	state.UpdatedAt = entry.Timestamp
	return nil
}

// ListModels scans models/runtime/ in object storage, validates integrity, and identifies champions.
func (s *ModelService) ListModels(ctx context.Context, task string) ([]entity.Model, error) {
	objects, err := s.objects.ListObjects(ctx, "models/runtime/")
	if err != nil {
		return nil, err
	}

	models := make([]entity.Model, 0)
	for _, object := range objects {
		if !strings.HasSuffix(object.Key, "manifest.json") || !strings.HasPrefix(object.Key, "models/runtime/") {
			continue
		}

		data, err := s.objects.GetObject(ctx, object.Key)
		if err != nil {
			continue
		}

		var manifest struct {
			RuntimePackageID      string   `json:"runtime_package_id"`
			SourceModelID         string   `json:"source_model_id"`
			SourceEvaluationRunID string   `json:"source_evaluation_run_id"`
			ModelVersion          string   `json:"model_version"`
			Task                  string   `json:"task"`
			PreprocessingVersion  string   `json:"preprocessing_version"`
			FeatureOrder          []string `json:"feature_order"`
			DecisionThreshold     float64  `json:"decision_threshold"`
			PythonParityStatus    string   `json:"python_parity_status"`
			CreatedAt             string   `json:"created_at"`
			ONNXSizeBytes         int64    `json:"onnx_size_bytes"`
			ONNXSHA256            string   `json:"onnx_sha256"`
			PreprocessingSHA256   string   `json:"preprocessing_sha256"`
			ThresholdSHA256       string   `json:"threshold_sha256"`
			ParityFixtureSHA256   string   `json:"parity_fixture_sha256"`
		}
		if json.Unmarshal(data, &manifest) != nil || manifest.RuntimePackageID == "" || manifest.SourceModelID == "" {
			continue
		}

		var normTask, taskDir string
		switch strings.ToLower(strings.TrimSpace(manifest.Task)) {
		case "candidate", taxonomy.TaskCandidateVetting:
			normTask = taxonomy.TaskCandidateVetting
			taskDir = "candidate"
		default:
			continue
		}
		if task != "" && normTask != task {
			continue
		}

		integrityOK := true
		checks := []struct{ name, sum string }{
			{"model.onnx", manifest.ONNXSHA256},
			{"preprocessing.json", manifest.PreprocessingSHA256},
			{"threshold.json", manifest.ThresholdSHA256},
			{"parity-fixture.json", manifest.ParityFixtureSHA256},
		}
		for _, check := range checks {
			if check.sum == "" {
				integrityOK = false
				break
			}
			fileData, err := s.objects.GetObject(ctx, strings.TrimSuffix(object.Key, "manifest.json")+check.name)
			if err != nil {
				integrityOK = false
				break
			}
			sumBytes := sha256.Sum256(fileData)
			if hex.EncodeToString(sumBytes[:]) != check.sum {
				integrityOK = false
				break
			}
		}

		status := taxonomy.ModelStatusValidated
		if manifest.PythonParityStatus != "PASS" || !integrityOK {
			status = taxonomy.ModelStatusInvalid
		}

		if status != taxonomy.ModelStatusInvalid {
			champData, err := s.objects.GetObject(ctx, fmt.Sprintf("models/%s/champion.json", taskDir))
			if err == nil {
				var pointer struct {
					RuntimePackageID string `json:"runtime_package_id"`
				}
				if json.Unmarshal(champData, &pointer) == nil && pointer.RuntimePackageID == manifest.RuntimePackageID {
					status = taxonomy.ModelStatusChampion
				}
			}
		}

		integrityStatus := "FAIL"
		if integrityOK {
			integrityStatus = "PASS"
		}

		models = append(models, entity.Model{
			ModelID:              manifest.SourceModelID,
			RuntimePackageID:     manifest.RuntimePackageID,
			Task:                 normTask,
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
			IntegrityStatus:      integrityStatus,
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
	return models, nil
}

// GetModelEvaluation retrieves frozen-cohort evaluation evidence and verifies integrity.
func (s *ModelService) GetModelEvaluation(ctx context.Context, runtimePackageID string) (*entity.ModelEvaluation, error) {
	runtimePackageID = strings.TrimSpace(runtimePackageID)
	if runtimePackageID == "" {
		return nil, fmt.Errorf("%w: runtime_package_id is required", taxonomy.ErrInvalidRequest)
	}

	// 1. Locate the specific runtime package directly from object storage without calling other workflows
	objects, err := s.objects.ListObjects(ctx, "models/runtime/")
	if err != nil {
		return nil, err
	}

	var targetKey string
	var manifest struct {
		RuntimePackageID      string   `json:"runtime_package_id"`
		SourceModelID         string   `json:"source_model_id"`
		SourceEvaluationRunID string   `json:"source_evaluation_run_id"`
		ModelVersion          string   `json:"model_version"`
		Task                  string   `json:"task"`
		PreprocessingVersion  string   `json:"preprocessing_version"`
		FeatureOrder          []string `json:"feature_order"`
		DecisionThreshold     float64  `json:"decision_threshold"`
		PythonParityStatus    string   `json:"python_parity_status"`
		CreatedAt             string   `json:"created_at"`
		ONNXSizeBytes         int64    `json:"onnx_size_bytes"`
		ONNXSHA256            string   `json:"onnx_sha256"`
		PreprocessingSHA256   string   `json:"preprocessing_sha256"`
		ThresholdSHA256       string   `json:"threshold_sha256"`
		ParityFixtureSHA256   string   `json:"parity_fixture_sha256"`
	}

	found := false
	for _, obj := range objects {
		if !strings.HasSuffix(obj.Key, "manifest.json") || !strings.HasPrefix(obj.Key, "models/runtime/") {
			continue
		}
		data, err := s.objects.GetObject(ctx, obj.Key)
		if err != nil {
			continue
		}
		if json.Unmarshal(data, &manifest) == nil && manifest.RuntimePackageID == runtimePackageID {
			targetKey = obj.Key
			found = true
			break
		}
	}

	if !found || manifest.SourceEvaluationRunID == "" {
		return nil, provider.ErrObjectNotFound
	}

	var normTask, taskDir string
	switch strings.ToLower(strings.TrimSpace(manifest.Task)) {
	case "candidate", taxonomy.TaskCandidateVetting:
		normTask = taxonomy.TaskCandidateVetting
		taskDir = "candidate"
	default:
		return nil, fmt.Errorf("%w: unsupported evaluation task %q", taxonomy.ErrInvalidRequest, manifest.Task)
	}

	// 2. Verify integrity of the target runtime package
	integrityOK := true
	checks := []struct{ name, sum string }{
		{"model.onnx", manifest.ONNXSHA256},
		{"preprocessing.json", manifest.PreprocessingSHA256},
		{"threshold.json", manifest.ThresholdSHA256},
		{"parity-fixture.json", manifest.ParityFixtureSHA256},
	}
	basePath := strings.TrimSuffix(targetKey, "manifest.json")
	for _, check := range checks {
		if check.sum == "" {
			integrityOK = false
			break
		}
		fileData, err := s.objects.GetObject(ctx, basePath+check.name)
		if err != nil {
			integrityOK = false
			break
		}
		sumBytes := sha256.Sum256(fileData)
		if hex.EncodeToString(sumBytes[:]) != check.sum {
			integrityOK = false
			break
		}
	}

	status := taxonomy.ModelStatusValidated
	if manifest.PythonParityStatus != "PASS" || !integrityOK {
		status = taxonomy.ModelStatusInvalid
	}

	if status != taxonomy.ModelStatusInvalid {
		champData, err := s.objects.GetObject(ctx, fmt.Sprintf("models/%s/champion.json", taskDir))
		if err == nil {
			var pointer struct {
				RuntimePackageID string `json:"runtime_package_id"`
			}
			if json.Unmarshal(champData, &pointer) == nil && pointer.RuntimePackageID == manifest.RuntimePackageID {
				status = taxonomy.ModelStatusChampion
			}
		}
	}

	integrityStatus := "FAIL"
	if integrityOK {
		integrityStatus = "PASS"
	}

	// 3. Read evaluation artifacts
	prefix := fmt.Sprintf("models/evaluations/%s/%s/", taskDir, manifest.SourceEvaluationRunID)
	manifestKey := prefix + "manifest.json"
	manifestData, err := s.objects.GetObject(ctx, manifestKey)
	if err != nil {
		return nil, err
	}
	var evalManifest struct {
		EvaluationRunID  string `json:"evaluation_run_id"`
		TrainingRunID    string `json:"training_run_id"`
		GoldenCohortID   string `json:"golden_cohort_id"`
		RecentCohortID   string `json:"recent_cohort_id"`
		EvaluationPolicy string `json:"evaluation_policy"`
		ThresholdPolicy  string `json:"threshold_policy"`
		MetricsSHA256    string `json:"metrics_sha256"`
		ThresholdSHA256  string `json:"threshold_sha256"`
		CreatedAt        string `json:"created_at"`
	}
	if err := json.Unmarshal(manifestData, &evalManifest); err != nil {
		return nil, fmt.Errorf("parse evaluation manifest %s: %w", manifestKey, err)
	}
	if evalManifest.EvaluationRunID != manifest.SourceEvaluationRunID {
		return nil, fmt.Errorf("evaluation manifest identity mismatch for %s", runtimePackageID)
	}

	metricsData, err := s.objects.GetObject(ctx, prefix+"metrics.json")
	if err != nil {
		return nil, err
	}
	metricsDigest := sha256.Sum256(metricsData)
	if evalManifest.MetricsSHA256 == "" || hex.EncodeToString(metricsDigest[:]) != evalManifest.MetricsSHA256 {
		return nil, fmt.Errorf("evaluation metrics integrity check failed for %s", evalManifest.EvaluationRunID)
	}
	var metrics struct {
		GoldenRowCount        int64     `json:"golden_row_count"`
		GoldenPositiveCount   int64     `json:"golden_positive_count"`
		GoldenNegativeCount   int64     `json:"golden_negative_count"`
		GoldenPRAUC           *float64  `json:"golden_pr_auc"`
		GoldenROCAUC          *float64  `json:"golden_roc_auc"`
		GoldenPrecision       *float64  `json:"golden_precision"`
		GoldenRecall          *float64  `json:"golden_recall"`
		GoldenF1              *float64  `json:"golden_f1"`
		GoldenConfusionMatrix [][]int64 `json:"golden_confusion_matrix"`

		RecentPRAUC           *float64  `json:"recent_pr_auc"`
		RecentROCAUC          *float64  `json:"recent_roc_auc"`
		RecentPrecision       *float64  `json:"recent_precision"`
		RecentRecall          *float64  `json:"recent_recall"`
		RecentF1              *float64  `json:"recent_f1"`
		RecentConfusionMatrix [][]int64 `json:"recent_confusion_matrix"`
		RecentRowCount        int64     `json:"recent_row_count"`
		RecentPositiveCount   int64     `json:"recent_positive_count"`
		RecentNegativeCount   int64     `json:"recent_negative_count"`
		PRAUCDrift            *float64  `json:"pr_auc_drift"`
		RecallDrift           *float64  `json:"recall_drift"`
	}
	if err := json.Unmarshal(metricsData, &metrics); err != nil {
		return nil, fmt.Errorf("parse evaluation metrics %s: %w", evalManifest.EvaluationRunID, err)
	}

	thresholdData, err := s.objects.GetObject(ctx, prefix+"threshold.json")
	if err != nil {
		return nil, err
	}
	thresholdDigest := sha256.Sum256(thresholdData)
	if evalManifest.ThresholdSHA256 == "" || hex.EncodeToString(thresholdDigest[:]) != evalManifest.ThresholdSHA256 {
		return nil, fmt.Errorf("evaluation threshold integrity check failed for %s", evalManifest.EvaluationRunID)
	}
	var threshold struct {
		DecisionThreshold   float64  `json:"decision_threshold"`
		ValidationRowCount  int64    `json:"validation_row_count"`
		ValidationPrecision *float64 `json:"validation_precision"`
		ValidationRecall    *float64 `json:"validation_recall"`
		ValidationF1        *float64 `json:"validation_f1"`
	}
	if err := json.Unmarshal(thresholdData, &threshold); err != nil {
		return nil, fmt.Errorf("parse evaluation threshold %s: %w", evalManifest.EvaluationRunID, err)
	}

	evaluation := &entity.ModelEvaluation{
		RuntimePackageID:      manifest.RuntimePackageID,
		ModelID:               manifest.SourceModelID,
		ModelVersion:          manifest.ModelVersion,
		Task:                  normTask,
		ModelStatus:           status,
		ParityStatus:          manifest.PythonParityStatus,
		IntegrityStatus:       integrityStatus,
		EvaluationRunID:       evalManifest.EvaluationRunID,
		TrainingRunID:         evalManifest.TrainingRunID,
		GoldenCohortID:        evalManifest.GoldenCohortID,
		RecentCohortID:        evalManifest.RecentCohortID,
		EvaluationPolicy:      evalManifest.EvaluationPolicy,
		ThresholdPolicy:       evalManifest.ThresholdPolicy,
		DecisionThreshold:     threshold.DecisionThreshold,
		ValidationRowCount:    threshold.ValidationRowCount,
		ValidationPrecision:   threshold.ValidationPrecision,
		ValidationRecall:      threshold.ValidationRecall,
		ValidationF1:          threshold.ValidationF1,
		PRAUCDrift:            metrics.PRAUCDrift,
		RecallDrift:           metrics.RecallDrift,
		EvaluationManifestKey: manifestKey,
		MetricsSHA256:         evalManifest.MetricsSHA256,
		CreatedAt:             evalManifest.CreatedAt,
		Golden: entity.EvaluationCohortMetrics{
			RowCount:        metrics.GoldenRowCount,
			PositiveCount:   metrics.GoldenPositiveCount,
			NegativeCount:   metrics.GoldenNegativeCount,
			PRAUC:           metrics.GoldenPRAUC,
			ROCAUC:          metrics.GoldenROCAUC,
			Precision:       metrics.GoldenPrecision,
			Recall:          metrics.GoldenRecall,
			F1:              metrics.GoldenF1,
			ConfusionMatrix: metrics.GoldenConfusionMatrix,
		},
	}
	if evalManifest.RecentCohortID != "" {
		evaluation.Recent = &entity.EvaluationCohortMetrics{
			RowCount:        metrics.RecentRowCount,
			PositiveCount:   metrics.RecentPositiveCount,
			NegativeCount:   metrics.RecentNegativeCount,
			PRAUC:           metrics.RecentPRAUC,
			ROCAUC:          metrics.RecentROCAUC,
			Precision:       metrics.RecentPrecision,
			Recall:          metrics.RecentRecall,
			F1:              metrics.RecentF1,
			ConfusionMatrix: metrics.RecentConfusionMatrix,
		}
	}
	return evaluation, nil
}

// GetModelEvolution retrieves verified end-to-end lineage and artifact bindings for an immutable runtime package.
func (s *ModelService) GetModelEvolution(ctx context.Context, runtimePackageID string) (*entity.ModelEvolutionEvidence, error) {
	runtimePackageID = strings.TrimSpace(runtimePackageID)
	if runtimePackageID == "" {
		return nil, fmt.Errorf("%w: runtime_package_id is required", taxonomy.ErrInvalidRequest)
	}

	// 1. Locate the runtime package manifest directly from object storage
	objects, err := s.objects.ListObjects(ctx, "models/runtime/")
	if err != nil {
		return nil, err
	}

	var targetKey string
	var manifest struct {
		RuntimePackageID      string   `json:"runtime_package_id"`
		SourceModelID         string   `json:"source_model_id"`
		SourceEvaluationRunID string   `json:"source_evaluation_run_id"`
		ModelVersion          string   `json:"model_version"`
		Task                  string   `json:"task"`
		PreprocessingVersion  string   `json:"preprocessing_version"`
		FeatureOrder          []string `json:"feature_order"`
		DecisionThreshold     float64  `json:"decision_threshold"`
		PythonParityStatus    string   `json:"python_parity_status"`
		CreatedAt             string   `json:"created_at"`
		ONNXSizeBytes         int64    `json:"onnx_size_bytes"`
		ONNXSHA256            string   `json:"onnx_sha256"`
		PreprocessingSHA256   string   `json:"preprocessing_sha256"`
		ThresholdSHA256       string   `json:"threshold_sha256"`
		ParityFixtureSHA256   string   `json:"parity_fixture_sha256"`
		GoldSnapshotID        string   `json:"gold_snapshot_id"`
	}

	found := false
	for _, obj := range objects {
		if !strings.HasSuffix(obj.Key, "manifest.json") || !strings.HasPrefix(obj.Key, "models/runtime/") {
			continue
		}
		data, err := s.objects.GetObject(ctx, obj.Key)
		if err != nil {
			continue
		}
		if json.Unmarshal(data, &manifest) == nil && manifest.RuntimePackageID == runtimePackageID {
			targetKey = obj.Key
			found = true
			break
		}
	}

	if !found || manifest.SourceEvaluationRunID == "" {
		return nil, provider.ErrObjectNotFound
	}

	var normTask, taskDir string
	switch strings.ToLower(strings.TrimSpace(manifest.Task)) {
	case "candidate", taxonomy.TaskCandidateVetting:
		normTask = taxonomy.TaskCandidateVetting
		taskDir = "candidate"
	default:
		return nil, fmt.Errorf("%w: unsupported evaluation task %q", taxonomy.ErrInvalidRequest, manifest.Task)
	}

	// 2. Verify integrity of runtime package artifacts
	integrityOK := true
	checks := []struct{ name, sum string }{
		{"model.onnx", manifest.ONNXSHA256},
		{"preprocessing.json", manifest.PreprocessingSHA256},
		{"threshold.json", manifest.ThresholdSHA256},
		{"parity-fixture.json", manifest.ParityFixtureSHA256},
	}
	basePath := strings.TrimSuffix(targetKey, "manifest.json")
	for _, check := range checks {
		if check.sum == "" {
			integrityOK = false
			break
		}
		fileData, err := s.objects.GetObject(ctx, basePath+check.name)
		if err != nil {
			integrityOK = false
			break
		}
		sumBytes := sha256.Sum256(fileData)
		if hex.EncodeToString(sumBytes[:]) != check.sum {
			integrityOK = false
			break
		}
	}

	status := taxonomy.ModelStatusValidated
	if manifest.PythonParityStatus != "PASS" || !integrityOK {
		status = taxonomy.ModelStatusInvalid
	}

	if status != taxonomy.ModelStatusInvalid {
		champData, err := s.objects.GetObject(ctx, fmt.Sprintf("models/%s/champion.json", taskDir))
		if err == nil {
			var pointer struct {
				RuntimePackageID string `json:"runtime_package_id"`
			}
			if json.Unmarshal(champData, &pointer) == nil && pointer.RuntimePackageID == manifest.RuntimePackageID {
				status = taxonomy.ModelStatusChampion
			}
		}
	}

	integrityStatus := "FAIL"
	if integrityOK {
		integrityStatus = "PASS"
	}

	// 3. Read evaluation manifest
	prefix := fmt.Sprintf("models/evaluations/%s/%s/", taskDir, manifest.SourceEvaluationRunID)
	evalManifestKey := prefix + "manifest.json"
	evalManifestData, err := s.objects.GetObject(ctx, evalManifestKey)
	if err != nil {
		return nil, err
	}

	evalManifestSum := sha256.Sum256(evalManifestData)
	evalManifestSHA256 := hex.EncodeToString(evalManifestSum[:])

	var evalManifest struct {
		EvaluationRunID           string `json:"evaluation_run_id"`
		TrainingRunID             string `json:"training_run_id"`
		GoldenCohortID            string `json:"golden_cohort_id"`
		RecentCohortID            string `json:"recent_cohort_id"`
		EvaluationPolicy          string `json:"evaluation_policy"`
		ThresholdPolicy           string `json:"threshold_policy"`
		MetricsSHA256             string `json:"metrics_sha256"`
		ThresholdSHA256           string `json:"threshold_sha256"`
		CreatedAt                 string `json:"created_at"`
		GoldSnapshotID            string `json:"gold_snapshot_id"`
		GoldManifestSHA256        string `json:"gold_manifest_sha256"`
		SplitID                   string `json:"split_id"`
		DatasetViewVersion        string `json:"dataset_view_version"`
		DatasetViewFingerprint    string `json:"dataset_view_fingerprint"`
		TrainingRunManifestSHA256 string `json:"training_run_manifest_sha256"`
	}
	if err := json.Unmarshal(evalManifestData, &evalManifest); err != nil {
		return nil, fmt.Errorf("parse evaluation manifest %s: %w", evalManifestKey, err)
	}

	// 4. Read evaluation metrics
	metricsData, err := s.objects.GetObject(ctx, prefix+"metrics.json")
	if err != nil {
		return nil, err
	}
	metricsDigest := sha256.Sum256(metricsData)
	if evalManifest.MetricsSHA256 == "" || hex.EncodeToString(metricsDigest[:]) != evalManifest.MetricsSHA256 {
		return nil, fmt.Errorf("evaluation metrics integrity check failed for %s", evalManifest.EvaluationRunID)
	}

	var metrics struct {
		GoldenPRAUC  *float64 `json:"golden_pr_auc"`
		GoldenRecall *float64 `json:"golden_recall"`
	}
	if err := json.Unmarshal(metricsData, &metrics); err != nil {
		return nil, fmt.Errorf("parse evaluation metrics %s: %w", evalManifest.EvaluationRunID, err)
	}

	goldSnapshotID := evalManifest.GoldSnapshotID
	if goldSnapshotID == "" {
		goldSnapshotID = manifest.GoldSnapshotID
	}

	gatePassed := status != taxonomy.ModelStatusInvalid && metrics.GoldenPRAUC != nil && *metrics.GoldenPRAUC >= 0.80

	return &entity.ModelEvolutionEvidence{
		RuntimePackageID:            manifest.RuntimePackageID,
		ModelID:                     manifest.SourceModelID,
		ModelVersion:                manifest.ModelVersion,
		Task:                        normTask,
		ModelStatus:                 status,
		ParityStatus:                manifest.PythonParityStatus,
		IntegrityStatus:             integrityStatus,
		GatePassed:                  gatePassed,
		CreatedAt:                   manifest.CreatedAt,
		GoldSnapshotID:              goldSnapshotID,
		GoldManifestSHA256:          evalManifest.GoldManifestSHA256,
		DatasetViewVersion:          evalManifest.DatasetViewVersion,
		DatasetViewFingerprint:      evalManifest.DatasetViewFingerprint,
		TrainingRunID:               evalManifest.TrainingRunID,
		SplitID:                     evalManifest.SplitID,
		FeatureCount:                len(manifest.FeatureOrder),
		TrainingRunManifestSHA256:   evalManifest.TrainingRunManifestSHA256,
		PreprocessingVersion:        manifest.PreprocessingVersion,
		EvaluationRunID:             evalManifest.EvaluationRunID,
		EvaluationPolicyVersion:     evalManifest.EvaluationPolicy,
		ThresholdPolicyVersion:      evalManifest.ThresholdPolicy,
		GoldenPRAUC:                 metrics.GoldenPRAUC,
		GoldenRecall:                metrics.GoldenRecall,
		EvaluationRunManifestSHA256: evalManifestSHA256,
		MetricsSHA256:               evalManifest.MetricsSHA256,
		ONNXSizeBytes:               manifest.ONNXSizeBytes,
		ONNXSHA256:                  manifest.ONNXSHA256,
		RuntimeManifestKey:          targetKey,
	}, nil
}
