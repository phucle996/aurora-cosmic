package ingester

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"go-api/internal/domain/entity"
)

type Client struct {
	Endpoint string
	HTTP     *http.Client
}

func NewClient(endpoint string) *Client {
	return &Client{Endpoint: strings.TrimRight(endpoint, "/"), HTTP: &http.Client{Timeout: 10 * time.Second}}
}

func (c *Client) Start(ctx context.Context, request entity.IngestStartRequest) (*entity.IngestControlJob, error) {
	var job entity.IngestControlJob
	if err := c.post(ctx, "/api/v1/ingest/jobs", request, &job); err != nil {
		return nil, err
	}
	return &job, nil
}

func (c *Client) Cancel(ctx context.Context, jobID string) (*entity.IngestControlJob, error) {
	var job entity.IngestControlJob
	if err := c.post(ctx, "/api/v1/ingest/jobs/"+jobID+"/cancel", map[string]string{}, &job); err != nil {
		return nil, err
	}
	return &job, nil
}

func (c *Client) post(ctx context.Context, path string, body any, output any) error {
	if c == nil || c.Endpoint == "" {
		return fmt.Errorf("ingester control endpoint is unavailable")
	}
	payload, err := json.Marshal(body)
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.Endpoint+path, bytes.NewReader(payload))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := c.HTTP.Do(req)
	if err != nil {
		return fmt.Errorf("ingester control request failed: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		return fmt.Errorf("ingester control returned HTTP %d", resp.StatusCode)
	}
	if err := json.NewDecoder(resp.Body).Decode(output); err != nil {
		return fmt.Errorf("decode ingester control response: %w", err)
	}
	return nil
}
