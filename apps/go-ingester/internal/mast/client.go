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
	downloadURL string
	httpClient *http.Client
	userAgent  string
}

// NewClient constructs a MAST client with the given base URL and timeout.
func NewClient(baseURL string, timeout time.Duration) *Client {
	base := strings.TrimRight(baseURL, "/")
	// Derive download URL: default MAST download endpoint is https://mast.stsci.edu/api/v0/download/file
	downloadEndpoint := "https://mast.stsci.edu/api/v0/download/file"
	if strings.Contains(base, "http://") || strings.Contains(base, "127.0.0.1") || strings.Contains(base, "localhost") {
		// In test or local mock environment, derive download URL from base URL
		downloadEndpoint = base + "/download/file"
	}

	return &Client{
		baseURL:     base,
		downloadURL: downloadEndpoint,
		httpClient: &http.Client{
			Timeout: timeout,
		},
		userAgent: "aurora-cosmic/go-ingester/2.1",
	}
}

// SetDownloadURL overrides the download endpoint (useful for testing).
func (c *Client) SetDownloadURL(downloadURL string) {
	c.downloadURL = downloadURL
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
	Page          int `json:"page"`
	PageSize      int `json:"pagesize"`
	PagesFiltered int `json:"pagesFiltered"`
	Rows          int `json:"rows"`
	RowsFound     int `json:"rowsFound"`
	RowsFiltered  int `json:"rowsFiltered"`
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

// OpenProduct opens an HTTP stream to download a data product given its dataURI.
// Returns an io.ReadCloser for streaming, content length, and an error.
// Retries on 429, temporary 5xx, or network errors with bounded backoff.
func (c *Client) OpenProduct(ctx context.Context, dataURI string) (io.ReadCloser, int64, error) {
	targetURL := dataURI
	if strings.HasPrefix(dataURI, "mast:") || !strings.HasPrefix(dataURI, "http") {
		targetURL = fmt.Sprintf("%s?uri=%s", c.downloadURL, url.QueryEscape(dataURI))
	}

	maxAttempts := 3
	var lastErr error

	for attempt := 1; attempt <= maxAttempts; attempt++ {
		select {
		case <-ctx.Done():
			return nil, 0, ctx.Err()
		default:
		}

		req, err := http.NewRequestWithContext(ctx, http.MethodGet, targetURL, nil)
		if err != nil {
			return nil, 0, fmt.Errorf("mast: build download req: %w", err)
		}
		req.Header.Set("User-Agent", c.userAgent)

		resp, err := c.httpClient.Do(req)
		if err != nil {
			lastErr = fmt.Errorf("mast: download attempt %d failed: %w", attempt, err)
			if attempt < maxAttempts {
				time.Sleep(time.Duration(attempt*100) * time.Millisecond)
				continue
			}
			return nil, 0, lastErr
		}

		if resp.StatusCode == http.StatusOK {
			return resp.Body, resp.ContentLength, nil
		}

		// Read small error body snippet and close body.
		snippet, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
		resp.Body.Close()

		lastErr = fmt.Errorf("mast: download HTTP %d: %s", resp.StatusCode, strings.TrimSpace(string(snippet)))

		// Retry candidates: 429, 500, 502, 503, 504
		isRetryable := resp.StatusCode == 429 || (resp.StatusCode >= 500 && resp.StatusCode <= 504)
		if !isRetryable || attempt == maxAttempts {
			return nil, 0, lastErr
		}

		backoff := time.Duration(attempt*200) * time.Millisecond
		select {
		case <-time.After(backoff):
		case <-ctx.Done():
			return nil, 0, ctx.Err()
		}
	}

	return nil, 0, lastErr
}
