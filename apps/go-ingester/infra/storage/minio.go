package storage

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"strings"

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
	// minio-go's GetObject is lazy: a missing key often surfaces only on the
	// first Read. Resolve existence here so checkpoint callers can distinguish a
	// normal first-run miss from an unavailable storage service.
	_, exists, err := c.StatObject(ctx, bucket, objectKey)
	if err != nil {
		return nil, err
	}
	if !exists {
		return nil, model.ErrObjectNotFound
	}

	obj, err := c.client.GetObject(ctx, bucket, objectKey, minio.GetObjectOptions{})
	if err != nil {
		return nil, fmt.Errorf("get object %s/%s: %w", bucket, objectKey, err)
	}
	return obj, nil
}

// ListObjectsWithPrefix lists all objects under a prefix.
func (c *MinIOClient) ListObjectsWithPrefix(ctx context.Context, bucket, prefix string) ([]model.ObjectInfo, error) {
	var result []model.ObjectInfo
	for obj := range c.client.ListObjects(ctx, bucket, minio.ListObjectsOptions{
		Prefix:    prefix,
		Recursive: true,
	}) {
		if obj.Err != nil {
			return nil, fmt.Errorf("list objects %s/%s: %w", bucket, prefix, obj.Err)
		}
		result = append(result, model.ObjectInfo{
			Key:          obj.Key,
			Size:         obj.Size,
			ETag:         obj.ETag,
			LastModified: obj.LastModified,
		})
	}
	return result, nil
}

// ListBronzeUsage calculates total byte usage under bronze/ prefix.
func (c *MinIOClient) ListBronzeUsage(ctx context.Context, bucket string) (totalBytes int64, objectCount int, err error) {
	for obj := range c.client.ListObjects(ctx, bucket, minio.ListObjectsOptions{
		Prefix:    "bronze/",
		Recursive: true,
	}) {
		if obj.Err != nil {
			return 0, 0, fmt.Errorf("list bronze objects: %w", obj.Err)
		}
		totalBytes += obj.Size
		objectCount++
	}
	return totalBytes, objectCount, nil
}

// ListLineageKeys lists all lineage record object keys under a prefix.
func (c *MinIOClient) ListLineageKeys(ctx context.Context, bucket, prefix string) ([]string, error) {
	var keys []string
	for obj := range c.client.ListObjects(ctx, bucket, minio.ListObjectsOptions{
		Prefix:    prefix,
		Recursive: true,
	}) {
		if obj.Err != nil {
			return nil, fmt.Errorf("list lineage records: %w", obj.Err)
		}
		if strings.HasSuffix(obj.Key, ".json") {
			keys = append(keys, obj.Key)
		}
	}
	return keys, nil
}

// DeleteObject removes an object from MinIO.
func (c *MinIOClient) DeleteObject(ctx context.Context, bucket, objectKey string) error {
	err := c.client.RemoveObject(ctx, bucket, objectKey, minio.RemoveObjectOptions{})
	if err != nil {
		return fmt.Errorf("delete object %s/%s: %w", bucket, objectKey, err)
	}
	return nil
}

// GetJSONObject fetches an object and JSON-decodes it into dst. Returns (false, nil) if not found.
func (c *MinIOClient) GetJSONObject(ctx context.Context, bucket, objectKey string, dst any) (bool, error) {
	obj, err := c.client.GetObject(ctx, bucket, objectKey, minio.GetObjectOptions{})
	if err != nil {
		errResp := minio.ToErrorResponse(err)
		if errResp.Code == "NoSuchKey" || errResp.Code == "NotFound" {
			return false, nil
		}
		return false, fmt.Errorf("get json object %s/%s: %w", bucket, objectKey, err)
	}
	defer obj.Close()

	data, err := io.ReadAll(obj)
	if err != nil {
		errResp := minio.ToErrorResponse(err)
		if errResp.Code == "NoSuchKey" || errResp.Code == "NotFound" {
			return false, nil
		}
		return false, fmt.Errorf("read json object %s/%s: %w", bucket, objectKey, err)
	}

	if err := json.Unmarshal(data, dst); err != nil {
		return false, fmt.Errorf("unmarshal json object %s/%s: %w", bucket, objectKey, err)
	}
	return true, nil
}

// PutJSONObject serializes src to JSON and stores it in MinIO.
func (c *MinIOClient) PutJSONObject(ctx context.Context, bucket, objectKey string, src any) error {
	data, err := json.Marshal(src)
	if err != nil {
		return fmt.Errorf("marshal json for %s/%s: %w", bucket, objectKey, err)
	}
	reader := bytes.NewReader(data)
	opts := minio.PutObjectOptions{
		ContentType: "application/json",
	}
	_, err = c.client.PutObject(ctx, bucket, objectKey, reader, int64(len(data)), opts)
	if err != nil {
		return fmt.Errorf("put json object %s/%s: %w", bucket, objectKey, err)
	}
	return nil
}
