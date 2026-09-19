package prometheus

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// Client handles low-level HTTP communication with the Prometheus server.
type Client struct {
	Endpoint string
	HTTP     *http.Client
}

// NewClient initializes a Prometheus HTTP client.
func NewClient(endpoint string) *Client {
	if endpoint == "" {
		endpoint = "http://127.0.0.1:9090"
	}
	return &Client{
		Endpoint: strings.TrimRight(endpoint, "/"),
		HTTP:     &http.Client{Timeout: 15 * time.Second},
	}
}

// Ping checks if the Prometheus server is reachable and healthy.
func (c *Client) Ping(ctx context.Context) error {
	if c == nil || c.Endpoint == "" {
		return fmt.Errorf("Prometheus endpoint is not configured")
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.Endpoint+"/-/healthy", nil)
	if err != nil {
		return fmt.Errorf("create Prometheus ping request: %w", err)
	}
	resp, err := c.HTTP.Do(req)
	if err != nil {
		return fmt.Errorf("Prometheus ping failed: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("Prometheus ping returned HTTP %d", resp.StatusCode)
	}
	return nil
}

// Get performs a GET request against an API path on Prometheus and returns the raw response body.
func (c *Client) Get(ctx context.Context, apiPath string, params url.Values) ([]byte, error) {
	if c == nil || c.Endpoint == "" {
		return nil, fmt.Errorf("Prometheus endpoint is not configured")
	}
	queryURL, err := url.Parse(c.Endpoint + apiPath)
	if err != nil {
		return nil, fmt.Errorf("parse Prometheus endpoint: %w", err)
	}
	if len(params) > 0 {
		queryURL.RawQuery = params.Encode()
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, queryURL.String(), nil)
	if err != nil {
		return nil, fmt.Errorf("create Prometheus query request: %w", err)
	}
	resp, err := c.HTTP.Do(req)
	if err != nil {
		return nil, fmt.Errorf("Prometheus request failed: %w", err)
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("read Prometheus response: %w", err)
	}
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("Prometheus returned HTTP %d: %s", resp.StatusCode, strings.TrimSpace(string(body)))
	}
	return body, nil
}
