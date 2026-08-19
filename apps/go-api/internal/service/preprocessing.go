package service

import (
	"context"
	"encoding/json"
	"fmt"
	"sort"
	"strings"
	"sync"
	"time"

	"go-api/internal/domain/entity"
	"go-api/internal/domain/repo"
	domainService "go-api/internal/domain/service"

	"github.com/google/uuid"
)

// ============================================================================
// HẰNG SỐ & ĐẶC TẢ METRICS TIỀN XỬ LÝ
// ============================================================================
const preprocessingObservationWindow = 5 * time.Minute

type preprocessingMetric struct {
	key   string
	query string
}

// Danh sách các metrics PromQL giám sát Rust Preprocessor
var preprocessingMetrics = []preprocessingMetric{
	{key: "inflight", query: "aurora_preprocessor_inflight_workers"},
	{key: "queue", query: "aurora_preprocessor_queue_depth"},
	{key: "backlog_pending", query: "aurora_preprocessor_backlog_pending"},
	{key: "backlog_ack_pending", query: "aurora_preprocessor_backlog_ack_pending"},
	{key: "throughput", query: "sum(rate(aurora_preprocessor_products_total{status=\"success\"}[2m]))"},
	{key: "errors", query: "sum(rate(aurora_preprocessor_errors_total[2m]))"},
	{key: "last_success", query: "max(aurora_preprocessor_last_success_timestamp_seconds)"},
}

// ============================================================================
// PREPROCESSING SERVICE (Dịch vụ điều phối & giám sát tiền xử lý FITS -> Silver/Gold)
// ============================================================================
// PreprocessingService chịu trách nhiệm:
// 1. Điều khiển bắt đầu (Start) / dừng (Stop) tác vụ Rust Preprocessor qua workflow dispatcher.
// 2. Dựng đồ thị luồng xử lý (DAG Pipeline Hops: Bronze -> Decode -> Transform -> Silver -> Checkpoint -> Lineage -> Event -> ACK).
// 3. Quét bất đồng bộ tiến độ checkpoint từ MinIO (`checkpoints/preprocessing/objects/...`).
type PreprocessingService struct {
	prometheus         repo.PrometheusQuerier          // Truy vấn metrics telemetry từ Prometheus
	dispatcher         repo.WorkflowDispatcher         // Gửi lệnh điều khiển (start/stop) tới Rust Preprocessor
	publisher          repo.EventPublisher             // Phát sự kiện workflow
	objects            repo.ObjectRepository           // Đọc checkpoint từ MinIO S3
	runtimeMu          sync.RWMutex                    // Khóa đồng bộ dữ liệu runtime trong RAM
	runtimeJob         *entity.PreprocessingControlJob // Thông tin job tiền xử lý hiện tại
	progress           entity.PreprocessingProgress    // Tiến độ xử lý (tổng số checkpoint, đã xong, còn lại)
	checkpointDetails  map[string]string               // Chi tiết checkpoint đối tượng FITS mới nhất
	progressAt         time.Time                       // Thời điểm quét checkpoint gần nhất
	progressRefreshing bool                            // Cờ đánh dấu đang quét nền checkpoint
}

// NewPreprocessingService khởi tạo PreprocessingService cơ bản
func NewPreprocessingService(prometheus repo.PrometheusQuerier, dispatchers ...repo.WorkflowDispatcher) domainService.Preprocessing {
	var dispatcher repo.WorkflowDispatcher
	if len(dispatchers) > 0 {
		dispatcher = dispatchers[0]
	}
	return &PreprocessingService{prometheus: prometheus, dispatcher: dispatcher}
}

// NewPreprocessingServiceWithEvents khởi tạo PreprocessingService có EventPublisher
func NewPreprocessingServiceWithEvents(prometheus repo.PrometheusQuerier, dispatcher repo.WorkflowDispatcher, publisher repo.EventPublisher) domainService.Preprocessing {
	return &PreprocessingService{prometheus: prometheus, dispatcher: dispatcher, publisher: publisher}
}

// NewPreprocessingServiceWithEventsAndObjects khởi tạo PreprocessingService đầy đủ chức năng
func NewPreprocessingServiceWithEventsAndObjects(prometheus repo.PrometheusQuerier, dispatcher repo.WorkflowDispatcher, publisher repo.EventPublisher, objects repo.ObjectRepository) domainService.Preprocessing {
	return &PreprocessingService{prometheus: prometheus, dispatcher: dispatcher, publisher: publisher, objects: objects}
}

// ============================================================================
// HÀM KHỞI CHẠY TIỀN XỬ LÝ (Start Preprocessing)
// ============================================================================
// Start gửi lệnh khởi động chế độ tiền xử lý (Stream hoặc Batch) tới Rust Preprocessor.
func (s *PreprocessingService) Start(ctx context.Context, request entity.PreprocessingStartRequest) (*entity.PreprocessingControlJob, error) {
	if s.dispatcher == nil {
		return nil, fmt.Errorf("preprocessing control is unavailable")
	}

	// 1. Kiểm tra xem đã có job nào đang chạy chưa
	s.runtimeMu.RLock()
	if s.runtimeJob != nil && (s.runtimeJob.Status == "running" || s.runtimeJob.Status == "accepted" || s.runtimeJob.Status == "cancelling") {
		activeJobID := s.runtimeJob.JobID
		s.runtimeMu.RUnlock()
		return nil, fmt.Errorf("preprocessing job %s is still active", activeJobID)
	}
	s.runtimeMu.RUnlock()

	request.Mode = strings.ToLower(strings.TrimSpace(request.Mode))
	if request.Mode == "" {
		request.Mode = "stream"
	}
	if request.Mode != "stream" && request.Mode != "batch" {
		return nil, fmt.Errorf("preprocessing mode must be stream or batch")
	}

	// 2. Tạo đối tượng job điều khiển mới
	job := &entity.PreprocessingControlJob{
		JobID:       "preprocess-job-" + uuid.NewString()[:8],
		Status:      "accepted",
		Mode:        request.Mode,
		IngestRunID: strings.TrimSpace(request.IngestRunID),
		Prefix:      request.Prefix,
		StartedAt:   time.Now().UTC(),
		UpdatedAt:   time.Now().UTC(),
	}

	// 3. Đóng gói và phát lệnh qua dispatcher
	command, err := json.Marshal(struct {
		Action      string `json:"action"`
		JobID       string `json:"job_id"`
		Mode        string `json:"mode"`
		IngestRunID string `json:"ingest_run_id,omitempty"`
		Prefix      string `json:"prefix,omitempty"`
	}{
		Action:      "start",
		JobID:       job.JobID,
		Mode:        job.Mode,
		IngestRunID: job.IngestRunID,
		Prefix:      job.Prefix,
	})
	if err != nil {
		return nil, fmt.Errorf("encode preprocessing command: %w", err)
	}

	if err := s.dispatcher.Dispatch(ctx, "preprocessing_start", command); err != nil {
		return nil, fmt.Errorf("dispatch preprocessing command: %w", err)
	}

	job.Status = "running"
	s.runtimeMu.Lock()
	s.runtimeJob = job
	s.progress = entity.PreprocessingProgress{ObservedAt: job.UpdatedAt}
	s.runtimeMu.Unlock()

	if s.publisher != nil {
		payload, _ := json.Marshal(job)
		_ = s.publisher.Publish(ctx, entity.WorkflowEvent{
			Type:       "workflow",
			Workflow:   "preprocessing",
			Status:     job.Status,
			JobID:      job.JobID,
			OccurredAt: job.UpdatedAt,
			Payload:    payload,
		})
	}
	return job, nil
}

// ============================================================================
// HÀM DỪNG TIỀN XỬ LÝ (Stop Preprocessing)
// ============================================================================
// Stop gửi lệnh dừng an toàn tới Rust Preprocessor worker.
func (s *PreprocessingService) Stop(ctx context.Context, jobID string) (*entity.PreprocessingControlJob, error) {
	jobID = strings.TrimSpace(jobID)
	if s.dispatcher == nil || jobID == "" {
		return nil, fmt.Errorf("preprocessing control is unavailable")
	}

	s.runtimeMu.Lock()
	if s.runtimeJob != nil && s.runtimeJob.JobID != jobID {
		s.runtimeMu.Unlock()
		return nil, fmt.Errorf("preprocessing job is not active")
	}

	var job entity.PreprocessingControlJob
	if s.runtimeJob != nil {
		job = *s.runtimeJob
	} else {
		job = entity.PreprocessingControlJob{JobID: jobID, Mode: "stream", StartedAt: time.Now().UTC()}
	}

	if job.Status == "completed" || job.Status == "failed" || job.Status == "canceled" || job.Status == "cancelled" {
		s.runtimeMu.Unlock()
		return &job, nil
	}

	job.Status = "cancelling"
	job.UpdatedAt = time.Now().UTC()
	s.runtimeJob = &job
	s.runtimeMu.Unlock()

	// Gửi lệnh stop qua dispatcher
	command, err := json.Marshal(struct {
		Action string `json:"action"`
		JobID  string `json:"job_id"`
	}{Action: "stop", JobID: jobID})
	if err != nil {
		return nil, fmt.Errorf("encode preprocessing stop command: %w", err)
	}

	if err := s.dispatcher.Dispatch(ctx, "preprocessing_stop", command); err != nil {
		s.runtimeMu.Lock()
		if s.runtimeJob != nil && s.runtimeJob.JobID == job.JobID {
			s.runtimeJob.Status = "running"
			s.runtimeJob.UpdatedAt = time.Now().UTC()
		}
		s.runtimeMu.Unlock()
		return nil, fmt.Errorf("dispatch preprocessing stop command: %w", err)
	}

	if s.publisher != nil {
		payload, _ := json.Marshal(&job)
		_ = s.publisher.Publish(ctx, entity.WorkflowEvent{
			Type:       "workflow",
			Workflow:   "preprocessing",
			Status:     job.Status,
			JobID:      job.JobID,
			OccurredAt: job.UpdatedAt,
			Payload:    payload,
		})
	}
	return &job, nil
}

// ============================================================================
// HÀM TRUY VẤN ĐỒ THỊ TIẾN TRÌNH (Query Preprocessing Graph & Pipeline DAG)
// ============================================================================
// Query trả về cấu trúc Pipeline DAG hoàn chỉnh (8 bước hops) cùng trạng thái và metrics
// để Dashboard hiển thị trực quan sơ đồ luồng dữ liệu thời gian thực.
func (s *PreprocessingService) Query(ctx context.Context) (*entity.PreprocessingGraph, error) {
	s.runtimeMu.RLock()
	runtimeJob := s.runtimeJob
	if runtimeJob != nil {
		copy := *runtimeJob
		runtimeJob = &copy
	}
	runtimeProgress := s.progress
	checkpointDetails := make(map[string]string, len(s.checkpointDetails))
	for key, value := range s.checkpointDetails {
		checkpointDetails[key] = value
	}
	progressAt := s.progressAt
	s.runtimeMu.RUnlock()

	// 1. Phục hồi trạng thái từ MinIO checkpoint nếu API vừa khởi động lại
	end := time.Now().UTC()
	if s.objects != nil {
		if data, err := s.objects.GetObject(ctx, "checkpoints/preprocessing/current.json"); err == nil && len(data) > 0 {
			var pointer struct {
				ActiveRunID string `json:"active_run_id"`
			}
			if json.Unmarshal(data, &pointer) == nil && pointer.ActiveRunID != "" {
				if runData, runErr := s.objects.GetObject(ctx, "checkpoints/preprocessing/runs/"+pointer.ActiveRunID+".json"); runErr == nil {
					var checkpoint struct {
						RunID       string    `json:"run_id"`
						Status      string    `json:"status"`
						Mode        string    `json:"mode"`
						IngestRunID string    `json:"ingest_run_id"`
						Prefix      string    `json:"prefix"`
						StartedAt   time.Time `json:"started_at"`
						UpdatedAt   time.Time `json:"updated_at"`
					}
					if json.Unmarshal(runData, &checkpoint) == nil && checkpoint.RunID != "" && (runtimeJob == nil || runtimeJob.JobID == checkpoint.RunID) {
						durableStatus := strings.ToLower(checkpoint.Status)
						if runtimeJob != nil && runtimeJob.JobID == checkpoint.RunID && runtimeJob.Status == "cancelling" && durableStatus == "running" {
							// Giữ nguyên trạng thái cancelling trong RAM trong khi worker đang drain
						} else {
							runtimeJob = &entity.PreprocessingControlJob{
								JobID:       checkpoint.RunID,
								Status:      durableStatus,
								Mode:        strings.ToLower(checkpoint.Mode),
								IngestRunID: checkpoint.IngestRunID,
								Prefix:      checkpoint.Prefix,
								StartedAt:   checkpoint.StartedAt,
								UpdatedAt:   checkpoint.UpdatedAt,
							}
						}
					}
				}
			}
		}

		// Kích hoạt quét nền cập nhật tiến độ checkpoint nếu dữ liệu cũ hơn 10 giây
		s.runtimeMu.Lock()
		stale := progressAt.IsZero() || end.Sub(progressAt) >= 10*time.Second
		if stale && !s.progressRefreshing {
			s.progressRefreshing = true
			go s.refreshCheckpointProgress(context.Background())
		}
		s.runtimeMu.Unlock()
	}

	// 2. Truy vấn song song metrics từ Prometheus
	observations := make(map[string][]entity.MonitoringPoint, len(preprocessingMetrics))
	var mu sync.Mutex
	var wg sync.WaitGroup
	var queryErrors int

	if s.prometheus != nil {
		start := end.Add(-preprocessingObservationWindow)
		for _, metric := range preprocessingMetrics {
			metric := metric
			wg.Add(1)
			go func() {
				defer wg.Done()
				points, err := s.prometheus.QueryRange(ctx, metric.query, start, end, 30*time.Second)
				mu.Lock()
				defer mu.Unlock()
				if err != nil {
					queryErrors++
					return
				}
				observations[metric.key] = points
			}()
		}
	}
	wg.Wait()

	if (s.prometheus == nil || queryErrors == len(preprocessingMetrics)) && runtimeJob == nil {
		return nil, fmt.Errorf("Prometheus preprocessing observation is unavailable")
	}

	// 3. Trích xuất giá trị quan sát gần nhất
	values := make(map[string]float64, len(observations))
	observed := false
	for key, points := range observations {
		if len(points) == 0 {
			continue
		}
		observed = true
		values[key] = lastPoint(points).Value
	}

	runtimeProgress.BacklogPending = int(values["backlog_pending"])
	runtimeProgress.BacklogAckPending = int(values["backlog_ack_pending"])
	runtimeProgress.ItemsToProcess = runtimeProgress.BacklogPending + runtimeProgress.BacklogAckPending
	if runtimeProgress.ItemsToProcess == 0 && runtimeProgress.CheckpointPending > 0 {
		runtimeProgress.ItemsToProcess = runtimeProgress.CheckpointPending
	}
	runtimeProgress.ObservedAt = end

	// 4. Suy luận trạng thái tổng thể (running, completed, failed, retry)
	status := preprocessingStatus(values, observed, end)
	if runtimeJob != nil && strings.EqualFold(runtimeJob.Status, "running") {
		if runtimeJob.Mode == "batch" && runtimeProgress.ItemsToProcess == 0 && values["inflight"] == 0 {
			runtimeJob.Status = "completed"
			runtimeJob.UpdatedAt = end
		} else if status == "failed" {
			runtimeJob.Status = "failed"
			runtimeJob.UpdatedAt = end
		} else if status == "not_observed" {
			status = "running"
		}
	}
	if runtimeJob != nil && (runtimeJob.Status == "completed" || runtimeJob.Status == "failed") {
		status = runtimeJob.Status
	}
	if runtimeJob != nil && (runtimeJob.Status == "cancelling" || runtimeJob.Status == "canceled" || runtimeJob.Status == "cancelled") {
		status = runtimeJob.Status
	}

	// 5. Dựng 8 bước Pipeline DAG Hops và các cạnh kết nối (Edges)
	hops := preprocessingHops(status, values, end, checkpointDetails)
	edges := make([]entity.PreprocessingEdge, 0, len(hops)-1)
	for i := 0; i < len(hops)-1; i++ {
		edges = append(edges, entity.PreprocessingEdge{
			ID:         fmt.Sprintf("edge-%d", i),
			Source:     hops[i].ID,
			Target:     hops[i+1].ID,
			Status:     status,
			ObservedAt: end,
		})
	}

	s.runtimeMu.Lock()
	s.progress = runtimeProgress
	if runtimeJob != nil {
		s.runtimeJob = runtimeJob
	}
	s.runtimeMu.Unlock()

	return &entity.PreprocessingGraph{
		Source:           "prometheus",
		ObservationScope: "preprocessor_service",
		Status:           status,
		ObservedAt:       end,
		Run:              runtimeJob,
		Progress:         runtimeProgress,
		Hops:             hops,
		Edges:            edges,
	}, nil
}

// refreshCheckpointProgress quét danh sách checkpoint từng file FITS trong MinIO với semaphore giới hạn 32 luồng
func (s *PreprocessingService) refreshCheckpointProgress(ctx context.Context) {
	objects, err := s.objects.ListObjects(ctx, "checkpoints/preprocessing/objects/")
	if err != nil {
		s.runtimeMu.Lock()
		s.progressRefreshing = false
		s.runtimeMu.Unlock()
		return
	}

	completed := 0
	var countMu sync.Mutex
	var countWG sync.WaitGroup
	var latestAt time.Time
	var latestDetails map[string]string
	semaphore := make(chan struct{}, 32)

	for _, object := range objects {
		object := object
		countWG.Add(1)
		go func() {
			defer countWG.Done()
			select {
			case semaphore <- struct{}{}:
			case <-ctx.Done():
				return
			}
			defer func() { <-semaphore }()

			data, getErr := s.objects.GetObject(ctx, object.Key)
			if getErr != nil || len(data) == 0 {
				return
			}

			var checkpoint struct {
				CheckpointID        string  `json:"checkpoint_id"`
				SourceProductID     string  `json:"source_product_id"`
				SampleID            *string `json:"sample_id"`
				ProductKind         string  `json:"product_kind"`
				BronzeBucket        string  `json:"bronze_bucket"`
				BronzeObjectKey     string  `json:"bronze_object_key"`
				BronzeSHA256        string  `json:"bronze_sha256"`
				ProcessorVersion    string  `json:"processor_version"`
				SilverBucket        *string `json:"silver_bucket"`
				SilverObjectKey     *string `json:"silver_object_key"`
				SilverSHA256        *string `json:"silver_sha256"`
				SilverSizeBytes     *uint64 `json:"silver_size_bytes"`
				SilverSchemaVersion *string `json:"silver_schema_version"`
				State               string  `json:"state"`
				Attempts            uint32  `json:"attempts"`
				LastError           *string `json:"last_error"`
				Terminal            bool    `json:"terminal"`
				CreatedAt           string  `json:"created_at"`
				UpdatedAt           string  `json:"updated_at"`
			}

			if json.Unmarshal(data, &checkpoint) == nil {
				updatedAt, _ := time.Parse(time.RFC3339Nano, checkpoint.UpdatedAt)
				if updatedAt.IsZero() {
					updatedAt = object.LastModified
				}
				countMu.Lock()
				if strings.EqualFold(checkpoint.State, "COMPLETED") {
					completed++
				}
				if latestDetails == nil || updatedAt.After(latestAt) {
					latestAt = updatedAt
					latestDetails = map[string]string{
						"checkpoint_id":         checkpoint.CheckpointID,
						"checkpoint_key":        object.Key,
						"source_product_id":     checkpoint.SourceProductID,
						"sample_id":             optionalString(checkpoint.SampleID),
						"product_kind":          checkpoint.ProductKind,
						"bronze_bucket":         checkpoint.BronzeBucket,
						"bronze_object_key":     checkpoint.BronzeObjectKey,
						"bronze_sha256":         checkpoint.BronzeSHA256,
						"processor_version":     checkpoint.ProcessorVersion,
						"silver_bucket":         optionalString(checkpoint.SilverBucket),
						"silver_object_key":     optionalString(checkpoint.SilverObjectKey),
						"silver_sha256":         optionalString(checkpoint.SilverSHA256),
						"silver_size_bytes":     optionalUint64(checkpoint.SilverSizeBytes),
						"silver_schema_version": optionalString(checkpoint.SilverSchemaVersion),
						"state":                 checkpoint.State,
						"attempts":              fmt.Sprintf("%d", checkpoint.Attempts),
						"last_error":            optionalString(checkpoint.LastError),
						"terminal":              fmt.Sprintf("%t", checkpoint.Terminal),
						"created_at":            checkpoint.CreatedAt,
						"updated_at":            checkpoint.UpdatedAt,
					}
				}
				countMu.Unlock()
			}
		}()
	}
	countWG.Wait()

	s.runtimeMu.Lock()
	s.progress.CheckpointTotal = len(objects)
	s.progress.CheckpointCompleted = completed
	s.progress.CheckpointPending = len(objects) - completed
	s.checkpointDetails = latestDetails
	s.progressAt = time.Now().UTC()
	s.progressRefreshing = false
	s.runtimeMu.Unlock()
}

func lastPoint(points []entity.MonitoringPoint) entity.MonitoringPoint {
	sort.Slice(points, func(i, j int) bool { return points[i].Timestamp < points[j].Timestamp })
	return points[len(points)-1]
}

// preprocessingStatus tính toán trạng thái hoạt động dựa trên metrics
func preprocessingStatus(values map[string]float64, observed bool, now time.Time) string {
	if !observed {
		return "not_observed"
	}
	active := values["inflight"] > 0 || values["queue"] > 0 || values["throughput"] > 0
	if values["errors"] > 0 {
		if active {
			return "retry"
		}
		return "failed"
	}
	if active {
		return "running"
	}
	if values["last_success"] > 0 {
		age := now.Sub(time.Unix(int64(values["last_success"]), 0))
		if age >= 0 && age <= preprocessingObservationWindow {
			return "completed"
		}
	}
	return "not_observed"
}

// ============================================================================
// ĐỊNH NGHĨA 8 BƯỚC HOPS TRONG PIPELINE DAG
// ============================================================================
// 1. bronze: Lưu FITS thô vào MinIO Bronze
// 2. decode: Đọc FITS, giải mã cấu trúc trắc quang
// 3. transform: Detrending, lọc outlier, chuẩn hóa khoa học
// 4. silver: Ghi Parquet vào MinIO Silver
// 5. checkpoint: Lưu checkpoint an toàn chống crash
// 6. lineage: Ghi nhận vết dữ liệu nguồn -> đích
// 7. event: Phát sự kiện Silver ready cho ML worker
// 8. ack: Xác nhận hoàn tất tin nhắn Bronze trên NATS
func preprocessingHops(status string, values map[string]float64, observedAt time.Time, details map[string]string) []entity.PreprocessingHop {
	metrics := make(map[string]float64, len(values))
	for key, value := range values {
		metrics[key] = value
	}
	hops := []entity.PreprocessingHop{
		{ID: "bronze", Label: "Bronze FITS", Description: "Immutable source artifact", Contract: "bronze/tess/<product>/sector=<sector>/tic=<tic>/", Input: "NASA FITS", Output: "Verified Bronze object"},
		{ID: "decode", Label: "Decode & validate", Description: "Read FITS and validate product shape", Contract: "product-kind validation", Input: "Bronze FITS", Output: "Validated samples"},
		{ID: "transform", Label: "Scientific transform", Description: "Clean, normalize and derive masks", Contract: "lc-preprocess-v1 / tpf-preprocess-v1 / ffi-preprocess-v1", Input: "Validated samples", Output: "Silver rows"},
		{ID: "silver", Label: "Silver Parquet", Description: "Write, upload and verify Silver", Contract: "silver/tess/<product>/processor=<version>/", Input: "Silver rows", Output: "Verified Parquet"},
		{ID: "checkpoint", Label: "Checkpoint", Description: "Persist crash-safe processing state", Contract: "checkpoints/preprocessing/objects/<id>.json", Input: "Silver verification", Output: "Completed checkpoint"},
		{ID: "lineage", Label: "Lineage commit", Description: "Commit source → Bronze → Silver identity", Contract: "lineage/v1/<lineage-id>.json", Input: "Checkpoint + checksums", Output: "Committed lineage"},
		{ID: "event", Label: "Silver event", Description: "Publish downstream-ready event", Contract: "aurora.v1.silver.<product>.ready", Input: "Committed lineage", Output: "Published event"},
		{ID: "ack", Label: "Bronze ACK", Description: "Acknowledge only after durable output", Contract: "NATS durable consumer ACK", Input: "Published event", Output: "Bronze message ACKed"},
	}
	for i := range hops {
		hops[i].Status, hops[i].ObservedAt, hops[i].Metrics = status, observedAt, metrics
		hops[i].Details = hopDetails(hops[i].ID, details)
	}
	return hops
}

// hopDetails lọc các trường chi tiết checkpoint phù hợp cho từng bước hop trong DAG
func hopDetails(id string, checkpoint map[string]string) map[string]string {
	details := make(map[string]string)
	for key, value := range checkpoint {
		if strings.TrimSpace(value) == "" {
			continue
		}
		details[key] = value
	}
	if len(details) == 0 {
		return details
	}
	keysByHop := map[string][]string{
		"bronze":     {"source_product_id", "product_kind", "bronze_bucket", "bronze_object_key", "bronze_sha256"},
		"decode":     {"product_kind", "bronze_object_key", "attempts"},
		"transform":  {"product_kind", "processor_version", "attempts"},
		"silver":     {"silver_bucket", "silver_object_key", "silver_sha256", "silver_size_bytes", "silver_schema_version"},
		"checkpoint": {"checkpoint_id", "checkpoint_key", "state", "attempts", "terminal", "updated_at", "last_error"},
		"lineage":    {"source_product_id", "processor_version", "checkpoint_id"},
		"event":      {"silver_object_key", "silver_schema_version"},
		"ack":        {"source_product_id", "state"},
	}
	filtered := make(map[string]string)
	for _, key := range keysByHop[id] {
		if value, ok := details[key]; ok {
			filtered[key] = value
		}
	}
	return filtered
}

func optionalString(value *string) string {
	if value == nil {
		return ""
	}
	return *value
}

func optionalUint64(value *uint64) string {
	if value == nil {
		return ""
	}
	return fmt.Sprintf("%d", *value)
}
