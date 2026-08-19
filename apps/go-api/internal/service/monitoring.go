package service

import (
	"context"
	"fmt"
	"sort"
	"sync"
	"time"

	"go-api/internal/domain/entity"
	"go-api/internal/domain/repo"
	domainService "go-api/internal/domain/service"
)

// ============================================================================
// MONITORING SERVICE (Dịch vụ giám sát sức khỏe & hiệu năng hệ thống)
// ============================================================================
// MonitoringService chịu trách nhiệm:
// 1. Định nghĩa danh sách các chỉ số PromQL cho từng service trong hệ thống (Pipeline & Platform).
// 2. Thực hiện truy vấn song song (parallel goroutines) tới Prometheus qua PromQL query range.
// 3. Đánh giá trạng thái hoạt động: "up" (hoàn toàn bình thường), "degraded" (suy giảm), hoặc "no_data" (mất kết nối).
type MonitoringService struct {
	prometheus repo.PrometheusQuerier // Interface truy vấn metrics từ Prometheus Server
}

// NewMonitoringService khởi tạo thể hiện của MonitoringService
func NewMonitoringService(prometheus repo.PrometheusQuerier) domainService.Monitoring {
	return &MonitoringService{prometheus: prometheus}
}

// ============================================================================
// ĐẶC TẢ METRIC & COMPONENT (PromQL Specifications)
// ============================================================================
type metricSpec struct {
	Key   string // Khóa định danh metric (VD: throughput, latency, errors)
	Name  string // Tên hiển thị người dùng (VD: "Products / second")
	Unit  string // Đơn vị đo (VD: "products/s", "bytes/s", "seconds")
	Kind  string // Loại metric: rate, duration, gauge
	Query string // Câu lệnh truy vấn PromQL
}

type componentSpec struct {
	ID        string       // Mã service (VD: "go-ingester", "rust-preprocessor")
	Name      string       // Tên component hiển thị
	Group     string       // Nhóm: "Pipeline" (các worker xử lý) hoặc "Platform" (hạ tầng nền tảng)
	Container string       // Tên container docker tương ứng
	Job       string       // Tên scrape job trong prometheus.yml
	Metrics   []metricSpec // Danh sách các metrics cần thu thập
}

// rate tạo câu truy vấn PromQL tính tốc độ biến thiên theo cửa sổ 2 phút: sum(rate(metric[2m]))
func rate(metric string) string {
	return fmt.Sprintf("sum(rate(%s[2m]))", metric)
}

// averageDuration tạo câu truy vấn PromQL tính thời gian xử lý trung bình: sum(rate(metric_sum)) / sum(rate(metric_count))
func averageDuration(metric string) string {
	return fmt.Sprintf("sum(rate(%s_sum[2m])) / clamp_min(sum(rate(%s_count[2m])), 1)", metric, metric)
}

// ============================================================================
// DANH SÁCH CÁC COMPONENT ĐƯỢC GIÁM SÁT
// ============================================================================
var components = []componentSpec{
	// 1. Go Ingester (Thu thập FITS từ MAST)
	{
		ID: "go-ingester", Name: "Go Ingester", Group: "Pipeline", Container: "aurora-go-ingester", Job: "aurora-go-ingester",
		Metrics: []metricSpec{
			{Key: "throughput", Name: "Products / second", Unit: "products/s", Kind: "rate", Query: rate("aurora_ingester_products_total")},
			{Key: "duration", Name: "Processing duration", Unit: "seconds", Kind: "duration", Query: averageDuration("aurora_ingester_product_duration_seconds")},
			{Key: "errors", Name: "Errors / second", Unit: "errors/s", Kind: "rate", Query: rate("aurora_ingester_errors_total")},
			{Key: "inflight", Name: "In-flight products", Unit: "products", Kind: "gauge", Query: "aurora_ingester_inflight_products"},
			{Key: "queue", Name: "Queue depth", Unit: "products", Kind: "gauge", Query: "aurora_ingester_queue_depth"},
			{Key: "bytes", Name: "Bytes / second", Unit: "bytes/s", Kind: "rate", Query: rate("aurora_ingester_bytes_processed_total")},
		},
	},
	// 2. Rust Preprocessor (Tiền xử lý FITS sang Parquet)
	{
		ID: "rust-preprocessor", Name: "Rust Preprocessor", Group: "Pipeline", Container: "aurora-rust-preprocessor", Job: "aurora-rust-preprocessor",
		Metrics: []metricSpec{
			{Key: "throughput", Name: "Products / second", Unit: "products/s", Kind: "rate", Query: rate("aurora_preprocessor_products_total")},
			{Key: "duration", Name: "Processing duration", Unit: "seconds", Kind: "duration", Query: averageDuration("aurora_preprocessor_processing_duration_seconds")},
			{Key: "errors", Name: "Errors / second", Unit: "errors/s", Kind: "rate", Query: rate("aurora_preprocessor_errors_total")},
			{Key: "inflight", Name: "In-flight workers", Unit: "workers", Kind: "gauge", Query: "aurora_preprocessor_inflight_workers"},
			{Key: "queue", Name: "Queue depth", Unit: "products", Kind: "gauge", Query: "aurora_preprocessor_queue_depth"},
			{Key: "bytes", Name: "Bytes / second", Unit: "bytes/s", Kind: "rate", Query: rate("aurora_preprocessor_bytes_total")},
		},
	},
	// 3. Python ML Worker (Huấn luyện mô hình PyTorch)
	{
		ID: "python-ml-worker", Name: "Python ML Worker", Group: "Pipeline", Container: "aurora-python-ml-worker", Job: "aurora-python-ml-worker",
		Metrics: []metricSpec{
			{Key: "throughput", Name: "Jobs / second", Unit: "jobs/s", Kind: "rate", Query: rate("aurora_ml_jobs_total")},
			{Key: "duration", Name: "Job duration", Unit: "seconds", Kind: "duration", Query: averageDuration("aurora_ml_job_duration_seconds")},
			{Key: "errors", Name: "Errors / second", Unit: "errors/s", Kind: "rate", Query: rate("aurora_ml_errors_total")},
			{Key: "inflight", Name: "In-flight jobs", Unit: "jobs", Kind: "gauge", Query: "aurora_ml_inflight_jobs"},
			{Key: "queue", Name: "Queue depth", Unit: "jobs", Kind: "gauge", Query: "aurora_ml_queue_depth"},
			{Key: "rows", Name: "Rows / second", Unit: "rows/s", Kind: "rate", Query: rate("aurora_ml_rows_processed_total")},
		},
	},
	// 4. Rust GPU Inference (Suy luận mô hình ONNX)
	{
		ID: "rust-inference", Name: "Rust GPU Inference", Group: "Pipeline", Container: "aurora-rust-inference", Job: "aurora-rust-inference",
		Metrics: []metricSpec{
			{Key: "throughput", Name: "Jobs / second", Unit: "jobs/s", Kind: "rate", Query: rate("aurora_inference_jobs_total")},
			{Key: "duration", Name: "Inference duration", Unit: "seconds", Kind: "duration", Query: averageDuration("aurora_inference_processing_duration_seconds")},
			{Key: "errors", Name: "Errors / second", Unit: "errors/s", Kind: "rate", Query: rate("aurora_inference_errors_total")},
			{Key: "inflight", Name: "In-flight jobs", Unit: "jobs", Kind: "gauge", Query: "aurora_inference_inflight_jobs"},
			{Key: "queue", Name: "Queue depth", Unit: "jobs", Kind: "gauge", Query: "aurora_inference_queue_depth"},
			{Key: "rows", Name: "Rows / second", Unit: "rows/s", Kind: "rate", Query: rate("aurora_inference_rows_processed_total")},
		},
	},
	// 5. Go API Gateway
	{
		ID: "go-api", Name: "Go API", Group: "Platform", Container: "aurora-go-api", Job: "aurora-go-api",
		Metrics: []metricSpec{
			{Key: "throughput", Name: "Requests / second", Unit: "requests/s", Kind: "rate", Query: rate("aurora_api_http_requests_total")},
			{Key: "duration", Name: "Request duration", Unit: "seconds", Kind: "duration", Query: averageDuration("aurora_api_http_request_duration_seconds")},
			{Key: "errors", Name: "Errors / second", Unit: "errors/s", Kind: "rate", Query: rate("aurora_api_http_errors_total")},
			{Key: "inflight", Name: "In-flight requests", Unit: "requests", Kind: "gauge", Query: "aurora_api_http_inflight_requests"},
		},
	},
	// 6. MinIO Storage
	{
		ID: "minio", Name: "MinIO Storage", Group: "Platform", Container: "aurora-minio", Job: "aurora-minio",
		Metrics: []metricSpec{
			{Key: "availability", Name: "Availability", Unit: "up", Kind: "gauge", Query: `max(up{job="aurora-minio"})`},
			{Key: "requests", Name: "S3 requests / second", Unit: "requests/s", Kind: "rate", Query: rate("minio_s3_requests_incoming_total")},
			{Key: "traffic_in", Name: "Traffic received", Unit: "bytes/s", Kind: "rate", Query: rate("minio_s3_traffic_received_bytes")},
			{Key: "traffic_out", Name: "Traffic sent", Unit: "bytes/s", Kind: "rate", Query: rate("minio_s3_traffic_sent_bytes")},
			{Key: "usage", Name: "Storage used", Unit: "bytes", Kind: "gauge", Query: "minio_cluster_usage_total_bytes"},
			{Key: "objects", Name: "Objects", Unit: "objects", Kind: "gauge", Query: "minio_cluster_usage_object_total"},
			{Key: "offline_drives", Name: "Offline drives", Unit: "drives", Kind: "gauge", Query: "minio_cluster_drive_offline_total"},
		},
	},
	// 7. NATS JetStream
	{
		ID: "nats", Name: "NATS JetStream", Group: "Platform", Container: "aurora-nats", Job: "aurora-nats",
		Metrics: []metricSpec{
			{Key: "availability", Name: "Availability", Unit: "up", Kind: "gauge", Query: `max(up{job="aurora-nats"})`},
			{Key: "inbound", Name: "Inbound messages", Unit: "messages/s", Kind: "rate", Query: rate("gnatsd_varz_in_msgs")},
			{Key: "outbound", Name: "Outbound messages", Unit: "messages/s", Kind: "rate", Query: rate("gnatsd_varz_out_msgs")},
			{Key: "connections", Name: "Connections", Unit: "connections", Kind: "gauge", Query: "max(gnatsd_varz_connections)"},
			{Key: "cpu", Name: "CPU usage", Unit: "percent", Kind: "gauge", Query: "100 * max(gnatsd_varz_cpu)"},
			{Key: "memory", Name: "Memory", Unit: "bytes", Kind: "gauge", Query: "max(gnatsd_varz_mem)"},
			{Key: "pending_bytes", Name: "Pending bytes", Unit: "bytes", Kind: "gauge", Query: "max(gnatsd_connz_pending_bytes)"},
		},
	},
	// 8. ClickHouse Analytics Database
	{
		ID: "clickhouse", Name: "ClickHouse", Group: "Platform", Container: "aurora-clickhouse", Job: "aurora-clickhouse",
		Metrics: []metricSpec{
			{Key: "availability", Name: "Availability", Unit: "up", Kind: "gauge", Query: `max(up{job="aurora-clickhouse"})`},
			{Key: "queries", Name: "Queries / second", Unit: "queries/s", Kind: "rate", Query: rate("ClickHouseProfileEvents_Query")},
			{Key: "selects", Name: "Selects / second", Unit: "queries/s", Kind: "rate", Query: rate("ClickHouseProfileEvents_SelectQuery")},
			{Key: "inserts", Name: "Inserts / second", Unit: "queries/s", Kind: "rate", Query: rate("ClickHouseProfileEvents_InsertQuery")},
			{Key: "failed_queries", Name: "Failed queries / second", Unit: "queries/s", Kind: "rate", Query: rate("ClickHouseProfileEvents_FailedQuery")},
			{Key: "active_queries", Name: "Active queries", Unit: "queries", Kind: "gauge", Query: "max(ClickHouseMetrics_Query)"},
			{Key: "memory", Name: "Memory used", Unit: "bytes", Kind: "gauge", Query: "max(ClickHouseMetrics_MemoryTracking)"},
		},
	},
}

// ============================================================================
// HÀM TRUY VẤN TỔNG HỢP METRICS (Query Monitoring Metrics)
// ============================================================================
// Query nhận vào cửa sổ thời gian (window) và tab lọc (all hoặc từng component),
// phát động các goroutine truy vấn song song tới Prometheus rồi trả về dữ liệu chuỗi thời gian.
func (s *MonitoringService) Query(ctx context.Context, window entity.MonitoringWindow, tab string) ([]entity.MonitoringComponent, error) {
	if s.prometheus == nil {
		return nil, fmt.Errorf("Prometheus monitoring is unavailable")
	}

	// 1. Chọn lọc các component theo tab yêu cầu
	selected, err := selectComponents(tab)
	if err != nil {
		return nil, err
	}

	end := time.Now().UTC()
	start := end.Add(-window.Duration)
	result := make([]entity.MonitoringComponent, len(selected))

	// 2. Chạy goroutine song song truy vấn từng component
	var wg sync.WaitGroup
	for i, spec := range selected {
		wg.Add(1)
		go func(i int, spec componentSpec) {
			defer wg.Done()
			result[i] = s.queryComponent(ctx, spec, start, end, window.Step)
		}(i, spec)
	}
	wg.Wait()

	// 3. Sắp xếp ổn định: Nhóm Platform/Pipeline rồi đến thứ tự tên component
	sort.SliceStable(result, func(i, j int) bool {
		if result[i].Group == result[j].Group {
			return result[i].Name < result[j].Name
		}
		return result[i].Group < result[j].Group
	})
	return result, nil
}

// queryComponent truy vấn song song tất cả metrics con của một component
func (s *MonitoringService) queryComponent(ctx context.Context, spec componentSpec, start, end time.Time, step time.Duration) entity.MonitoringComponent {
	component := entity.MonitoringComponent{
		ID:        spec.ID,
		Name:      spec.Name,
		Group:     spec.Group,
		Container: spec.Container,
		Status:    "no_data",
		Metrics:   make([]entity.MonitoringMetric, len(spec.Metrics)),
	}

	var wg sync.WaitGroup
	for i, metric := range spec.Metrics {
		wg.Add(1)
		go func(i int, metric metricSpec) {
			defer wg.Done()
			points, err := s.prometheus.QueryRange(ctx, metric.Query, start, end, step)
			if err != nil {
				return
			}
			component.Metrics[i] = entity.MonitoringMetric{
				Key:    metric.Key,
				Name:   metric.Name,
				Unit:   metric.Unit,
				Kind:   metric.Kind,
				Points: points,
			}
		}(i, metric)
	}
	wg.Wait()

	// Đánh giá trạng thái Component:
	// - Nếu tất cả metrics đều có dữ liệu: "up"
	// - Nếu chỉ có 1 phần metrics phản hồi: "degraded"
	// - Nếu không có metric nào phản hồi: "no_data"
	available := 0
	for _, metric := range component.Metrics {
		if len(metric.Points) > 0 {
			available++
		}
	}
	switch {
	case available == len(component.Metrics) && available > 0:
		component.Status = "up"
	case available > 0:
		component.Status = "degraded"
	}
	return component
}

// selectComponents lọc danh sách component dựa trên tab người dùng đang chọn trên UI
func selectComponents(tab string) ([]componentSpec, error) {
	if tab == "" || tab == entity.MonitoringAllTab {
		return components, nil
	}
	for _, component := range components {
		if component.ID == tab {
			return []componentSpec{component}, nil
		}
	}
	return nil, fmt.Errorf("unknown monitoring tab %q", tab)
}
