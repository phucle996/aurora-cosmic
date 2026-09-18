package service

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
	"sort"
	"strings"
	"sync"
	"time"

	"go-api/internal/domain/entity"
	"go-api/internal/domain/repo"
	domainService "go-api/internal/domain/service"
	"go-api/internal/provider"
)

// ============================================================================
// INGEST SERVICE (Dịch vụ điều phối & giám sát quá trình thu thập dữ liệu)
// ============================================================================
// IngestService chịu trách nhiệm:
// 1. Kích hoạt (Start) hoặc Hủy bỏ (Cancel) tiến trình tải dữ liệu thiên văn từ NASA MAST.
// 2. Theo dõi trạng thái tiến trình thời gian thực qua Checkpoint MinIO và Metrics Prometheus.
// 3. Quản lý danh sách đối tượng lưu trữ trong vùng đệm MinIO Bronze (~50 GiB).
type storageCacheEntry struct {
	cachedAt   time.Time
	objects    []provider.ObjectInfo
	totalBytes int64
}

type IngestService struct {
	objects      provider.ObjectStorage        // Storage đọc ghi MinIO S3
	prometheus   repo.PrometheusQuerier        // Truy vấn metrics tốc độ throughput từ Prometheus
	bucket       string                        // Tên bucket MinIO (mặc định: "aurora")
	controller   repo.IngestController         // Controller điều khiển Go Ingester worker
	publisher    provider.EventPublisher       // Publisher phát sự kiện lifecycle workflow
	runtimeMu    sync.RWMutex                  // Khóa đồng bộ trạng thái runtime trong bộ nhớ
	runtimeJob   *entity.IngestControlJob      // Thông tin job điều khiển đang chạy
	runtime      *entity.IngestStatus          // Snapshot trạng thái thu thập gần nhất
	cachedRunID  string                        // ID đợt thu thập đã parse và lưu bộ nhớ đệm
	cachedStatus *entity.IngestStatus          // Trạng thái đã parse sẵn của checkpoint MinIO
	storageCache map[string]*storageCacheEntry // Bộ đệm cache danh sách MinIO theo prefix (TTL 10s)
}

// ============================================================================
// DTO CHECKPOINT TIẾN TRÌNH THU THẬP (Ingestion Checkpoint DTO)
// ============================================================================
// ingestionCheckpoint ánh xạ nội dung file JSON checkpoint lưu tại:
// s3://aurora/checkpoints/ingestion/runs/<run_id>.json
type ingestionCheckpoint struct {
	RunID        string                      `json:"run_id"`        // Mã định danh đợt thu thập (VD: run-2026-s42)
	Status       string                      `json:"status"`        // Trạng thái: RUNNING, COMPLETED, FAILED, CANCELED
	ManifestPath string                      `json:"manifest_path"` // Đường dẫn tới manifest kế hoạch thu thập
	StartedAt    time.Time                   `json:"started_at"`    // Thời điểm bắt đầu
	UpdatedAt    time.Time                   `json:"updated_at"`    // Thời điểm cập nhật checkpoint gần nhất
	Products     map[string]ingestionProduct `json:"products"`      // Danh sách trạng thái từng file FITS đang tải
}

// ingestionProduct lưu trạng thái chi tiết của từng file dữ liệu (Light Curve / TPF FITS)
type ingestionProduct struct {
	ProductKind       string    `json:"product_kind"`         // Loại sản phẩm: light_curve, target_pixel, ffi
	ObjectKey         string    `json:"object_key"`           // Khóa lưu trữ S3 (VD: bronze/sector-42/..._lc.fits)
	ExpectedSizeBytes int64     `json:"expected_size_bytes"`  // Kích thước dự kiến từ catalog MAST
	SizeBytes         int64     `json:"size_bytes"`           // Số bytes thực tế đã tải về
	State             string    `json:"state"`                // Trạng thái: DOWNLOADING, STORED, PUBLISHED, FAILED
	Attempts          int       `json:"attempts"`             // Số lần đã thử tải lại
	LastError         string    `json:"last_error,omitempty"` // Lỗi chi tiết nếu thất bại
	UpdatedAt         time.Time `json:"updated_at"`           // Thời gian cập nhật trạng thái
}

// applyPlanningStatus promotes an active control run to planning only while the
// durable catalog or manifest protocol reports that it is still in progress.
// The API owns this workflow-state mapping; clients must render Status as-is.
func applyPlanningStatus(status *entity.IngestStatus, controlJob *entity.IngestControlJob) {
	if status == nil || controlJob == nil || !strings.EqualFold(controlJob.Status, "running") {
		return
	}
	isPlanning := func(state string) bool {
		switch strings.ToLower(state) {
		case "planned", "running":
			return true
		default:
			return false
		}
	}
	if (status.CatalogProgress != nil && isPlanning(status.CatalogProgress.State)) ||
		(status.ManifestProgress != nil && isPlanning(status.ManifestProgress.State)) {
		status.Status = "planning"
	}
}

func (s *IngestService) attachPlanningProgress(ctx context.Context, status *entity.IngestStatus, controlJob *entity.IngestControlJob) {
	if status == nil || controlJob == nil || !strings.EqualFold(controlJob.Status, "running") {
		return
	}
	if payload, catalogErr := s.objects.GetObject(ctx, "control/ingest/catalog-status.json"); catalogErr == nil {
		var catalogProgress entity.IngestCatalogProgress
		if json.Unmarshal(payload, &catalogProgress) == nil && catalogProgress.State != "" {
			status.CatalogProgress = &catalogProgress
		}
	}
	if payload, manifestErr := s.objects.GetObject(ctx, "control/ingest/manifest-status.json"); manifestErr == nil {
		var manifestProgress entity.IngestManifestProgress
		if json.Unmarshal(payload, &manifestProgress) == nil && manifestProgress.State != "" {
			status.ManifestProgress = &manifestProgress
		}
	}
}

// NewIngestService khởi tạo thể hiện duy nhất của IngestService
func NewIngestService(
	objects provider.ObjectStorage,
	prometheus repo.PrometheusQuerier,
	bucket string,
	controller repo.IngestController,
	publisher provider.EventPublisher,
) domainService.Ingest {
	return &IngestService{
		objects:      objects,
		prometheus:   prometheus,
		bucket:       bucket,
		controller:   controller,
		publisher:    publisher,
		storageCache: make(map[string]*storageCacheEntry),
	}
}

// ============================================================================
// HÀM KHỞI CHẠY TIẾN TRÌNH THU THẬP (Start Ingestion)
// ============================================================================
// Start gửi lệnh khởi động một đợt thu thập dữ liệu mới tới Go Ingester
// và phát sự kiện workflow vào event bus.
func (s *IngestService) Start(ctx context.Context, request entity.IngestStartRequest) (*entity.IngestControlJob, error) {
	// 1. Gọi controller để kích hoạt Ingester worker
	job, err := s.controller.Start(ctx, request)
	if err != nil {
		if strings.Contains(err.Error(), "409") || strings.Contains(err.Error(), "already running") {
			return nil, entity.ErrIngestAlreadyRunning
		}
		return nil, err
	}
	if job == nil || job.JobID == "" {
		return nil, fmt.Errorf("ingester controller returned invalid job")
	}

	// 2. Phát sự kiện workflow (sai thì fail, không fallback)
	topic := "ingest"
	if job.TicketID != "" {
		topic = "ingest:" + job.TicketID
	}
	data, err := json.Marshal(map[string]any{
		"job_id":      job.JobID,
		"ticket_id":   job.TicketID,
		"status":      strings.ToLower(job.Status),
		"occurred_at": job.UpdatedAt,
		"payload":     job,
	})
	if err != nil {
		return nil, fmt.Errorf("marshal ingest start event: %w", err)
	}
	if s.publisher != nil {
		if err := s.publisher.Publish(ctx, topic, provider.Event{
			Type:  "workflow",
			Topic: topic,
			Data:  data,
		}); err != nil {
			return nil, fmt.Errorf("publish ingest start event: %w", err)
		}
	}

	// 3. Cập nhật trạng thái runtime trong bộ nhớ
	s.runtimeMu.Lock()
	s.runtimeJob = job
	s.cachedRunID = ""
	s.cachedStatus = nil
	s.runtime = &entity.IngestStatus{
		Observed:     false,
		TicketID:     job.TicketID,
		Status:       strings.ToLower(job.Status),
		ManifestPath: job.ManifestPath,
		StartedAt:    job.StartedAt,
		UpdatedAt:    job.UpdatedAt,
		ObservedAt:   time.Now().UTC(),
		Products:     []entity.IngestProduct{},
		ProductKinds: make(map[string]entity.IngestKindSummary),
	}
	s.runtimeMu.Unlock()

	return job, nil
}

// ============================================================================
// HÀM HỦY BỎ TIẾN TRÌNH (Cancel Ingestion)
// ============================================================================
// Cancel requests a graceful stop. The ingester drains products already owned
// by workers before it reports the terminal stopped state.
func (s *IngestService) Cancel(ctx context.Context, jobID string) (*entity.IngestControlJob, error) {
	jobID = strings.TrimSpace(jobID)
	if jobID == "" || jobID == "current" || jobID == "active" {
		s.runtimeMu.RLock()
		if s.runtimeJob != nil && s.runtimeJob.JobID != "" {
			jobID = s.runtimeJob.JobID
		} else {
			jobID = "active"
		}
		s.runtimeMu.RUnlock()
	}

	job, err := s.controller.Cancel(ctx, jobID)
	if err != nil {
		if strings.Contains(err.Error(), "404") || strings.Contains(err.Error(), "not found") {
			return nil, entity.ErrIngestJobNotFound
		}
		return nil, fmt.Errorf("cancel ingestion job %s: %w", jobID, err)
	}
	if job == nil || job.JobID == "" {
		return nil, fmt.Errorf("ingester returned no cancellation state for job %s", jobID)
	}

	topic := "ingest"
	if job.TicketID != "" {
		topic = "ingest:" + job.TicketID
	}
	data, err := json.Marshal(map[string]any{
		"job_id":      job.JobID,
		"ticket_id":   job.TicketID,
		"status":      strings.ToLower(job.Status),
		"occurred_at": job.UpdatedAt,
		"payload":     job,
	})
	if err != nil {
		return nil, fmt.Errorf("marshal ingest cancel event: %w", err)
	}
	if s.publisher != nil {
		if err := s.publisher.Publish(ctx, topic, provider.Event{
			Type:  "workflow",
			Topic: topic,
			Data:  data,
		}); err != nil {
			return nil, fmt.Errorf("publish ingest cancel event: %w", err)
		}
	}

	s.runtimeMu.Lock()
	s.runtimeJob = job
	s.cachedStatus = nil
	if s.runtime != nil {
		s.runtime.Status = strings.ToLower(job.Status)
		s.runtime.UpdatedAt = job.UpdatedAt
		s.runtime.ObservedAt = time.Now().UTC()
	}
	s.runtimeMu.Unlock()

	return job, nil
}

// ============================================================================
// HÀM TRUY VẤN TRẠNG THÁI TIẾN TRÌNH (Ingestion Status & Telemetry)
// ============================================================================
// Status tổng hợp trạng thái từ:
// 1. Runtime controller hiện tại.
// 2. File checkpoint bền vững trong MinIO (`checkpoints/ingestion/current.json`).
// 3. Prometheus metrics tốc độ tải (throughput pts/s, bytes/s, hàng đợi).
func (s *IngestService) Status(ctx context.Context) (*entity.IngestStatus, error) {
	var controlJob *entity.IngestControlJob
	if runtimeController, ok := s.controller.(repo.IngestRuntimeController); ok {
		if current, currentErr := runtimeController.Current(ctx); currentErr == nil && current != nil && current.Status != "not_observed" {
			controlJob = current
			s.runtimeMu.Lock()
			s.runtimeJob = current
			ticketID := current.TicketID
			if ticketID == "" {
				ticketID = current.JobID
			}
			if s.runtime == nil || current.StartedAt.After(s.runtime.StartedAt) {
				s.runtime = &entity.IngestStatus{
					Observed:     false,
					TicketID:     ticketID,
					Status:       strings.ToLower(current.Status),
					Error:        current.Error,
					ManifestPath: current.ManifestPath,
					StartedAt:    current.StartedAt,
					UpdatedAt:    current.UpdatedAt,
					ObservedAt:   time.Now().UTC(),
					Products:     []entity.IngestProduct{},
					ProductKinds: make(map[string]entity.IngestKindSummary),
				}
			} else {
				s.runtime.Status = strings.ToLower(current.Status)
				s.runtime.Error = current.Error
				s.runtime.UpdatedAt = current.UpdatedAt
				s.runtime.ObservedAt = time.Now().UTC()
			}
			s.runtimeMu.Unlock()
		}
	}

	// 1. Kiểm tra cache đối tượng checkpoint từ MinIO: checkpoints/ingestion/current.json
	data, err := s.objects.GetObject(ctx, "checkpoints/ingestion/current.json")
	if err != nil {
		s.runtimeMu.RLock()
		if s.runtime != nil {
			cached := *s.runtime
			s.runtimeMu.RUnlock()
			s.attachPlanningProgress(ctx, &cached, controlJob)
			applyPlanningStatus(&cached, controlJob)
			return &cached, nil
		}
		s.runtimeMu.RUnlock()
		status := &entity.IngestStatus{Observed: false, Status: "not_observed", ObservedAt: time.Now().UTC()}
		return status, nil
	}

	// 2. Đọc run_id đang hoạt động
	var pointer struct {
		ActiveRunID string `json:"active_run_id"`
	}
	if err := json.Unmarshal(data, &pointer); err != nil || pointer.ActiveRunID == "" {
		return nil, fmt.Errorf("decode ingestion checkpoint pointer: %w", err)
	}

	s.runtimeMu.RLock()
	cachedStatus := s.cachedStatus
	cachedRunID := s.cachedRunID
	runtimeSnapshot := s.runtime
	s.runtimeMu.RUnlock()

	var status *entity.IngestStatus
	usingRuntimeState := false

	// Tối ưu overhead: Tái sử dụng checkpoint đã parse nếu run đã hoàn thành
	if cachedStatus != nil && cachedRunID == pointer.ActiveRunID &&
		(cachedStatus.Status == "completed" || cachedStatus.Status == "published" || cachedStatus.Status == "stopped") {
		cloned := *cachedStatus
		cloned.ObservedAt = time.Now().UTC()
		status = &cloned
	} else {
		// 3. Đọc chi tiết checkpoint đợt thu thập: checkpoints/ingestion/runs/<run_id>.json
		data, err = s.objects.GetObject(ctx, "checkpoints/ingestion/runs/"+pointer.ActiveRunID+".json")
		if err != nil {
			return nil, fmt.Errorf("load ingestion run %s: %w", pointer.ActiveRunID, err)
		}

		var checkpoint ingestionCheckpoint
		if err := json.Unmarshal(data, &checkpoint); err != nil {
			return nil, fmt.Errorf("decode ingestion run %s: %w", pointer.ActiveRunID, err)
		}

		// 4. Tổng hợp các thông số sản phẩm tải về (bytes, số file thành công/thất bại)
		status = &entity.IngestStatus{
			Observed:     true,
			RunID:        checkpoint.RunID,
			Status:       strings.ToLower(checkpoint.Status),
			ManifestPath: checkpoint.ManifestPath,
			StartedAt:    checkpoint.StartedAt,
			UpdatedAt:    checkpoint.UpdatedAt,
			ObservedAt:   time.Now().UTC(),
			Products:     make([]entity.IngestProduct, 0, len(checkpoint.Products)),
			ProductKinds: make(map[string]entity.IngestKindSummary),
		}
		if controlJob != nil {
			if controlJob.TicketID != "" {
				status.TicketID = controlJob.TicketID
			} else if controlJob.JobID != "" {
				status.TicketID = controlJob.JobID
			}
		}

		if runtimeSnapshot != nil && controlJob != nil && runtimeSnapshot.StartedAt.After(checkpoint.UpdatedAt) {
			usingRuntimeState = true
			status = &entity.IngestStatus{
				Observed:     true,
				TicketID:     runtimeSnapshot.TicketID,
				Status:       runtimeSnapshot.Status,
				Error:        runtimeSnapshot.Error,
				ManifestPath: runtimeSnapshot.ManifestPath,
				StartedAt:    runtimeSnapshot.StartedAt,
				UpdatedAt:    runtimeSnapshot.UpdatedAt,
				ObservedAt:   time.Now().UTC(),
				Products:     []entity.IngestProduct{},
				ProductKinds: make(map[string]entity.IngestKindSummary),
			}
		}

		if !usingRuntimeState {
			for id, product := range checkpoint.Products {
				kind := string(product.ProductKind)
				kindSummary := status.ProductKinds[kind]
				kindSummary.Planned++
				status.TotalProducts++
				expectedSize := product.ExpectedSizeBytes
				if expectedSize <= 0 && (strings.EqualFold(product.State, "STORED") || strings.EqualFold(product.State, "PUBLISHED")) {
					expectedSize = product.SizeBytes
				}
				status.ExpectedBytes += expectedSize
				status.CompletedBytes += product.SizeBytes
				switch strings.ToUpper(product.State) {
				case "STORED", "PUBLISHED":
					status.CompletedProducts++
					kindSummary.Completed++
				case "DOWNLOADING":
					status.Downloading++
					kindSummary.Downloading++
				case "FAILED":
					status.FailedProducts++
					kindSummary.Failed++
				}
				status.ProductKinds[kind] = kindSummary
				status.Products = append(status.Products, entity.IngestProduct{
					ID:        id,
					Kind:      string(product.ProductKind),
					ObjectKey: product.ObjectKey,
					State:     strings.ToLower(product.State),
					SizeBytes: product.SizeBytes,
					Expected:  expectedSize,
					Attempts:  product.Attempts,
					LastError: product.LastError,
					UpdatedAt: product.UpdatedAt,
				})
			}
			if (status.Status == "completed" || status.Status == "published") && status.ExpectedBytes <= 0 {
				status.ExpectedBytes = status.CompletedBytes
			}
			sort.Slice(status.Products, func(i, j int) bool { return status.Products[i].UpdatedAt.After(status.Products[j].UpdatedAt) })

			s.runtimeMu.Lock()
			s.cachedRunID = pointer.ActiveRunID
			s.cachedStatus = status
			s.runtimeMu.Unlock()
		}
	}

	// Đảm bảo trạng thái hủy bỏ (Cancel) từ control plane được ưu tiên hiển thị ngay
	if controlJob != nil {
		if controlJob.TicketID != "" {
			status.TicketID = controlJob.TicketID
		} else if controlJob.JobID != "" && status.TicketID == "" {
			status.TicketID = controlJob.JobID
		}
		status.Status = strings.ToLower(controlJob.Status)
		status.Error = controlJob.Error
		if controlJob.UpdatedAt.After(status.UpdatedAt) {
			status.UpdatedAt = controlJob.UpdatedAt
		}
	} else if status.Status == "running" && !status.UpdatedAt.IsZero() && time.Since(status.UpdatedAt) > 20*time.Second {
		// Nếu checkpoint ghi là running nhưng controller thực tế không có job nào đang chạy
		// và checkpoint đã ngưng cập nhật quá 20 giây, đánh dấu tiến trình đã dừng
		status.Status = "stopped"
		status.Downloading = 0
	}

	// Chỉ đọc planning khi job đang running
	s.attachPlanningProgress(ctx, status, controlJob)
	applyPlanningStatus(status, controlJob)
	if status.Status != "planning" {
		status.CatalogProgress = nil
		status.ManifestProgress = nil
	}

	// Prometheus metrics chỉ truy vấn khi status là running hoặc draining
	if s.prometheus != nil && (status.Status == "running" || status.Status == "draining") {
		end := time.Now().UTC()
		start := end.Add(-2 * time.Minute)
		queries := map[string]string{
			"products": "sum(rate(aurora_ingester_products_total{status=\"success\"}[2m]))",
			"bytes":    "rate(aurora_ingester_bytes_processed_total[2m])",
			"queue":    "aurora_ingester_queue_depth",
			"inflight": "aurora_ingester_inflight_products",
		}
		var wg sync.WaitGroup
		var mu sync.Mutex
		values := make(map[string]float64, len(queries))
		for key, query := range queries {
			key, query := key, query
			wg.Add(1)
			go func() {
				defer wg.Done()
				points, queryErr := s.prometheus.QueryRange(ctx, query, start, end, time.Minute)
				if queryErr != nil || len(points) == 0 {
					return
				}
				mu.Lock()
				values[key] = points[len(points)-1].Value
				mu.Unlock()
			}()
		}
		wg.Wait()
		status.ProductsPerSecond = values["products"]
		status.BytesPerSecond = values["bytes"]
		status.QueueDepth = int(math.Round(values["queue"]))
		status.InflightProducts = int(math.Round(values["inflight"]))
	}
	// Prometheus is scrape-based and can lag the durable checkpoint by one or
	// more intervals. A product marked DOWNLOADING is authoritative evidence of
	// an active worker, so never report fewer active workers than the checkpoint.
	if status.Downloading > status.InflightProducts {
		status.InflightProducts = status.Downloading
	}
	if status.Status == "completed" || status.Status == "published" || status.Status == "stopped" {
		status.Downloading = 0
		status.InflightProducts = 0
		status.QueueDepth = 0
	}

	s.runtimeMu.Lock()
	s.runtime = status
	if controlJob != nil {
		s.runtimeJob = controlJob
	}
	s.runtimeMu.Unlock()
	return status, nil
}

// ============================================================================
// HÀM DUYỆT BỘ NHỚ ĐỆM MEDALLION (Lakehouse Catalog & Storage Listing)
// ============================================================================
// Storage phân trang danh sách các file FITS thô, Parquet Silver và Snapshot Gold,
// Storage returns the current physical inventory in MinIO.  ClickHouse remains
// useful for search-oriented metadata, but is an eventually-consistent index:
// it can contain multiple historical rows for one object before merges finish.
// Operator-facing tier counts and bytes must therefore never be sourced from it.
func (s *IngestService) Storage(ctx context.Context, prefix string, page, limit int) (*entity.StorageListing, error) {
	prefix = strings.TrimSpace(prefix)
	if prefix == "" {
		prefix = "bronze/"
	}
	if limit <= 0 || limit > 200 {
		limit = 100
	}
	if page < 1 {
		page = 1
	}

	var allObjects []provider.ObjectInfo
	var totalBytes int64

	s.runtimeMu.Lock()
	cached, ok := s.storageCache[prefix]
	if ok && time.Since(cached.cachedAt) < 15*time.Second {
		allObjects = cached.objects
		totalBytes = cached.totalBytes
	}
	s.runtimeMu.Unlock()

	if allObjects == nil {
		objects, err := s.objects.ListObjects(ctx, prefix)
		if err != nil {
			return nil, err
		}

		sort.Slice(objects, func(i, j int) bool { return objects[i].LastModified.After(objects[j].LastModified) })

		for _, object := range objects {
			if strings.HasPrefix(prefix, "bronze/") && !isProcessableBronzeFITS(object.Key) {
				continue
			}
			totalBytes += object.Size
			allObjects = append(allObjects, object)
		}

		s.runtimeMu.Lock()
		s.storageCache[prefix] = &storageCacheEntry{
			cachedAt:   time.Now().UTC(),
			objects:    allObjects,
			totalBytes: totalBytes,
		}
		s.runtimeMu.Unlock()
	}

	start := (page - 1) * limit
	if start > len(allObjects) {
		start = len(allObjects)
	}
	end := start + limit
	if end > len(allObjects) {
		end = len(allObjects)
	}

	sliced := allObjects[start:end]
	items := make([]entity.StorageObject, len(sliced))
	for i, object := range sliced {
		items[i] = entity.StorageObject{
			Key:          object.Key,
			SizeBytes:    object.Size,
			ETag:         object.ETag,
			LastModified: object.LastModified,
		}
	}

	listing := &entity.StorageListing{
		Bucket:     s.bucket,
		Prefix:     prefix,
		Page:       page,
		PageSize:   limit,
		Total:      len(allObjects),
		TotalBytes: totalBytes,
		Truncated:  end < len(allObjects),
		Objects:    items,
	}

	return listing, nil
}

func isProcessableBronzeFITS(key string) bool {
	key = strings.ToLower(strings.TrimSpace(key))
	return strings.HasSuffix(key, ".fits") || strings.HasSuffix(key, ".fit") ||
		strings.HasSuffix(key, ".fits.gz") || strings.HasSuffix(key, ".fit.gz")
}

