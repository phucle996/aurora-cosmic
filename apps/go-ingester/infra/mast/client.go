package mast

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync/atomic"
	"time"

	"go-ingester/internal/model"
)

// Client wraps HTTP communication with NASA MAST API.
type Client struct {
	baseURL     string
	downloadURL string
	httpClient  *http.Client
	queryClient *http.Client
}

type rotatingDialer struct {
	dialer   net.Dialer
	resolver *net.Resolver
	next     atomic.Uint64
}

func (d *rotatingDialer) DialContext(ctx context.Context, network, address string) (net.Conn, error) {
	host, port, err := net.SplitHostPort(address)
	if err != nil || net.ParseIP(host) != nil {
		return d.dialer.DialContext(ctx, network, address)
	}
	addresses, err := d.resolver.LookupIPAddr(ctx, host)
	if err != nil || len(addresses) == 0 {
		return d.dialer.DialContext(ctx, network, address)
	}
	start := int(d.next.Add(1)-1) % len(addresses)
	var lastErr error
	for offset := range len(addresses) {
		candidate := net.JoinHostPort(addresses[(start+offset)%len(addresses)].IP.String(), port)
		connection, dialErr := d.dialer.DialContext(ctx, network, candidate)
		if dialErr == nil {
			return connection, nil
		}
		lastErr = dialErr
	}
	return nil, lastErr
}

// NewClient constructs a MAST Client instance.
func NewClient(baseURL string, timeout time.Duration) *Client {
	if baseURL == "" {
		baseURL = "https://mast.stsci.edu/api/v0/invoke"
	}
	if timeout <= 0 {
		timeout = 90 * time.Second
	}
	metadataTimeout := min(timeout, 25*time.Second)
	downloadDialer := &rotatingDialer{dialer: net.Dialer{Timeout: 10 * time.Second, KeepAlive: 30 * time.Second}, resolver: net.DefaultResolver}
	queryDialer := &rotatingDialer{dialer: net.Dialer{Timeout: 10 * time.Second}, resolver: net.DefaultResolver}
	return &Client{
		baseURL:     baseURL,
		downloadURL: "https://mast.stsci.edu/api/v0.1/Download/file",
		httpClient: &http.Client{
			// A total client timeout breaks large FITS streams. Bound header
			// acquisition instead and let the caller's context cancel the body.
			Timeout: 0,
			Transport: &http.Transport{
				DialContext:           downloadDialer.DialContext,
				MaxIdleConns:          256,
				MaxIdleConnsPerHost:   64,
				MaxConnsPerHost:       64,
				IdleConnTimeout:       90 * time.Second,
				ResponseHeaderTimeout: timeout,
				ForceAttemptHTTP2:     true,
			},
		},
		queryClient: &http.Client{
			Timeout: metadataTimeout,
			Transport: &http.Transport{
				DialContext:           queryDialer.DialContext,
				MaxIdleConns:          16,
				MaxIdleConnsPerHost:   8,
				MaxConnsPerHost:       64,
				IdleConnTimeout:       30 * time.Second,
				ResponseHeaderTimeout: metadataTimeout,
				TLSHandshakeTimeout:   10 * time.Second,
				ForceAttemptHTTP2:     true,
			},
		},
	}
}

// SetDownloadURL overrides the default download endpoint (useful for mock servers in testing).
func (c *Client) SetDownloadURL(downloadURL string) {
	c.downloadURL = downloadURL
}

func (c *Client) productURL(dataURI string) (string, error) {
	if strings.TrimSpace(dataURI) == "" {
		return "", fmt.Errorf("MAST product URI is empty")
	}
	if strings.HasPrefix(strings.ToLower(dataURI), "http://") || strings.HasPrefix(strings.ToLower(dataURI), "https://") {
		return dataURI, nil
	}
	return c.downloadURL + "?" + url.Values{"uri": []string{dataURI}}.Encode(), nil
}

// Query performs a POST request to the MAST API endpoint.
func (c *Client) Query(ctx context.Context, reqBody url.Values) ([]byte, error) {
	// MAST's SOAP-backed endpoint reads form parameters from the POST body;
	// putting `request` in the URL query results in HTTP 500 "Missing parameter".
	for poll := 0; poll < 60; poll++ {
		var body []byte
		var lastErr error
		for attempt := 0; attempt < 4; attempt++ {
			req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL, strings.NewReader(reqBody.Encode()))
			if err != nil {
				return nil, fmt.Errorf("mast query: create request: %w", err)
			}

			req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
			resp, err := c.queryClient.Do(req)
			if err != nil {
				// A MAST cluster node can accept TCP/TLS and then never return an
				// HTTP header. Drop its idle HTTP/2 connection so the rotating
				// dialer selects another resolved node on the next attempt.
				c.queryClient.CloseIdleConnections()
				if ctx.Err() != nil {
					return nil, fmt.Errorf("mast query: execute: %w", ctx.Err())
				}
				lastErr = fmt.Errorf("mast query: execute: %w", err)
			} else {
				responseBody, readErr := io.ReadAll(resp.Body)
				resp.Body.Close()
				if readErr != nil {
					lastErr = fmt.Errorf("mast query: read body: %w", readErr)
				} else if resp.StatusCode == http.StatusOK {
					body = responseBody
					lastErr = nil
					break
				} else {
					lastErr = fmt.Errorf("mast query status %d: %s", resp.StatusCode, string(responseBody))
					if resp.StatusCode != http.StatusTooManyRequests && resp.StatusCode < 500 {
						return nil, lastErr
					}
				}
			}

			if attempt == 3 {
				break
			}
			backoff := time.Duration(1<<attempt) * time.Second
			select {
			case <-ctx.Done():
				return nil, fmt.Errorf("mast query: retry canceled: %w", ctx.Err())
			case <-time.After(backoff):
			}
		}
		if lastErr != nil {
			return nil, lastErr
		}

		if !mastQueryExecuting(body) {
			return body, nil
		}
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-time.After(2 * time.Second):
		}
	}

	return nil, fmt.Errorf("mast query: polling timed out after 60 attempts")
}

func mastQueryExecuting(body []byte) bool {
	var status struct {
		Status string `json:"status"`
	}
	return json.Unmarshal(body, &status) == nil && status.Status == "EXECUTING"
}

// OpenProduct streams product content by URI with retry logic (429 / 5xx).
func (c *Client) OpenProduct(ctx context.Context, dataURI string) (io.ReadCloser, int64, error) {
	targetURL, targetErr := c.productURL(dataURI)
	if targetErr != nil {
		return nil, 0, fmt.Errorf("mast open product: %w", targetErr)
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
func ClassifyProduct(obs Observation) model.ProductKind {
	subGroup := obs.ProductSubGroup
	if subGroup == "" {
		subGroup = obs.Description
	}

	switch subGroup {
	case "TARGETPIXEL", "TARG", "TP":
		return model.KindTargetPixel
	case "LIGHTCURVE", "LC":
		return model.KindLightCurve
	default:
		return model.KindUnknown
	}
}
