package prometheus

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"go-api/internal/domain/entity"
)

type Client struct {
	Endpoint string
	HTTP     *http.Client
}

func NewClient(endpoint string) *Client {
	return &Client{Endpoint: strings.TrimRight(endpoint, "/"), HTTP: &http.Client{Timeout: 12 * time.Second}}
}

func (p *Client) QueryRange(ctx context.Context, expression string, start, end time.Time, step time.Duration) ([]entity.MonitoringPoint, error) {
	if p == nil || p.Endpoint == "" {
		return nil, fmt.Errorf("Prometheus endpoint is not configured")
	}
	queryURL, err := url.Parse(p.Endpoint + "/api/v1/query_range")
	if err != nil {
		return nil, fmt.Errorf("parse Prometheus endpoint: %w", err)
	}
	values := queryURL.Query()
	values.Set("query", expression)
	values.Set("start", strconv.FormatInt(start.Unix(), 10))
	values.Set("end", strconv.FormatInt(end.Unix(), 10))
	values.Set("step", strconv.FormatInt(int64(step/time.Second), 10))
	queryURL.RawQuery = values.Encode()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, queryURL.String(), nil)
	if err != nil {
		return nil, fmt.Errorf("create Prometheus query: %w", err)
	}
	resp, err := p.HTTP.Do(req)
	if err != nil {
		return nil, fmt.Errorf("Prometheus request failed: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("Prometheus returned HTTP %d", resp.StatusCode)
	}
	var payload struct {
		Status string `json:"status"`
		Data   struct {
			Result []struct {
				Values [][]json.RawMessage `json:"values"`
			} `json:"result"`
		} `json:"data"`
		ErrorType string `json:"errorType"`
		Error     string `json:"error"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&payload); err != nil {
		return nil, fmt.Errorf("decode Prometheus response: %w", err)
	}
	if payload.Status != "success" {
		return nil, fmt.Errorf("Prometheus query failed: %s: %s", payload.ErrorType, payload.Error)
	}
	if len(payload.Data.Result) == 0 {
		return []entity.MonitoringPoint{}, nil
	}
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
		if err == nil {
			points = append(points, entity.MonitoringPoint{Timestamp: timestamp, Value: value})
		}
	}
	return points, nil
}
