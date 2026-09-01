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
	objects    []repo.ObjectInfo
	totalBytes int64
}

type IngestService struct {
	objects      repo.ObjectRepository           // Repository đọc ghi MinIO S3
	catalog      repo.LakehouseCatalogRepository // Repository ClickHouse Lakehouse Catalog (Sub-ms lookup)
	prometheus   repo.PrometheusQuerier          // Truy vấn metrics tốc độ throughput từ Prometheus
	bucket       string                          // Tên bucket MinIO (mặc định: "aurora")
	controller   repo.IngestController           // Controller điều khiển Go Ingester worker
	publisher    repo.EventPublisher             // Publisher phát sự kiện lifecycle workflow
	runtimeMu    sync.RWMutex                    // Khóa đồng bộ trạng thái runtime trong bộ nhớ
	runtimeJob   *entity.IngestControlJob        // Thông tin job điều khiển đang chạy
	runtime      *entity.IngestStatus            // Snapshot trạng thái thu thập gần nhất
	storageCache map[string]*storageCacheEntry   // Bộ đệm cache danh sách MinIO theo prefix (TTL 10s)
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

// NewIngestService khởi tạo thể hiện của IngestService
func NewIngestService(objects repo.ObjectRepository, prometheus repo.PrometheusQuerier, bucket string, controllers ...repo.IngestController) domainService.Ingest {
	var controller repo.IngestController
	if len(controllers) > 0 {
		controller = controllers[0]
	}
	return &IngestService{objects: objects, prometheus: prometheus, bucket: bucket, controller: controller, storageCache: make(map[string]*storageCacheEntry)}
}

// NewIngestServiceWithEvents khởi tạo thể hiện IngestService có kèm EventPublisher
func NewIngestServiceWithEvents(objects repo.ObjectRepository, prometheus repo.PrometheusQuerier, bucket string, controller repo.IngestController, publisher repo.EventPublisher) domainService.Ingest {
	return &IngestService{objects: objects, prometheus: prometheus, bucket: bucket, controller: controller, publisher: publisher, storageCache: make(map[string]*storageCacheEntry)}
}

// NewIngestServiceWithCatalogAndEvents khởi tạo thể hiện IngestService tích hợp ClickHouse Catalog
func NewIngestServiceWithCatalogAndEvents(objects repo.ObjectRepository, catalog repo.LakehouseCatalogRepository, prometheus repo.PrometheusQuerier, bucket string, controller repo.IngestController, publisher repo.EventPublisher) domainService.Ingest {
	svc := &IngestService{
		objects:      objects,
		catalog:      catalog,
		prometheus:   prometheus,
		bucket:       bucket,
		controller:   controller,
		publisher:    publisher,
		storageCache: make(map[string]*storageCacheEntry),
	}
	go svc.runPeriodicCatalogSync()
	return svc
}

// ============================================================================
// HÀM KHỞI CHẠY TIẾN TRÌNH THU THẬP (Start Ingestion)
// ============================================================================
// Start gửi lệnh khởi động một đợt thu thập dữ liệu mới tới Go Ingester
// và phát sự kiện workflow vào event bus.
func (s *IngestService) Start(ctx context.Context, request entity.IngestStartRequest) (*entity.IngestControlJob, error) {
	if s.controller == nil {
		return nil, fmt.Errorf("ingester control is unavailable")
	}

	// 1. Gọi controller để kích hoạt Ingester worker
	job, err := s.controller.Start(ctx, request)
	if err != nil {
		return nil, err
	}

	// 2. Phát sự kiện workflow (nếu có publisher)
	if s.publisher != nil {
		payload, _ := json.Marshal(job)
		_ = s.publisher.Publish(ctx, entity.WorkflowEvent{
			Type:       "workflow",
			Workflow:   "ingest",
			Status:     job.Status,
			JobID:      job.JobID,
			OccurredAt: job.UpdatedAt,
			Payload:    payload,
		})
	}

	// 3. Cập nhật trạng thái runtime trong bộ nhớ
	s.runtimeMu.Lock()
	s.runtimeJob = job
	s.runtime = &entity.IngestStatus{
		Observed:     true,
		Source:       "api-runtime",
		ControlJobID: job.JobID,
		Status:       strings.ToLower(job.Status),
		ManifestPath: job.ManifestPath,
		StartedAt:    job.StartedAt,
		UpdatedAt:    job.UpdatedAt,
		ObservedAt:   time.Now().UTC(),
		Products:     []entity.IngestProduct{},
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

	if s.controller == nil {
		return nil, fmt.Errorf("ingester control is unavailable")
	}
	job, err := s.controller.Cancel(ctx, jobID)
	if err != nil {
		return nil, fmt.Errorf("cancel ingestion job %s: %w", jobID, err)
	}
	if job == nil {
		return nil, fmt.Errorf("ingester returned no cancellation state for job %s", jobID)
	}

	// The ingester exclusively owns its durable checkpoint.  The API publishes
	// the acknowledged control result, but never fabricates or overwrites state.

	if s.publisher != nil {
		payload, _ := json.Marshal(job)
		_ = s.publisher.Publish(ctx, entity.WorkflowEvent{
			Type:       "workflow",
			Workflow:   "ingest",
			Status:     job.Status,
			JobID:      job.JobID,
			OccurredAt: job.UpdatedAt,
			Payload:    payload,
		})
	}

	s.runtimeMu.Lock()
	s.runtimeJob = job
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
	if s.objects == nil {
		return nil, fmt.Errorf("MinIO ingestion checkpoint is unavailable")
	}
	var catalogProgress entity.IngestCatalogProgress
	if payload, catalogErr := s.objects.GetObject(ctx, "control/ingest/catalog-status.json"); catalogErr == nil {
		if json.Unmarshal(payload, &catalogProgress) != nil {
			catalogProgress = entity.IngestCatalogProgress{}
		}
	}
	var manifestProgress entity.IngestManifestProgress
	if payload, manifestErr := s.objects.GetObject(ctx, "control/ingest/manifest-status.json"); manifestErr == nil {
		if json.Unmarshal(payload, &manifestProgress) != nil {
			manifestProgress = entity.IngestManifestProgress{}
		}
	}
	attachPlanningProgress := func(status *entity.IngestStatus) {
		if status == nil {
			return
		}
		if catalogProgress.State != "" {
			status.CatalogProgress = &catalogProgress
		}
		if manifestProgress.State != "" {
			status.ManifestProgress = &manifestProgress
		}
	}

	var controlJob *entity.IngestControlJob
	if runtimeController, ok := s.controller.(repo.IngestRuntimeController); ok {
		if current, currentErr := runtimeController.Current(ctx); currentErr == nil && current != nil && current.Status != "not_observed" {
			controlJob = current
			s.runtimeMu.Lock()
			s.runtimeJob = current
			if s.runtime == nil || current.StartedAt.After(s.runtime.StartedAt) {
				s.runtime = &entity.IngestStatus{
					Observed:     true,
					Source:       "ingester-control",
					ControlJobID: current.JobID,
					Status:       strings.ToLower(current.Status),
					Error:        current.Error,
					ManifestPath: current.ManifestPath,
					StartedAt:    current.StartedAt,
					UpdatedAt:    current.UpdatedAt,
					ObservedAt:   time.Now().UTC(),
					Products:     []entity.IngestProduct{},
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

	// 1. Đọc con trỏ checkpoint hiện tại từ MinIO: checkpoints/ingestion/current.json
	data, err := s.objects.GetObject(ctx, "checkpoints/ingestion/current.json")
	if err != nil {
		s.runtimeMu.RLock()
		if s.runtime != nil {
			cached := *s.runtime
			cached.Products = append([]entity.IngestProduct(nil), s.runtime.Products...)
			s.runtimeMu.RUnlock()
			attachPlanningProgress(&cached)
			applyPlanningStatus(&cached, controlJob)
			return &cached, nil
		}
		s.runtimeMu.RUnlock()
		status := &entity.IngestStatus{Observed: false, Source: "minio-checkpoint", Status: "not_observed", ObservedAt: time.Now().UTC()}
		return status, nil
	}

	// 2. Đọc run_id đang hoạt động
	var pointer struct {
		ActiveRunID string `json:"active_run_id"`
	}
	if err := json.Unmarshal(data, &pointer); err != nil || pointer.ActiveRunID == "" {
		return nil, fmt.Errorf("decode ingestion checkpoint pointer: %w", err)
	}

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
	status := &entity.IngestStatus{
		Observed:     true,
		Source:       "minio-checkpoint",
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
		status.ControlJobID = controlJob.JobID
	}

	usingRuntimeState := false
	s.runtimeMu.RLock()
	if s.runtime != nil && controlJob != nil && s.runtime.StartedAt.After(checkpoint.UpdatedAt) {
		usingRuntimeState = true
		status = &entity.IngestStatus{
			Observed:     true,
			Source:       "api-runtime",
			ControlJobID: s.runtime.ControlJobID,
			Status:       s.runtime.Status,
			Error:        s.runtime.Error,
			ManifestPath: s.runtime.ManifestPath,
			StartedAt:    s.runtime.StartedAt,
			UpdatedAt:    s.runtime.UpdatedAt,
			ObservedAt:   time.Now().UTC(),
			Products:     []entity.IngestProduct{},
		}
	}
	s.runtimeMu.RUnlock()
	attachPlanningProgress(status)

	if !usingRuntimeState {
		for id, product := range checkpoint.Products {
			kind := string(product.ProductKind)
			kindSummary := status.ProductKinds[kind]
			kindSummary.Planned++
			status.TotalProducts++
			status.ExpectedBytes += product.ExpectedSizeBytes
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
				Expected:  product.ExpectedSizeBytes,
				Attempts:  product.Attempts,
				LastError: product.LastError,
				UpdatedAt: product.UpdatedAt,
			})
		}
		sort.Slice(status.Products, func(i, j int) bool { return status.Products[i].UpdatedAt.After(status.Products[j].UpdatedAt) })
	}

	// Đảm bảo trạng thái hủy bỏ (Cancel) từ control plane được ưu tiên hiển thị ngay
	if controlJob != nil {
		status.ControlJobID = controlJob.JobID
		status.Status = strings.ToLower(controlJob.Status)
		status.Error = controlJob.Error
		if controlJob.UpdatedAt.After(status.UpdatedAt) {
			status.UpdatedAt = controlJob.UpdatedAt
		}
	} else if status.Status == "running" && s.controller != nil && !checkpoint.UpdatedAt.IsZero() && time.Since(checkpoint.UpdatedAt) > 20*time.Second {
		// Nếu checkpoint ghi là running nhưng controller thực tế không có job nào đang chạy
		// và checkpoint đã ngưng cập nhật quá 20 giây, đánh dấu tiến trình đã dừng
		status.Status = "stopped"
		status.Downloading = 0
	}
	applyPlanningStatus(status, controlJob)
	if status.Status != "planning" {
		// Planner documents are retained for audit, but must not make an idle or
		// completed run appear to have an active planning phase.
		status.CatalogProgress = nil
		status.ManifestProgress = nil
	}

	// Planning has no download workers yet, therefore its authoritative
	// telemetry is the durable catalog/manifest protocol. Avoid holding the
	// ticket-driven status endpoint on Prometheus while MAST is being queried.
	if s.prometheus != nil && (status.Status == "running" || status.Status == "draining") {
		end := time.Now().UTC()
		start := end.Add(-5 * time.Minute)
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
		status.QueueDepth = values["queue"]
		status.InflightProducts = values["inflight"]
	}
	// Prometheus is scrape-based and can lag the durable checkpoint by one or
	// more intervals. A product marked DOWNLOADING is authoritative evidence of
	// an active worker, so never report fewer active workers than the checkpoint.
	if checkpointInflight := float64(status.Downloading); checkpointInflight > status.InflightProducts {
		status.InflightProducts = checkpointInflight
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

	// MinIO is the authoritative S3 inventory.  The short cache bounds a full
	// listing cost while preserving the exact object count users operate on.
	if s.objects == nil {
		return nil, fmt.Errorf("MinIO storage is unavailable")
	}

	var allObjects []repo.ObjectInfo
	var totalBytes int64

	s.runtimeMu.Lock()
	if s.storageCache == nil {
		s.storageCache = make(map[string]*storageCacheEntry)
	}
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

// syncMinIOToCatalog tự động quét và nạp siêu dữ liệu từ MinIO vào ClickHouse Catalog
func (s *IngestService) syncMinIOToCatalog() {
	if s.catalog == nil || s.objects == nil {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()

	_ = s.catalog.EnsureSchema(ctx)

	for _, tier := range []string{"bronze/", "silver/", "gold/"} {
		objs, err := s.objects.ListObjects(ctx, tier)
		if err != nil || len(objs) == 0 {
			continue
		}

		batch := make([]repo.CatalogObject, 0, 500)
		for _, o := range objs {
			tierName := "bronze"
			if strings.HasPrefix(o.Key, "silver/") {
				tierName = "silver"
			} else if strings.HasPrefix(o.Key, "gold/") {
				tierName = "gold"
			}

			// Unknown paths must never be attributed to a real observing sector.
			var sector int32
			var ticID int64 = 0
			if idx := strings.Index(o.Key, "tic="); idx != -1 {
				end := strings.IndexAny(o.Key[idx+4:], "/._-")
				if end != -1 {
					var val int64
					fmt.Sscanf(o.Key[idx+4:idx+4+end], "%d", &val)
					ticID = val
				}
			}
			if idx := strings.Index(o.Key, "sector="); idx != -1 {
				end := strings.IndexAny(o.Key[idx+7:], "/._-")
				if end != -1 {
					var val int32
					fmt.Sscanf(o.Key[idx+7:idx+7+end], "%d", &val)
					sector = val
				}
			}

			cleanEtag := strings.Trim(o.ETag, "\"")
			batch = append(batch, repo.CatalogObject{
				Tier:         tierName,
				ObjectKey:    o.Key,
				SizeBytes:    o.Size,
				ETag:         cleanEtag,
				Sector:       sector,
				TICID:        ticID,
				ProductType:  "lakehouse_file",
				LastModified: o.LastModified,
			})

			if len(batch) >= 500 {
				_ = s.catalog.UpsertObjects(ctx, batch)
				batch = batch[:0]
			}
		}
		if len(batch) > 0 {
			_ = s.catalog.UpsertObjects(ctx, batch)
		}
	}
}

// runPeriodicCatalogSync runs syncMinIOToCatalog immediately on startup, then
// every 2 minutes so the Datasets page always reflects the current lakehouse state.
func (s *IngestService) runPeriodicCatalogSync() {
	const interval = 2 * time.Minute
	s.syncMinIOToCatalog()
	for range time.Tick(interval) {
		s.syncMinIOToCatalog()
		// Invalidate the MinIO fallback cache so the next Storage() call
		// re-reads from ClickHouse (or fresh MinIO list) instead of stale data.
		s.runtimeMu.Lock()
		s.storageCache = make(map[string]*storageCacheEntry)
		s.runtimeMu.Unlock()
	}
}
