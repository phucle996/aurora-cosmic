package minio

import (
	"context"
	"fmt"
	"net/http"
	"strings"
	"time"

	minioSDK "github.com/minio/minio-go/v7"
	"github.com/minio/minio-go/v7/pkg/credentials"
)

type Client struct {
	Endpoint string
	Bucket   string
	HTTP     *http.Client
	SDK      *minioSDK.Client
}

func NewClient(endpoint, bucket, accessKey, secretKey string) *Client {
	if endpoint == "" {
		endpoint = "http://minio:9000"
	}
	if bucket == "" {
		bucket = "aurora"
	}
	secure := strings.HasPrefix(strings.ToLower(endpoint), "https://")
	host := strings.TrimPrefix(strings.TrimPrefix(endpoint, "https://"), "http://")
	client, err := minioSDK.New(host, &minioSDK.Options{
		Creds:  credentials.NewStaticV4(accessKey, secretKey, ""),
		Secure: secure,
	})
	if err != nil {
		client = nil
	}
	return &Client{
		Endpoint: endpoint,
		Bucket:   bucket,
		HTTP:     &http.Client{Timeout: 60 * time.Second},
		SDK:      client,
	}
}

func (c *Client) Ping(ctx context.Context) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, fmt.Sprintf("%s/minio/health/live", c.Endpoint), nil)
	if err != nil {
		return fmt.Errorf("create MinIO health request: %w", err)
	}
	resp, err := c.HTTP.Do(req)
	if err != nil {
		return fmt.Errorf("MinIO health check failed: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("MinIO health returned HTTP %d", resp.StatusCode)
	}
	return nil
}
