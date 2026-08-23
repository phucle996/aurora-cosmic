package service

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
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
}

// NewModelsService khởi tạo thể hiện của ModelsService
func NewModelsService(objects repo.ObjectRepository, dispatcher repo.InferenceDispatcher) domainService.Models {
	return &ModelsService{objects: objects, dispatcher: dispatcher}
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
		normTask := taxonomy.TaskAnomalyDetection
		if strings.EqualFold(strings.TrimSpace(manifest.Task), "candidate") || strings.EqualFold(strings.TrimSpace(manifest.Task), taxonomy.TaskCandidateVetting) {
			normTask = taxonomy.TaskCandidateVetting
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
		taskDir := "anomaly"
		if normTask == taxonomy.TaskCandidateVetting {
			taskDir = "candidate"
		}
		for _, candidateDir := range []string{manifest.Task, taskDir} {
			if champData, err := s.objects.GetObject(ctx, fmt.Sprintf("models/%s/champion.json", candidateDir)); err == nil {
				var pointer struct {
					ModelID string `json:"model_id"`
				}
				if json.Unmarshal(champData, &pointer) == nil && (pointer.ModelID == manifest.SourceModelID || pointer.ModelID == manifest.RuntimePackageID) {
					status = taxonomy.ModelStatusChampion
					break
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
		req.Task = "candidate_vetting"
	}
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
	if req.BaseModelID == "" {
		req.BaseModelID = "champion"
	}

	if len(req.GoldSnapshotIDs) > 0 && req.GoldSnapshotID == "" {
		req.GoldSnapshotID = req.GoldSnapshotIDs[0]
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
		"auto_promote":      req.AutoPromote,
		"created_at":        createdAt,
	})
	if err != nil {
		return nil, fmt.Errorf("marshal training request: %w", err)
	}

	if s.dispatcher != nil {
		if err := s.dispatcher.Dispatch(ctx, "training_start", payload); err != nil {
			return nil, fmt.Errorf("dispatch training event: %w", err)
		}
	}

	return &entity.TrainingJobResult{
		JobID:           jobID,
		Task:            req.Task,
		GoldSnapshotID:  req.GoldSnapshotID,
		GoldSnapshotIDs: req.GoldSnapshotIDs,
		Status:          "queued",
		CreatedAt:       createdAt,
		Message:         fmt.Sprintf("Training job %s successfully dispatched to PyTorch GPU worker.", jobID),
	}, nil
}

// ============================================================================
// HÀM TRIỂN KHAI / HỦY TRIỂN KHAI MÔ HÌNH SUY LUẬN (Champion Deployment)
// ============================================================================
// SetModelDeployment cập nhật nguyên tử con trỏ `champion.json` trong MinIO
// để chọn model làm Champion phục vụ suy luận trực tiếp, hoặc hủy kích hoạt.
func (s *ModelsService) SetModelDeployment(ctx context.Context, modelID string, task string, active bool) error {
	if task == "" {
		task = "candidate_vetting"
	}
	taskDirs := []string{task}
	switch task {
	case "candidate_vetting":
		taskDirs = append(taskDirs, "candidate")
	case "astronomical_anomaly_detection":
		taskDirs = append(taskDirs, "anomaly")
	}

	if !active {
		// Hủy kích hoạt / Bỏ chọn: xóa con trỏ champion.json
		for _, dir := range taskDirs {
			key := fmt.Sprintf("models/%s/champion.json", dir)
			_ = s.objects.DeleteObject(ctx, key)
		}
		return nil
	}

	// Triển khai model: ghi nguyên tử con trỏ champion.json
	now := time.Now().UTC().Format(time.RFC3339)
	pointerData, err := json.MarshalIndent(map[string]any{
		"model_id":    modelID,
		"task":        task,
		"promoted_at": now,
	}, "", "  ")
	if err != nil {
		return fmt.Errorf("marshal champion pointer: %w", err)
	}

	for _, dir := range taskDirs {
		key := fmt.Sprintf("models/%s/champion.json", dir)
		if err := s.objects.PutObject(ctx, key, pointerData, "application/json"); err != nil {
			return fmt.Errorf("write champion pointer %s: %w", key, err)
		}
	}
	return nil
}
