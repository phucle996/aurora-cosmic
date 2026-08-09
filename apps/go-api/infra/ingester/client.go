package ingester

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"go-api/internal/domain/entity"
)

type Client struct {
	Endpoint string
	HTTP     *http.Client
}

// HTTPError preserves the downstream control-plane status so the API can
// distinguish a single-flight conflict from an unavailable ingester.
type HTTPError struct {
	StatusCode int
	Body       string
}

func (e *HTTPError) Error() string {
	if e.Body == "" {
		return fmt.Sprintf("ingester control returned HTTP %d", e.StatusCode)
	}
	return fmt.Sprintf("ingester control returned HTTP %d: %s", e.StatusCode, e.Body)
}

func (e *HTTPError) HTTPStatusCode() int { return e.StatusCode }

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
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 4<<10))
		return &HTTPError{StatusCode: resp.StatusCode, Body: strings.TrimSpace(string(body))}
	}
	if err := json.NewDecoder(resp.Body).Decode(output); err != nil {
		return fmt.Errorf("decode ingester control response: %w", err)
	}
	return nil
}
