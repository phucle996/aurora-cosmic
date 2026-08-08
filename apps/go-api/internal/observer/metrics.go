// Package observer exposes the small, low-cardinality Prometheus surface of
// the Go API. Request paths are recorded from Gin route templates, never from
// raw URLs, so IDs and query strings cannot create unbounded time series.
package observer

import (
	"net/http"
	"runtime"
	"strconv"
	"time"

	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promhttp"
)

// Metrics is the API observer. It owns an isolated registry so tests and
// embedded applications cannot register duplicate global collectors.
type Metrics struct {
	registry  *prometheus.Registry
	requests  *prometheus.CounterVec
	duration  *prometheus.HistogramVec
	errors    *prometheus.CounterVec
	inflight  prometheus.Gauge
	startTime prometheus.Gauge
	buildInfo *prometheus.GaugeVec
}

// New creates the API observer with bounded labels only.
func New() *Metrics {
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

// Handler exposes the isolated registry in Prometheus text format.
func (m *Metrics) Handler() http.Handler {
	if m == nil || m.registry == nil {
		return http.NotFoundHandler()
	}
	return promhttp.HandlerFor(m.registry, promhttp.HandlerOpts{})
}

// ObserveRequest records one completed HTTP request. The status class is
// deliberately used instead of the raw status code to keep cardinality low.
func (m *Metrics) ObserveRequest(method, route string, status int, elapsed time.Duration) {
	if m == nil {
		return
	}
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

// RequestStarted and RequestFinished maintain the in-flight gauge around a
// request. Keeping these operations separate makes the middleware safe to
// compose with other HTTP middleware.
func (m *Metrics) RequestStarted() {
	if m != nil {
		m.inflight.Inc()
	}
}

func (m *Metrics) RequestFinished() {
	if m != nil {
		m.inflight.Dec()
	}
}
