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
// Cancel gửi tín hiệu dừng khẩn cấp một tác vụ thu thập đang chạy.
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

	var job *entity.IngestControlJob
	if s.controller != nil {
		job, _ = s.controller.Cancel(ctx, jobID)
	}
	if job == nil {
		job = &entity.IngestControlJob{
			JobID:     jobID,
			Status:    "canceled",
			StartedAt: time.Now().UTC(),
			UpdatedAt: time.Now().UTC(),
		}
	}

	// Cập nhật ngay file Checkpoint trong MinIO sang trạng thái CANCELED
	if s.objects != nil {
		if data, err := s.objects.GetObject(ctx, "checkpoints/ingestion/current.json"); err == nil {
			var pointer struct {
				ActiveRunID string `json:"active_run_id"`
			}
			if json.Unmarshal(data, &pointer) == nil && pointer.ActiveRunID != "" {
				runKey := "checkpoints/ingestion/runs/" + pointer.ActiveRunID + ".json"
				if runData, err := s.objects.GetObject(ctx, runKey); err == nil {
					var cp ingestionCheckpoint
					if json.Unmarshal(runData, &cp) == nil {
						cp.Status = "CANCELED"
						cp.UpdatedAt = time.Now().UTC()
						for k, p := range cp.Products {
							if strings.EqualFold(p.State, "DOWNLOADING") {
								p.State = "FAILED"
								p.LastError = "ingestion canceled by user"
								p.UpdatedAt = time.Now().UTC()
								cp.Products[k] = p
							}
						}
						if updatedData, err := json.Marshal(cp); err == nil {
							_ = s.objects.PutObject(ctx, runKey, updatedData, "application/json")
						}
					}
				}
			}
		}
	}

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
		s.runtime.Downloading = 0
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
			return &cached, nil
		}
		s.runtimeMu.RUnlock()
		return &entity.IngestStatus{Observed: false, Source: "minio-checkpoint", Status: "not_observed", ObservedAt: time.Now().UTC()}, nil
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

	if !usingRuntimeState {
		for id, product := range checkpoint.Products {
			status.TotalProducts++
			status.ExpectedBytes += product.ExpectedSizeBytes
			status.CompletedBytes += product.SizeBytes
			switch strings.ToUpper(product.State) {
			case "STORED", "PUBLISHED":
				status.CompletedProducts++
			case "DOWNLOADING":
				status.Downloading++
			case "FAILED":
				status.FailedProducts++
			}
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
	} else if status.Status == "running" && s.controller != nil && controlJob == nil && !checkpoint.UpdatedAt.IsZero() && time.Since(checkpoint.UpdatedAt) > 20*time.Second {
		// Nếu checkpoint ghi là running nhưng controller thực tế không có job nào đang chạy
		// và checkpoint đã ngưng cập nhật quá 20 giây, đánh dấu tiến trình đã dừng
		status.Status = "stopped"
		status.Downloading = 0
	}

	// 5. Truy vấn telemetry từ Prometheus nếu tiến trình đang chạy
	if s.prometheus != nil && status.Status == "running" {
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
// ưu tiên truy vấn siêu tốc (<1ms) từ ClickHouse Lakehouse Metadata Catalog,
// và tự động fallback sang MinIO Object Storage nếu catalog chưa sẵn sàng.
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

	tier := "bronze"
	if strings.HasPrefix(prefix, "silver") {
		tier = "silver"
	} else if strings.HasPrefix(prefix, "gold") {
		tier = "gold"
	}

	// 1. Truy vấn siêu tốc từ ClickHouse Lakehouse Metadata Catalog (<1ms)
	if s.catalog != nil {
		items, total, totalBytes, err := s.catalog.ListObjects(ctx, tier, prefix, page, limit)
		if err == nil && total > 0 {
			objects := make([]entity.StorageObject, len(items))
			for i, o := range items {
				objects[i] = entity.StorageObject{
					Key:          o.ObjectKey,
					SizeBytes:    o.SizeBytes,
					ETag:         o.ETag,
					LastModified: o.LastModified,
				}
			}
			return &entity.StorageListing{
				Bucket:     s.bucket,
				Prefix:     prefix,
				Page:       page,
				PageSize:   limit,
				Total:      int(total),
				TotalBytes: totalBytes,
				Truncated:  (page * limit) < int(total),
				Objects:    objects,
			}, nil
		}
	}

	// 2. Fallback sang MinIO S3 Object Storage (khi Catalog đang khởi tạo)
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
			totalBytes += object.Size
		}
		allObjects = objects

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

			var sector int32 = 42
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
