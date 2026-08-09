package service

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"go-api/internal/domain/entity"
)

type fakePreprocessingPrometheus struct {
	values map[string]float64
	err    error
}

func (f fakePreprocessingPrometheus) QueryRange(_ context.Context, query string, _ time.Time, _ time.Time, _ time.Duration) ([]entity.MonitoringPoint, error) {
	if f.err != nil {
		return nil, f.err
	}
	for key, value := range f.values {
		if strings.Contains(query, key) {
			return []entity.MonitoringPoint{{Timestamp: float64(time.Now().Unix()), Value: value}}, nil
		}
	}
	return []entity.MonitoringPoint{}, nil
}

func TestPreprocessingQueryReportsRunningFromLiveMetrics(t *testing.T) {
	svc := NewPreprocessingService(fakePreprocessingPrometheus{values: map[string]float64{
		"inflight_workers": 2,
		"queue_depth":      3,
		"products_total":   1,
		"errors_total":     0,
	}})
	graph, err := svc.Query(context.Background())
	if err != nil {
		t.Fatalf("query preprocessing: %v", err)
	}
	if graph.Status != "running" || len(graph.Hops) != 8 || graph.Hops[0].Status != "running" {
		t.Fatalf("expected running graph with eight live hops, got %#v", graph)
	}
	if graph.Source != "prometheus" || graph.ObservationScope != "preprocessor_service" {
		t.Fatalf("unexpected observation metadata: %#v", graph)
	}
}

func TestPreprocessingQueryKeepsNoDataGray(t *testing.T) {
	svc := NewPreprocessingService(fakePreprocessingPrometheus{values: map[string]float64{}})
	graph, err := svc.Query(context.Background())
	if err != nil {
		t.Fatalf("query preprocessing: %v", err)
	}
	if graph.Status != "not_observed" {
		t.Fatalf("expected not_observed, got %q", graph.Status)
	}
}

func TestPreprocessingQueryReturnsUnavailableWhenPrometheusFails(t *testing.T) {
	svc := NewPreprocessingService(fakePreprocessingPrometheus{err: errors.New("down")})
	if _, err := svc.Query(context.Background()); err == nil {
		t.Fatal("expected Prometheus failure")
	}
}
