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

type MonitoringService struct{ prometheus repo.PrometheusQuerier }

func NewMonitoringService(prometheus repo.PrometheusQuerier) domainService.Monitoring {
	return &MonitoringService{prometheus: prometheus}
}

type componentSpec struct{ ID, Name, Group, Container string }

var components = []componentSpec{
	{"go-ingester", "Go Ingester", "Pipeline", "aurora-go-ingester"},
	{"rust-preprocessor", "Rust Preprocessor", "Pipeline", "aurora-rust-preprocessor"},
	{"python-ml-worker", "Python ML Worker", "Pipeline", "aurora-python-ml-worker"},
	{"rust-inference", "Rust GPU Inference", "Pipeline", "aurora-rust-inference"},
	{"go-api", "Go API", "Platform", "aurora-go-api"},
	{"minio", "MinIO Storage", "Platform", "aurora-minio"},
	{"nats", "NATS JetStream", "Platform", "aurora-nats"},
	{"clickhouse", "ClickHouse", "Platform", "aurora-clickhouse"},
	{"prometheus", "Prometheus", "Observability", "aurora-prometheus"},
}

func (s *MonitoringService) Query(ctx context.Context, window entity.MonitoringWindow) ([]entity.MonitoringComponent, error) {
	if s.prometheus == nil {
		return nil, fmt.Errorf("Prometheus monitoring is unavailable")
	}
	end := time.Now().UTC()
	start := end.Add(-window.Duration)
	result := make([]entity.MonitoringComponent, len(components))
	var wg sync.WaitGroup
	for i, spec := range components {
		wg.Add(1)
		go func(i int, spec componentSpec) {
			defer wg.Done()

			component := entity.MonitoringComponent{
				ID:        spec.ID,
				Name:      spec.Name,
				Group:     spec.Group,
				Container: spec.Container,
				Status:    "no_data",
			}
			queries := map[string]string{
				"cpu":        fmt.Sprintf(`sum(rate(container_cpu_usage_seconds_total{name=%q}[2m]))`, spec.Container),
				"memory":     fmt.Sprintf(`max(container_memory_working_set_bytes{name=%q})`, spec.Container),
				"network_rx": fmt.Sprintf(`sum(rate(container_network_receive_bytes_total{name=%q}[2m]))`, spec.Container),
				"network_tx": fmt.Sprintf(`sum(rate(container_network_transmit_bytes_total{name=%q}[2m]))`, spec.Container),
			}
			var qWg sync.WaitGroup
			var mu sync.Mutex
			for name, expression := range queries {
				qWg.Add(1)
				go func(name, expression string) {
					defer qWg.Done()
					points, err := s.prometheus.QueryRange(ctx, expression, start, end, window.Step)
					if err != nil {
						return
					}
					mu.Lock()
					switch name {
					case "cpu":
						component.Metrics.CPU = points
					case "memory":
						component.Metrics.Memory = points
					case "network_rx":
						component.Metrics.NetworkRX = points
					case "network_tx":
						component.Metrics.NetworkTX = points
					}
					mu.Unlock()
				}(name, expression)
			}
			qWg.Wait()
			if len(component.Metrics.CPU)+len(component.Metrics.Memory)+len(component.Metrics.NetworkRX)+len(component.Metrics.NetworkTX) > 0 {
				component.Status = "up"
			}
			result[i] = component
		}(i, spec)
	}
	wg.Wait()
	sort.SliceStable(result, func(i, j int) bool {
		if result[i].Group == result[j].Group {
			return result[i].Name < result[j].Name
		}
		return result[i].Group < result[j].Group
	})
	return result, nil
}
