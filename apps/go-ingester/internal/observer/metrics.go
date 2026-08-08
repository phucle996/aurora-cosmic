// Package observer contains the small, stable metrics surface of the
// ingester. It deliberately exposes operational signals rather than a
// high-cardinality trace of every product or request.
package observer

import (
	"net/http"
	"time"

	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promhttp"
)

// Metrics is the ingester's Prometheus instrumentation. All labels are
// bounded values; product IDs, object keys, and request URLs must never be
// labels here.
type Metrics struct {
	registry *prometheus.Registry

	products *prometheus.CounterVec
	duration *prometheus.HistogramVec
	errors   prometheus.Counter
	inflight prometheus.Gauge
	queue    prometheus.Gauge
	bytes    prometheus.Counter
	lastOK   prometheus.Gauge
}

// New creates an isolated registry so the ingester can be embedded in tests
// and cannot accidentally register process-global collectors twice.
func New() *Metrics {
	m := &Metrics{
		registry: prometheus.NewRegistry(),
		products: prometheus.NewCounterVec(prometheus.CounterOpts{
			Namespace: "aurora",
			Subsystem: "ingester",
			Name:      "products_total",
			Help:      "Number of products reaching a terminal ingestion state.",
		}, []string{"status"}),
		duration: prometheus.NewHistogramVec(prometheus.HistogramOpts{
			Namespace: "aurora",
			Subsystem: "ingester",
			Name:      "product_duration_seconds",
			Help:      "Time spent processing one product until a terminal state.",
			Buckets:   prometheus.DefBuckets,
		}, []string{"status"}),
		errors: prometheus.NewCounter(prometheus.CounterOpts{
			Namespace: "aurora",
			Subsystem: "ingester",
			Name:      "errors_total",
			Help:      "Number of products that failed ingestion.",
		}),
		inflight: prometheus.NewGauge(prometheus.GaugeOpts{
			Namespace: "aurora",
			Subsystem: "ingester",
			Name:      "inflight_products",
			Help:      "Number of products currently being processed by workers.",
		}),
		queue: prometheus.NewGauge(prometheus.GaugeOpts{
			Namespace: "aurora",
			Subsystem: "ingester",
			Name:      "queue_depth",
			Help:      "Number of products waiting for an ingestion worker.",
		}),
		bytes: prometheus.NewCounter(prometheus.CounterOpts{
			Namespace: "aurora",
			Subsystem: "ingester",
			Name:      "bytes_processed_total",
			Help:      "Bytes successfully stored or recovered by the ingester.",
		}),
		lastOK: prometheus.NewGauge(prometheus.GaugeOpts{
			Namespace: "aurora",
			Subsystem: "ingester",
			Name:      "last_success_timestamp_seconds",
			Help:      "Unix timestamp of the last successfully processed product.",
		}),
	}

	m.registry.MustRegister(m.products)
	m.registry.MustRegister(m.duration)
	m.registry.MustRegister(m.errors)
	m.registry.MustRegister(m.inflight)
	m.registry.MustRegister(m.queue)
	m.registry.MustRegister(m.bytes)
	m.registry.MustRegister(m.lastOK)
	return m
}

// Handler exposes the isolated registry in Prometheus' text format.
func (m *Metrics) Handler() http.Handler {
	return promhttp.HandlerFor(m.registry, promhttp.HandlerOpts{})
}

// SetQueueDepth records the current number of queued products.
func (m *Metrics) SetQueueDepth(depth int) {
	if m != nil {
		m.queue.Set(float64(depth))
	}
}

// ProductStarted increments the active worker count.
func (m *Metrics) ProductStarted() {
	if m != nil {
		m.inflight.Inc()
	}
}

// ProductFinished records one terminal product result. Status values are
// intentionally limited to success, skipped, and failed.
func (m *Metrics) ProductFinished(status string, elapsedSeconds float64, bytes int64) {
	if m == nil {
		return
	}
	if status != "success" && status != "skipped" {
		status = "failed"
	}
	m.inflight.Dec()
	m.products.WithLabelValues(status).Inc()
	m.duration.WithLabelValues(status).Observe(float64(elapsedSeconds))
	if bytes > 0 {
		m.bytes.Add(float64(bytes))
	}
	if status == "failed" {
		m.errors.Inc()
		return
	}
	if status == "success" {
		m.lastOK.Set(float64(time.Now().Unix()))
	}
}
