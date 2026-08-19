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

// ============================================================================
// INFERENCE SERVICE (Dịch vụ quản lý tác vụ suy luận ML)
// ============================================================================
// InferenceService chịu trách nhiệm:
// 1. Quét danh sách các tác vụ suy luận (Inference Jobs) từ MinIO manifests.
// 2. Kiểm tra trạng thái hoàn thành (Completed) hay đang chờ (Planned) qua output files.
// 3. Cho phép kích hoạt chạy lại (Retry / Re-dispatch) một Inference Job qua NATS.
type InferenceService struct {
	objects    repo.ObjectRepository     // Repository tương tác trực tiếp với MinIO S3
	dispatcher repo.InferenceDispatcher // Dispatcher gửi event kích hoạt job qua NATS JetStream
}

// NewInferenceService khởi tạo thể hiện của InferenceService
func NewInferenceService(objects repo.ObjectRepository, dispatcher repo.InferenceDispatcher) domainService.Inference {
	return &InferenceService{objects: objects, dispatcher: dispatcher}
}

// ============================================================================
// DTO ĐẶC TẢ MANIFEST TÁC VỤ SUY LUẬN (Inference Job Manifest DTO)
// ============================================================================
// inferenceJobManifestDTO ánh xạ nội dung file JSON bất biến lưu tại:
// s3://aurora/manifests/inference-jobs/<job_id>.json
type inferenceJobManifestDTO struct {
	SchemaVersion             int    `json:"schema_version"`               // Phiên bản schema hợp đồng (schema_version = 1)
	JobID                     string `json:"job_id"`                       // Định danh duy nhất của job (VD: inference-job-v1-...)
	JobFingerprint            string `json:"job_fingerprint"`              // Mã băm SHA-256 xác thực tính toàn vẹn cấu hình job
	Task                      string `json:"task"`                         // Loại tác vụ: candidate_vetting hoặc astronomical_anomaly_detection
	GoldSnapshotID            string `json:"gold_snapshot_id"`             // ID của snapshot Gold làm đầu vào
	GoldManifestKey           string `json:"gold_manifest_key"`            // Đường dẫn S3 tới manifest của Gold snapshot
	GoldArtifactKey           string `json:"gold_artifact_key"`            // Đường dẫn S3 tới file Parquet dữ liệu Gold
	GoldArtifactContentSHA256 string `json:"gold_artifact_content_sha256"` // SHA-256 nội dung file Parquet
	GoldArtifactRowCount      int64  `json:"gold_artifact_row_count"`      // Số lượng dòng dữ liệu trong partition
	Sector                    int    `json:"sector"`                       // Sector quan sát của NASA TESS
	RuntimePackageID          string `json:"runtime_package_id"`           // Gói runtime ONNX model được sử dụng
	RuntimeManifestKey        string `json:"runtime_manifest_key"`         // Đường dẫn S3 tới manifest của package model
	RuntimeManifestSHA256     string `json:"runtime_manifest_sha256"`      // SHA-256 của model runtime manifest
	RuntimeValidationID       string `json:"runtime_validation_id"`        // Mã chứng nhận kiểm định an toàn runtime
	ModelID                   string `json:"model_id"`                     // ID mô hình (VD: candidate-cnn-v1)
	ModelVersion              string `json:"model_version"`                // Phiên bản mô hình (VD: 1.0.0)
	EvaluationRunID           string `json:"evaluation_run_id"`            // Mã đợt đánh giá chất lượng (Champion/Challenger)
	ExpectedPredictionCount   int64  `json:"expected_prediction_count"`    // Số lượng bản ghi dự đoán kỳ vọng tạo ra
	CreatedAt                 string `json:"created_at"`                   // Thời gian tạo job (ISO 8601)
}

// ============================================================================
// HÀM LIỆT KÊ CÁC TÁC VỤ SUY LUẬN (List Jobs)
// ============================================================================
// ListJobs quét toàn bộ các file JSON manifest trong `manifests/inference-jobs/`,
// lọc theo task / model (nếu có), và kiểm tra xem file kết quả `predictions/.../part-00000.jsonl`
// đã tồn tại trong MinIO chưa để gán trạng thái (completed hoặc planned).
func (s *InferenceService) ListJobs(ctx context.Context, task, model string) ([]entity.InferenceJob, error) {
	// 1. Quét danh sách các đối tượng trong thư mục manifests trên MinIO
	objects, err := s.objects.ListObjects(ctx, "manifests/inference-jobs/")
	if err != nil {
		return nil, err
	}

	jobs := make([]entity.InferenceJob, 0)
	for _, object := range objects {
		// Chỉ xử lý các file có định dạng .json
		if !strings.HasSuffix(object.Key, ".json") {
			continue
		}

		// Đọc nội dung file JSON manifest từ MinIO
		data, err := s.objects.GetObject(ctx, object.Key)
		if err != nil {
			continue
		}

		// Giải mã JSON vào struct DTO
		var manifest inferenceJobManifestDTO
		if json.Unmarshal(data, &manifest) != nil || manifest.JobID == "" {
			continue
		}

		// 2. Chuẩn hóa tên task (candidate_vetting hoặc anomaly_detection)
		normTask := entity.TaskAnomalyDetection
		if strings.EqualFold(strings.TrimSpace(manifest.Task), "candidate") || strings.EqualFold(strings.TrimSpace(manifest.Task), string(entity.TaskCandidateVetting)) {
			normTask = entity.TaskCandidateVetting
		}

		// Lọc theo task nếu người dùng có truyền tham số
		if task != "" && string(normTask) != task {
			continue
		}

		// Lọc theo modelID nếu người dùng có truyền tham số
		if model != "" && manifest.ModelID != model {
			continue
		}

		// 3. Kiểm tra file output trong MinIO để suy luận trạng thái hoàn thành
		outputKey := fmt.Sprintf("predictions/%s/%s/%s/part-00000.jsonl", manifest.Task, manifest.GoldSnapshotID, manifest.JobID)
		status := string(entity.JobStatusPlanned)
		if outputs, listErr := s.objects.ListObjects(ctx, outputKey); listErr == nil && len(outputs) > 0 {
			status = string(entity.JobStatusCompleted)
		}

		// 4. Bổ sung job vào danh sách kết quả
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

	// Sắp xếp các job theo thời gian tạo mới nhất lên đầu
	sort.Slice(jobs, func(i, j int) bool { return jobs[i].CreatedAt > jobs[j].CreatedAt })
	return jobs, nil
}

// ============================================================================
// HÀM KÍCH HOẠT LẠI TÁC VỤ (Retry / Re-dispatch Job)
// ============================================================================
// RetryJob tìm kiếm manifest của job theo jobID, đóng gói thành event NATS JetStream
// và phát hành lại (dispatch) để Rust Inference worker tiếp tục xử lý.
func (s *InferenceService) RetryJob(ctx context.Context, jobID string) (entity.InferenceJobManifest, map[string]any, error) {
	// 1. Quét tìm file manifest khớp với jobID
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

	// 2. Xác định loại event NATS tương ứng với task
	eventType := "aurora.v1.inference.anomaly.requested"
	if manifest.Task == string(entity.TaskCandidateVetting) || manifest.Task == "candidate" {
		eventType = "aurora.v1.inference.candidate.requested"
	}

	// Tính mã băm SHA-256 của file manifest để đảm bảo tính toàn vẹn
	sum := sha256.Sum256(raw)

	// 3. Đóng gói payload event NATS JetStream
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

	// 4. Phát tín hiệu event vào NATS JetStream
	if err := s.dispatcher.Dispatch(ctx, manifest.Task, payload); err != nil {
		return entity.InferenceJobManifest{}, nil, err
	}

	// 5. Chuyển đổi DTO sang Domain Entity để trả về cho API client
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
