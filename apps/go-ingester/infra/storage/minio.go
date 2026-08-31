package storage

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/url"
	"strings"

	contract "go-ingester/internal/pipeline/storage"

	"github.com/minio/minio-go/v7"
	"github.com/minio/minio-go/v7/pkg/credentials"
)

// MinIOClient implements the ingestion storage port for MinIO.
type MinIOClient struct {
	client *minio.Client
}

// NewMinIOClient creates a connected MinIOClient.
func NewMinIOClient(endpoint, accessKey, secretKey string) (*MinIOClient, error) {
	endpoint, secure, err := normalizeEndpoint(endpoint)
	if err != nil {
		return nil, err
	}
	client, err := minio.New(endpoint, &minio.Options{
		Creds:  credentials.NewStaticV4(accessKey, secretKey, ""),
		Secure: secure,
	})
	if err != nil {
		return nil, fmt.Errorf("minio init %s: %w", endpoint, err)
	}
	return &MinIOClient{client: client}, nil
}

func normalizeEndpoint(endpoint string) (string, bool, error) {
	endpoint = strings.TrimSpace(endpoint)
	if endpoint == "" {
		return "", false, fmt.Errorf("minio endpoint cannot be empty")
	}
	if !strings.Contains(endpoint, "://") {
		return strings.TrimRight(endpoint, "/"), false, nil
	}

	u, err := url.Parse(endpoint)
	if err != nil || u.Host == "" {
		return "", false, fmt.Errorf("invalid minio endpoint %q", endpoint)
	}
	if u.Path != "" && u.Path != "/" {
		return "", false, fmt.Errorf("minio endpoint must not contain a path: %q", endpoint)
	}
	return u.Host, strings.EqualFold(u.Scheme, "https"), nil
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

func (c *MinIOClient) PutJSON(ctx context.Context, bucket, objectKey string, data []byte) error {
	_, err := c.client.PutObject(ctx, bucket, objectKey, bytes.NewReader(data), int64(len(data)), minio.PutObjectOptions{ContentType: "application/json"})
	if err != nil {
		return fmt.Errorf("put JSON %s/%s: %w", bucket, objectKey, err)
	}
	return nil
}

// StatObject checks if an object exists and returns metadata info.
func (c *MinIOClient) StatObject(ctx context.Context, bucket, objectKey string) (*contract.ObjectInfo, bool, error) {
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

	return &contract.ObjectInfo{
		Key:          info.Key,
		Size:         info.Size,
		ETag:         info.ETag,
		LastModified: info.LastModified,
		UserMetadata: userMeta,
	}, true, nil
}

// StatObjectExists adapts object metadata to lifecycle capacity checks without
// exposing the concrete MinIO client to the workflow layer.
func (c *MinIOClient) StatObjectExists(ctx context.Context, bucket, objectKey string) (int64, bool, error) {
	info, exists, err := c.StatObject(ctx, bucket, objectKey)
	if err != nil || !exists {
		return 0, exists, err
	}
	return info.Size, true, nil
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
		return nil, contract.ErrObjectNotFound
	}

	obj, err := c.client.GetObject(ctx, bucket, objectKey, minio.GetObjectOptions{})
	if err != nil {
		return nil, fmt.Errorf("get object %s/%s: %w", bucket, objectKey, err)
	}
	return obj, nil
}

// ListObjectsWithPrefix lists all objects under a prefix.
func (c *MinIOClient) ListObjectsWithPrefix(ctx context.Context, bucket, prefix string) ([]contract.ObjectInfo, error) {
	var result []contract.ObjectInfo
	for obj := range c.client.ListObjects(ctx, bucket, minio.ListObjectsOptions{
		Prefix:    prefix,
		Recursive: true,
	}) {
		if obj.Err != nil {
			return nil, fmt.Errorf("list objects %s/%s: %w", bucket, prefix, obj.Err)
		}
		result = append(result, contract.ObjectInfo{
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

// CopyObject copies an object entirely within MinIO and replaces its metadata.
// It is used by operational repairs so large FITS files never need to be
// downloaded to the host just to correct a lakehouse tier path.
func (c *MinIOClient) CopyObject(ctx context.Context, bucket, sourceKey, destinationKey string, userMetadata map[string]string) error {
	if sourceKey == "" || destinationKey == "" {
		return fmt.Errorf("copy object: source and destination keys are required")
	}
	if sourceKey == destinationKey {
		return nil
	}
	_, err := c.client.CopyObject(ctx,
		minio.CopyDestOptions{
			Bucket:          bucket,
			Object:          destinationKey,
			ContentType:     "application/fits",
			UserMetadata:    userMetadata,
			ReplaceMetadata: true,
		},
		minio.CopySrcOptions{Bucket: bucket, Object: sourceKey},
	)
	if err != nil {
		return fmt.Errorf("copy object %s -> %s: %w", sourceKey, destinationKey, err)
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
