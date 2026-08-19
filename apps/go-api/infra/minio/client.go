package minio

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	minioSDK "github.com/minio/minio-go/v7"
	"github.com/minio/minio-go/v7/pkg/credentials"
	"go-api/internal/domain/repo"
)

type Client struct {
	Endpoint string
	Bucket   string
	HTTP     *http.Client
	client   *minioSDK.Client
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
	client, err := minioSDK.New(host, &minioSDK.Options{Creds: credentials.NewStaticV4(accessKey, secretKey, ""), Secure: secure})
	if err != nil {
		client = nil
	}
	return &Client{Endpoint: endpoint, Bucket: bucket, HTTP: &http.Client{Timeout: 60 * time.Second}, client: client}
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

func (c *Client) GetObject(ctx context.Context, key string) ([]byte, error) {
	if c.client == nil {
		return nil, fmt.Errorf("MinIO client is unavailable")
	}
	object, err := c.client.GetObject(ctx, c.Bucket, key, minioSDK.GetObjectOptions{})
	if err != nil {
		return nil, fmt.Errorf("MinIO get object %s: %w", key, err)
	}
	defer object.Close()
	data, err := io.ReadAll(object)
	if err != nil {
		return nil, fmt.Errorf("MinIO read object %s: %w", key, err)
	}
	return data, nil
}

func (c *Client) ListObjects(ctx context.Context, prefix string) ([]repo.ObjectInfo, error) {
	if c.client == nil {
		return nil, fmt.Errorf("MinIO client is unavailable")
	}
	objects := make([]repo.ObjectInfo, 0)
	for object := range c.client.ListObjects(ctx, c.Bucket, minioSDK.ListObjectsOptions{Prefix: prefix, Recursive: true}) {
		if object.Err != nil {
			return nil, fmt.Errorf("MinIO list objects with prefix %q: %w", prefix, object.Err)
		}
		objects = append(objects, repo.ObjectInfo{Key: object.Key, Size: object.Size, ETag: object.ETag, LastModified: object.LastModified})
	}
	return objects, nil
}

func (c *Client) PutObject(ctx context.Context, key string, data []byte, contentType string) error {
	if c.client == nil {
		return fmt.Errorf("MinIO client is unavailable")
	}
	_, err := c.client.PutObject(ctx, c.Bucket, key, bytes.NewReader(data), int64(len(data)), minioSDK.PutObjectOptions{ContentType: contentType})
	return err
}

func (c *Client) DeleteObject(ctx context.Context, key string) error {
	if c.client == nil {
		return fmt.Errorf("MinIO client is unavailable")
	}
	return c.client.RemoveObject(ctx, c.Bucket, key, minioSDK.RemoveObjectOptions{})
}
