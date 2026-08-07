package storage

import (
	"context"
	"fmt"
	"io"

	"go-ingester/internal/model"

	"github.com/minio/minio-go/v7"
	"github.com/minio/minio-go/v7/pkg/credentials"
)

// MinIOClient implements model.Client for MinIO storage.
type MinIOClient struct {
	client *minio.Client
}

// NewMinIOClient creates a connected MinIOClient.
func NewMinIOClient(endpoint, accessKey, secretKey string) (*MinIOClient, error) {
	client, err := minio.New(endpoint, &minio.Options{
		Creds:  credentials.NewStaticV4(accessKey, secretKey, ""),
		Secure: false,
	})
	if err != nil {
		return nil, fmt.Errorf("minio init %s: %w", endpoint, err)
	}
	return &MinIOClient{client: client}, nil
}

// EnsureBucket ensures target S3 bucket exists in MinIO.
func (c *MinIOClient) EnsureBucket(ctx context.Context, bucket string) error {
	exists, err := c.client.BucketExists(ctx, bucket)
	if err != nil {
		return fmt.Errorf("check bucket %s: %w", bucket, err)
	}
	if !exists {
		err = c.client.MakeBucket(ctx, bucket, minio.MakeBucketOptions{})
		if err != nil {
			return fmt.Errorf("create bucket %s: %w", bucket, err)
		}
	}
	return nil
}

// PutObject streams data into MinIO bucket.
func (c *MinIOClient) PutObject(ctx context.Context, bucket, objectKey string, reader io.Reader, objectSize int64, userMetadata map[string]string) error {
	opts := minio.PutObjectOptions{
		UserMetadata: userMetadata,
		ContentType:  "application/fits",
	}
	_, err := c.client.PutObject(ctx, bucket, objectKey, reader, objectSize, opts)
	if err != nil {
		return fmt.Errorf("put object %s/%s: %w", bucket, objectKey, err)
	}
	return nil
}

// StatObject checks if an object exists and returns metadata info.
func (c *MinIOClient) StatObject(ctx context.Context, bucket, objectKey string) (*model.ObjectInfo, bool, error) {
	info, err := c.client.StatObject(ctx, bucket, objectKey, minio.StatObjectOptions{})
	if err != nil {
		errResponse := minio.ToErrorResponse(err)
		if errResponse.Code == "NoSuchKey" || errResponse.Code == "NotFound" {
			return nil, false, nil
		}
		return nil, false, fmt.Errorf("stat object %s/%s: %w", bucket, objectKey, err)
	}

	userMeta := make(map[string]string)
	for k, v := range info.UserMetadata {
		userMeta[k] = v
	}

	return &model.ObjectInfo{
		Key:          info.Key,
		Size:         info.Size,
		ETag:         info.ETag,
		LastModified: info.LastModified,
		UserMetadata: userMeta,
	}, true, nil
}

// GetObject retrieves object stream from MinIO.
func (c *MinIOClient) GetObject(ctx context.Context, bucket, objectKey string) (io.ReadCloser, error) {
	obj, err := c.client.GetObject(ctx, bucket, objectKey, minio.GetObjectOptions{})
	if err != nil {
		return nil, fmt.Errorf("get object %s/%s: %w", bucket, objectKey, err)
	}
	return obj, nil
}
