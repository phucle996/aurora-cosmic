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
	if value.SourceProductID == "" || (value.TrainingLabel != "POSITIVE" && value.TrainingLabel != "NEGATIVE" && value.TrainingLabel != "UNRESOLVED") {
		return invalidModelRequest("source_product_id and a POSITIVE, NEGATIVE or UNRESOLVED label are required")
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

// ============================================================================
// DTO RUNTIME MANIFEST CỦA MODEL PACKAGE
// ============================================================================
// runtimeManifestDTO ánh xạ nội dung file `manifest.json` trong package mô hình:
// s3://aurora/models/runtime/<task>/<model_id>/<runtime_package_id>/manifest.json
type runtimeManifestDTO struct {
	RuntimePackageID      string   `json:"runtime_package_id"`       // ID gói runtime (VD: rp-onnx-candidate-v1-...)
	Task                  string   `json:"task"`                     // Loại tác vụ: candidate_vetting hoặc astronomical_anomaly_detection
	SourceModelID         string   `json:"source_model_id"`          // ID mô hình gốc đăng ký (VD: candidate-cnn-v1)
	ModelVersion          string   `json:"model_version"`            // Phiên bản mô hình (VD: 1.0.0)
	PreprocessingVersion  string   `json:"preprocessing_version"`    // Phiên bản tiền xử lý dữ liệu đầu vào
	PreprocessingSHA256   string   `json:"preprocessing_sha256"`     // SHA-256 của file cấu hình preprocessing.json
	ThresholdSHA256       string   `json:"threshold_sha256"`         // SHA-256 của file ngưỡng quyết định threshold.json
	ParityFixtureSHA256   string   `json:"parity_fixture_sha256"`    // SHA-256 của file kiểm thử đối sánh Python-Rust
	FeatureOrder          []string `json:"feature_order"`            // Danh sách thứ tự các trường đặc trưng đầu vào
	ONNXSizeBytes         int64    `json:"onnx_size_bytes"`          // Kích thước file model.onnx (bytes)
	ONNXSHA256            string   `json:"onnx_sha256"`              // SHA-256 của file model.onnx
	DecisionThreshold     float64  `json:"decision_threshold"`       // Ngưỡng phân loại nhị phân (VD: 0.5)
	PythonParityStatus    string   `json:"python_parity_status"`     // Trạng thái kiểm thử đồng nhất giữa PyTorch và Rust ONNX ("PASS")
	SourceEvaluationRunID string   `json:"source_evaluation_run_id"` // Mã đợt đánh giá mô hình trên tập validation
	CreatedAt             string   `json:"created_at"`               // Thời điểm tạo package (ISO 8601)
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
// SetModelDeployment cập nhật nguyên tử con trỏ `champion.json` trong MinIO
// để chọn model làm Champion phục vụ suy luận trực tiếp, hoặc hủy kích hoạt.
func (s *ModelsService) SetModelDeployment(ctx context.Context, modelID string, task string, active bool) error {
	if task == "" {
		task = taxonomy.TaskCandidateVetting
	}
	normalizedTask, taskDir, ok := normalizeModelTask(task)
	if !ok {
		return invalidModelRequest("unsupported model task %q", task)
	}

	if !active {
		return s.objects.DeleteObject(ctx, fmt.Sprintf("models/%s/champion.json", taskDir))
	}
	modelID = strings.TrimSpace(modelID)
	if modelID == "" {
		return invalidModelRequest("runtime_package_id is required")
	}
	models, err := s.ListModels(ctx, normalizedTask)
	if err != nil {
		return fmt.Errorf("load runtime registry: %w", err)
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
		return invalidModelRequest("runtime package %q was not found for task %s", modelID, normalizedTask)
	}
	if selected.Status == taxonomy.ModelStatusInvalid || selected.IntegrityStatus != "PASS" || selected.ParityStatus != "PASS" {
		return invalidModelRequest("runtime package %q has not passed integrity and parity validation", modelID)
	}

	// Triển khai model: ghi nguyên tử con trỏ champion.json
	now := time.Now().UTC().Format(time.RFC3339)
	pointerData, err := json.MarshalIndent(map[string]any{
		"runtime_package_id": selected.RuntimePackageID,
		"model_id":           selected.ModelID,
		"task":               normalizedTask,
		"promoted_at":        now,
	}, "", "  ")
	if err != nil {
		return fmt.Errorf("marshal champion pointer: %w", err)
	}

	key := fmt.Sprintf("models/%s/champion.json", taskDir)
	if err := s.objects.PutObject(ctx, key, pointerData, "application/json"); err != nil {
		return fmt.Errorf("write champion pointer %s: %w", key, err)
	}
	return nil
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
