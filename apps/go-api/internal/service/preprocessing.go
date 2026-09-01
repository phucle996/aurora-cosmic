package service

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"go-api/internal/domain/entity"
	"go-api/internal/domain/repo"
	domainService "go-api/internal/domain/service"

	"github.com/google/uuid"
	"github.com/parquet-go/parquet-go"
)

// ============================================================================
// HẰNG SỐ & ĐẶC TẢ METRICS TIỀN XỬ LÝ
// ============================================================================
const (
	preprocessingObservationWindow = 5 * time.Minute
	preprocessingInventoryRefresh  = 60 * time.Second
	preprocessingRuntimeWindow     = 60 * time.Second
	preprocessingTraceLimit        = 200
	maxScatterBackfillObjectBytes  = 64 << 20
	maxLCScatterPoints             = 800
	maxTPFTransformPoints          = 800
	maxMaterializationPoints       = 1_200
	maxCheckpointPoints            = 1_200
)

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
	{key: "lc_input_rate", query: "sum(rate(aurora_preprocessor_science_samples_total{kind=\"lightcurve\",outcome=\"input\"}[2m]))"},
	{key: "lc_output_rate", query: "sum(rate(aurora_preprocessor_science_samples_total{kind=\"lightcurve\",outcome=\"output\"}[2m]))"},
	{key: "lc_quality_removed_rate", query: "sum(rate(aurora_preprocessor_science_samples_total{kind=\"lightcurve\",outcome=\"quality_removed\"}[2m]))"},
	{key: "lc_invalid_removed_rate", query: "sum(rate(aurora_preprocessor_science_samples_total{kind=\"lightcurve\",outcome=\"invalid_removed\"}[2m]))"},
	{key: "lc_nonfinite_removed_rate", query: "sum(rate(aurora_preprocessor_science_samples_total{kind=\"lightcurve\",outcome=\"nonfinite_removed\"}[2m]))"},
	{key: "lc_nonpositive_removed_rate", query: "sum(rate(aurora_preprocessor_science_samples_total{kind=\"lightcurve\",outcome=\"nonpositive_time_removed\"}[2m]))"},
	{key: "lc_outlier_removed_rate", query: "sum(rate(aurora_preprocessor_science_samples_total{kind=\"lightcurve\",outcome=\"outlier_removed\"}[2m]))"},
	{key: "lc_sigma_clip_3_4_rate", query: "sum(rate(aurora_preprocessor_science_samples_total{kind=\"lightcurve\",outcome=\"sigma_clip_3_4_removed\"}[2m]))"},
	{key: "lc_sigma_clip_4_5_rate", query: "sum(rate(aurora_preprocessor_science_samples_total{kind=\"lightcurve\",outcome=\"sigma_clip_4_5_removed\"}[2m]))"},
	{key: "lc_sigma_clip_ge_5_rate", query: "sum(rate(aurora_preprocessor_science_samples_total{kind=\"lightcurve\",outcome=\"sigma_clip_ge_5_removed\"}[2m]))"},
	{key: "tpf_input_rate", query: "sum(rate(aurora_preprocessor_science_samples_total{kind=\"target_pixel\",outcome=\"input\"}[2m]))"},
	{key: "tpf_output_rate", query: "sum(rate(aurora_preprocessor_science_samples_total{kind=\"target_pixel\",outcome=\"output\"}[2m]))"},
	{key: "tpf_quality_removed_rate", query: "sum(rate(aurora_preprocessor_science_samples_total{kind=\"target_pixel\",outcome=\"quality_removed\"}[2m]))"},
	{key: "tpf_invalid_removed_rate", query: "sum(rate(aurora_preprocessor_science_samples_total{kind=\"target_pixel\",outcome=\"invalid_removed\"}[2m]))"},
	{key: "tpf_nonfinite_removed_rate", query: "sum(rate(aurora_preprocessor_science_samples_total{kind=\"target_pixel\",outcome=\"nonfinite_removed\"}[2m]))"},
	{key: "tpf_nonpositive_removed_rate", query: "sum(rate(aurora_preprocessor_science_samples_total{kind=\"target_pixel\",outcome=\"nonpositive_time_removed\"}[2m]))"},
	{key: "lc_input_total", query: "sum(aurora_preprocessor_science_samples_total{kind=\"lightcurve\",outcome=\"input\"})"},
	{key: "lc_quality_removed_total", query: "sum(aurora_preprocessor_science_samples_total{kind=\"lightcurve\",outcome=\"quality_removed\"})"},
	{key: "lc_nonfinite_removed_total", query: "sum(aurora_preprocessor_science_samples_total{kind=\"lightcurve\",outcome=\"nonfinite_removed\"})"},
	{key: "lc_nonpositive_removed_total", query: "sum(aurora_preprocessor_science_samples_total{kind=\"lightcurve\",outcome=\"nonpositive_time_removed\"})"},
	{key: "lc_sigma_clip_3_4_total", query: "sum(aurora_preprocessor_science_samples_total{kind=\"lightcurve\",outcome=\"sigma_clip_3_4_removed\"})"},
	{key: "lc_sigma_clip_4_5_total", query: "sum(aurora_preprocessor_science_samples_total{kind=\"lightcurve\",outcome=\"sigma_clip_4_5_removed\"})"},
	{key: "lc_sigma_clip_ge_5_total", query: "sum(aurora_preprocessor_science_samples_total{kind=\"lightcurve\",outcome=\"sigma_clip_ge_5_removed\"})"},
	{key: "tpf_input_total", query: "sum(aurora_preprocessor_science_samples_total{kind=\"target_pixel\",outcome=\"input\"})"},
	{key: "tpf_quality_removed_total", query: "sum(aurora_preprocessor_science_samples_total{kind=\"target_pixel\",outcome=\"quality_removed\"})"},
	{key: "tpf_nonfinite_removed_total", query: "sum(aurora_preprocessor_science_samples_total{kind=\"target_pixel\",outcome=\"nonfinite_removed\"})"},
	{key: "tpf_nonpositive_removed_total", query: "sum(aurora_preprocessor_science_samples_total{kind=\"target_pixel\",outcome=\"nonpositive_time_removed\"})"},
	{key: "tpf_finite_pixel_fraction", query: "max(aurora_preprocessor_finite_pixel_fraction{kind=\"target_pixel\"})"},
	{key: "lc_scatter_before_p50", query: "histogram_quantile(0.50, sum by (le) (rate(aurora_preprocessor_lc_normalized_scatter_ppm_bucket{phase=\"before_clip\"}[15m])))"},
	{key: "lc_scatter_before_p95", query: "histogram_quantile(0.95, sum by (le) (rate(aurora_preprocessor_lc_normalized_scatter_ppm_bucket{phase=\"before_clip\"}[15m])))"},
	{key: "lc_scatter_after_p50", query: "histogram_quantile(0.50, sum by (le) (rate(aurora_preprocessor_lc_normalized_scatter_ppm_bucket{phase=\"after_clip\"}[15m])))"},
	{key: "lc_scatter_after_p95", query: "histogram_quantile(0.95, sum by (le) (rate(aurora_preprocessor_lc_normalized_scatter_ppm_bucket{phase=\"after_clip\"}[15m])))"},
	{key: "lc_sigma_clip_fraction_p95", query: "histogram_quantile(0.95, sum by (le) (rate(aurora_preprocessor_lc_sigma_clip_fraction_bucket[15m])))"},
	{key: "tpf_finite_pixel_fraction_p05", query: "histogram_quantile(0.05, sum by (le) (rate(aurora_preprocessor_tpf_finite_pixel_fraction_bucket[15m])))"},
	{key: "tpf_pixel_input_rate", query: "sum(rate(aurora_preprocessor_tpf_normalization_pixels_total{outcome=\"input\"}[2m]))"},
	{key: "tpf_pixel_retained_rate", query: "sum(rate(aurora_preprocessor_tpf_normalization_pixels_total{outcome=\"retained\"}[2m]))"},
	{key: "tpf_pixel_nonfinite_rate", query: "sum(rate(aurora_preprocessor_tpf_normalization_pixels_total{outcome=\"nonfinite_input\"}[2m]))"},
	{key: "tpf_pixel_invalid_reference_rate", query: "sum(rate(aurora_preprocessor_tpf_normalization_pixels_total{outcome=\"invalid_reference\"}[2m]))"},
	{key: "tpf_scatter_p50", query: "histogram_quantile(0.50, sum by (le) (rate(aurora_preprocessor_tpf_pixel_scatter_mad_ppm_bucket{quantile=\"p50\"}[15m])))"},
	{key: "tpf_scatter_p95", query: "histogram_quantile(0.95, sum by (le) (rate(aurora_preprocessor_tpf_pixel_scatter_mad_ppm_bucket{quantile=\"p95\"}[15m])))"},
	{key: "tpf_reference_drift_p95", query: "histogram_quantile(0.95, sum by (le) (rate(aurora_preprocessor_tpf_reference_drift_ppm_bucket{quantile=\"p95\"}[15m])))"},
	{key: "tpf_boundary_jump_p95", query: "histogram_quantile(0.95, sum by (le) (rate(aurora_preprocessor_tpf_chunk_boundary_jump_ppm_bucket{quantile=\"p95\"}[15m])))"},
	{key: "bronze_bytes_rate", query: "sum(rate(aurora_preprocessor_bytes_total{stage=\"bronze\"}[2m]))"},
	{key: "silver_bytes_rate", query: "sum(rate(aurora_preprocessor_bytes_total{stage=\"silver\"}[2m]))"},
	{key: "lc_duration_p95", query: "histogram_quantile(0.95, sum by (le) (rate(aurora_preprocessor_processing_duration_seconds_bucket{kind=\"lightcurve\"}[5m])))"},
	{key: "tpf_duration_p95", query: "histogram_quantile(0.95, sum by (le) (rate(aurora_preprocessor_processing_duration_seconds_bucket{kind=\"target_pixel\"}[5m])))"},
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
	eventObserver      repo.SilverEventStreamObserver  // Đọc metadata AURORA_SILVER mà không consume event
	bronzeObserver     repo.BronzeConsumerObserver     // Đọc trạng thái ACK của durable Bronze consumer
	runtimeMu          sync.RWMutex                    // Khóa đồng bộ dữ liệu runtime trong RAM
	runtimeJob         *entity.PreprocessingControlJob // Thông tin job tiền xử lý hiện tại
	progress           entity.PreprocessingProgress    // Tiến độ xử lý (tổng số checkpoint, đã xong, còn lại)
	checkpointDetails  map[string]string               // Chi tiết checkpoint đối tượng FITS mới nhất
	progressAt         time.Time                       // Thời điểm quét checkpoint gần nhất
	progressRefreshing bool                            // Cờ đánh dấu đang quét nền checkpoint
	runtime            entity.PreprocessingRuntimeSnapshot
	completionTimes    []time.Time
	scienceCacheMu     sync.Mutex
	lcScatterCache     map[string]scatterCacheEntry
}

type scatterCacheEntry struct {
	value    float64
	observed bool
}

type silverCheckpointEvidence struct {
	ProductKind   string
	SHA256        string
	SizeBytes     int64
	SchemaVersion string
	Attempts      int64
}

// NewPreprocessingService khởi tạo PreprocessingService cơ bản
func NewPreprocessingService(prometheus repo.PrometheusQuerier, dispatchers ...repo.WorkflowDispatcher) domainService.Preprocessing {
	var dispatcher repo.WorkflowDispatcher
	if len(dispatchers) > 0 {
		dispatcher = dispatchers[0]
	}
	return &PreprocessingService{prometheus: prometheus, dispatcher: dispatcher, eventObserver: silverEventObserver(dispatcher), bronzeObserver: bronzeConsumerObserver(dispatcher)}
}

// NewPreprocessingServiceWithEvents khởi tạo PreprocessingService có EventPublisher
func NewPreprocessingServiceWithEvents(prometheus repo.PrometheusQuerier, dispatcher repo.WorkflowDispatcher, publisher repo.EventPublisher) domainService.Preprocessing {
	return &PreprocessingService{prometheus: prometheus, dispatcher: dispatcher, publisher: publisher, eventObserver: silverEventObserver(dispatcher), bronzeObserver: bronzeConsumerObserver(dispatcher)}
}

// NewPreprocessingServiceWithEventsAndObjects khởi tạo PreprocessingService đầy đủ chức năng
func NewPreprocessingServiceWithEventsAndObjects(prometheus repo.PrometheusQuerier, dispatcher repo.WorkflowDispatcher, publisher repo.EventPublisher, objects repo.ObjectRepository) domainService.Preprocessing {
	return &PreprocessingService{prometheus: prometheus, dispatcher: dispatcher, publisher: publisher, objects: objects, eventObserver: silverEventObserver(dispatcher), bronzeObserver: bronzeConsumerObserver(dispatcher)}
}

func silverEventObserver(dispatcher repo.WorkflowDispatcher) repo.SilverEventStreamObserver {
	observer, _ := dispatcher.(repo.SilverEventStreamObserver)
	return observer
}

func bronzeConsumerObserver(dispatcher repo.WorkflowDispatcher) repo.BronzeConsumerObserver {
	observer, _ := dispatcher.(repo.BronzeConsumerObserver)
	return observer
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
	if strings.TrimSpace(request.IngestRunID) != "" || strings.TrimSpace(request.Prefix) != "" {
		return nil, fmt.Errorf("preprocessing scoping by ingest_run_id or prefix is not supported by the Bronze event contract")
	}

	// 2. Tạo đối tượng job điều khiển mới
	job := &entity.PreprocessingControlJob{
		JobID:       "preprocess-job-" + uuid.NewString()[:8],
		Status:      "accepted",
		Mode:        request.Mode,
		WorkerCount: request.WorkerCount,
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
		WorkerCount int    `json:"worker_count"`
	}{
		Action:      "start",
		JobID:       job.JobID,
		Mode:        job.Mode,
		IngestRunID: job.IngestRunID,
		Prefix:      job.Prefix,
		WorkerCount: job.WorkerCount,
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
	s.runtime = entity.PreprocessingRuntimeSnapshot{DesiredWorkers: job.WorkerCount, ObservedAt: job.UpdatedAt}
	s.completionTimes = nil
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

// ObserveRuntime applies a tiny Core NATS lifecycle event. State is kept in
// memory and bounded: dashboard traffic never causes a MinIO scan or log dump.
func (s *PreprocessingService) ObserveRuntime(event entity.PreprocessingRuntimeEvent) {
	if event.OccurredAt.IsZero() {
		event.OccurredAt = time.Now().UTC()
	}
	// Never expose an internal fallback identifier as a worker. It originated
	// from an older pool race and must not inflate operator-facing totals.
	if event.WorkerID == "preprocess-unassigned" {
		return
	}
	s.runtimeMu.Lock()
	defer s.runtimeMu.Unlock()
	if s.runtime.ObservedAt.IsZero() && s.runtimeJob != nil {
		s.runtime.DesiredWorkers = s.runtimeJob.WorkerCount
	}
	workers := make(map[string]entity.PreprocessingWorkerRuntime, len(s.runtime.Workers)+1)
	for _, worker := range s.runtime.Workers {
		if worker.WorkerID == "preprocess-unassigned" {
			continue
		}
		workers[worker.WorkerID] = worker
	}
	worker := workers[event.WorkerID]
	if event.WorkerID != "" {
		worker.WorkerID = event.WorkerID
	}
	worker.UpdatedAt = event.OccurredAt
	switch event.Event {
	case "worker_spawned":
		worker.State = "idle"
	case "file_started", "stage_changed":
		worker.State, worker.ProductKind, worker.ObjectKey, worker.Stage = "processing", event.ProductKind, event.ObjectKey, event.Stage
		if event.Event == "file_started" {
			worker.StartedAt = event.OccurredAt
		}
	case "file_completed":
		worker.State, worker.LastDurationMS, worker.Completed = "idle", event.ElapsedMS, worker.Completed+1
		worker.ObjectKey, worker.Stage = "", "completed"
		s.runtime.Completed++
		s.completionTimes = append(s.completionTimes, event.OccurredAt)
	case "file_failed":
		worker.State, worker.LastDurationMS, worker.Failed = "failed", event.ElapsedMS, worker.Failed+1
		worker.Stage = "failed"
		s.runtime.Failed++
	case "worker_stopped", "worker_killed":
		worker.State, worker.ObjectKey, worker.Stage = "stopped", "", ""
	case "worker_idle":
		worker.State, worker.ObjectKey = "idle", ""
	}
	if event.WorkerID != "" {
		workers[event.WorkerID] = worker
	}
	s.runtime.Workers = s.runtime.Workers[:0]
	for _, item := range workers {
		s.runtime.Workers = append(s.runtime.Workers, item)
	}
	sort.Slice(s.runtime.Workers, func(i, j int) bool { return s.runtime.Workers[i].WorkerID < s.runtime.Workers[j].WorkerID })
	s.runtime.ActualWorkers, s.runtime.Processing = 0, 0
	for _, item := range s.runtime.Workers {
		if item.State != "stopped" {
			s.runtime.ActualWorkers++
		}
		if item.State == "processing" {
			s.runtime.Processing++
		}
	}
	cutoff := event.OccurredAt.Add(-preprocessingRuntimeWindow)
	kept := s.completionTimes[:0]
	for _, completedAt := range s.completionTimes {
		if completedAt.After(cutoff) {
			kept = append(kept, completedAt)
		}
	}
	s.completionTimes = kept
	s.runtime.Throughput = float64(len(kept)) / preprocessingRuntimeWindow.Seconds()
	s.runtime.Trace = append(s.runtime.Trace, event)
	if len(s.runtime.Trace) > preprocessingTraceLimit {
		s.runtime.Trace = s.runtime.Trace[len(s.runtime.Trace)-preprocessingTraceLimit:]
	}
	s.runtime.ObservedAt = event.OccurredAt
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
	runtime := s.runtime
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
						WorkerCount int       `json:"worker_count"`
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
								WorkerCount: checkpoint.WorkerCount,
								StartedAt:   checkpoint.StartedAt,
								UpdatedAt:   checkpoint.UpdatedAt,
							}
						}
					}
				}
			}
		}

		// Inventory includes every processable Bronze FITS and is intentionally
		// refreshed at a bounded cadence: a large MinIO backlog must not trigger a
		// full object listing on every dashboard poll.
		s.runtimeMu.Lock()
		stale := progressAt.IsZero() || end.Sub(progressAt) >= preprocessingInventoryRefresh
		if stale && !s.progressRefreshing {
			s.progressRefreshing = true
			go s.refreshCheckpointProgress(context.Background())
		}
		s.runtimeMu.Unlock()
	}
	if runtime.DesiredWorkers == 0 && runtimeJob != nil {
		runtime.DesiredWorkers = runtimeJob.WorkerCount
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
				finitePoints := make([]entity.MonitoringPoint, 0, len(points))
				for _, point := range points {
					if math.IsNaN(point.Value) || math.IsInf(point.Value, 0) {
						continue
					}
					finitePoints = append(finitePoints, point)
				}
				if len(finitePoints) > 0 {
					observations[metric.key] = finitePoints
				}
			}()
		}
	}
	wg.Wait()

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
	if !runtime.ObservedAt.IsZero() {
		values["throughput"] = runtime.Throughput
		values["inflight"] = float64(runtime.Processing)
		observed = true
	}

	runtimeProgress.BacklogPending = int(values["backlog_pending"])
	runtimeProgress.BacklogAckPending = int(values["backlog_ack_pending"])
	runtimeProgress.ItemsToProcess = runtimeProgress.BronzePending
	if runtimeProgress.ItemsToProcess == 0 {
		runtimeProgress.ItemsToProcess = runtimeProgress.BacklogPending + runtimeProgress.BacklogAckPending
	}
	if runtimeProgress.ItemsToProcess == 0 && runtimeProgress.CheckpointPending > 0 {
		runtimeProgress.ItemsToProcess = runtimeProgress.CheckpointPending
	}
	runtimeProgress.ObservedAt = end

	// 4. Suy luận trạng thái tổng thể (running, completed, failed, retry)
	status := preprocessingStatus(values, observed, end)
	var stateChangedJob *entity.PreprocessingControlJob
	if runtimeJob != nil && strings.EqualFold(runtimeJob.Status, "running") {
		if runtimeJob.Mode == "batch" && runtimeProgress.ItemsToProcess == 0 && values["inflight"] == 0 {
			runtimeJob.Status = "completed"
			runtimeJob.UpdatedAt = end
			stateChangedJob = runtimeJob
		} else if status == "failed" {
			runtimeJob.Status = "failed"
			runtimeJob.UpdatedAt = end
			stateChangedJob = runtimeJob
		} else if status == "not_observed" {
			status = "running"
		}
	}
	if runtimeJob != nil && runtimeJob.Status == "completed" {
		if hasCompletedPreprocessingEvidence(runtimeProgress) {
			status = "completed"
		} else {
			status = "not_observed"
		}
	}
	if runtimeJob != nil && runtimeJob.Status == "failed" {
		status = "failed"
	}
	if runtimeJob != nil && (runtimeJob.Status == "cancelling" || runtimeJob.Status == "canceled" || runtimeJob.Status == "cancelled") {
		status = runtimeJob.Status
	}

	// 5. Dựng 8 bước Pipeline DAG Hops và các cạnh kết nối (Edges)
	hops := preprocessingHops(values, observations, end, checkpointDetails, runtimeProgress)
	topology := [][2]string{
		{"bronze", "route"},
		{"route", "lc-quality"}, {"lc-quality", "lc-transform"}, {"lc-transform", "lc-parquet"}, {"lc-parquet", "silver"},
		{"route", "tpf-quality"}, {"tpf-quality", "tpf-transform"}, {"tpf-transform", "tpf-parquet"}, {"tpf-parquet", "silver"},
		{"silver", "checkpoint"}, {"checkpoint", "lineage"}, {"lineage", "event"}, {"event", "ack"},
	}
	edges := make([]entity.PreprocessingEdge, 0, len(topology))
	for i, connection := range topology {
		edges = append(edges, entity.PreprocessingEdge{
			ID:         fmt.Sprintf("edge-%d", i),
			Source:     connection[0],
			Target:     connection[1],
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

	// 6. Phát sự kiện SSE khi hoàn tất tác vụ batch
	if stateChangedJob != nil && s.publisher != nil {
		payload, _ := json.Marshal(stateChangedJob)
		_ = s.publisher.Publish(ctx, entity.WorkflowEvent{
			Type:       "workflow",
			Workflow:   "preprocessing",
			Status:     stateChangedJob.Status,
			JobID:      stateChangedJob.JobID,
			OccurredAt: stateChangedJob.UpdatedAt,
			Payload:    payload,
		})
	}

	return &entity.PreprocessingGraph{
		Source:           "prometheus",
		ObservationScope: "preprocessor_service",
		Status:           status,
		ObservedAt:       end,
		Run:              runtimeJob,
		Progress:         runtimeProgress,
		Runtime:          runtime,
		Hops:             hops,
		Edges:            edges,
	}, nil
}

// A durable run is only complete once the persisted input, output and
// checkpoint inventories can account for its work. This prevents a restored
// control record from briefly presenting a completed DAG with empty charts
// while the asynchronous object inventory is still loading.
func hasCompletedPreprocessingEvidence(progress entity.PreprocessingProgress) bool {
	return progress.BronzeObserved &&
		progress.FootprintObserved &&
		progress.BronzeTotal > 0 &&
		progress.CheckpointCompleted > 0 &&
		progress.SilverTotal > 0 &&
		progress.SilverBytes > 0
}

// refreshCheckpointProgress refreshes durable checkpoint progress and the
// physically stored lakehouse footprint.  The latter is deliberately based on
// ObjectInfo.Size from MinIO; transformations such as decoded FITS arrays are
// transient worker memory and must never be represented as a storage tier.
func (s *PreprocessingService) refreshCheckpointProgress(ctx context.Context) {
	objects, err := s.objects.ListObjects(ctx, "checkpoints/preprocessing/objects/")
	checkpointInventoryRead := err == nil
	if !checkpointInventoryRead {
		objects = nil
	}

	completed := 0
	completedLightCurves := 0
	completedTargetPixels := 0
	completedBronzeKeys := make(map[string]struct{})
	failed := 0
	failedBronzeKeys := make(map[string]struct{})
	var countMu sync.Mutex
	var countWG sync.WaitGroup
	var latestAt time.Time
	var latestDetails map[string]string
	encodeFailures := make([]entity.PreprocessingEncodeFailure, 0)
	silverFailures := make([]entity.PreprocessingSilverFailure, 0)
	checkpointPoints := make([]entity.PreprocessingCheckpointPoint, 0, min(len(objects), maxCheckpointPoints))
	completedSilverByKey := make(map[string]silverCheckpointEvidence)
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
				SchemaVersion       uint32  `json:"schema_version"`
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
				LastErrorKind       *string `json:"last_error_kind"`
				Terminal            bool    `json:"terminal"`
				CreatedAt           string  `json:"created_at"`
				UpdatedAt           string  `json:"updated_at"`
			}

			if json.Unmarshal(data, &checkpoint) == nil {
				createdAt, _ := time.Parse(time.RFC3339Nano, checkpoint.CreatedAt)
				updatedAt, _ := time.Parse(time.RFC3339Nano, checkpoint.UpdatedAt)
				if updatedAt.IsZero() {
					updatedAt = object.LastModified
				}
				countMu.Lock()
				if len(checkpointPoints) < maxCheckpointPoints {
					elapsed := updatedAt.Sub(createdAt)
					if createdAt.IsZero() || elapsed < 0 {
						elapsed = 0
					}
					checkpointPoints = append(checkpointPoints, entity.PreprocessingCheckpointPoint{
						CheckpointID: checkpoint.CheckpointID, ProductKind: checkpoint.ProductKind,
						State: strings.ToUpper(checkpoint.State), SchemaVersion: int64(checkpoint.SchemaVersion),
						Attempts: int64(checkpoint.Attempts), Terminal: checkpoint.Terminal,
						SilverObjectKey:    optionalString(checkpoint.SilverObjectKey),
						LastErrorKind:      optionalString(checkpoint.LastErrorKind),
						LifecycleElapsedMS: elapsed.Milliseconds(), CreatedAt: createdAt, UpdatedAt: updatedAt,
					})
				}
				if strings.EqualFold(checkpoint.State, "COMPLETED") {
					completed++
					switch strings.ToUpper(strings.ReplaceAll(checkpoint.ProductKind, "-", "_")) {
					case "LIGHT_CURVE", "LIGHTCURVE":
						completedLightCurves++
					case "TARGET_PIXEL", "TARGETPIXEL":
						completedTargetPixels++
					}
					if checkpoint.BronzeObjectKey != "" {
						completedBronzeKeys[checkpoint.BronzeObjectKey] = struct{}{}
					}
					if checkpoint.SilverObjectKey != nil && strings.TrimSpace(*checkpoint.SilverObjectKey) != "" {
						completedSilverByKey[*checkpoint.SilverObjectKey] = silverCheckpointEvidence{
							ProductKind:   checkpoint.ProductKind,
							SHA256:        optionalString(checkpoint.SilverSHA256),
							SizeBytes:     int64(optionalUint64Value(checkpoint.SilverSizeBytes)),
							SchemaVersion: optionalString(checkpoint.SilverSchemaVersion),
							Attempts:      int64(checkpoint.Attempts),
						}
					}
				} else if strings.EqualFold(checkpoint.State, "FAILED") {
					failed++
					if checkpoint.BronzeObjectKey != "" {
						failedBronzeKeys[checkpoint.BronzeObjectKey] = struct{}{}
					}
				}
				if checkpoint.LastErrorKind != nil && strings.EqualFold(*checkpoint.LastErrorKind, "PARQUET_ENCODE_FAILED") {
					encodeFailures = append(encodeFailures, entity.PreprocessingEncodeFailure{
						ObjectKey: checkpoint.BronzeObjectKey, ProductKind: checkpoint.ProductKind,
						Reason: optionalString(checkpoint.LastError), Recovered: strings.EqualFold(checkpoint.State, "COMPLETED"),
						OccurredAt: updatedAt,
					})
				}
				if checkpoint.LastErrorKind != nil && (strings.EqualFold(*checkpoint.LastErrorKind, "SILVER_WRITE_FAILED") || strings.EqualFold(*checkpoint.LastErrorKind, "SILVER_CONFLICT")) {
					silverFailures = append(silverFailures, entity.PreprocessingSilverFailure{
						ObjectKey: checkpoint.BronzeObjectKey, ProductKind: checkpoint.ProductKind,
						Kind: *checkpoint.LastErrorKind, Reason: optionalString(checkpoint.LastError),
						Recovered: strings.EqualFold(checkpoint.State, "COMPLETED"), Attempts: int64(checkpoint.Attempts),
						OccurredAt: updatedAt,
					})
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

	bronzeTotal := 0
	bronzeBytes := int64(0)
	bronzeCompleted := 0
	bronzeFailed := 0
	bronzeLightCurves := 0
	bronzeTargetPixels := 0
	bronzeInventoryRead := false
	bronzeSizeByKey := make(map[string]int64)
	if bronzeObjects, bronzeErr := s.objects.ListObjects(ctx, "bronze/"); bronzeErr == nil {
		bronzeInventoryRead = true
		for _, object := range bronzeObjects {
			if !isProcessableBronzeFITS(object.Key) {
				continue
			}
			bronzeTotal++
			bronzeBytes += object.Size
			bronzeSizeByKey[object.Key] = object.Size
			lowerKey := strings.ToLower(object.Key)
			if strings.Contains(lowerKey, "/lightcurve/") {
				bronzeLightCurves++
			} else if strings.Contains(lowerKey, "/target-pixel/") {
				bronzeTargetPixels++
			}
			if _, ok := completedBronzeKeys[object.Key]; ok {
				bronzeCompleted++
			}
			if _, ok := failedBronzeKeys[object.Key]; ok {
				bronzeFailed++
			}
		}
	}

	silverTotal := 0
	silverBytes := int64(0)
	silverLightCurves := 0
	silverTargetPixels := 0
	scienceCountsObserved := false
	var lcInputSamples, lcOutputSamples, lcQualityRemoved, lcInvalidRemoved, lcNonfiniteRemoved, lcNonpositiveRemoved, lcOutlierRemoved int64
	var lcSigmaClip3To4, lcSigmaClip4To5, lcSigmaClipGE5 int64
	var tpfInputSamples, tpfOutputSamples, tpfQualityRemoved, tpfInvalidRemoved, tpfNonfiniteRemoved, tpfNonpositiveRemoved int64
	lcOutlierFractions := make([]float64, 0)
	lcScatterBefore := make([]float64, 0)
	lcScatterAfter := make([]float64, 0)
	lcScatterPoints := make([]entity.PreprocessingScatterPoint, 0, min(silverLightCurves, maxLCScatterPoints))
	tpfFiniteFractions := make([]float64, 0)
	tpfTransformPoints := make([]entity.PreprocessingTPFTransformPoint, 0, maxTPFTransformPoints)
	materializationPoints := make([]entity.PreprocessingMaterializationPoint, 0)
	verifiedSilverByKey := make(map[string]bool)
	silverInventoryRead := false
	silverObjects, silverErr := listObjectsWithMetadata(ctx, s.objects, "silver/")
	if silverErr == nil {
		silverInventoryRead = true
		sort.SliceStable(silverObjects, func(i, j int) bool {
			return silverObjects[i].LastModified.After(silverObjects[j].LastModified)
		})
		for _, object := range silverObjects {
			if !strings.HasSuffix(strings.ToLower(object.Key), ".parquet") {
				continue
			}
			silverTotal++
			silverBytes += object.Size
			lowerKey := strings.ToLower(object.Key)
			productKind := ""
			rows := int64(0)
			if strings.Contains(lowerKey, "/lightcurve/") {
				productKind = "lightcurve"
				rows = metadataInt64(object.UserMetadata, "output-points")
				silverLightCurves++
				if _, ok := object.UserMetadata["input-points"]; ok {
					scienceCountsObserved = true
				}
				lcInputSamples += metadataInt64(object.UserMetadata, "input-points")
				lcOutputSamples += metadataInt64(object.UserMetadata, "output-points")
				lcQualityRemoved += metadataInt64(object.UserMetadata, "quality-removed")
				lcInvalidRemoved += metadataInt64(object.UserMetadata, "invalid-removed")
				lcNonfiniteRemoved += metadataInt64(object.UserMetadata, "nonfinite-removed")
				lcNonpositiveRemoved += metadataInt64(object.UserMetadata, "nonpositive-time-removed")
				outlierRemoved := metadataInt64(object.UserMetadata, "outlier-removed")
				lcOutlierRemoved += outlierRemoved
				lcSigmaClip3To4 += metadataInt64(object.UserMetadata, "sigma-clip-3-4-removed")
				lcSigmaClip4To5 += metadataInt64(object.UserMetadata, "sigma-clip-4-5-removed")
				lcSigmaClipGE5 += metadataInt64(object.UserMetadata, "sigma-clip-ge-5-removed")
				outputSamples := metadataInt64(object.UserMetadata, "output-points")
				if preclipSamples := outputSamples + outlierRemoved; preclipSamples > 0 {
					lcOutlierFractions = append(lcOutlierFractions, float64(outlierRemoved)/float64(preclipSamples))
				}
				beforeScatter, beforeObserved := metadataFloat64(object.UserMetadata, "normalized-scatter-before-clip-ppm")
				afterScatter, afterObserved := metadataFloat64(object.UserMetadata, "normalized-scatter-after-clip-ppm")
				if !afterObserved {
					afterScatter, afterObserved = s.lightCurveScatterPPM(ctx, object)
				}
				// If no cadence was clipped, the stored output is exactly the
				// pre-clip series and therefore provides both distributions.
				if !beforeObserved && afterObserved && outlierRemoved == 0 {
					beforeScatter, beforeObserved = afterScatter, true
				}
				if beforeObserved {
					lcScatterBefore = append(lcScatterBefore, beforeScatter)
				}
				if afterObserved {
					lcScatterAfter = append(lcScatterAfter, afterScatter)
				}
				if beforeObserved && afterObserved && len(lcScatterPoints) < maxLCScatterPoints {
					sigmaClipLevel, _ := metadataFloat64(object.UserMetadata, "sigma-clip-level")
					lcScatterPoints = append(lcScatterPoints, entity.PreprocessingScatterPoint{
						ObjectKey: object.Key, BeforePPM: beforeScatter, AfterPPM: afterScatter,
						OutlierRemoved: outlierRemoved, PreclipSamples: outputSamples + outlierRemoved,
						SigmaClipLevel: sigmaClipLevel,
					})
				}
			} else if strings.Contains(lowerKey, "/target-pixel/") {
				productKind = "target_pixel"
				rows = metadataInt64(object.UserMetadata, "output-cadences")
				silverTargetPixels++
				if _, ok := object.UserMetadata["input-cadences"]; ok {
					scienceCountsObserved = true
				}
				tpfInputSamples += metadataInt64(object.UserMetadata, "input-cadences")
				tpfOutputSamples += metadataInt64(object.UserMetadata, "output-cadences")
				tpfQualityRemoved += metadataInt64(object.UserMetadata, "quality-removed")
				tpfInvalidRemoved += metadataInt64(object.UserMetadata, "invalid-time-removed")
				tpfNonfiniteRemoved += metadataInt64(object.UserMetadata, "nonfinite-removed")
				tpfNonpositiveRemoved += metadataInt64(object.UserMetadata, "nonpositive-time-removed")
				finitePixelFraction, finiteObserved := metadataFloat64(object.UserMetadata, "finite-pixel-fraction")
				if finiteObserved && finitePixelFraction <= 1 {
					tpfFiniteFractions = append(tpfFiniteFractions, finitePixelFraction)
				}
				_, diagnosticsObserved := object.UserMetadata["tpf-input-pixel-values"]
				if (finiteObserved || diagnosticsObserved) && len(tpfTransformPoints) < maxTPFTransformPoints {
					scatterP50, _ := metadataFloat64(object.UserMetadata, "tpf-pixel-scatter-mad-p50-ppm")
					scatterP95, _ := metadataFloat64(object.UserMetadata, "tpf-pixel-scatter-mad-p95-ppm")
					driftP50, _ := metadataFloat64(object.UserMetadata, "tpf-reference-drift-p50-ppm")
					driftP95, _ := metadataFloat64(object.UserMetadata, "tpf-reference-drift-p95-ppm")
					boundaryP50, _ := metadataFloat64(object.UserMetadata, "tpf-boundary-jump-p50-ppm")
					boundaryP95, _ := metadataFloat64(object.UserMetadata, "tpf-boundary-jump-p95-ppm")
					tpfTransformPoints = append(tpfTransformPoints, entity.PreprocessingTPFTransformPoint{
						ObjectKey: object.Key, CompletedAt: object.LastModified,
						DiagnosticsObserved:    diagnosticsObserved,
						FinitePixelFraction:    finitePixelFraction,
						InputCadences:          metadataInt64(object.UserMetadata, "input-cadences"),
						OutputCadences:         metadataInt64(object.UserMetadata, "output-cadences"),
						InputPixelValues:       metadataInt64(object.UserMetadata, "tpf-input-pixel-values"),
						NormalizedPixelValues:  metadataInt64(object.UserMetadata, "tpf-normalized-pixel-values"),
						NonfinitePixelValues:   metadataInt64(object.UserMetadata, "tpf-nonfinite-pixel-values"),
						InvalidReferenceValues: metadataInt64(object.UserMetadata, "tpf-invalid-reference-values"),
						InvalidReferencePixels: metadataInt64(object.UserMetadata, "tpf-invalid-reference-pixels"),
						ScatterP50PPM:          scatterP50, ScatterP95PPM: scatterP95,
						DriftP50PPM: driftP50, DriftP95PPM: driftP95,
						BoundaryJumpP50PPM: boundaryP50, BoundaryJumpP95PPM: boundaryP95,
						ChunkCount: metadataInt64(object.UserMetadata, "tpf-chunk-count"),
					})
				}
			}
			if productKind != "" && len(materializationPoints) < maxMaterializationPoints {
				bronzeKey := strings.TrimSpace(object.UserMetadata["bronze-object-key"])
				bronzeSHA := strings.TrimSpace(object.UserMetadata["bronze-sha256"])
				silverSHA := strings.TrimSpace(object.UserMetadata["silver-sha256"])
				schemaVersion := strings.TrimSpace(object.UserMetadata["schema-version"])
				checkpoint, checkpointLinked := completedSilverByKey[object.Key]
				sizeVerified := checkpointLinked && checkpoint.SizeBytes == object.Size && object.Size > 0
				checksumBound := checkpointLinked && silverSHA != "" && strings.EqualFold(checkpoint.SHA256, silverSHA)
				schemaVerified := checkpointLinked && schemaVersion != "" && checkpoint.SchemaVersion == schemaVersion
				lineageBound := bronzeKey != "" && bronzeSHA != ""
				encodeDurationMS, _ := metadataFloat64(object.UserMetadata, "parquet-encode-duration-ms")
				integrityVerified := checkpointLinked && sizeVerified && checksumBound && schemaVerified && lineageBound
				verifiedSilverByKey[object.Key] = integrityVerified
				materializationPoints = append(materializationPoints, entity.PreprocessingMaterializationPoint{
					ObjectKey: object.Key, ProductKind: productKind, Rows: rows, SizeBytes: object.Size,
					SourceBytes: bronzeSizeByKey[bronzeKey], EncodeDurationMS: encodeDurationMS, CompletedAt: object.LastModified,
					ETag: object.ETag, SchemaVersion: schemaVersion, ChecksumBound: checksumBound,
					LineageBound: lineageBound, SizeVerified: sizeVerified, SchemaVerified: schemaVerified,
					CheckpointLinked:     checkpointLinked,
					IntegrityVerified:    integrityVerified,
					VerificationAttempts: checkpoint.Attempts,
				})
			}
		}
	}
	for i := range checkpointPoints {
		point := &checkpointPoints[i]
		point.SilverVerified = verifiedSilverByKey[point.SilverObjectKey]
		point.ResumeAction = checkpointResumeAction(*point)
	}
	sort.SliceStable(checkpointPoints, func(i, j int) bool {
		return checkpointPoints[i].UpdatedAt.Before(checkpointPoints[j].UpdatedAt)
	})

	goldTotal := 0
	goldBytes := int64(0)
	goldInventoryRead := false
	if goldObjects, goldErr := s.objects.ListObjects(ctx, "gold/"); goldErr == nil {
		goldInventoryRead = true
		for _, object := range goldObjects {
			goldTotal++
			goldBytes += object.Size
		}
	}

	var silverEvents repo.SilverEventStreamSnapshot
	silverEventsObserved := false
	if s.eventObserver != nil {
		if snapshot, eventErr := s.eventObserver.ObserveSilverEventStream(ctx); eventErr == nil {
			silverEvents = snapshot
			silverEventsObserved = true
		}
	}
	var bronzeConsumer repo.BronzeConsumerSnapshot
	bronzeConsumerObserved := false
	if s.bronzeObserver != nil {
		if snapshot, consumerErr := s.bronzeObserver.ObserveBronzeConsumer(ctx); consumerErr == nil {
			bronzeConsumer = snapshot
			bronzeConsumerObserved = true
		}
	}

	s.runtimeMu.Lock()
	if bronzeInventoryRead {
		s.progress.BronzeTotal = bronzeTotal
		s.progress.BronzeBytes = bronzeBytes
		s.progress.BronzeCompleted = bronzeCompleted
		s.progress.BronzeFailed = bronzeFailed
		s.progress.BronzePending = bronzeTotal - bronzeCompleted - bronzeFailed
		s.progress.BronzeObserved = true
		s.progress.BronzeLightCurves = bronzeLightCurves
		s.progress.BronzeTargetPixels = bronzeTargetPixels
	}
	if silverInventoryRead {
		s.progress.SilverTotal = silverTotal
		s.progress.SilverBytes = silverBytes
		s.progress.SilverLightCurves = silverLightCurves
		s.progress.SilverTargetPixels = silverTargetPixels
		s.progress.ScienceCountsObserved = scienceCountsObserved
		s.progress.LCInputSamples = lcInputSamples
		s.progress.LCOutputSamples = lcOutputSamples
		s.progress.LCQualityRemoved = lcQualityRemoved
		s.progress.LCInvalidRemoved = lcInvalidRemoved
		s.progress.LCNonfiniteRemoved = lcNonfiniteRemoved
		s.progress.LCNonpositiveRemoved = lcNonpositiveRemoved
		s.progress.LCOutlierRemoved = lcOutlierRemoved
		s.progress.LCSigmaClip3To4 = lcSigmaClip3To4
		s.progress.LCSigmaClip4To5 = lcSigmaClip4To5
		s.progress.LCSigmaClipGE5 = lcSigmaClipGE5
		s.progress.LCTransformProducts = len(lcOutlierFractions)
		s.progress.LCScatterProducts = min(len(lcScatterBefore), len(lcScatterAfter))
		s.progress.LCScatterBeforeMean = meanFloat64(lcScatterBefore)
		s.progress.LCScatterBeforeP50 = quantileFloat64(lcScatterBefore, 0.50)
		s.progress.LCScatterBeforeP95 = quantileFloat64(lcScatterBefore, 0.95)
		s.progress.LCScatterAfterMean = meanFloat64(lcScatterAfter)
		s.progress.LCScatterAfterP50 = quantileFloat64(lcScatterAfter, 0.50)
		s.progress.LCScatterAfterP95 = quantileFloat64(lcScatterAfter, 0.95)
		s.progress.LCOutlierFractionP50 = quantileFloat64(lcOutlierFractions, 0.50)
		s.progress.LCOutlierFractionP95 = quantileFloat64(lcOutlierFractions, 0.95)
		s.progress.LCScatterPoints = lcScatterPoints
		s.progress.TPFInputSamples = tpfInputSamples
		s.progress.TPFOutputSamples = tpfOutputSamples
		s.progress.TPFQualityRemoved = tpfQualityRemoved
		s.progress.TPFInvalidRemoved = tpfInvalidRemoved
		s.progress.TPFNonfiniteRemoved = tpfNonfiniteRemoved
		s.progress.TPFNonpositiveRemoved = tpfNonpositiveRemoved
		s.progress.TPFFiniteProducts = len(tpfFiniteFractions)
		s.progress.TPFFiniteFractionMean = meanFloat64(tpfFiniteFractions)
		s.progress.TPFFiniteFractionP05 = quantileFloat64(tpfFiniteFractions, 0.05)
		s.progress.TPFFiniteFractionP50 = quantileFloat64(tpfFiniteFractions, 0.50)
		s.progress.TPFTransformPoints = tpfTransformPoints
		s.progress.MaterializationPoints = materializationPoints
		s.progress.EncodeFailures = encodeFailures
		s.progress.SilverFailures = silverFailures
	}
	if goldInventoryRead {
		s.progress.GoldTotal = goldTotal
		s.progress.GoldBytes = goldBytes
	}
	s.progress.FootprintObserved = bronzeInventoryRead && silverInventoryRead && goldInventoryRead
	if checkpointInventoryRead {
		s.progress.CheckpointTotal = len(objects)
		s.progress.CheckpointCompleted = completed
		s.progress.CheckpointFailed = failed
		s.progress.CheckpointPending = len(objects) - completed - failed
		s.progress.CompletedLightCurves = completedLightCurves
		s.progress.CompletedTargetPixels = completedTargetPixels
		s.progress.CheckpointPoints = checkpointPoints
		s.checkpointDetails = latestDetails
	}
	if silverEventsObserved {
		s.progress.SilverEventObserved = true
		s.progress.SilverEventMessages = silverEvents.Messages
		s.progress.SilverEventBytes = silverEvents.Bytes
		s.progress.SilverEventConsumers = silverEvents.Consumers
		s.progress.SilverEventLightCurves = silverEvents.BySubject["aurora.v1.silver.lightcurve.ready"]
		s.progress.SilverEventTargetPixels = silverEvents.BySubject["aurora.v1.silver.target_pixel.ready"]
		s.progress.SilverEventFirstAt = silverEvents.FirstAt
		s.progress.SilverEventLastAt = silverEvents.LastAt
	}
	if bronzeConsumerObserved {
		s.progress.BronzeConsumerObserved = true
		s.progress.BronzeStreamMessages = bronzeConsumer.StreamMessages
		s.progress.BronzeStreamBytes = bronzeConsumer.StreamBytes
		s.progress.BronzeDeliveredConsumer = bronzeConsumer.DeliveredConsumerSeq
		s.progress.BronzeDeliveredStream = bronzeConsumer.DeliveredStreamSeq
		s.progress.BronzeAckFloorConsumer = bronzeConsumer.AckFloorConsumerSeq
		s.progress.BronzeAckFloorStream = bronzeConsumer.AckFloorStreamSeq
		s.progress.BronzeConsumerAckPending = bronzeConsumer.AckPending
		s.progress.BronzeConsumerPending = bronzeConsumer.Pending
		s.progress.BronzeCurrentRedelivered = bronzeConsumer.CurrentRedelivered
		s.progress.BronzeConsumerWaiting = bronzeConsumer.Waiting
		s.progress.BronzeLastDeliveredAt = bronzeConsumer.LastDeliveredAt
		s.progress.BronzeLastAckAt = bronzeConsumer.LastAckAt
	}
	s.progressAt = time.Now().UTC()
	s.progressRefreshing = false
	jobID := ""
	if s.runtimeJob != nil {
		jobID = s.runtimeJob.JobID
	}
	observedAt := s.progressAt
	s.runtimeMu.Unlock()

	if s.publisher != nil && (checkpointInventoryRead || bronzeInventoryRead || silverInventoryRead) {
		payload, _ := json.Marshal(map[string]any{"science_counts_observed": scienceCountsObserved, "silver_objects": silverTotal})
		_ = s.publisher.Publish(ctx, entity.WorkflowEvent{
			Type: "workflow", Workflow: "preprocessing", Status: "evidence_refreshed",
			JobID: jobID, OccurredAt: observedAt, Payload: payload,
		})
	}
}

func listObjectsWithMetadata(ctx context.Context, objects repo.ObjectRepository, prefix string) ([]repo.ObjectInfo, error) {
	if metadataObjects, ok := objects.(repo.ObjectMetadataRepository); ok {
		return metadataObjects.ListObjectsWithMetadata(ctx, prefix)
	}
	return objects.ListObjects(ctx, prefix)
}

func metadataInt64(metadata map[string]string, key string) int64 {
	value, err := strconv.ParseInt(strings.TrimSpace(metadata[key]), 10, 64)
	if err != nil || value < 0 {
		return 0
	}
	return value
}

func metadataFloat64(metadata map[string]string, key string) (float64, bool) {
	value, err := strconv.ParseFloat(strings.TrimSpace(metadata[key]), 64)
	if err != nil || math.IsNaN(value) || math.IsInf(value, 0) || value < 0 {
		return 0, false
	}
	return value, true
}

func checkpointResumeAction(point entity.PreprocessingCheckpointPoint) string {
	if point.Terminal {
		return "terminal"
	}
	switch strings.ToUpper(point.State) {
	case "COMPLETED":
		if point.SilverVerified {
			return "reuse_and_ack"
		}
		return "reprocess"
	case "SILVER_STORED":
		if point.SilverVerified {
			return "verify_silver"
		}
		return "reprocess"
	default:
		return "reprocess"
	}
}

type lightCurveScatterRow struct {
	Flux float32 `parquet:"flux"`
}

func (s *PreprocessingService) lightCurveScatterPPM(ctx context.Context, object repo.ObjectInfo) (float64, bool) {
	if object.Size <= 0 || object.Size > maxScatterBackfillObjectBytes {
		return 0, false
	}
	cacheKey := fmt.Sprintf("%s:%s:%d:%d", object.Key, object.ETag, object.Size, object.LastModified.UnixNano())
	s.scienceCacheMu.Lock()
	if entry, ok := s.lcScatterCache[cacheKey]; ok {
		s.scienceCacheMu.Unlock()
		return entry.value, entry.observed
	}
	s.scienceCacheMu.Unlock()

	data, err := s.objects.GetObject(ctx, object.Key)
	value, observed := 0.0, false
	if err == nil && len(data) <= maxScatterBackfillObjectBytes {
		value, err = normalizedFluxScatterPPM(data)
		observed = err == nil
	}

	s.scienceCacheMu.Lock()
	if s.lcScatterCache == nil {
		s.lcScatterCache = make(map[string]scatterCacheEntry)
	}
	s.lcScatterCache[cacheKey] = scatterCacheEntry{value: value, observed: observed}
	s.scienceCacheMu.Unlock()
	return value, observed
}

func normalizedFluxScatterPPM(data []byte) (float64, error) {
	reader := parquet.NewGenericReader[lightCurveScatterRow](bytes.NewReader(data))
	defer reader.Close()
	rows := make([]lightCurveScatterRow, 4096)
	count := 0.0
	mean, m2 := 0.0, 0.0
	for {
		n, err := reader.Read(rows)
		if err != nil && !errors.Is(err, io.EOF) {
			return 0, fmt.Errorf("read normalized Light Curve flux: %w", err)
		}
		for _, row := range rows[:n] {
			value := float64(row.Flux)
			if math.IsNaN(value) || math.IsInf(value, 0) {
				continue
			}
			count++
			delta := value - mean
			mean += delta / count
			m2 += delta * (value - mean)
		}
		if errors.Is(err, io.EOF) {
			break
		}
	}
	if count == 0 {
		return 0, fmt.Errorf("normalized Light Curve contains no finite flux samples")
	}
	return math.Sqrt(m2/count) * 1_000_000, nil
}

func meanFloat64(values []float64) float64 {
	if len(values) == 0 {
		return 0
	}
	total := 0.0
	for _, value := range values {
		total += value
	}
	return total / float64(len(values))
}

func quantileFloat64(values []float64, q float64) float64 {
	if len(values) == 0 {
		return 0
	}
	ordered := append([]float64(nil), values...)
	sort.Float64s(ordered)
	position := q * float64(len(ordered)-1)
	lower := int(math.Floor(position))
	upper := int(math.Ceil(position))
	if lower == upper {
		return ordered[lower]
	}
	weight := position - float64(lower)
	return ordered[lower]*(1-weight) + ordered[upper]*weight
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
// ĐỊNH NGHĨA 8 BƯỚC HOPS TRONG PIPELINE DAG VỚI METRICS THỜI GIAN THỰC TỪ BACKEND
// ============================================================================
func preprocessingHops(values map[string]float64, observations map[string][]entity.MonitoringPoint, observedAt time.Time, details map[string]string, progress entity.PreprocessingProgress) []entity.PreprocessingHop {
	baseMetrics := make(map[string]float64, len(values))
	for key, value := range values {
		baseMetrics[key] = value
	}
	terminalCheckpoints := 0
	for _, point := range progress.CheckpointPoints {
		if point.Terminal {
			terminalCheckpoints++
		}
	}
	ackLagSeconds := 0.0
	if !progress.BronzeLastDeliveredAt.IsZero() && !progress.BronzeLastAckAt.IsZero() {
		ackLagSeconds = math.Max(0, progress.BronzeLastAckAt.Sub(progress.BronzeLastDeliveredAt).Seconds())
	}

	hops := []entity.PreprocessingHop{
		{
			ID:          "bronze",
			Label:       "Bronze FITS",
			Description: "Immutable source artifact",
			Contract:    "bronze/tess/<product>/sector=<sector>/tic=<tic>/",
			Input:       "NASA FITS",
			Output:      "Verified Bronze object",
			Metrics: map[string]float64{
				"total_files":        float64(progress.BronzeTotal),
				"lightcurve_files":   float64(progress.BronzeLightCurves),
				"target_pixel_files": float64(progress.BronzeTargetPixels),
				"pending_files":      float64(progress.BronzePending),
				"failed_files":       float64(progress.BronzeFailed),
				"bronze_bytes":       float64(progress.BronzeBytes),
				"inventory_observed": boolToMetric(progress.BronzeObserved),
				"throughput":         values["throughput"],
			},
			Telemetry: metricSeries(observations, "throughput"),
		},
		{
			ID:          "decode",
			Label:       "Decode & validate",
			Description: "Read FITS and validate product shape",
			Contract:    "product-kind validation",
			Input:       "Bronze FITS",
			Output:      "Validated samples",
			Metrics: mergeMetricValues(metricValues(values,
				"lc_input_rate", "tpf_input_rate", "lc_quality_removed_rate", "tpf_quality_removed_rate",
				"lc_invalid_removed_rate", "tpf_invalid_removed_rate", "lc_nonfinite_removed_rate", "tpf_nonfinite_removed_rate",
				"lc_nonpositive_removed_rate", "tpf_nonpositive_removed_rate", "lc_input_total", "tpf_input_total",
				"lc_quality_removed_total", "tpf_quality_removed_total", "lc_nonfinite_removed_total", "tpf_nonfinite_removed_total",
				"lc_nonpositive_removed_total", "tpf_nonpositive_removed_total", "errors"), map[string]float64{
				"completed_lightcurves":   float64(progress.CompletedLightCurves),
				"completed_target_pixels": float64(progress.CompletedTargetPixels),
				"science_counts_observed": boolToMetric(progress.ScienceCountsObserved),
				"lc_input_samples":        float64(progress.LCInputSamples),
				"lc_output_samples":       float64(progress.LCOutputSamples),
				"lc_quality_removed":      float64(progress.LCQualityRemoved),
				"lc_invalid_removed":      float64(progress.LCInvalidRemoved),
				"lc_nonfinite_removed":    float64(progress.LCNonfiniteRemoved),
				"lc_nonpositive_removed":  float64(progress.LCNonpositiveRemoved),
				"lc_outlier_removed":      float64(progress.LCOutlierRemoved),
				"tpf_input_samples":       float64(progress.TPFInputSamples),
				"tpf_output_samples":      float64(progress.TPFOutputSamples),
				"tpf_quality_removed":     float64(progress.TPFQualityRemoved),
				"tpf_invalid_removed":     float64(progress.TPFInvalidRemoved),
				"tpf_nonfinite_removed":   float64(progress.TPFNonfiniteRemoved),
				"tpf_nonpositive_removed": float64(progress.TPFNonpositiveRemoved),
				"failed_products":         float64(progress.CheckpointFailed),
			}),
			Telemetry: metricSeries(observations,
				"lc_input_rate", "tpf_input_rate", "lc_quality_removed_rate", "tpf_quality_removed_rate",
				"lc_invalid_removed_rate", "tpf_invalid_removed_rate", "lc_nonfinite_removed_rate", "tpf_nonfinite_removed_rate",
				"lc_nonpositive_removed_rate", "tpf_nonpositive_removed_rate"),
		},
		{
			ID:          "transform",
			Label:       "Scientific transform",
			Description: "Clean, normalize and derive masks",
			Contract:    "lc-preprocess-v1 / tpf-preprocess-v2-chunked",
			Input:       "Validated samples",
			Output:      "Silver rows",
			Metrics: mergeMetricValues(metricValues(values,
				"lc_output_rate", "tpf_output_rate", "lc_outlier_removed_rate", "lc_sigma_clip_3_4_rate", "lc_sigma_clip_4_5_rate", "lc_sigma_clip_ge_5_rate",
				"tpf_finite_pixel_fraction", "lc_scatter_before_p50", "lc_scatter_before_p95", "lc_scatter_after_p50", "lc_scatter_after_p95",
				"lc_sigma_clip_fraction_p95", "tpf_finite_pixel_fraction_p05", "tpf_pixel_input_rate", "tpf_pixel_retained_rate",
				"tpf_pixel_nonfinite_rate", "tpf_pixel_invalid_reference_rate", "tpf_scatter_p50", "tpf_scatter_p95",
				"tpf_reference_drift_p95", "tpf_boundary_jump_p95", "lc_duration_p95", "tpf_duration_p95", "throughput"), map[string]float64{
				"completed_lightcurves":            float64(progress.CompletedLightCurves),
				"completed_target_pixels":          float64(progress.CompletedTargetPixels),
				"lc_preclip_samples":               float64(progress.LCOutputSamples + progress.LCOutlierRemoved),
				"lc_retained_samples":              float64(progress.LCOutputSamples),
				"lc_outlier_removed":               float64(progress.LCOutlierRemoved),
				"lc_sigma_clip_3_4_removed":        float64(progress.LCSigmaClip3To4),
				"lc_sigma_clip_4_5_removed":        float64(progress.LCSigmaClip4To5),
				"lc_sigma_clip_ge_5_removed":       float64(progress.LCSigmaClipGE5),
				"lc_transform_products":            float64(progress.LCTransformProducts),
				"lc_scatter_products":              float64(progress.LCScatterProducts),
				"lc_scatter_before_mean_durable":   progress.LCScatterBeforeMean,
				"lc_scatter_before_p50_durable":    progress.LCScatterBeforeP50,
				"lc_scatter_before_p95_durable":    progress.LCScatterBeforeP95,
				"lc_scatter_after_mean_durable":    progress.LCScatterAfterMean,
				"lc_scatter_after_p50_durable":     progress.LCScatterAfterP50,
				"lc_scatter_after_p95_durable":     progress.LCScatterAfterP95,
				"lc_outlier_fraction_p50_durable":  progress.LCOutlierFractionP50,
				"lc_outlier_fraction_p95_durable":  progress.LCOutlierFractionP95,
				"tpf_finite_products":              float64(progress.TPFFiniteProducts),
				"tpf_finite_fraction_mean_durable": progress.TPFFiniteFractionMean,
				"tpf_finite_fraction_p05_durable":  progress.TPFFiniteFractionP05,
				"tpf_finite_fraction_p50_durable":  progress.TPFFiniteFractionP50,
			}),
			Telemetry: metricSeries(observations,
				"lc_output_rate", "tpf_output_rate", "lc_outlier_removed_rate", "lc_sigma_clip_3_4_rate", "lc_sigma_clip_4_5_rate", "lc_sigma_clip_ge_5_rate",
				"tpf_finite_pixel_fraction", "lc_scatter_before_p50", "lc_scatter_before_p95", "lc_scatter_after_p50", "lc_scatter_after_p95",
				"lc_sigma_clip_fraction_p95", "tpf_finite_pixel_fraction_p05", "tpf_pixel_input_rate", "tpf_pixel_retained_rate",
				"tpf_pixel_nonfinite_rate", "tpf_pixel_invalid_reference_rate", "tpf_scatter_p50", "tpf_scatter_p95",
				"tpf_reference_drift_p95", "tpf_boundary_jump_p95", "lc_duration_p95", "tpf_duration_p95"),
		},
		{
			ID:          "silver",
			Label:       "Silver Parquet",
			Description: "Write, upload and verify Silver",
			Contract:    "silver/tess/<product>/processor=<version>/",
			Input:       "Silver rows",
			Output:      "Verified Parquet",
			Metrics: map[string]float64{
				"silver_objects":       float64(progress.SilverTotal),
				"silver_lightcurves":   float64(progress.SilverLightCurves),
				"silver_target_pixels": float64(progress.SilverTargetPixels),
				"silver_bytes":         float64(progress.SilverBytes),
				"inventory_observed":   boolToMetric(progress.FootprintObserved),
				"throughput":           values["throughput"],
				"bronze_bytes_rate":    values["bronze_bytes_rate"],
				"silver_bytes_rate":    values["silver_bytes_rate"],
			},
			Telemetry: metricSeries(observations, "throughput", "bronze_bytes_rate", "silver_bytes_rate"),
		},
		{
			ID:          "checkpoint",
			Label:       "Checkpoint",
			Description: "Persist crash-safe processing state",
			Contract:    "checkpoints/preprocessing/objects/<id>.json",
			Input:       "Silver verification",
			Output:      "Completed checkpoint",
			Metrics: map[string]float64{
				"checkpoint_total":     float64(progress.CheckpointTotal),
				"checkpoint_completed": float64(progress.CheckpointCompleted),
				"checkpoint_pending":   float64(progress.CheckpointPending),
				"checkpoint_failed":    float64(progress.CheckpointFailed),
				"throughput":           values["throughput"],
			},
			Telemetry: metricSeries(observations, "throughput"),
		},
		{
			ID:          "lineage",
			Label:       "Lineage & stored footprint",
			Description: "Commit source → Bronze → Silver identity and measure persisted MinIO tiers",
			Contract:    "lineage/v1/<lineage-id>.json",
			Input:       "Checkpoint + checksums",
			Output:      "Committed lineage",
			Metrics: map[string]float64{
				"bronze_bytes":       float64(progress.BronzeBytes),
				"bronze_objects":     float64(progress.BronzeTotal),
				"silver_bytes":       float64(progress.SilverBytes),
				"silver_objects":     float64(progress.SilverTotal),
				"inventory_observed": boolToMetric(progress.FootprintObserved),
			},
		},
		{
			ID:          "event",
			Label:       "Silver event",
			Description: "Publish downstream-ready event",
			Contract:    "aurora.v1.silver.<product>.ready",
			Input:       "Committed lineage",
			Output:      "Published event",
			Metrics: map[string]float64{
				"stream_observed":        boolToMetric(progress.SilverEventObserved),
				"eligible_artifacts":     float64(progress.SilverTotal),
				"eligible_lightcurves":   float64(progress.SilverLightCurves),
				"eligible_target_pixels": float64(progress.SilverTargetPixels),
				"event_emissions":        float64(progress.SilverEventMessages),
				"event_bytes":            float64(progress.SilverEventBytes),
				"event_consumers":        float64(progress.SilverEventConsumers),
				"lightcurve_emissions":   float64(progress.SilverEventLightCurves),
				"target_pixel_emissions": float64(progress.SilverEventTargetPixels),
				"event_first_timestamp":  timeToMetric(progress.SilverEventFirstAt),
				"event_last_timestamp":   timeToMetric(progress.SilverEventLastAt),
				"event_replay_emissions": float64(max(int64(0), progress.SilverEventMessages-int64(progress.SilverTotal))),
			},
		},
		{
			ID:          "ack",
			Label:       "Bronze ACK",
			Description: "Acknowledge only after durable output",
			Contract:    "NATS durable consumer ACK",
			Input:       "Published event",
			Output:      "Bronze message ACKed",
			Metrics: map[string]float64{
				"consumer_observed":             boolToMetric(progress.BronzeConsumerObserved),
				"stream_messages":               float64(progress.BronzeStreamMessages),
				"stream_bytes":                  float64(progress.BronzeStreamBytes),
				"delivery_attempts":             float64(progress.BronzeDeliveredConsumer),
				"delivered_stream_positions":    float64(progress.BronzeDeliveredStream),
				"acknowledged_deliveries":       float64(progress.BronzeAckFloorConsumer),
				"acknowledged_stream_positions": float64(progress.BronzeAckFloorStream),
				"historical_redeliveries":       float64(max(int64(0), progress.BronzeDeliveredConsumer-progress.BronzeDeliveredStream)),
				"ack_pending":                   float64(progress.BronzeConsumerAckPending),
				"pending":                       float64(progress.BronzeConsumerPending),
				"current_redelivered":           float64(progress.BronzeCurrentRedelivered),
				"waiting_fetches":               float64(progress.BronzeConsumerWaiting),
				"last_delivered_timestamp":      timeToMetric(progress.BronzeLastDeliveredAt),
				"last_ack_timestamp":            timeToMetric(progress.BronzeLastAckAt),
				"last_delivery_to_ack_seconds":  ackLagSeconds,
				"completed_checkpoints":         float64(progress.CheckpointCompleted),
				"terminal_checkpoints":          float64(terminalCheckpoints),
			},
		},
	}
	legacy := make(map[string]entity.PreprocessingHop, len(hops))
	for _, hop := range hops {
		legacy[hop.ID] = hop
	}
	variant := func(sourceID, id, label, description, contract, input, output string) entity.PreprocessingHop {
		hop := legacy[sourceID]
		hop.ID = id
		hop.Label = label
		hop.Description = description
		hop.Contract = contract
		hop.Input = input
		hop.Output = output
		return hop
	}
	hops = []entity.PreprocessingHop{
		variant("bronze", "bronze", "Bronze verify & fetch", "Verify object identity, size and checksum before local staging", "bronze/tess/<product>/sector=<sector>/tic=<tic>/", "NASA MAST FITS", "Verified local FITS"),
		variant("decode", "route", "Product router & FITS reader", "Route each verified product to the full LC decoder or bounded-memory TPF chunk reader", "fits-product-router-v1", "Verified local FITS", "Typed LC stream or TPF chunks"),
		variant("decode", "lc-quality", "LC cadence quality control", "Apply quality bitmask, finite-value checks, time validity and cadence deduplication", "quality-flag-bitmask-v1/lc", "Decoded Light Curve", "Quality-valid LC cadences"),
		variant("transform", "lc-transform", "LC normalization & sigma clip", "Normalize relative flux by its median and optionally remove configured sigma outliers", "lc-preprocess-v1", "Quality-valid LC cadences", "Normalized LC samples"),
		variant("silver", "lc-parquet", "LC Parquet encode", "Encode the complete normalized Light Curve as a checksummed ZSTD Parquet artifact", "silver-lightcurve-v1", "Normalized LC samples", "Local LC Parquet"),
		variant("decode", "tpf-quality", "TPF chunk decode & cadence QC", "Read bounded cadence chunks and apply quality, finite-time and time-validity filters", "quality-flag-bitmask-v1/tpf-chunk", "Target Pixel FITS", "Quality-valid TPF chunks"),
		variant("transform", "tpf-transform", "TPF temporal pixel normalization", "Normalize each bounded Target Pixel chunk against its temporal pixel reference", "tpf-preprocess-v2-chunked", "Quality-valid TPF chunk", "Normalized TPF chunk"),
		variant("silver", "tpf-parquet", "TPF row-group append & finalize", "Append each normalized chunk as a Parquet row group, then finalize the complete artifact", "silver-target-pixel-v1/chunked", "Normalized TPF chunks", "Local TPF Parquet"),
		variant("silver", "silver", "Silver upload & integrity verify", "Upload the finalized LC or TPF Parquet object and verify durable size, checksum and metadata", "silver/tess/<product>/processor=<version>/", "Finalized local Parquet", "Verified Silver object"),
		legacy["checkpoint"], legacy["lineage"], legacy["event"], legacy["ack"],
	}
	statuses := preprocessingHopStatuses(values, progress)
	for i := range hops {
		hops[i].Status = statuses[hops[i].ID]
		hops[i].ObservedAt = observedAt
		hops[i].Details = hopDetails(hops[i].ID, details)
		if hops[i].Metrics == nil {
			hops[i].Metrics = baseMetrics
		}
		if hops[i].ID == "lc-transform" {
			hops[i].ScatterPoints = append([]entity.PreprocessingScatterPoint(nil), progress.LCScatterPoints...)
		}
		if hops[i].ID == "tpf-transform" {
			hops[i].TPFTransformPoints = append([]entity.PreprocessingTPFTransformPoint(nil), progress.TPFTransformPoints...)
		}
		if hops[i].ID == "silver" {
			hops[i].MaterializationPoints = append([]entity.PreprocessingMaterializationPoint(nil), progress.MaterializationPoints...)
			hops[i].SilverFailures = append([]entity.PreprocessingSilverFailure(nil), progress.SilverFailures...)
		}
		if hops[i].ID == "checkpoint" {
			hops[i].CheckpointPoints = append([]entity.PreprocessingCheckpointPoint(nil), progress.CheckpointPoints...)
		}
		if hops[i].ID == "lineage" {
			hops[i].MaterializationPoints = append([]entity.PreprocessingMaterializationPoint(nil), progress.MaterializationPoints...)
		}
		if hops[i].ID == "lc-parquet" || hops[i].ID == "tpf-parquet" {
			kind := "lightcurve"
			if hops[i].ID == "tpf-parquet" {
				kind = "target_pixel"
			}
			for _, point := range progress.MaterializationPoints {
				if point.ProductKind == kind {
					hops[i].MaterializationPoints = append(hops[i].MaterializationPoints, point)
				}
			}
			for _, failure := range progress.EncodeFailures {
				normalizedKind := strings.ToLower(strings.ReplaceAll(failure.ProductKind, "-", "_"))
				if normalizedKind == kind || (kind == "lightcurve" && normalizedKind == "light_curve") {
					hops[i].EncodeFailures = append(hops[i].EncodeFailures, failure)
				}
			}
		}
	}
	return hops
}

func metricValues(values map[string]float64, keys ...string) map[string]float64 {
	result := make(map[string]float64, len(keys))
	for _, key := range keys {
		if value, ok := values[key]; ok {
			result[key] = value
		}
	}
	return result
}

func mergeMetricValues(target map[string]float64, source map[string]float64) map[string]float64 {
	for key, value := range source {
		target[key] = value
	}
	return target
}

func metricSeries(observations map[string][]entity.MonitoringPoint, keys ...string) map[string][]entity.MonitoringPoint {
	result := make(map[string][]entity.MonitoringPoint, len(keys))
	for _, key := range keys {
		if points := observations[key]; len(points) > 0 {
			result[key] = points
		}
	}
	return result
}

func preprocessingHopStatuses(values map[string]float64, progress entity.PreprocessingProgress) map[string]string {
	statuses := map[string]string{
		"bronze": "not_observed", "route": "not_observed",
		"lc-quality": "not_observed", "lc-transform": "not_observed", "lc-parquet": "not_observed",
		"tpf-quality": "not_observed", "tpf-transform": "not_observed", "tpf-parquet": "not_observed", "silver": "not_observed",
		"checkpoint": "not_observed", "lineage": "not_observed", "event": "not_observed", "ack": "not_observed",
	}
	if progress.BronzeObserved && progress.BronzeTotal > 0 {
		statuses["bronze"] = observedComponentStatus(values, true)
		statuses["route"] = observedComponentStatus(values, true)
	}
	lcObserved := progress.CompletedLightCurves > 0 || progress.SilverLightCurves > 0 || values["lc_input_rate"] > 0 || values["lc_output_rate"] > 0
	tpfObserved := progress.CompletedTargetPixels > 0 || progress.SilverTargetPixels > 0 || values["tpf_input_rate"] > 0 || values["tpf_output_rate"] > 0
	for _, id := range []string{"lc-quality", "lc-transform", "lc-parquet"} {
		statuses[id] = observedComponentStatus(values, lcObserved)
	}
	for _, id := range []string{"tpf-quality", "tpf-transform", "tpf-parquet"} {
		statuses[id] = observedComponentStatus(values, tpfObserved)
	}
	if progress.FootprintObserved && progress.SilverTotal > 0 {
		statuses["silver"] = observedComponentStatus(values, true)
	}
	if progress.CheckpointTotal > 0 && progress.CheckpointPending == 0 {
		statuses["checkpoint"] = "completed"
	} else if progress.CheckpointPending > 0 && values["inflight"] > 0 {
		statuses["checkpoint"] = "running"
	}
	lineageObserved := progress.CheckpointCompleted > 0 && progress.SilverTotal > 0 && len(progress.MaterializationPoints) == progress.SilverTotal
	if lineageObserved {
		for _, point := range progress.MaterializationPoints {
			if !point.LineageBound {
				lineageObserved = false
				break
			}
		}
	}
	statuses["lineage"] = observedComponentStatus(values, lineageObserved)
	eventObserved := progress.SilverEventObserved && progress.SilverEventMessages >= int64(progress.SilverTotal) && progress.SilverTotal > 0
	statuses["event"] = observedComponentStatus(values, eventObserved)
	ackObserved := progress.BronzeConsumerObserved && progress.BronzeAckFloorStream > 0
	statuses["ack"] = observedComponentStatus(values, ackObserved)
	return statuses
}

func observedComponentStatus(values map[string]float64, observed bool) string {
	if !observed {
		return "not_observed"
	}
	if values["errors"] > 0 {
		return "retry"
	}
	if values["inflight"] > 0 || values["queue"] > 0 || values["throughput"] > 0 {
		return "running"
	}
	return "completed"
}

func boolToMetric(value bool) float64 {
	if value {
		return 1
	}
	return 0
}

func timeToMetric(value time.Time) float64 {
	if value.IsZero() {
		return 0
	}
	return float64(value.Unix())
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

func optionalUint64Value(value *uint64) uint64 {
	if value == nil {
		return 0
	}
	return *value
}
