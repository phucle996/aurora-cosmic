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

	"github.com/google/uuid"
	"go-api/internal/domain/entity"
	"go-api/internal/domain/repo"
	domainService "go-api/internal/domain/service"
	"go-api/internal/taxonomy"
)

// ============================================================================
// MODELS SERVICE (Dịch vụ quản lý mô hình học máy - Model Registry)
// ============================================================================
// ModelsService chịu trách nhiệm:
// 1. Quét các package mô hình ML đã đăng ký trong MinIO (`models/runtime/...`).
// 2. Kiểm tra tính toàn vẹn (Integrity Check) qua mã băm SHA-256 của file ONNX, preprocessing, threshold.
// 3. Xác định trạng thái của mô hình: Champion (đang phục vụ chính), Validated (hợp lệ), hoặc Invalid (lỗi băm/parity).
// 4. Phát lệnh huấn luyện mô hình mới tới GPU ML Worker qua NATS JetStream.
type ModelsService struct {
	objects    repo.ObjectRepository    // Repository tương tác với MinIO S3
	dispatcher repo.InferenceDispatcher // Dispatcher phát event sang NATS JetStream
	analytics  repo.TrainingReadinessRepository
}

// NewModelsService khởi tạo thể hiện của ModelsService
func NewModelsService(objects repo.ObjectRepository, dispatcher repo.InferenceDispatcher, analytics repo.TrainingReadinessRepository) domainService.Models {
	return &ModelsService{objects: objects, dispatcher: dispatcher, analytics: analytics}
}

func (s *ModelsService) TrainingReadiness(ctx context.Context, snapshotIDs []string) (*entity.TrainingReadiness, error) {
	normalized, err := normalizeGoldSnapshotIDs("", snapshotIDs)
	if err != nil {
		return nil, err
	}
	for _, snapshotID := range normalized {
		if err := s.requireCommittedGoldSnapshot(ctx, snapshotID); err != nil {
			return nil, err
		}
	}
	if s.analytics == nil {
		return nil, fmt.Errorf("training readiness analytics is unavailable")
	}
	return s.analytics.TrainingReadiness(ctx, normalized)
}

func (s *ModelsService) OverrideTrainingLabel(ctx context.Context, value entity.TrainingLabelOverride) error {
	value.SnapshotID = strings.TrimSpace(value.SnapshotID)
	value.SourceProductID = strings.TrimSpace(value.SourceProductID)
	value.TrainingLabel = strings.ToUpper(strings.TrimSpace(value.TrainingLabel))
	value.ReviewReason = strings.ToUpper(strings.TrimSpace(value.ReviewReason))
	if value.SourceProductID == "" || (value.TrainingLabel != "POSITIVE" && value.TrainingLabel != "NEGATIVE" && value.TrainingLabel != "UNRESOLVED") {
		return invalidModelRequest("source_product_id and a POSITIVE, NEGATIVE or UNRESOLVED label are required")
	}
	if len(value.ReviewReason) > 64 {
		return invalidModelRequest("review_reason must not exceed 64 characters")
	}
	if value.Confidence == 0 {
		value.Confidence = 1
	}
	if value.Confidence < 0 || value.Confidence > 1 {
		return invalidModelRequest("confidence must be between 0 and 1")
	}
	if err := s.requireCommittedGoldSnapshot(ctx, value.SnapshotID); err != nil {
		return err
	}
	overrides, ok := s.analytics.(repo.TrainingLabelOverrideRepository)
	if !ok {
		return fmt.Errorf("training label review repository is unavailable")
	}
	return overrides.OverrideTrainingLabel(ctx, value)
}

func (s *ModelsService) ListTrainingReviews(ctx context.Context, limit int) ([]entity.TrainingReview, error) {
	if limit <= 0 || limit > 500 {
		limit = 100
	}
	reviews, ok := s.analytics.(repo.TrainingReviewListRepository)
	if !ok {
		return nil, fmt.Errorf("training review repository is unavailable")
	}
	return reviews.ListTrainingReviews(ctx, limit)
}

func (s *ModelsService) ListTrainingReviewQueue(ctx context.Context, snapshotIDs []string, page entity.PageRequest) (entity.Page[entity.TrainingReviewQueueItem], error) {
	normalized, err := normalizeGoldSnapshotIDs("", snapshotIDs)
	if err != nil {
		return entity.Page[entity.TrainingReviewQueueItem]{}, err
	}
	if page.Limit <= 0 || page.Limit > 100 {
		page.Limit = 20
	}
	if page.Offset < 0 {
		return entity.Page[entity.TrainingReviewQueueItem]{}, invalidModelRequest("review queue offset must be non-negative")
	}
	queue, ok := s.analytics.(repo.TrainingReviewQueueRepository)
	if !ok {
		return entity.Page[entity.TrainingReviewQueueItem]{}, fmt.Errorf("training review queue repository is unavailable")
	}
	return queue.ListTrainingReviewQueue(ctx, normalized, page)
}

// ============================================================================
// DTO RUNTIME MANIFEST CỦA MODEL PACKAGE
// ============================================================================
// runtimeManifestDTO ánh xạ nội dung file `manifest.json` trong package mô hình:
// s3://aurora/models/runtime/<task>/<model_id>/<runtime_package_id>/manifest.json
type runtimeManifestDTO struct {
	RuntimePackageID       string   `json:"runtime_package_id"` // ID gói runtime (VD: rp-onnx-candidate-v1-...)
	RuntimeFingerprint     string   `json:"runtime_fingerprint"`
	Task                   string   `json:"task"`                     // Loại tác vụ: candidate_vetting hoặc astronomical_anomaly_detection
	SourceModelID          string   `json:"source_model_id"`          // ID mô hình gốc đăng ký (VD: candidate-cnn-v1)
	ModelVersion           string   `json:"model_version"`            // Phiên bản mô hình (VD: 1.0.0)
	PreprocessingVersion   string   `json:"preprocessing_version"`    // Phiên bản tiền xử lý dữ liệu đầu vào
	PreprocessingSHA256    string   `json:"preprocessing_sha256"`     // SHA-256 của file cấu hình preprocessing.json
	ThresholdSHA256        string   `json:"threshold_sha256"`         // SHA-256 của file ngưỡng quyết định threshold.json
	ParityFixtureSHA256    string   `json:"parity_fixture_sha256"`    // SHA-256 của file kiểm thử đối sánh Python-Rust
	FeatureOrder           []string `json:"feature_order"`            // Danh sách thứ tự các trường đặc trưng đầu vào
	ONNXSizeBytes          int64    `json:"onnx_size_bytes"`          // Kích thước file model.onnx (bytes)
	ONNXSHA256             string   `json:"onnx_sha256"`              // SHA-256 của file model.onnx
	DecisionThreshold      float64  `json:"decision_threshold"`       // Ngưỡng phân loại nhị phân (VD: 0.5)
	PythonParityStatus     string   `json:"python_parity_status"`     // Trạng thái kiểm thử đồng nhất giữa PyTorch và Rust ONNX ("PASS")
	SourceEvaluationRunID  string   `json:"source_evaluation_run_id"` // Mã đợt đánh giá mô hình trên tập validation
	DatasetViewVersion     string   `json:"dataset_view_version"`
	DatasetViewFingerprint string   `json:"dataset_view_fingerprint"`
	CreatedAt              string   `json:"created_at"` // Thời điểm tạo package (ISO 8601)
}

type evaluationManifestDTO struct {
	EvaluationRunID   string  `json:"evaluation_run_id"`
	TrainingRunID     string  `json:"training_run_id"`
	ModelVersion      string  `json:"model_version"`
	GoldenCohortID    string  `json:"golden_cohort_id"`
	RecentCohortID    string  `json:"recent_cohort_id"`
	EvaluationPolicy  string  `json:"evaluation_policy_version"`
	ThresholdPolicy   string  `json:"threshold_policy_version"`
	DecisionThreshold float64 `json:"decision_threshold"`
	ThresholdSHA256   string  `json:"threshold_sha256"`
	MetricsSHA256     string  `json:"metrics_sha256"`
	CreatedAt         string  `json:"created_at"`
}

type candidateEvaluationMetricsDTO struct {
	GoldenPRAUC           *float64  `json:"golden_pr_auc"`
	GoldenROCAUC          *float64  `json:"golden_roc_auc"`
	GoldenPrecision       *float64  `json:"golden_precision"`
	GoldenRecall          *float64  `json:"golden_recall"`
	GoldenF1              *float64  `json:"golden_f1"`
	GoldenConfusionMatrix [][]int64 `json:"golden_confusion_matrix"`
	GoldenRowCount        int64     `json:"golden_row_count"`
	GoldenPositiveCount   int64     `json:"golden_positive_count"`
	GoldenNegativeCount   int64     `json:"golden_negative_count"`
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

type evaluationThresholdDTO struct {
	DecisionThreshold   float64  `json:"decision_threshold"`
	ValidationRowCount  int64    `json:"validation_row_count"`
	ValidationPrecision *float64 `json:"validation_precision"`
	ValidationRecall    *float64 `json:"validation_recall"`
	ValidationF1        *float64 `json:"validation_f1"`
}

type modelPackageManifestDTO struct {
	ModelID                     string `json:"model_id"`
	TrainingRunID               string `json:"training_run_id"`
	TrainingRunManifestSHA256   string `json:"training_run_manifest_sha256"`
	EvaluationRunID             string `json:"evaluation_run_id"`
	EvaluationRunManifestSHA256 string `json:"evaluation_run_manifest_sha256"`
	GoldSnapshotID              string `json:"gold_snapshot_id"`
	GoldManifestSHA256          string `json:"gold_manifest_sha256"`
	SplitID                     string `json:"split_id"`
	DatasetViewVersion          string `json:"dataset_view_version"`
	DatasetViewFingerprint      string `json:"dataset_view_fingerprint"`
}

// ============================================================================
// HÀM LIỆT KÊ & KIỂM TRA MÔ HÌNH (List Models)
// ============================================================================
// ListModels duyệt toàn bộ model package trong `models/runtime/`,
// xác thực chữ ký SHA-256 của các thành phần, và đối chiếu pointer `champion.json`
// để đánh dấu model Champion hiện tại.
func (s *ModelsService) ListModels(ctx context.Context, task string) ([]entity.Model, error) {
	// 1. Quét danh sách file trong thư mục models/runtime/ trên MinIO
	objects, err := s.objects.ListObjects(ctx, "models/runtime/")
	if err != nil {
		return nil, err
	}

	models := make([]entity.Model, 0)
	for _, object := range objects {
		// Đường dẫn hợp lệ phải kết thúc bằng manifest.json và nằm dưới models/runtime/
		if !strings.HasSuffix(object.Key, "manifest.json") || !strings.HasPrefix(object.Key, "models/runtime/") {
			continue
		}

		// Đọc nội dung manifest.json của model package
		data, err := s.objects.GetObject(ctx, object.Key)
		if err != nil {
			continue
		}

		var manifest runtimeManifestDTO
		if json.Unmarshal(data, &manifest) != nil || manifest.RuntimePackageID == "" || manifest.SourceModelID == "" {
			continue
		}

		// 2. Chuẩn hóa task và lọc theo yêu cầu
		normTask, taskDir, ok := normalizeModelTask(manifest.Task)
		if !ok {
			continue
		}
		if task != "" && normTask != task {
			continue
		}

		// 3. Kiểm tra tính toàn vẹn dữ liệu (Data Integrity Check):
		// Đọc và băm SHA-256 từng file phụ trợ để so khớp với mã băm trong manifest
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

		// 4. Xác định trạng thái mô hình
		status := taxonomy.ModelStatusValidated
		if manifest.PythonParityStatus != "PASS" || !integrityOK {
			status = taxonomy.ModelStatusInvalid
		}

		// 5. Kiểm tra xem model này có đang là Champion hay không (đọc từ models/<task>/champion.json)
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

		// 6. Đưa thông tin model vào danh sách kết quả
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

	// Sắp xếp: gom theo Task, rồi sắp xếp model mới nhất lên đầu
	sort.Slice(models, func(i, j int) bool {
		if models[i].Task == models[j].Task {
			return models[i].CreatedAt > models[j].CreatedAt
		}
		return models[i].Task < models[j].Task
	})
	return models, nil
}

func (s *ModelsService) GetModelEvaluation(ctx context.Context, runtimePackageID string) (*entity.ModelEvaluation, error) {
	runtimePackageID = strings.TrimSpace(runtimePackageID)
	if runtimePackageID == "" {
		return nil, invalidModelRequest("runtime_package_id is required")
	}

	models, err := s.ListModels(ctx, "")
	if err != nil {
		return nil, err
	}
	var selected *entity.Model
	for i := range models {
		if models[i].RuntimePackageID == runtimePackageID {
			selected = &models[i]
			break
		}
	}
	if selected == nil || selected.EvaluationRunID == "" {
		return nil, repo.ErrObjectNotFound
	}
	_, taskDir, ok := normalizeModelTask(selected.Task)
	if !ok {
		return nil, invalidModelRequest("unsupported evaluation task %q", selected.Task)
	}

	prefix := fmt.Sprintf("models/evaluations/%s/%s/", taskDir, selected.EvaluationRunID)
	manifestKey := prefix + "manifest.json"
	manifestData, err := s.objects.GetObject(ctx, manifestKey)
	if err != nil {
		return nil, err
	}
	var manifest evaluationManifestDTO
	if err := json.Unmarshal(manifestData, &manifest); err != nil {
		return nil, fmt.Errorf("parse evaluation manifest %s: %w", manifestKey, err)
	}
	if manifest.EvaluationRunID != selected.EvaluationRunID {
		return nil, fmt.Errorf("evaluation manifest identity mismatch for %s", selected.RuntimePackageID)
	}

	metricsData, err := s.objects.GetObject(ctx, prefix+"metrics.json")
	if err != nil {
		return nil, err
	}
	metricsDigest := sha256.Sum256(metricsData)
	if manifest.MetricsSHA256 == "" || hex.EncodeToString(metricsDigest[:]) != manifest.MetricsSHA256 {
		return nil, fmt.Errorf("evaluation metrics integrity check failed for %s", manifest.EvaluationRunID)
	}
	var metrics candidateEvaluationMetricsDTO
	if err := json.Unmarshal(metricsData, &metrics); err != nil {
		return nil, fmt.Errorf("parse evaluation metrics %s: %w", manifest.EvaluationRunID, err)
	}

	thresholdData, err := s.objects.GetObject(ctx, prefix+"threshold.json")
	if err != nil {
		return nil, err
	}
	thresholdDigest := sha256.Sum256(thresholdData)
	if manifest.ThresholdSHA256 == "" || hex.EncodeToString(thresholdDigest[:]) != manifest.ThresholdSHA256 {
		return nil, fmt.Errorf("evaluation threshold integrity check failed for %s", manifest.EvaluationRunID)
	}
	var threshold evaluationThresholdDTO
	if err := json.Unmarshal(thresholdData, &threshold); err != nil {
		return nil, fmt.Errorf("parse evaluation threshold %s: %w", manifest.EvaluationRunID, err)
	}

	evaluation := &entity.ModelEvaluation{
		RuntimePackageID:      selected.RuntimePackageID,
		ModelID:               selected.ModelID,
		ModelVersion:          selected.ModelVersion,
		Task:                  selected.Task,
		ModelStatus:           selected.Status,
		ParityStatus:          selected.ParityStatus,
		IntegrityStatus:       selected.IntegrityStatus,
		EvaluationRunID:       manifest.EvaluationRunID,
		TrainingRunID:         manifest.TrainingRunID,
		GoldenCohortID:        manifest.GoldenCohortID,
		RecentCohortID:        manifest.RecentCohortID,
		EvaluationPolicy:      manifest.EvaluationPolicy,
		ThresholdPolicy:       manifest.ThresholdPolicy,
		DecisionThreshold:     threshold.DecisionThreshold,
		ValidationRowCount:    threshold.ValidationRowCount,
		ValidationPrecision:   threshold.ValidationPrecision,
		ValidationRecall:      threshold.ValidationRecall,
		ValidationF1:          threshold.ValidationF1,
		PRAUCDrift:            metrics.PRAUCDrift,
		RecallDrift:           metrics.RecallDrift,
		EvaluationManifestKey: manifestKey,
		RuntimeManifestKey:    selected.RuntimeManifestKey,
		PreprocessingVersion:  selected.PreprocessingVersion,
		FeatureCount:          selected.FeatureCount,
		ONNXSizeBytes:         selected.ONNXSizeBytes,
		ONNXSHA256:            selected.ONNXSHA256,
		MetricsSHA256:         manifest.MetricsSHA256,
		CreatedAt:             manifest.CreatedAt,
		Golden: entity.EvaluationCohortMetrics{
			RowCount: metrics.GoldenRowCount, PositiveCount: metrics.GoldenPositiveCount,
			NegativeCount: metrics.GoldenNegativeCount, PRAUC: metrics.GoldenPRAUC,
			ROCAUC: metrics.GoldenROCAUC, Precision: metrics.GoldenPrecision,
			Recall: metrics.GoldenRecall, F1: metrics.GoldenF1,
			ConfusionMatrix: metrics.GoldenConfusionMatrix,
		},
	}
	if manifest.RecentCohortID != "" {
		evaluation.Recent = &entity.EvaluationCohortMetrics{
			RowCount: metrics.RecentRowCount, PositiveCount: metrics.RecentPositiveCount,
			NegativeCount: metrics.RecentNegativeCount, PRAUC: metrics.RecentPRAUC,
			ROCAUC: metrics.RecentROCAUC, Precision: metrics.RecentPrecision,
			Recall: metrics.RecentRecall, F1: metrics.RecentF1,
			ConfusionMatrix: metrics.RecentConfusionMatrix,
		}
	}
	packageKey := fmt.Sprintf("models/registry/%s/%s/manifest.json", taskDir, selected.ModelID)
	if packageData, packageErr := s.objects.GetObject(ctx, packageKey); packageErr == nil {
		var modelPackage modelPackageManifestDTO
		if json.Unmarshal(packageData, &modelPackage) == nil && modelPackage.ModelID == selected.ModelID && modelPackage.EvaluationRunID == manifest.EvaluationRunID {
			evaluation.GoldSnapshotID = modelPackage.GoldSnapshotID
			evaluation.GoldManifestSHA256 = modelPackage.GoldManifestSHA256
			evaluation.SplitID = modelPackage.SplitID
			evaluation.DatasetViewVersion = modelPackage.DatasetViewVersion
			evaluation.DatasetViewFingerprint = modelPackage.DatasetViewFingerprint
			evaluation.TrainingManifestSHA256 = modelPackage.TrainingRunManifestSHA256
			evaluation.EvaluationManifestSHA256 = modelPackage.EvaluationRunManifestSHA256
		}
	}
	return evaluation, nil
}

// ============================================================================
// HÀM KHỞI CHẠY HUẤN LUYỆN MÔ HÌNH (Start Training Job)
// ============================================================================
// StartTrainingJob tiếp nhận yêu cầu từ Dashboard, đóng gói cấu hình huấn luyện
// và phát sự kiện `aurora.v1.ml.training.requested` qua NATS tới GPU ML Worker.
func (s *ModelsService) StartTrainingJob(ctx context.Context, req entity.TrainingJobSpec) (*entity.TrainingJobResult, error) {
	if req.Task == "" {
		req.Task = taxonomy.TaskCandidateVetting
	}
	normalizedTask, _, ok := normalizeModelTask(req.Task)
	if !ok {
		return nil, invalidModelRequest("unsupported training task %q", req.Task)
	}
	req.Task = normalizedTask
	if req.Epochs <= 0 {
		req.Epochs = 50
	}
	if req.LearningRate <= 0 {
		req.LearningRate = 0.001
	}
	if req.BatchSize <= 0 {
		req.BatchSize = 32
	}
	if req.Seed == 0 {
		req.Seed = 42
	}
	jobID := fmt.Sprintf("train-%d", time.Now().UnixNano()/1e6)
	createdAt := time.Now().UTC().Format(time.RFC3339)

	if req.TrainingMode == "" {
		req.TrainingMode = "fine_tune"
	}
	if req.TrainingMode != "fine_tune" && req.TrainingMode != "scratch" {
		return nil, invalidModelRequest("invalid training_mode %q: expected fine_tune or scratch", req.TrainingMode)
	}
	if req.BaseModelID == "" {
		req.BaseModelID = "champion"
	}
	if req.ComputeTarget == "" {
		req.ComputeTarget = "gpu"
	}
	if req.ComputeTarget != "cpu" && req.ComputeTarget != "gpu" {
		return nil, invalidModelRequest("invalid compute_target %q: expected cpu or gpu", req.ComputeTarget)
	}

	normalizedSnapshotIDs, err := normalizeGoldSnapshotIDs(req.GoldSnapshotID, req.GoldSnapshotIDs)
	if err != nil {
		return nil, err
	}
	req.GoldSnapshotIDs = normalizedSnapshotIDs
	req.GoldSnapshotID = req.GoldSnapshotIDs[0]
	readiness, err := s.TrainingReadiness(ctx, req.GoldSnapshotIDs)
	if err != nil {
		return nil, err
	}
	if !readiness.Ready {
		return nil, invalidModelRequest("Gold snapshot is not a supervised training cohort: %s", readiness.Blocker)
	}
	payload, err := json.Marshal(map[string]any{
		"training_job_id":   jobID,
		"task":              req.Task,
		"gold_snapshot_id":  req.GoldSnapshotID,
		"gold_snapshot_ids": req.GoldSnapshotIDs,
		"base_model_id":     req.BaseModelID,
		"training_mode":     req.TrainingMode,
		"epochs":            req.Epochs,
		"learning_rate":     req.LearningRate,
		"batch_size":        req.BatchSize,
		"seed":              req.Seed,
		// Promotion changes scientific production state and must be an
		// explicit human action through the registry control plane.
		"auto_promote":   false,
		"compute_target": req.ComputeTarget,
		"created_at":     createdAt,
	})
	if err != nil {
		return nil, fmt.Errorf("marshal training request: %w", err)
	}

	if s.dispatcher == nil {
		return nil, fmt.Errorf("training dispatcher is unavailable")
	}
	if err := s.dispatcher.Dispatch(ctx, "training_start", payload); err != nil {
		return nil, fmt.Errorf("dispatch training event: %w", err)
	}

	return &entity.TrainingJobResult{
		JobID:           jobID,
		Task:            req.Task,
		GoldSnapshotID:  req.GoldSnapshotID,
		GoldSnapshotIDs: req.GoldSnapshotIDs,
		Status:          "queued",
		CreatedAt:       createdAt,
		Message:         fmt.Sprintf("Training job %s dispatched to the %s training branch; promotion requires manual review.", jobID, req.ComputeTarget),
		ComputeTarget:   req.ComputeTarget,
	}, nil
}

// ============================================================================
// HÀM TRIỂN KHAI / HỦY TRIỂN KHAI MÔ HÌNH SUY LUẬN (Champion Deployment)
// ============================================================================
// SetModelDeployment validates a package in the serving runtime before
// atomically switching champion.json. Progress is emitted over Core NATS with
// the caller's ticket ID and reaches the dashboard through the SSE broker.
func (s *ModelsService) SetModelDeployment(ctx context.Context, modelID string, task string, active bool, ticketID string) (*entity.ModelDeploymentResult, error) {
	if task == "" {
		task = taxonomy.TaskCandidateVetting
	}
	normalizedTask, taskDir, ok := normalizeModelTask(task)
	if !ok {
		return nil, invalidModelRequest("unsupported model task %q", task)
	}
	if ticketID == "" {
		ticketID = uuid.NewString()
	} else if _, err := uuid.Parse(ticketID); err != nil {
		return nil, invalidModelRequest("ticket_id must be a UUID")
	}
	result := &entity.ModelDeploymentResult{TicketID: ticketID, RuntimePackageID: modelID, Active: active}

	if !active {
		if err := s.objects.DeleteObject(ctx, fmt.Sprintf("models/%s/champion.json", taskDir)); err != nil {
			return nil, err
		}
		return result, nil
	}
	modelID = strings.TrimSpace(modelID)
	if modelID == "" {
		return nil, invalidModelRequest("runtime_package_id is required")
	}
	bus, ok := s.dispatcher.(repo.ModelPromotionBus)
	if !ok {
		return nil, fmt.Errorf("model promotion event bus is unavailable")
	}
	emit := func(status, phase string, progress int, message string, evidence map[string]any) error {
		payload := map[string]any{
			"schema_version":     1,
			"event_type":         "aurora.live.ml.promotion.progress",
			"ticket_id":          ticketID,
			"runtime_package_id": modelID,
			"task":               normalizedTask,
			"status":             status,
			"phase":              phase,
			"progress_percent":   progress,
			"message":            message,
			"occurred_at":        time.Now().UTC().Format(time.RFC3339Nano),
		}
		for key, value := range evidence {
			payload[key] = value
		}
		data, err := json.Marshal(payload)
		if err != nil {
			return err
		}
		return bus.PublishCore(ctx, "aurora.live.ml.promotion.progress", data)
	}
	fail := func(phase string, cause error) (*entity.ModelDeploymentResult, error) {
		_ = emit("failed", phase, 100, cause.Error(), map[string]any{"error": cause.Error()})
		return nil, cause
	}
	if err := emit("running", "registry_preflight", 10, "Resolving immutable runtime generation", nil); err != nil {
		return nil, fmt.Errorf("publish promotion preflight: %w", err)
	}
	models, err := s.ListModels(ctx, normalizedTask)
	if err != nil {
		return fail("registry_preflight", fmt.Errorf("load runtime registry: %w", err))
	}
	var selected *entity.Model
	for index := range models {
		model := &models[index]
		if model.RuntimePackageID == modelID {
			selected = model
			break
		}
	}
	if selected == nil {
		return fail("registry_preflight", invalidModelRequest("runtime package %q was not found for task %s", modelID, normalizedTask))
	}
	if selected.Status == taxonomy.ModelStatusInvalid || selected.IntegrityStatus != "PASS" || selected.ParityStatus != "PASS" {
		return fail("verification_gates", invalidModelRequest("runtime package %q has not passed integrity and parity validation", modelID))
	}
	if err := emit("running", "verification_gates", 25, "Integrity and evaluation parity gates passed", map[string]any{
		"integrity_status": selected.IntegrityStatus,
		"parity_status":    selected.ParityStatus,
	}); err != nil {
		return nil, fmt.Errorf("publish verification progress: %w", err)
	}
	runtimeManifest, err := s.objects.GetObject(ctx, selected.RuntimeManifestKey)
	if err != nil {
		return fail("runtime_manifest", fmt.Errorf("read runtime manifest: %w", err))
	}
	runtimeManifestDigest := sha256.Sum256(runtimeManifest)
	runtimeManifestSHA := hex.EncodeToString(runtimeManifestDigest[:])
	request := map[string]any{
		"schema_version":          1,
		"ticket_id":               ticketID,
		"runtime_package_id":      selected.RuntimePackageID,
		"runtime_manifest_key":    selected.RuntimeManifestKey,
		"runtime_manifest_sha256": runtimeManifestSHA,
		"task":                    normalizedTask,
		"requested_at":            time.Now().UTC().Format(time.RFC3339Nano),
	}
	requestData, err := json.Marshal(request)
	if err != nil {
		return fail("runtime_canary", fmt.Errorf("marshal runtime canary: %w", err))
	}
	if err := emit("running", "runtime_canary_queued", 35, "Runtime canary dispatched to Rust inference", nil); err != nil {
		return nil, fmt.Errorf("publish canary progress: %w", err)
	}
	canaryCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	responseData, err := bus.RequestCore(canaryCtx, "aurora.live.ml.promotion.requested", requestData)
	if err != nil {
		return fail("runtime_canary", fmt.Errorf("Rust runtime canary did not complete: %w", err))
	}
	var canary struct {
		Status              string  `json:"status"`
		Error               string  `json:"error"`
		RuntimePackageID    string  `json:"runtime_package_id"`
		RuntimeValidationID string  `json:"runtime_validation_id"`
		Engine              string  `json:"engine"`
		MaxAbsoluteError    float64 `json:"max_absolute_error"`
		MaxRelativeError    float64 `json:"max_relative_error"`
	}
	if err := json.Unmarshal(responseData, &canary); err != nil {
		return fail("runtime_canary", fmt.Errorf("decode runtime canary response: %w", err))
	}
	if canary.Status != "PASS" || canary.RuntimePackageID != selected.RuntimePackageID {
		if canary.Error == "" {
			canary.Error = fmt.Sprintf("runtime canary returned invalid evidence: status=%q runtime_package_id=%q expected=%q", canary.Status, canary.RuntimePackageID, selected.RuntimePackageID)
		}
		return fail("runtime_canary", errors.New(canary.Error))
	}

	// Commit only after the serving runtime has loaded the exact package and
	// reproduced the immutable parity fixture.
	if err := emit("running", "champion_pointer_commit", 95, "Runtime canary passed; committing serving pointer", map[string]any{
		"runtime_validation_id": canary.RuntimeValidationID,
		"engine":                canary.Engine,
		"max_absolute_error":    canary.MaxAbsoluteError,
		"max_relative_error":    canary.MaxRelativeError,
	}); err != nil {
		return nil, fmt.Errorf("publish pointer progress: %w", err)
	}
	now := time.Now().UTC().Format(time.RFC3339)
	pointerData, err := json.MarshalIndent(map[string]any{
		"runtime_package_id":    selected.RuntimePackageID,
		"model_id":              selected.ModelID,
		"task":                  normalizedTask,
		"promoted_at":           now,
		"promotion_ticket_id":   ticketID,
		"runtime_validation_id": canary.RuntimeValidationID,
	}, "", "  ")
	if err != nil {
		return fail("champion_pointer_commit", fmt.Errorf("marshal champion pointer: %w", err))
	}

	key := fmt.Sprintf("models/%s/champion.json", taskDir)
	if err := s.objects.PutObject(ctx, key, pointerData, "application/json"); err != nil {
		return fail("champion_pointer_commit", fmt.Errorf("write champion pointer %s: %w", key, err))
	}
	result.RuntimeValidation = canary.RuntimeValidationID
	result.Engine = canary.Engine
	result.MaxAbsoluteError = canary.MaxAbsoluteError
	result.MaxRelativeError = canary.MaxRelativeError
	_ = emit("completed", "completed", 100, "Champion is serving after a successful runtime canary", map[string]any{
		"runtime_validation_id": canary.RuntimeValidationID,
		"engine":                canary.Engine,
		"max_absolute_error":    canary.MaxAbsoluteError,
		"max_relative_error":    canary.MaxRelativeError,
	})
	return result, nil
}

func normalizeModelTask(task string) (canonical string, directory string, ok bool) {
	switch strings.ToLower(strings.TrimSpace(task)) {
	case "candidate", taxonomy.TaskCandidateVetting:
		return taxonomy.TaskCandidateVetting, "candidate", true
	default:
		return "", "", false
	}
}

func normalizeGoldSnapshotIDs(primary string, values []string) ([]string, error) {
	const maximumSnapshotsPerRun = 200
	primary = strings.TrimSpace(primary)
	unique := make(map[string]struct{}, len(values)+1)
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value != "" {
			unique[value] = struct{}{}
		}
	}
	if primary != "" {
		if len(unique) > 0 {
			if _, exists := unique[primary]; !exists {
				return nil, invalidModelRequest("gold_snapshot_id conflicts with gold_snapshot_ids")
			}
		}
		unique[primary] = struct{}{}
	}
	if len(unique) == 0 {
		return nil, invalidModelRequest("at least one committed Gold snapshot is required")
	}
	if len(unique) > maximumSnapshotsPerRun {
		return nil, invalidModelRequest("at most %d Gold snapshots may be selected per training run", maximumSnapshotsPerRun)
	}
	normalized := make([]string, 0, len(unique))
	for value := range unique {
		normalized = append(normalized, value)
	}
	sort.Strings(normalized)
	return normalized, nil
}

func (s *ModelsService) requireCommittedGoldSnapshot(ctx context.Context, snapshotID string) error {
	snapshotID = strings.TrimSpace(snapshotID)
	if !strings.HasPrefix(snapshotID, "gold-v1-") || strings.Contains(snapshotID, "/") {
		return invalidModelRequest("a valid gold_snapshot_id is required")
	}
	data, err := s.objects.GetObject(ctx, "gold/snapshots/"+snapshotID+"/manifest.json")
	if err != nil {
		if errors.Is(err, repo.ErrObjectNotFound) {
			return invalidModelRequest("Gold snapshot %s was not found", snapshotID)
		}
		return fmt.Errorf("read Gold snapshot %s: %w", snapshotID, err)
	}
	var snapshot entity.GoldSnapshotDetail
	if err := json.Unmarshal(data, &snapshot); err != nil {
		return invalidModelRequest("decode Gold snapshot %s: %v", snapshotID, err)
	}
	if snapshot.SnapshotID != snapshotID || snapshot.Status != "COMMITTED" {
		return invalidModelRequest("Gold snapshot %s is not committed", snapshotID)
	}
	return nil
}

func invalidModelRequest(format string, arguments ...any) error {
	return fmt.Errorf("%w: %s", taxonomy.ErrInvalidRequest, fmt.Sprintf(format, arguments...))
}
