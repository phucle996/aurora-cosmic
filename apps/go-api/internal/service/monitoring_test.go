package service

import (
	"context"
	"errors"
	"strings"
	"sync"
	"testing"
	"time"

	"go-api/internal/domain/entity"
)

type fakeMonitoringPrometheus struct {
	mu      sync.Mutex
	queries []string
	fail    bool
}

type idleMonitoringPrometheus struct{}

func (idleMonitoringPrometheus) QueryRange(_ context.Context, query string, _ time.Time, _ time.Time, _ time.Duration) ([]entity.MonitoringPoint, error) {
	if query == `max(up{job="aurora-python-ml-worker"})` {
		return []entity.MonitoringPoint{{Timestamp: 1, Value: 1}}, nil
	}
	return []entity.MonitoringPoint{}, nil
}

func (f *fakeMonitoringPrometheus) QueryRange(_ context.Context, query string, _ time.Time, _ time.Time, _ time.Duration) ([]entity.MonitoringPoint, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.queries = append(f.queries, query)
	if f.fail {
		return nil, errors.New("prometheus query failed")
	}
	return []entity.MonitoringPoint{{Timestamp: 1, Value: 2}}, nil
}

func TestMonitoringQuerySelectsOneComponentAndReturnsMetricSeries(t *testing.T) {
	prometheus := &fakeMonitoringPrometheus{}
	service := NewMonitoringService(prometheus)
	components, err := service.Query(context.Background(), entity.MonitoringWindow{Duration: time.Hour, Step: time.Minute}, "go-api")
	if err != nil {
		t.Fatalf("query monitoring: %v", err)
	}
	if len(components) != 1 || components[0].ID != "go-api" {
		t.Fatalf("expected only go-api component, got %#v", components)
	}
	expectedMetrics := 4 // throughput, duration_p95, errors, inflight
	if len(components[0].Metrics) != expectedMetrics {
		t.Fatalf("expected %d Go API operational metrics, got %d", expectedMetrics, len(components[0].Metrics))
	}
	if components[0].Status != "up" {
		t.Fatalf("expected component status up, got %q", components[0].Status)
	}
	if len(prometheus.queries) != expectedMetrics+1 {
		t.Fatalf("expected %d metric queries plus health, got %d", expectedMetrics, len(prometheus.queries))
	}
}

func TestMonitoringContractUsesHealthAndNonDuplicatedOperationalSignals(t *testing.T) {
	seenIDs := make(map[string]bool, len(components))
	for _, component := range components {
		if seenIDs[component.ID] {
			t.Fatalf("duplicate component id %q", component.ID)
		}
		seenIDs[component.ID] = true
		if component.HealthQuery == "" {
			t.Fatalf("component %q has no health query", component.ID)
		}
		if !strings.HasPrefix(component.HealthQuery, "max(up{") {
			t.Fatalf("component %q health query must use native prometheus up scraper, got %q", component.ID, component.HealthQuery)
		}
		seenKeys := make(map[string]bool, len(component.Metrics))
		for _, metric := range component.Metrics {
			if seenKeys[metric.Key] {
				t.Fatalf("component %q has duplicate metric key %q", component.ID, metric.Key)
			}
			seenKeys[metric.Key] = true
			if strings.Contains(metric.Query, "aurora_systemd_") || strings.Contains(metric.Query, "aurora_host_") {
				t.Fatalf("component %q still contains systemd or host cgroup query: %s", component.ID, metric.Query)
			}
		}
	}

	ml, err := selectComponents("python-ml-worker")
	if err != nil {
		t.Fatal(err)
	}
	for _, metric := range ml[0].Metrics {
		if metric.Key == "rows" || metric.Key == "cpu_time" {
			t.Fatalf("misleading ML metric remains in contract: %q", metric.Key)
		}
	}

	nats, err := selectComponents("nats")
	if err != nil {
		t.Fatal(err)
	}
	for _, metric := range nats[0].Metrics {
		if metric.Key == "cpu" && metric.Query != "max(gnatsd_varz_cpu)" {
			t.Fatalf("NATS CPU must use exporter percent directly, got %q", metric.Query)
		}
	}
}

func TestComponentsExposeTailoredDomainMetrics(t *testing.T) {
	// Verify each service exposes only its tailored domain metrics
	expectedKeys := map[string][]string{
		"go-ingester":        {"throughput", "duration_p95", "errors", "inflight", "queue", "bytes"},
		"rust-preprocessor":  {"throughput", "duration_p95", "errors", "inflight", "queue", "backlog", "bytes"},
		"python-ml-worker":   {"throughput", "duration_p95", "errors", "inflight", "queue", "gpu_available", "gpu_utilization", "gpu_memory_used", "gpu_memory_total"},
		"rust-inference":     {"throughput", "duration_p95", "errors", "inflight", "queue", "rows"},
		"gold-builder":       {"throughput", "duration_p95", "errors", "deferred", "inflight", "queue", "rows"},
		"go-api":             {"throughput", "duration_p95", "errors", "inflight"},
		"minio":              {"requests", "ttfb_p95", "inflight", "errors", "traffic_in", "traffic_out", "usage", "objects", "offline_drives"},
		"nats":               {"inbound", "outbound", "connections", "cpu", "memory", "pending_bytes"},
		"clickhouse":         {"queries", "duration", "failed_queries", "active_queries", "memory"},
	}

	if len(components) != len(expectedKeys) {
		t.Fatalf("expected %d components, got %d", len(expectedKeys), len(components))
	}

	for _, component := range components {
		expected, exists := expectedKeys[component.ID]
		if !exists {
			t.Fatalf("unexpected component %q in registry", component.ID)
		}
		actualKeys := make(map[string]bool, len(component.Metrics))
		for _, m := range component.Metrics {
			actualKeys[m.Key] = true
		}
		for _, key := range expected {
			if !actualKeys[key] {
				t.Errorf("component %q missing expected metric %q", component.ID, key)
			}
		}
		if len(component.Metrics) != len(expected) {
			t.Errorf("component %q expected %d metrics, got %d", component.ID, len(expected), len(component.Metrics))
		}
	}
}

func TestMonitoringQueryRejectsUnknownComponent(t *testing.T) {
	service := NewMonitoringService(&fakeMonitoringPrometheus{})
	if _, err := service.Query(context.Background(), entity.MonitoringWindow{Duration: time.Hour, Step: time.Minute}, "unknown"); err == nil {
		t.Fatal("expected unknown monitoring component to fail")
	}
}

func TestIdleComponentIsNotMarkedDegradedWhenHealthIsUp(t *testing.T) {
	service := NewMonitoringService(idleMonitoringPrometheus{})
	components, err := service.Query(context.Background(), entity.MonitoringWindow{Duration: time.Hour, Step: time.Minute}, "python-ml-worker")
	if err != nil {
		t.Fatalf("query idle monitoring: %v", err)
	}
	if len(components) != 1 || components[0].Status != "up" {
		t.Fatalf("idle healthy component must remain up, got %#v", components)
	}
}

func TestMonitoringQueryPreservesMetricContractWhenPrometheusHasNoSeries(t *testing.T) {
	service := NewMonitoringService(&fakeMonitoringPrometheus{fail: true})
	components, err := service.Query(context.Background(), entity.MonitoringWindow{Duration: time.Hour, Step: time.Minute}, "go-api")
	if err != nil {
		t.Fatalf("query monitoring: %v", err)
	}
	if len(components) != 1 || components[0].Status != "no_data" {
		t.Fatalf("expected one no_data component, got %#v", components)
	}
	for _, metric := range components[0].Metrics {
		if metric.Key == "" || metric.Name == "" || metric.Unit == "" || metric.Kind == "" {
			t.Fatalf("expected metric metadata to survive a failed query, got %#v", metric)
		}
		if len(metric.Points) != 0 {
			t.Fatalf("expected no samples for failed query, got %#v", metric.Points)
		}
	}
}
