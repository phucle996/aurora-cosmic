package service

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"sync"
	"time"

	"go-api/infra/nats"
	"go-api/internal/domain/entity"
	domainService "go-api/internal/domain/service"
	"go-api/internal/provider"

	natsgo "github.com/nats-io/nats.go"
)

// ============================================================================
// INGEST SERVICE (Dịch vụ điều phối & giám sát quá trình thu thập dữ liệu)
// ============================================================================
// IngestService chịu trách nhiệm:
// 1. Kích hoạt (Start) hoặc Hủy bỏ (Cancel) tiến trình tải dữ liệu thiên văn từ NASA MAST.
// 2. Theo dõi trạng thái tiến trình thời gian thực qua NATS Pub/Sub event stream.
type IngestService struct {
	objects    provider.ObjectStorage   // Storage đọc MinIO S3 cho Storage() browsing
	bucket     string                   // Tên bucket MinIO (mặc định: "aurora")
	nats       *nats.Client             // Kết nối NATS Client trực tiếp để trao đổi lệnh và trạng thái
	publisher  provider.EventPublisher  // Publisher phát sự kiện lifecycle workflow
	runtimeMu  sync.RWMutex             // Khóa đồng bộ trạng thái runtime trong bộ nhớ
	runtimeJob *entity.IngestControlJob // Thông tin job điều khiển đang chạy
	runtime    *entity.IngestStatus     // Snapshot trạng thái thu thập gần nhất

	lastProgressAt        time.Time
	lastCompletedBytes    int64
	lastCompletedProducts int64
}

// NewIngestService khởi tạo thể hiện duy nhất của IngestService
func NewIngestService(
	objects provider.ObjectStorage,
	bucket string,
	natsClient *nats.Client,
	publisher provider.EventPublisher,
) domainService.Ingest {
	s := &IngestService{
		objects:   objects,
		bucket:    bucket,
		nats:      natsClient,
		publisher: publisher,
	}
	s.startEventListener()
	return s
}

func (s *IngestService) startEventListener() {
	go func() {
		nc, err := s.nats.Conn(context.Background())
		if err != nil {
			return
		}
		_, _ = nc.Subscribe("aurora.v1.ingest.runtime.>", func(msg *natsgo.Msg) {
			s.handleRuntimeEvent(msg.Data)
		})
	}()
}

func (s *IngestService) handleRuntimeEvent(data []byte) {
	if len(data) == 0 {
		return
	}
	var ev struct {
		TicketID             string    `json:"ticket_id"`
		Status               string    `json:"status"`
		PlanningStage        string    `json:"planning_stage,omitempty"`
		PlanningCompleted    int       `json:"planning_completed,omitempty"`
		PlanningTotal        int       `json:"planning_total,omitempty"`
		PlanningProducts     int       `json:"planning_products,omitempty"`
		Error                string    `json:"error,omitempty"`
		ProductID            string    `json:"product_id,omitempty"`
		ProductKind          string    `json:"product_kind,omitempty"`
		WorkerID             int       `json:"worker_id,omitempty"`
		ProductBytes         int64     `json:"product_bytes,omitempty"`
		ProductExpectedBytes int64     `json:"product_expected_bytes,omitempty"`
		CompletedProducts    int64     `json:"completed_products,omitempty"`
		TotalProducts        int       `json:"total_products,omitempty"`
		CompletedBytes       int64     `json:"completed_bytes,omitempty"`
		ExpectedBytes        int64     `json:"expected_bytes,omitempty"`
		ActiveWorkers        int       `json:"active_workers,omitempty"`
		OccurredAt           time.Time `json:"occurred_at"`
	}
	if err := json.Unmarshal(data, &ev); err != nil {
		return
	}
	ticketID := strings.TrimSpace(ev.TicketID)
	if ticketID == "" {
		return
	}

	now := time.Now().UTC()
	if ev.OccurredAt.IsZero() {
		ev.OccurredAt = now
	}

	s.runtimeMu.Lock()
	if s.runtime == nil || s.runtime.TicketID != ticketID {
		s.runtime = &entity.IngestStatus{
			Observed:     true,
			TicketID:     ticketID,
			Status:       strings.ToLower(ev.Status),
			Error:        ev.Error,
			ObservedAt:   now,
			Products:     []entity.IngestProduct{},
			ProductKinds: make(map[string]entity.IngestKindSummary),
		}
		s.lastProgressAt = time.Time{}
		s.lastCompletedBytes = 0
		s.lastCompletedProducts = 0
	}

	if ev.Status != "" {
		s.runtime.Status = strings.ToLower(ev.Status)
	}
	if ev.Error != "" {
		s.runtime.Error = ev.Error
	}
	if ev.TotalProducts > 0 {
		s.runtime.TotalProducts = ev.TotalProducts
	}
	if ev.CompletedProducts > 0 {
		s.runtime.CompletedProducts = int(ev.CompletedProducts)
	}
	if ev.CompletedBytes > 0 {
		s.runtime.CompletedBytes = ev.CompletedBytes
	}
	if ev.ExpectedBytes > 0 {
		s.runtime.ExpectedBytes = ev.ExpectedBytes
	}
	if ev.ActiveWorkers > 0 {
		s.runtime.InflightProducts = ev.ActiveWorkers
		s.runtime.Downloading = ev.ActiveWorkers
	}

	// Calculate soft throughput metrics (bytes/s, products/s)
	if ev.Status == "progress" {
		if !s.lastProgressAt.IsZero() {
			secs := now.Sub(s.lastProgressAt).Seconds()
			if secs > 0 {
				if ev.CompletedBytes > s.lastCompletedBytes {
					s.runtime.BytesPerSecond = float64(ev.CompletedBytes-s.lastCompletedBytes) / secs
				}
				if ev.CompletedProducts > s.lastCompletedProducts {
					s.runtime.ProductsPerSecond = float64(ev.CompletedProducts-s.lastCompletedProducts) / secs
				}
			}
		}
		s.lastProgressAt = now
		s.lastCompletedBytes = ev.CompletedBytes
		s.lastCompletedProducts = ev.CompletedProducts
	}

	// Update planning progress
	if ev.PlanningStage != "" {
		s.runtime.Status = "planning"
		s.runtime.ManifestProgress = &entity.IngestManifestProgress{
			State:              "RUNNING",
			Stage:              ev.PlanningStage,
			StageCompleted:     ev.PlanningCompleted,
			StageTotal:         ev.PlanningTotal,
			DiscoveredProducts: ev.PlanningProducts,
			UpdatedAt:          ev.OccurredAt,
		}
	}

	// Update active worker transferring products
	if ev.Status == "transfer" && ev.ProductID != "" {
		found := false
		for i := range s.runtime.Products {
			if s.runtime.Products[i].ID == ev.ProductID {
				s.runtime.Products[i].State = "downloading"
				s.runtime.Products[i].SizeBytes = ev.ProductBytes
				if ev.ProductExpectedBytes > 0 {
					s.runtime.Products[i].Expected = ev.ProductExpectedBytes
				}
				s.runtime.Products[i].UpdatedAt = ev.OccurredAt
				found = true
				break
			}
		}
		if !found {
			p := entity.IngestProduct{
				ID:        ev.ProductID,
				Kind:      ev.ProductKind,
				State:     "downloading",
				SizeBytes: ev.ProductBytes,
				Expected:  ev.ProductExpectedBytes,
				UpdatedAt: ev.OccurredAt,
			}
			s.runtime.Products = append([]entity.IngestProduct{p}, s.runtime.Products...)
			if len(s.runtime.Products) > 100 {
				s.runtime.Products = s.runtime.Products[:100]
			}
		}
	} else if ev.Status == "transfer_complete" && ev.ProductID != "" {
		for i := range s.runtime.Products {
			if s.runtime.Products[i].ID == ev.ProductID {
				s.runtime.Products[i].State = "stored"
				s.runtime.Products[i].SizeBytes = ev.ProductBytes
				s.runtime.Products[i].UpdatedAt = ev.OccurredAt
				break
			}
		}
	}

	downloadingCount := 0
	for i := range s.runtime.Products {
		if s.runtime.Products[i].State == "downloading" {
			downloadingCount++
		}
	}
	if downloadingCount > 0 {
		s.runtime.Downloading = downloadingCount
	} else if ev.ActiveWorkers > 0 {
		s.runtime.Downloading = ev.ActiveWorkers
	}

	if ev.Status == "completed" || ev.Status == "canceled" || ev.Status == "stopped" || ev.Status == "failed" {
		s.runtime.Downloading = 0
		s.runtime.InflightProducts = 0
		s.runtime.QueueDepth = 0
		s.runtime.BytesPerSecond = 0
		s.runtime.ProductsPerSecond = 0
	}

	s.runtime.ObservedAt = now
	s.runtimeMu.Unlock()

	// Push SSE real-time update
	topic := "ingest:" + ticketID
	_ = s.publisher.Publish(context.Background(), topic, provider.Event{
		Type:  "workflow",
		Topic: topic,
		Data:  data,
	})
	_ = s.publisher.Publish(context.Background(), "ingest", provider.Event{
		Type:  "workflow",
		Topic: "ingest",
		Data:  data,
	})
}

// ============================================================================
// HÀM KHỞI CHẠY TIẾN TRÌNH THU THẬP (Start Ingestion)
// ============================================================================
// Start gửi lệnh khởi động 1 chiều tới Ingester qua NATS và phát sự kiện SSE
func (s *IngestService) Start(ctx context.Context, request entity.IngestStartRequest) (*entity.IngestControlJob, error) {
	payload, err := json.Marshal(request)
	if err != nil {
		return nil, fmt.Errorf("marshal ingest start request: %w", err)
	}

	// 1. Gửi lệnh 1 chiều (fire-and-forget command) tới Ingester worker qua NATS
	if err := s.nats.Publish(ctx, "aurora.v1.ingest.control.start", payload); err != nil {
		return nil, fmt.Errorf("publish ingest start command over NATS: %w", err)
	}

	now := time.Now().UTC()
	job := &entity.IngestControlJob{
		TicketID:     request.TicketID,
		Status:       "running",
		ManifestPath: request.ManifestPath,
		Sector:       request.Sector,
		Concurrency:  request.Concurrency,
		StartedAt:    now,
		UpdatedAt:    now,
	}

	// 2. Phát sự kiện workflow vào event bus
	topic := "ingest:" + request.TicketID
	eventData, err := json.Marshal(map[string]any{
		"ticket_id":   job.TicketID,
		"status":      strings.ToLower(job.Status),
		"occurred_at": job.UpdatedAt,
		"payload":     job,
	})
	if err == nil {
		_ = s.publisher.Publish(ctx, topic, provider.Event{
			Type:  "workflow",
			Topic: topic,
			Data:  eventData,
		})
	}

	// 3. Cập nhật trạng thái runtime trong bộ nhớ
	s.runtimeMu.Lock()
	s.runtimeJob = job
	s.runtime = &entity.IngestStatus{
		Observed:     false,
		TicketID:     job.TicketID,
		Status:       strings.ToLower(job.Status),
		ManifestPath: job.ManifestPath,
		StartedAt:    job.StartedAt,
		UpdatedAt:    job.UpdatedAt,
		ObservedAt:   now,
		Products:     []entity.IngestProduct{},
		ProductKinds: make(map[string]entity.IngestKindSummary),
	}
	s.runtimeMu.Unlock()

	return job, nil
}

// ============================================================================
// HÀM HỦY BỎ TIẾN TRÌNH (Cancel Ingestion)
// ============================================================================
// Cancel gửi lệnh 1 chiều hủy bỏ qua NATS và cập nhật trạng thái runtime
func (s *IngestService) Cancel(ctx context.Context, ticketID string) (*entity.IngestControlJob, error) {
	payload, err := json.Marshal(map[string]string{
		"ticket_id": ticketID,
	})
	if err != nil {
		return nil, fmt.Errorf("marshal cancel request: %w", err)
	}

	// 1. Gửi lệnh 1 chiều hủy bỏ qua NATS
	if err := s.nats.Publish(ctx, "aurora.v1.ingest.control.cancel", payload); err != nil {
		return nil, fmt.Errorf("cancel ingestion job %s over NATS: %w", ticketID, err)
	}

	now := time.Now().UTC()
	job := &entity.IngestControlJob{
		TicketID:  ticketID,
		Status:    "draining",
		UpdatedAt: now,
	}

	// 2. Phát sự kiện workflow
	topic := "ingest:" + ticketID
	eventData, err := json.Marshal(map[string]any{
		"ticket_id":   job.TicketID,
		"status":      strings.ToLower(job.Status),
		"occurred_at": job.UpdatedAt,
		"payload":     job,
	})
	if err == nil {
		_ = s.publisher.Publish(ctx, topic, provider.Event{
			Type:  "workflow",
			Topic: topic,
			Data:  eventData,
		})
	}

	s.runtimeMu.Lock()
	s.runtimeJob = job
	if s.runtime != nil {
		s.runtime.Status = "draining"
		s.runtime.UpdatedAt = job.UpdatedAt
		s.runtime.ObservedAt = now
	}
	s.runtimeMu.Unlock()

	return job, nil
}

// ============================================================================
// HÀM TRUY VẤN TRẠNG THÁI TIẾN TRÌNH (Ingestion Status & Telemetry)
// ============================================================================
// Status trả về snapshot trạng thái realtime từ in-memory NATS Pub/Sub projection
// và đồng bộ trạng thái controller volatile từ NATS nếu có.
func (s *IngestService) Status(ctx context.Context) (*entity.IngestStatus, error) {
	var controlJob *entity.IngestControlJob
	if data, currentErr := s.nats.Request(ctx, "aurora.v1.ingest.control.current", nil); currentErr == nil && len(data) > 0 {
		var current entity.IngestControlJob
		if json.Unmarshal(data, &current) == nil && current.TicketID != "" && current.Status != "not_observed" {
			controlJob = &current
			s.runtimeMu.Lock()
			s.runtimeJob = &current
			ticketID := current.TicketID
			if s.runtime == nil || current.StartedAt.After(s.runtime.StartedAt) {
				s.runtime = &entity.IngestStatus{
					Observed:     true,
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

	s.runtimeMu.RLock()
	defer s.runtimeMu.RUnlock()

	if s.runtime == nil {
		return &entity.IngestStatus{
			Observed:     false,
			Status:       "not_observed",
			ObservedAt:   time.Now().UTC(),
			Products:     []entity.IngestProduct{},
			ProductKinds: make(map[string]entity.IngestKindSummary),
		}, nil
	}

	cloned := *s.runtime
	if controlJob != nil {
		if controlJob.TicketID != "" {
			cloned.TicketID = controlJob.TicketID
		}
		cloned.Status = strings.ToLower(controlJob.Status)
		cloned.Error = controlJob.Error
		if controlJob.UpdatedAt.After(cloned.UpdatedAt) {
			cloned.UpdatedAt = controlJob.UpdatedAt
		}
	}
	cloned.ObservedAt = time.Now().UTC()
	return &cloned, nil
}

// ============================================================================
// HÀM DUYỆT BỘ NHỚ ĐỆM MEDALLION (Lakehouse Catalog & Storage Listing)
// ============================================================================
// Storage returns objects in MinIO using native cursor streaming (StartAfter).
func (s *IngestService) Storage(ctx context.Context, prefix string, cursor string, limit int) (*entity.StorageListing, error) {
	objects, nextCursor, truncated, err := s.objects.ListObjectsCursor(ctx, prefix, cursor, limit)
	if err != nil {
		return nil, err
	}

	items := make([]entity.StorageObject, len(objects))
	var pageBytes int64
	for i, object := range objects {
		pageBytes += object.Size
		items[i] = entity.StorageObject{
			Key:          object.Key,
			SizeBytes:    object.Size,
			ETag:         object.ETag,
			LastModified: object.LastModified,
		}
	}

	return &entity.StorageListing{
		Bucket:     s.bucket,
		Prefix:     prefix,
		Limit:      limit,
		Cursor:     cursor,
		NextCursor: nextCursor,
		Truncated:  truncated,
		Total:      len(items),
		TotalBytes: pageBytes,
		Objects:    items,
	}, nil
}
