package clickhouse

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"time"
)

type Client struct {
	Endpoint string
	Database string
	Username string
	Password string
	HTTP     *http.Client
}

func NewClient(endpoint, database, username, password string) *Client {
	if endpoint == "" {
		endpoint = "http://clickhouse:8123"
	}
	if database == "" {
		database = "aurora"
	}
	return &Client{Endpoint: endpoint, Database: database, Username: username, Password: password, HTTP: &http.Client{Timeout: 10 * time.Second}}
}

func (c *Client) Ping(ctx context.Context) error {
	_, err := c.Query(ctx, "SELECT 1 FORMAT JSON")
	return err
}

func (c *Client) Query(ctx context.Context, query string) ([]byte, error) {
	reqURL := fmt.Sprintf("%s/?database=%s&query=%s", c.Endpoint, url.QueryEscape(c.Database), url.QueryEscape(query))
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, reqURL, nil)
	if err != nil {
		return nil, fmt.Errorf("build ClickHouse request: %w", err)
	}
	if c.Username != "" {
		req.SetBasicAuth(c.Username, c.Password)
	}
	resp, err := c.HTTP.Do(req)
	if err != nil {
		return nil, fmt.Errorf("ClickHouse connection failed: %w", err)
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("read ClickHouse response: %w", err)
	}
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("ClickHouse returned HTTP %d: %s", resp.StatusCode, string(body))
	}
	return body, nil
}
