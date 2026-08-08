package http

import (
	"context"
	"fmt"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"go-api/internal/monitoring"
)

type monitoringComponentSpec struct {
	ID        string
	Name      string
	Group     string
	Container string
}

var monitoringComponents = []monitoringComponentSpec{
	{ID: "go-ingester", Name: "Go Ingester", Group: "Pipeline", Container: "aurora-go-ingester"},
	{ID: "rust-preprocessor", Name: "Rust Preprocessor", Group: "Pipeline", Container: "aurora-rust-preprocessor"},
	{ID: "python-ml-worker", Name: "Python ML Worker", Group: "Pipeline", Container: "aurora-python-ml-worker"},
	{ID: "rust-inference", Name: "Rust GPU Inference", Group: "Pipeline", Container: "aurora-rust-inference"},
	{ID: "go-api", Name: "Go API", Group: "Platform", Container: "aurora-go-api"},
	{ID: "minio", Name: "MinIO Storage", Group: "Platform", Container: "aurora-minio"},
	{ID: "nats", Name: "NATS JetStream", Group: "Platform", Container: "aurora-nats"},
	{ID: "clickhouse", Name: "ClickHouse", Group: "Platform", Container: "aurora-clickhouse"},
	{ID: "prometheus", Name: "Prometheus", Group: "Observability", Container: "aurora-prometheus"},
	{ID: "cadvisor", Name: "cAdvisor", Group: "Observability", Container: "aurora-cadvisor"},
}

type monitoringMetric struct {
	CPU       []monitoring.Point `json:"cpu"`
	Memory    []monitoring.Point `json:"memory"`
	NetworkRX []monitoring.Point `json:"network_rx"`
	NetworkTX []monitoring.Point `json:"network_tx"`
}

type monitoringComponent struct {
	ID        string           `json:"id"`
	Name      string           `json:"name"`
	Group     string           `json:"group"`
	Container string           `json:"container"`
	Status    string           `json:"status"`
	Metrics   monitoringMetric `json:"metrics"`
}

func (r *Router) handleMonitoring(w http.ResponseWriter, req *http.Request) {
	if r.monitoringClient == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "Prometheus monitoring is unavailable"})
		return
	}
	duration, step, err := monitoringWindow(req)
	if err != nil {
		writeBadRequest(w, err.Error())
		return
	}
	end := time.Now().UTC()
	start := end.Add(-duration)
	components := make([]monitoringComponent, len(monitoringComponents))
	var waitGroup sync.WaitGroup
	for index, spec := range monitoringComponents {
		waitGroup.Add(1)
		go func(index int, spec monitoringComponentSpec) {
			defer waitGroup.Done()
			components[index] = r.queryComponent(req.Context(), spec, start, end, step)
		}(index, spec)
	}
	waitGroup.Wait()
	sort.SliceStable(components, func(i, j int) bool {
		if components[i].Group == components[j].Group {
			return components[i].Name < components[j].Name
		}
		return components[i].Group < components[j].Group
	})
	writeJSON(w, http.StatusOK, map[string]any{
		"source":       "prometheus",
		"range":        duration.String(),
		"start":        start.Format(time.RFC3339),
		"end":          end.Format(time.RFC3339),
		"step_seconds": int64(step / time.Second),
		"components":   components,
	})
}

func (r *Router) queryComponent(ctx context.Context, spec monitoringComponentSpec, start, end time.Time, step time.Duration) monitoringComponent {
	component := monitoringComponent{
		ID: spec.ID, Name: spec.Name, Group: spec.Group, Container: spec.Container, Status: "no_data",
	}
	queries := map[string]string{
		"cpu":        fmt.Sprintf(`sum(rate(container_cpu_usage_seconds_total{name=%q}[2m]))`, spec.Container),
		"memory":     fmt.Sprintf(`max(container_memory_working_set_bytes{name=%q})`, spec.Container),
		"network_rx": fmt.Sprintf(`sum(rate(container_network_receive_bytes_total{name=%q}[2m]))`, spec.Container),
		"network_tx": fmt.Sprintf(`sum(rate(container_network_transmit_bytes_total{name=%q}[2m]))`, spec.Container),
	}
	var waitGroup sync.WaitGroup
	var mutex sync.Mutex
	for metricName, expression := range queries {
		waitGroup.Add(1)
		go func(metricName, expression string) {
			defer waitGroup.Done()
			points, err := r.monitoringClient.QueryRange(ctx, expression, start, end, step)
			if err != nil {
				return
			}
			mutex.Lock()
			switch metricName {
			case "cpu":
				component.Metrics.CPU = points
			case "memory":
				component.Metrics.Memory = points
			case "network_rx":
				component.Metrics.NetworkRX = points
			case "network_tx":
				component.Metrics.NetworkTX = points
			}
			mutex.Unlock()
		}(metricName, expression)
	}
	waitGroup.Wait()
	if len(component.Metrics.CPU)+len(component.Metrics.Memory)+len(component.Metrics.NetworkRX)+len(component.Metrics.NetworkTX) > 0 {
		component.Status = "up"
	}
	return component
}

func monitoringWindow(req *http.Request) (time.Duration, time.Duration, error) {
	duration := time.Hour
	if raw := strings.TrimSpace(req.URL.Query().Get("range")); raw != "" {
		parsed, err := time.ParseDuration(raw)
		if err != nil || parsed <= 0 || parsed > 24*time.Hour {
			return 0, 0, fmt.Errorf("range must be a positive duration up to 24h")
		}
		duration = parsed
	}
	step := 60 * time.Second
	if raw := strings.TrimSpace(req.URL.Query().Get("step")); raw != "" {
		seconds, err := strconv.Atoi(raw)
		if err != nil || seconds < 15 || seconds > 900 {
			return 0, 0, fmt.Errorf("step must be between 15 and 900 seconds")
		}
		step = time.Duration(seconds) * time.Second
	}
	return duration, step, nil
}
