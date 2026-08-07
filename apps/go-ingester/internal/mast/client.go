package mast

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// Client executes requests against the NASA MAST API.
type Client struct {
	baseURL    string
	httpClient *http.Client
	userAgent  string
}

// NewClient constructs a MAST client with the given base URL and timeout.
func NewClient(baseURL string, timeout time.Duration) *Client {
	return &Client{
		baseURL: strings.TrimRight(baseURL, "/"),
		httpClient: &http.Client{
			Timeout: timeout,
		},
		userAgent: "aurora-cosmic/go-ingester/2.1",
	}
}

// mastRequest is the JSON body sent to the MAST invoke endpoint.
type mastRequest struct {
	Service  string         `json:"service"`
	Params   map[string]any `json:"params"`
	Format   string         `json:"format"`
	Page     int            `json:"page,omitempty"`
	PageSize int            `json:"pagesize,omitempty"`
}

// mastResponse is the generic envelope returned by MAST.
type mastResponse[T any] struct {
	Status string   `json:"status"`
	Msg    string   `json:"msg"`
	Data   []T      `json:"data"`
	Paging *paging  `json:"paging"`
}

type paging struct {
	Page       int `json:"page"`
	PageSize   int `json:"pagesize"`
	PagesFiltered int `json:"pagesFiltered"`
	Rows       int `json:"rows"`
	RowsFound  int `json:"rowsFound"`
	RowsFiltered int `json:"rowsFiltered"`
}

// invoke sends a POST to MAST /invoke and decodes the response.
func invoke[T any](ctx context.Context, c *Client, req mastRequest) (*mastResponse[T], error) {
	body, err := json.Marshal(req)
	if err != nil {
		return nil, fmt.Errorf("mast: marshal request: %w", err)
	}

	form := url.Values{"request": {string(body)}}
	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL, strings.NewReader(form.Encode()))
	if err != nil {
		return nil, fmt.Errorf("mast: build request: %w", err)
	}
	httpReq.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	httpReq.Header.Set("User-Agent", c.userAgent)

	resp, err := c.httpClient.Do(httpReq)
	if err != nil {
		return nil, fmt.Errorf("mast: http request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		raw, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
		return nil, fmt.Errorf("mast: HTTP %d: %s", resp.StatusCode, strings.TrimSpace(string(raw)))
	}

	var out mastResponse[T]
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return nil, fmt.Errorf("mast: decode response: %w", err)
	}
	if out.Status != "COMPLETE" && out.Status != "OK" {
		return nil, fmt.Errorf("mast: api status=%q msg=%q", out.Status, out.Msg)
	}
	return &out, nil
}
