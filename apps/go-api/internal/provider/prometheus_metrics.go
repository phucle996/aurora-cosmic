// Package provider exposes pure technical capabilities (telemetry, storage, SSE)
// decoupled from application domain logic.
package provider

import (
	"context"
	"errors"
	"fmt"
	"net"
	"net/http"
	"runtime"
	"strconv"
	"time"

	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promhttp"
)

// ============================================================================
// PROMETHEUS METRICS REGISTRY & COLLECTORS
// ============================================================================

// Metrics là telemetry provider của API. Nó sở hữu một Prometheus registry riêng biệt
// để các unit tests và embedded applications không bị trùng lặp global collectors.
type Metrics struct {
	registry  *prometheus.Registry
	requests  *prometheus.CounterVec
	duration  *prometheus.HistogramVec
	errors    *prometheus.CounterVec
	inflight  prometheus.Gauge
	startTime prometheus.Gauge
	buildInfo *prometheus.GaugeVec
}

// NewMetrics khởi tạo Prometheus metrics collector với labels có cardinality giới hạn
func NewMetrics() *Metrics {
	m := &Metrics{
		registry: prometheus.NewRegistry(),
		requests: prometheus.NewCounterVec(prometheus.CounterOpts{
			Namespace: "aurora",
			Subsystem: "api",
			Name:      "http_requests_total",
			Help:      "Number of HTTP requests reaching a terminal response.",
		}, []string{"method", "route", "status_class"}),
		duration: prometheus.NewHistogramVec(prometheus.HistogramOpts{
			Namespace: "aurora",
			Subsystem: "api",
			Name:      "http_request_duration_seconds",
			Help:      "HTTP request duration in seconds.",
			Buckets:   prometheus.DefBuckets,
		}, []string{"method", "route"}),
		errors: prometheus.NewCounterVec(prometheus.CounterOpts{
			Namespace: "aurora",
			Subsystem: "api",
			Name:      "http_errors_total",
			Help:      "Number of HTTP responses with a 4xx or 5xx status.",
		}, []string{"route", "status_class"}),
		inflight: prometheus.NewGauge(prometheus.GaugeOpts{
			Namespace: "aurora",
			Subsystem: "api",
			Name:      "http_inflight_requests",
			Help:      "Number of HTTP requests currently being handled.",
		}),
		startTime: prometheus.NewGauge(prometheus.GaugeOpts{
			Namespace: "aurora",
			Subsystem: "api",
			Name:      "start_time_seconds",
			Help:      "Unix timestamp when the API observer was initialized.",
		}),
		buildInfo: prometheus.NewGaugeVec(prometheus.GaugeOpts{
			Namespace: "aurora",
			Subsystem: "api",
			Name:      "build_info",
			Help:      "Build and runtime information for the API process.",
		}, []string{"go_version"}),
	}

	m.registry.MustRegister(m.requests)
	m.registry.MustRegister(m.duration)
	m.registry.MustRegister(m.errors)
	m.registry.MustRegister(m.inflight)
	m.registry.MustRegister(m.startTime)
	m.registry.MustRegister(m.buildInfo)
	m.startTime.Set(float64(time.Now().Unix()))
	m.buildInfo.WithLabelValues(runtime.Version()).Set(1)
	return m
}

// Handler trả về http.Handler phục vụ định dạng Prometheus text format
func (m *Metrics) Handler() http.Handler {
	return promhttp.HandlerFor(m.registry, promhttp.HandlerOpts{})
}

// ObserveRequest ghi nhận một HTTP request đã hoàn tất. Sử dụng status class (2xx, 4xx, 5xx)
// thay cho status code cụ thể để giữ cardinality luôn ở mức thấp.
func (m *Metrics) ObserveRequest(method, route string, status int, elapsed time.Duration) {
	if method == "" {
		method = http.MethodGet
	}
	if route == "" {
		route = "unmatched"
	}
	if status < 100 || status > 599 {
		status = http.StatusInternalServerError
	}
	statusClass := strconv.Itoa(status/100) + "xx"
	m.requests.WithLabelValues(method, route, statusClass).Inc()
	m.duration.WithLabelValues(method, route).Observe(elapsed.Seconds())
	if status >= http.StatusBadRequest {
		m.errors.WithLabelValues(route, statusClass).Inc()
	}
}

// RequestStarted ghi nhận thêm 1 request đang xử lý (in-flight)
func (m *Metrics) RequestStarted() {
	m.inflight.Inc()
}

// RequestFinished giảm 1 request đang xử lý (in-flight)
func (m *Metrics) RequestFinished() {
	m.inflight.Dec()
}

// ============================================================================
// METRICS HTTP SCRAPE SERVER
// ============================================================================

// MetricsServer chạy listener riêng biệt để publish /metrics và /healthz,
// tách biệt hoàn toàn với public API listener.
type MetricsServer struct {
	httpServer *http.Server
}

// StartMetricsServer bind địa chỉ observer và khởi động HTTP server cho metrics
func StartMetricsServer(addr string, metrics *Metrics) (*MetricsServer, error) {
	if metrics == nil {
		return nil, errors.New("provider: metrics is nil")
	}
	if addr == "" {
		return nil, errors.New("provider: metrics address is empty")
	}

	mux := http.NewServeMux()
	mux.Handle("/metrics", metrics.Handler())
	mux.HandleFunc("/healthz", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
		_, _ = w.Write([]byte("ok\n"))
	})
	server := &http.Server{
		Addr:              addr,
		Handler:           mux,
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       10 * time.Second,
		WriteTimeout:      10 * time.Second,
		IdleTimeout:       30 * time.Second,
	}
	listener, err := net.Listen("tcp", addr)
	if err != nil {
		return nil, fmt.Errorf("provider: listen metrics %s: %w", addr, err)
	}
	s := &MetricsServer{httpServer: server}
	go func() {
		if err := server.Serve(listener); err != nil && !errors.Is(err, http.ErrServerClosed) {
		}
	}()
	return s, nil
}

// Shutdown dừng observer mà không làm gián đoạn active scrape
func (s *MetricsServer) Shutdown(ctx context.Context) error {
	if s == nil || s.httpServer == nil {
		return nil
	}
	return s.httpServer.Shutdown(ctx)
}
