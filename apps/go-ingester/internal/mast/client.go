package mast

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"time"

	"go-ingester/internal/model"
)

// Client wraps HTTP communication with NASA MAST API.
type Client struct {
	baseURL     string
	downloadURL string
	httpClient  *http.Client
}

// NewClient constructs a MAST Client instance.
func NewClient(baseURL string, timeout time.Duration) *Client {
	if baseURL == "" {
		baseURL = "https://mast.stsci.edu/api/v0/invoke"
	}
	return &Client{
		baseURL:     baseURL,
		downloadURL: "https://mast.stsci.edu/api/v0/download/file",
		httpClient: &http.Client{
			Timeout: timeout,
		},
	}
}

// SetDownloadURL overrides the default download endpoint (useful for mock servers in testing).
func (c *Client) SetDownloadURL(downloadURL string) {
	c.downloadURL = downloadURL
}

// Query performs a POST request to the MAST API endpoint.
func (c *Client) Query(ctx context.Context, reqBody url.Values) ([]byte, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL, nil)
	if err != nil {
		return nil, fmt.Errorf("mast query: create request: %w", err)
	}

	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.URL.RawQuery = reqBody.Encode()

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("mast query: execute: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("mast query status %d: %s", resp.StatusCode, string(body))
	}

	data, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("mast query: read body: %w", err)
	}

	return data, nil
}

// OpenProduct streams product content by URI with retry logic (429 / 5xx).
func (c *Client) OpenProduct(ctx context.Context, dataURI string) (io.ReadCloser, int64, error) {
	targetURL := dataURI
	if dataURI == "" {
		return nil, 0, fmt.Errorf("mast open product: dataURI is empty")
	}

	if len(dataURI) < 4 || dataURI[:4] != "http" {
		targetURL = fmt.Sprintf("%s?uri=%s", c.downloadURL, url.QueryEscape(dataURI))
	}

	maxRetries := 3
	backoff := 500 * time.Millisecond

	for attempt := 0; attempt <= maxRetries; attempt++ {
		if attempt > 0 {
			select {
			case <-ctx.Done():
				return nil, 0, ctx.Err()
			case <-time.After(backoff):
				backoff *= 2
			}
		}

		req, err := http.NewRequestWithContext(ctx, http.MethodGet, targetURL, nil)
		if err != nil {
			return nil, 0, fmt.Errorf("mast open product: create request: %w", err)
		}

		resp, err := c.httpClient.Do(req)
		if err != nil {
			if attempt < maxRetries {
				continue
			}
			return nil, 0, fmt.Errorf("mast open product: execute: %w", err)
		}

		if resp.StatusCode == http.StatusOK {
			contentLength := resp.ContentLength
			if contentLength <= 0 {
				if clStr := resp.Header.Get("Content-Length"); clStr != "" {
					if parsed, parseErr := strconv.ParseInt(clStr, 10, 64); parseErr == nil {
						contentLength = parsed
					}
				}
			}
			return resp.Body, contentLength, nil
		}

		resp.Body.Close()

		if resp.StatusCode == http.StatusTooManyRequests || resp.StatusCode >= 500 {
			if attempt < maxRetries {
				continue
			}
		}

		return nil, 0, fmt.Errorf("mast download failed with HTTP %d for %s", resp.StatusCode, targetURL)
	}

	return nil, 0, fmt.Errorf("mast download retries exhausted for %s", targetURL)
}

// ClassifyProduct inspects product metadata and determines its ProductKind.
func ClassifyProduct(obs model.Observation) model.ProductKind {
	subGroup := obs.ProductSubGroup
	if subGroup == "" {
		subGroup = obs.Description
	}

	switch subGroup {
	case "TARGETPIXEL", "TARG", "TP":
		return model.KindTargetPixel
	case "LIGHTCURVE", "LC":
		return model.KindLightCurve
	case "FFI", "FFIC":
		return model.KindFFI
	default:
		return model.KindUnknown
	}
}
