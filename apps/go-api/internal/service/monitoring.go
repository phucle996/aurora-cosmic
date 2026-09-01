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
	ID          string
	Name        string
	Group       string
	Container   string
	Job         string
	HealthQuery string
	Metrics     []metricSpec
}

// Labelled counters often do not exist before their first event. Returning a
// real zero series keeps an idle but healthy component distinct from a failed
// Prometheus scrape.
func rate(metric string) string {
	return fmt.Sprintf("sum(rate(%s[2m])) or vector(0)", metric)
}

// p95Duration reports the slow tail of a real histogram. The count guard
// removes the NaN emitted by an idle histogram before falling back to zero.
func p95Duration(metric, selector string) string {
	return fmt.Sprintf(
		"(histogram_quantile(0.95, sum by (le) (rate(%s_bucket%s[5m]))) and on() (sum(increase(%s_count%s[5m])) > 0)) or vector(0)",
		metric, selector, metric, selector,
	)
}

func systemdMetrics(unit string) []metricSpec {
	selector := fmt.Sprintf(`{unit=%q}`, unit)
	return []metricSpec{
		{Key: "memory", Name: "Process memory", Unit: "bytes", Kind: "gauge", Query: "max(aurora_systemd_unit_memory_bytes" + selector + ")"},
		{Key: "memory_total", Name: "Host memory capacity", Unit: "bytes", Kind: "gauge", Query: "max(aurora_host_memory_total_bytes)"},
		{Key: "cpu_cores", Name: "CPU cores in use", Unit: "cores", Kind: "gauge", Query: "rate(aurora_systemd_unit_cpu_seconds_total" + selector + "[1m])"},
		{Key: "cpu_cores_total", Name: "Host logical CPU cores", Unit: "cores", Kind: "gauge", Query: "max(aurora_host_cpu_logical_cores)"},
		{Key: "disk_read", Name: "Process disk read", Unit: "bytes/s", Kind: "rate", Query: "rate(aurora_systemd_unit_io_read_bytes_total" + selector + "[1m])"},
		{Key: "disk_write", Name: "Process disk write", Unit: "bytes/s", Kind: "rate", Query: "rate(aurora_systemd_unit_io_write_bytes_total" + selector + "[1m])"},
	}
}

func combineMetrics(groups ...[]metricSpec) []metricSpec {
	total := 0
	for _, group := range groups {
		total += len(group)
	}
	combined := make([]metricSpec, 0, total)
	for _, group := range groups {
		combined = append(combined, group...)
	}
	return combined
}

// ============================================================================
// DANH SÁCH CÁC COMPONENT ĐƯỢC GIÁM SÁT
// ============================================================================
var components = []componentSpec{
	{
		ID: "go-ingester", Name: "Go Ingester", Group: "Pipeline", Container: "aurora-go-ingester", Job: "aurora-go-ingester", HealthQuery: `max(up{job="aurora-go-ingester"})`,
		Metrics: combineMetrics([]metricSpec{
			{Key: "throughput", Name: "Stored products / second", Unit: "products/s", Kind: "rate", Query: rate(`aurora_ingester_products_total{status="success"}`)},
			{Key: "duration_p95", Name: "Product latency p95", Unit: "seconds", Kind: "histogram p95", Query: p95Duration("aurora_ingester_product_duration_seconds", `{status="success"}`)},
			{Key: "errors", Name: "Errors / second", Unit: "errors/s", Kind: "rate", Query: rate("aurora_ingester_errors_total")},
			{Key: "inflight", Name: "In-flight products", Unit: "products", Kind: "gauge", Query: "sum(aurora_ingester_inflight_products)"},
			{Key: "queue", Name: "Queue depth", Unit: "products", Kind: "gauge", Query: "sum(aurora_ingester_queue_depth)"},
			{Key: "bytes", Name: "Stored bytes / second", Unit: "bytes/s", Kind: "rate", Query: rate("aurora_ingester_bytes_processed_total")},
		}, systemdMetrics("aurora-go-ingester.service")),
	},
	{
		ID: "rust-preprocessor", Name: "Rust Preprocessor", Group: "Pipeline", Container: "aurora-rust-preprocessor", Job: "aurora-rust-preprocessor", HealthQuery: `max(up{job="aurora-rust-preprocessor"})`,
		Metrics: combineMetrics([]metricSpec{
			{Key: "throughput", Name: "Prepared products / second", Unit: "products/s", Kind: "rate", Query: rate(`aurora_preprocessor_products_total{status=~"success|recovered"}`)},
			{Key: "duration_p95", Name: "Preprocessing latency p95", Unit: "seconds", Kind: "histogram p95", Query: p95Duration("aurora_preprocessor_processing_duration_seconds", "")},
			{Key: "errors", Name: "Errors / second", Unit: "errors/s", Kind: "rate", Query: rate("aurora_preprocessor_errors_total")},
			{Key: "inflight", Name: "In-flight workers", Unit: "workers", Kind: "gauge", Query: "sum(aurora_preprocessor_inflight_workers)"},
			{Key: "queue", Name: "Queue depth", Unit: "products", Kind: "gauge", Query: "sum(aurora_preprocessor_queue_depth)"},
			{Key: "bytes", Name: "Silver output / second", Unit: "bytes/s", Kind: "rate", Query: rate(`aurora_preprocessor_bytes_total{stage="silver"}`)},
		}, systemdMetrics("aurora-rust-preprocessor.service")),
	},
	{
		ID: "python-ml-worker", Name: "Python ML Worker", Group: "Pipeline", Container: "aurora-python-ml-worker", Job: "aurora-python-ml-worker", HealthQuery: `max(up{job="aurora-python-ml-worker"})`,
		Metrics: combineMetrics([]metricSpec{
			{Key: "throughput", Name: "Successful jobs / second", Unit: "jobs/s", Kind: "rate", Query: rate(`aurora_ml_jobs_total{status="success"}`)},
			{Key: "duration_p95", Name: "Training latency p95", Unit: "seconds", Kind: "histogram p95", Query: p95Duration("aurora_ml_job_duration_seconds", `{operation="training"}`)},
			{Key: "errors", Name: "Errors / second", Unit: "errors/s", Kind: "rate", Query: rate("aurora_ml_errors_total")},
			{Key: "inflight", Name: "In-flight jobs", Unit: "jobs", Kind: "gauge", Query: "sum(aurora_ml_inflight_jobs)"},
			{Key: "queue", Name: "Queue depth", Unit: "jobs", Kind: "gauge", Query: "sum(aurora_ml_queue_depth)"},
		}, systemdMetrics("aurora-python-ml-worker.service"), []metricSpec{
			{Key: "cpu_info", Name: "Host CPU info", Unit: "info", Kind: "gauge", Query: "aurora_host_cpu_info"},
			{Key: "gpu_available", Name: "GPU available", Unit: "up", Kind: "metadata", Query: "max(aurora_ml_gpu_available)"},
			{Key: "gpu_utilization", Name: "Shared GPU device utilization", Unit: "percent", Kind: "gauge", Query: "max(aurora_ml_gpu_utilization_percent)"},
			{Key: "gpu_memory_used", Name: "Shared GPU device memory used", Unit: "bytes", Kind: "gauge", Query: "max(aurora_ml_gpu_memory_used_bytes)"},
			{Key: "gpu_memory_total", Name: "Shared GPU device memory total", Unit: "bytes", Kind: "gauge", Query: "max(aurora_ml_gpu_memory_total_bytes)"},
		}),
	},
	{
		ID: "rust-inference", Name: "Rust GPU Inference", Group: "Pipeline", Container: "aurora-rust-inference", Job: "aurora-rust-inference", HealthQuery: `max(up{job="aurora-rust-inference"})`,
		Metrics: combineMetrics([]metricSpec{
			{Key: "throughput", Name: "Successful jobs / second", Unit: "jobs/s", Kind: "rate", Query: rate(`aurora_inference_jobs_total{status="success"}`)},
			{Key: "duration_p95", Name: "Inference latency p95", Unit: "seconds", Kind: "histogram p95", Query: p95Duration("aurora_inference_processing_duration_seconds", "")},
			{Key: "errors", Name: "Errors / second", Unit: "errors/s", Kind: "rate", Query: rate("aurora_inference_errors_total")},
			{Key: "inflight", Name: "In-flight jobs", Unit: "jobs", Kind: "gauge", Query: "sum(aurora_inference_inflight_jobs)"},
			{Key: "queue", Name: "Queue depth", Unit: "jobs", Kind: "gauge", Query: "sum(aurora_inference_queue_depth)"},
			{Key: "rows", Name: "Inferred rows / second", Unit: "rows/s", Kind: "rate", Query: rate("aurora_inference_rows_processed_total")},
		}, systemdMetrics("aurora-rust-inference.service")),
	},
	{
		ID: "go-api", Name: "Go API", Group: "Platform", Container: "aurora-go-api", Job: "aurora-go-api", HealthQuery: `max(up{job="aurora-go-api"})`,
		Metrics: combineMetrics([]metricSpec{
			{Key: "throughput", Name: "Requests / second", Unit: "requests/s", Kind: "rate", Query: rate("aurora_api_http_requests_total")},
			{Key: "duration_p95", Name: "Request latency p95", Unit: "seconds", Kind: "histogram p95", Query: p95Duration("aurora_api_http_request_duration_seconds", "")},
			{Key: "errors", Name: "Errors / second", Unit: "errors/s", Kind: "rate", Query: rate("aurora_api_http_errors_total")},
			{Key: "inflight", Name: "In-flight requests", Unit: "requests", Kind: "gauge", Query: "sum(aurora_api_http_inflight_requests)"},
		}, systemdMetrics("aurora-go-api.service")),
	},
	{
		ID: "gold-builder", Name: "Gold Builder", Group: "Pipeline", Container: "aurora-gold-builder", Job: "aurora-gold-builder", HealthQuery: `max(up{job="aurora-gold-builder"}) or max(aurora_systemd_unit_active{unit="aurora-gold-builder.service"})`,
		Metrics: combineMetrics([]metricSpec{
			{Key: "throughput", Name: "Committed batches / second", Unit: "batches/s", Kind: "rate", Query: rate(`aurora_gold_batches_total{status="success"}`)},
			{Key: "duration_p95", Name: "Gold build latency p95", Unit: "seconds", Kind: "histogram p95", Query: p95Duration("aurora_gold_batch_duration_seconds", `{status="success"}`)},
			{Key: "errors", Name: "Failed builds / second", Unit: "errors/s", Kind: "rate", Query: rate(`aurora_gold_batches_total{status="failed"}`)},
			{Key: "deferred", Name: "Catalog deferrals / second", Unit: "deferrals/s", Kind: "rate", Query: rate(`aurora_gold_batches_total{status="deferred"}`)},
			{Key: "inflight", Name: "In-flight builds", Unit: "builds", Kind: "gauge", Query: "sum(aurora_gold_inflight_builds) or vector(0)"},
			{Key: "queue", Name: "Queue depth", Unit: "batches", Kind: "gauge", Query: "sum(aurora_gold_queue_depth) or vector(0)"},
			{Key: "rows", Name: "Committed rows / second", Unit: "rows/s", Kind: "rate", Query: rate("aurora_gold_output_rows_total")},
		}, systemdMetrics("aurora-gold-builder.service")),
	},
	{
		ID: "dashboard", Name: "Dashboard", Group: "Platform", Container: "aurora-dashboard", Job: "aurora-systemd", HealthQuery: `max(aurora_systemd_unit_active{unit="aurora-dashboard.service"})`,
		Metrics: systemdMetrics("aurora-dashboard.service"),
	},
	{
		ID: "minio", Name: "MinIO Storage", Group: "Platform", Container: "aurora-minio", Job: "aurora-minio", HealthQuery: `max(up{job="aurora-minio"})`,
		Metrics: []metricSpec{
			{Key: "requests", Name: "S3 requests / second", Unit: "requests/s", Kind: "rate", Query: rate("minio_s3_requests_total")},
			{Key: "ttfb_p95", Name: "S3 TTFB p95 (lifetime)", Unit: "seconds", Kind: "distribution p95", Query: "histogram_quantile(0.95, sum by (le) (minio_s3_requests_ttfb_seconds_distribution))"},
			{Key: "inflight", Name: "In-flight S3 requests", Unit: "requests", Kind: "gauge", Query: "sum(minio_s3_requests_inflight_total)"},
			{Key: "errors", Name: "S3 errors / second", Unit: "errors/s", Kind: "rate", Query: rate("minio_s3_requests_errors_total")},
			{Key: "traffic_in", Name: "Traffic received", Unit: "bytes/s", Kind: "rate", Query: rate("minio_s3_traffic_received_bytes")},
			{Key: "traffic_out", Name: "Traffic sent", Unit: "bytes/s", Kind: "rate", Query: rate("minio_s3_traffic_sent_bytes")},
			{Key: "usage", Name: "Storage used", Unit: "bytes", Kind: "gauge", Query: "sum(minio_cluster_usage_total_bytes)"},
			{Key: "objects", Name: "Stored objects", Unit: "objects", Kind: "gauge", Query: "sum(minio_cluster_usage_object_total)"},
			{Key: "offline_drives", Name: "Offline drives", Unit: "drives", Kind: "gauge", Query: "sum(minio_cluster_drive_offline_total)"},
		},
	},
	{
		ID: "nats", Name: "NATS JetStream", Group: "Platform", Container: "aurora-nats", Job: "aurora-nats", HealthQuery: `max(up{job="aurora-nats"})`,
		Metrics: []metricSpec{
			{Key: "inbound", Name: "Inbound messages", Unit: "messages/s", Kind: "rate", Query: rate("gnatsd_varz_in_msgs")},
			{Key: "outbound", Name: "Outbound messages", Unit: "messages/s", Kind: "rate", Query: rate("gnatsd_varz_out_msgs")},
			{Key: "connections", Name: "Connections", Unit: "connections", Kind: "gauge", Query: "max(gnatsd_varz_connections)"},
			{Key: "cpu", Name: "CPU usage", Unit: "percent", Kind: "gauge", Query: "max(gnatsd_varz_cpu)"},
			{Key: "memory", Name: "Memory", Unit: "bytes", Kind: "gauge", Query: "max(gnatsd_varz_mem)"},
			{Key: "pending_bytes", Name: "Pending bytes", Unit: "bytes", Kind: "gauge", Query: "max(gnatsd_connz_pending_bytes)"},
		},
	},
	{
		ID: "clickhouse", Name: "ClickHouse", Group: "Platform", Container: "aurora-clickhouse", Job: "aurora-clickhouse", HealthQuery: `max(up{job="aurora-clickhouse"})`,
		Metrics: []metricSpec{
			{Key: "queries", Name: "Queries / second", Unit: "queries/s", Kind: "rate", Query: rate("ClickHouseProfileEvents_Query")},
			{Key: "duration", Name: "Average query latency", Unit: "seconds", Kind: "duration", Query: "(sum(rate(ClickHouseProfileEvents_QueryTimeMicroseconds[2m])) / clamp_min(sum(rate(ClickHouseProfileEvents_Query[2m])), 0.000001) / 1000000) or vector(0)"},
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

	var healthPoints []entity.MonitoringPoint
	var healthErr error
	queryFailed := make([]bool, len(spec.Metrics))
	var wg sync.WaitGroup
	wg.Add(1)
	go func() {
		defer wg.Done()
		healthPoints, healthErr = s.prometheus.QueryRange(ctx, spec.HealthQuery, start, end, step)
	}()
	for i, metric := range spec.Metrics {
		wg.Add(1)
		go func(i int, metric metricSpec) {
			defer wg.Done()
			result := entity.MonitoringMetric{
				Key:    metric.Key,
				Name:   metric.Name,
				Unit:   metric.Unit,
				Kind:   metric.Kind,
				Points: []entity.MonitoringPoint{},
			}
			points, err := s.prometheus.QueryRange(ctx, metric.Query, start, end, step)
			if err == nil {
				result.Points = points
			} else {
				queryFailed[i] = true
			}
			component.Metrics[i] = result
		}(i, metric)
	}
	wg.Wait()

	// Component health comes from its scrape/unit signal, never from whether
	// user traffic happened to create counter samples in this window.
	if healthErr != nil || len(healthPoints) == 0 {
		return component
	}
	component.Status = "up"
	if healthPoints[len(healthPoints)-1].Value <= 0 {
		component.Status = "degraded"
		return component
	}
	for _, failed := range queryFailed {
		if failed {
			component.Status = "degraded"
			break
		}
	}
	return component
}

// selectComponents lọc danh sách component dựa trên tab người dùng đang chọn trên UI
func selectComponents(tab string) ([]componentSpec, error) {
	if tab == "" || tab == "all" {
		return components, nil
	}
	for _, component := range components {
		if component.ID == tab {
			return []componentSpec{component}, nil
		}
	}
	return nil, fmt.Errorf("unknown monitoring tab %q", tab)
}
