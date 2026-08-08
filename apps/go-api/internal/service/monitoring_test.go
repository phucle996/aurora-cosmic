package service

import (
	"context"
	"sync"
	"testing"
	"time"

	"go-api/internal/domain/entity"
)

type fakeMonitoringPrometheus struct {
	mu      sync.Mutex
	queries []string
}

func (f *fakeMonitoringPrometheus) QueryRange(_ context.Context, query string, _ time.Time, _ time.Time, _ time.Duration) ([]entity.MonitoringPoint, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.queries = append(f.queries, query)
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
	if len(components[0].Metrics) != 4 {
		t.Fatalf("expected four Go API metric charts, got %d", len(components[0].Metrics))
	}
	if components[0].Status != "up" {
		t.Fatalf("expected component status up, got %q", components[0].Status)
	}
	if len(prometheus.queries) != 4 {
		t.Fatalf("expected four Prometheus queries, got %d", len(prometheus.queries))
	}
}

func TestMonitoringQueryRejectsUnknownTab(t *testing.T) {
	service := NewMonitoringService(&fakeMonitoringPrometheus{})
	if _, err := service.Query(context.Background(), entity.MonitoringWindow{Duration: time.Hour, Step: time.Minute}, "unknown"); err == nil {
		t.Fatal("expected unknown monitoring tab to fail")
	}
}
