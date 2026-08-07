package storage

import (
	"context"
	"fmt"
	"io"
	"net/url"
	"strings"

	"github.com/minio/minio-go/v7"
	"github.com/minio/minio-go/v7/pkg/credentials"
)

// ObjectInfo holds verification metadata for a stored Bronze object.
type ObjectInfo struct {
	Key          string
	Size         int64
	UserMetadata map[string]string
}

// Client defines the storage interface required for Bronze object ingestion.
type Client interface {
	EnsureBucket(ctx context.Context, bucket string) error
	PutObject(ctx context.Context, bucket, objectKey string, reader io.Reader, size int64, userMeta map[string]string) error
	StatObject(ctx context.Context, bucket, objectKey string) (*ObjectInfo, bool, error)
	GetObject(ctx context.Context, bucket, objectKey string) (io.ReadCloser, error)
}

// MinIOClient wraps minio.Client.
type MinIOClient struct {
	client *minio.Client
}

// NewMinIOClient constructs a MinIOClient.
// Endpoint can be raw host:port or URL (http://minio:9000).
func NewMinIOClient(rawEndpoint, accessKey, secretKey string) (*MinIOClient, error) {
	endpoint := rawEndpoint
	useSSL := false

	if strings.HasPrefix(rawEndpoint, "http://") || strings.HasPrefix(rawEndpoint, "https://") {
		u, err := url.Parse(rawEndpoint)
		if err != nil {
			return nil, fmt.Errorf("minio: invalid endpoint URL %q: %w", rawEndpoint, err)
		}
		endpoint = u.Host
		useSSL = u.Scheme == "https"
	}

	creds := credentials.NewStaticV4(accessKey, secretKey, "")
	mc, err := minio.New(endpoint, &minio.Options{
		Creds:  creds,
		Secure: useSSL,
	})
	if err != nil {
		return nil, fmt.Errorf("minio: init client failed: %w", err)
	}

	return &MinIOClient{client: mc}, nil
}

// EnsureBucket checks if bucket exists, creating it if it does not.
func (m *MinIOClient) EnsureBucket(ctx context.Context, bucket string) error {
	exists, err := m.client.BucketExists(ctx, bucket)
	if err != nil {
		return fmt.Errorf("minio: bucket exists check %q: %w", bucket, err)
	}
	if !exists {
		err = m.client.MakeBucket(ctx, bucket, minio.MakeBucketOptions{})
		if err != nil {
			return fmt.Errorf("minio: make bucket %q: %w", bucket, err)
		}
	}
	return nil
}

// PutObject streams data directly from reader into MinIO.
func (m *MinIOClient) PutObject(ctx context.Context, bucket, objectKey string, reader io.Reader, size int64, userMeta map[string]string) error {
	opts := minio.PutObjectOptions{
		UserMetadata: userMeta,
		ContentType:  "application/fits",
	}

	_, err := m.client.PutObject(ctx, bucket, objectKey, reader, size, opts)
	if err != nil {
		return fmt.Errorf("minio: put object %s/%s: %w", bucket, objectKey, err)
	}
	return nil
}

// StatObject checks if object exists and returns its ObjectInfo.
// Returns info, exists (bool), error.
func (m *MinIOClient) StatObject(ctx context.Context, bucket, objectKey string) (*ObjectInfo, bool, error) {
	objInfo, err := m.client.StatObject(ctx, bucket, objectKey, minio.StatObjectOptions{})
	if err != nil {
		errResp := minio.ToErrorResponse(err)
		if errResp.Code == "NoSuchKey" || errResp.Code == "NotFound" || strings.Contains(err.Error(), "does not exist") {
			return nil, false, nil
		}
		return nil, false, fmt.Errorf("minio: stat object %s/%s: %w", bucket, objectKey, err)
	}

	meta := make(map[string]string)
	for k, v := range objInfo.UserMetadata {
		meta[strings.ToLower(k)] = v
	}

	return &ObjectInfo{
		Key:          objInfo.Key,
		Size:         objInfo.Size,
		UserMetadata: meta,
	}, true, nil
}

// GetObject opens a stream to read an object from MinIO.
func (m *MinIOClient) GetObject(ctx context.Context, bucket, objectKey string) (io.ReadCloser, error) {
	obj, err := m.client.GetObject(ctx, bucket, objectKey, minio.GetObjectOptions{})
	if err != nil {
		return nil, fmt.Errorf("minio: get object %s/%s: %w", bucket, objectKey, err)
	}
	return obj, nil
}
