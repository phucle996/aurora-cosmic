package monitoring

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

type Point struct {
	Timestamp float64 `json:"timestamp"`
	Value     float64 `json:"value"`
}

type Querier interface {
	QueryRange(context.Context, string, time.Time, time.Time, time.Duration) ([]Point, error)
}

type Prometheus struct {
	Endpoint string
	Client   *http.Client
}

func NewPrometheus(endpoint string) *Prometheus {
	return &Prometheus{
		Endpoint: strings.TrimRight(endpoint, "/"),
		Client:   &http.Client{Timeout: 12 * time.Second},
	}
}

type queryResponse struct {
	Status string `json:"status"`
	Data   struct {
		ResultType string `json:"resultType"`
		Result     []struct {
			Values [][]json.RawMessage `json:"values"`
		} `json:"result"`
	} `json:"data"`
	ErrorType string `json:"errorType"`
	Error     string `json:"error"`
}

func (p *Prometheus) QueryRange(ctx context.Context, expression string, start, end time.Time, step time.Duration) ([]Point, error) {
	if p == nil || p.Endpoint == "" {
		return nil, fmt.Errorf("Prometheus endpoint is not configured")
	}
	queryURL, err := url.Parse(p.Endpoint + "/api/v1/query_range")
	if err != nil {
		return nil, fmt.Errorf("parse Prometheus endpoint: %w", err)
	}
	values := queryURL.Query()
	values.Set("query", expression)
	values.Set("start", strconv.FormatFloat(float64(start.Unix()), 'f', 0, 64))
	values.Set("end", strconv.FormatFloat(float64(end.Unix()), 'f', 0, 64))
	values.Set("step", strconv.FormatInt(int64(step/time.Second), 10))
	queryURL.RawQuery = values.Encode()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, queryURL.String(), nil)
	if err != nil {
		return nil, fmt.Errorf("create Prometheus query: %w", err)
	}
	resp, err := p.Client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("Prometheus request failed: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("Prometheus returned HTTP %d", resp.StatusCode)
	}
	var payload queryResponse
	if err := json.NewDecoder(resp.Body).Decode(&payload); err != nil {
		return nil, fmt.Errorf("decode Prometheus response: %w", err)
	}
	if payload.Status != "success" {
		return nil, fmt.Errorf("Prometheus query failed: %s: %s", payload.ErrorType, payload.Error)
	}
	if len(payload.Data.Result) == 0 {
		return []Point{}, nil
	}
	points := make([]Point, 0, len(payload.Data.Result[0].Values))
	for _, pair := range payload.Data.Result[0].Values {
		if len(pair) != 2 {
			continue
		}
		var timestamp float64
		var rawValue string
		if err := json.Unmarshal(pair[0], &timestamp); err != nil {
			continue
		}
		if err := json.Unmarshal(pair[1], &rawValue); err != nil {
			continue
		}
		value, err := strconv.ParseFloat(rawValue, 64)
		if err != nil {
			continue
		}
		points = append(points, Point{Timestamp: timestamp, Value: value})
	}
	return points, nil
}
