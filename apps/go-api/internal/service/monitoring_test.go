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

func TestMonitoringQuerySelectsOneTabAndReturnsMetricSeries(t *testing.T) {
	prometheus := &fakeMonitoringPrometheus{}
	service := NewMonitoringService(prometheus)
	components, err := service.Query(context.Background(), entity.MonitoringWindow{Duration: time.Hour, Step: time.Minute}, "go-api")
	if err != nil {
		t.Fatalf("query monitoring: %v", err)
	}
	if len(components) != 1 || components[0].ID != "go-api" {
		t.Fatalf("expected only go-api component, got %#v", components)
	}
	expectedMetrics := 4 + len(systemdMetrics("aurora-go-api.service"))
	if len(components[0].Metrics) != expectedMetrics {
		t.Fatalf("expected %d Go API business and resource metrics, got %d", expectedMetrics, len(components[0].Metrics))
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
		seenKeys := make(map[string]bool, len(component.Metrics))
		for _, metric := range component.Metrics {
			if seenKeys[metric.Key] {
				t.Fatalf("component %q has duplicate metric key %q", component.ID, metric.Key)
			}
			seenKeys[metric.Key] = true
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

func TestProcessHopsExposePerServiceResourceAccounting(t *testing.T) {
	units := map[string]string{
		"go-ingester":       "aurora-go-ingester.service",
		"rust-preprocessor": "aurora-rust-preprocessor.service",
		"python-ml-worker":  "aurora-python-ml-worker.service",
		"rust-inference":    "aurora-rust-inference.service",
		"gold-builder":      "aurora-gold-builder.service",
		"go-api":            "aurora-go-api.service",
		"dashboard":         "aurora-dashboard.service",
	}
	required := []string{"memory", "memory_total", "cpu_cores", "cpu_cores_total", "disk_read", "disk_write"}
	unitScoped := map[string]bool{"memory": true, "cpu_cores": true, "disk_read": true, "disk_write": true}

	for _, component := range components {
		unit, ok := units[component.ID]
		if !ok {
			continue
		}
		metrics := make(map[string]metricSpec, len(component.Metrics))
		for _, metric := range component.Metrics {
			if metric.Key == "restarts" {
				t.Errorf("component %q still exposes the host-specific process restart metric", component.ID)
			}
			metrics[metric.Key] = metric
		}
		for _, key := range required {
			metric, exists := metrics[key]
			if !exists {
				t.Errorf("component %q is missing resource metric %q", component.ID, key)
				continue
			}
			if unitScoped[key] && !strings.Contains(metric.Query, `unit="`+unit+`"`) {
				t.Errorf("component %q metric %q is not scoped to unit %q: %s", component.ID, key, unit, metric.Query)
			}
		}
	}
}

func TestMonitoringQueryRejectsUnknownTab(t *testing.T) {
	service := NewMonitoringService(&fakeMonitoringPrometheus{})
	if _, err := service.Query(context.Background(), entity.MonitoringWindow{Duration: time.Hour, Step: time.Minute}, "unknown"); err == nil {
		t.Fatal("expected unknown monitoring tab to fail")
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
