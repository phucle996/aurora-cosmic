package service

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"sort"
	"strings"

	"go-api/internal/domain/entity"
	"go-api/internal/domain/repo"
	domainService "go-api/internal/domain/service"
)

// ============================================================================
// MODELS SERVICE (Dịch vụ quản lý mô hình học máy - Model Registry)
// ============================================================================
// ModelsService chịu trách nhiệm:
// 1. Quét các package mô hình ML đã đăng ký trong MinIO (`models/runtime/...`).
// 2. Kiểm tra tính toàn vẹn (Integrity Check) qua mã băm SHA-256 của file ONNX, preprocessing, threshold.
// 3. Xác định trạng thái của mô hình: Champion (đang phục vụ chính), Validated (hợp lệ), hoặc Invalid (lỗi băm/parity).
type ModelsService struct {
	objects repo.ObjectRepository // Repository tương tác với MinIO S3
}

// NewModelsService khởi tạo thể hiện của ModelsService
func NewModelsService(objects repo.ObjectRepository) domainService.Models {
	return &ModelsService{objects: objects}
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
	ParityFixtureSHA256   string   `json:"parity_fixture_sha256"`   // SHA-256 của file kiểm thử đối sánh Python-Rust
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
		// Đường dẫn hợp lệ phải có định dạng: models/runtime/<task>/<model_id>/manifest.json (hoặc tương tự 5 cấp)
		parts := strings.Split(object.Key, "/")
		if len(parts) != 5 || parts[0] != "models" || parts[1] != "runtime" || parts[4] != "manifest.json" {
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
		normTask := entity.TaskAnomalyDetection
		if strings.EqualFold(strings.TrimSpace(manifest.Task), "candidate") || strings.EqualFold(strings.TrimSpace(manifest.Task), string(entity.TaskCandidateVetting)) {
			normTask = entity.TaskCandidateVetting
		}
		if task != "" && string(normTask) != task {
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
		status := string(entity.ModelStatusValidated)
		if manifest.PythonParityStatus != "PASS" || !integrityOK {
			status = string(entity.ModelStatusInvalid)
		}

		// 5. Kiểm tra xem model này có đang là Champion hay không (đọc từ models/<task>/champion.json)
		taskDir := "anomaly"
		if normTask == entity.TaskCandidateVetting {
			taskDir = "candidate"
		}
		if champData, err := s.objects.GetObject(ctx, fmt.Sprintf("models/%s/champion.json", taskDir)); err == nil {
			var pointer struct {
				ModelID string `json:"model_id"`
			}
			if json.Unmarshal(champData, &pointer) == nil && pointer.ModelID == manifest.SourceModelID {
				status = string(entity.ModelStatusChampion)
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
