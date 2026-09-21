package provider

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
	"net/url"
	"strconv"
	"time"

	"go-api/infra/prometheus"
	"go-api/internal/domain/entity"
	"go-api/internal/domain/repo"
)

// PrometheusQueryBase executes PromQL queries via Prometheus client and maps results to domain points.
type PrometheusQueryBase struct {
	client *prometheus.Client
}

// NewPrometheusQueryBase constructs a Prometheus query base provider.
func NewPrometheusQueryBase(client *prometheus.Client) repo.PrometheusQuerier {
	return &PrometheusQueryBase{client: client}
}

// QueryRange evaluates a PromQL query expression over a range and maps to entity.MonitoringPoint points.
func (q *PrometheusQueryBase) QueryRange(ctx context.Context, expression string, start, end time.Time, step time.Duration) ([]entity.MonitoringPoint, error) {
	if q == nil || q.client == nil {
		return nil, fmt.Errorf("Prometheus query client is not configured")
	}

	params := url.Values{}
	params.Set("query", expression)
	params.Set("start", strconv.FormatInt(start.Unix(), 10))
	params.Set("end", strconv.FormatInt(end.Unix(), 10))
	params.Set("step", strconv.FormatInt(int64(step/time.Second), 10))

	body, err := q.client.Get(ctx, "/api/v1/query_range", params)
	if err != nil {
		return nil, err
	}

	var payload struct {
		Status string `json:"status"`
		Data   struct {
			Result []struct {
				Metric map[string]string   `json:"metric"`
				Values [][]json.RawMessage `json:"values"`
			} `json:"result"`
		} `json:"data"`
		ErrorType string `json:"errorType"`
		Error     string `json:"error"`
	}

	if err := json.Unmarshal(body, &payload); err != nil {
		return nil, fmt.Errorf("decode Prometheus response: %w", err)
	}

	if payload.Status != "success" {
		return nil, fmt.Errorf("Prometheus query failed: %s: %s", payload.ErrorType, payload.Error)
	}

	if len(payload.Data.Result) == 0 {
		return []entity.MonitoringPoint{}, nil
	}

	if len(payload.Data.Result) != 1 {
		return nil, fmt.Errorf("Prometheus query returned %d series; monitoring queries must aggregate labels explicitly", len(payload.Data.Result))
	}

	labels := payload.Data.Result[0].Metric
	points := make([]entity.MonitoringPoint, 0, len(payload.Data.Result[0].Values))
	for _, pair := range payload.Data.Result[0].Values {
		if len(pair) != 2 {
			continue
		}
		var timestamp float64
		var rawValue string
		if json.Unmarshal(pair[0], &timestamp) != nil || json.Unmarshal(pair[1], &rawValue) != nil {
			continue
		}
		value, err := strconv.ParseFloat(rawValue, 64)
		if err == nil && !math.IsNaN(value) && !math.IsInf(value, 0) {
			points = append(points, entity.MonitoringPoint{
				Timestamp: timestamp,
				Value:     value,
				Labels:    labels,
			})
		}
	}

	return points, nil
}
