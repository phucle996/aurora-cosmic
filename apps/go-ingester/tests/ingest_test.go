package tests

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"sync"
	"testing"
	"time"

	"go-ingester/internal/ingest"
	"go-ingester/infra/mast"
	"go-ingester/internal/model"
)

type mockStorageClient struct {
	mu      sync.Mutex
	objects map[string]*model.ObjectInfo
	content map[string][]byte
}

func newMockStorageClient() *mockStorageClient {
	return &mockStorageClient{
		objects: make(map[string]*model.ObjectInfo),
		content: make(map[string][]byte),
	}
}

func (m *mockStorageClient) EnsureBucket(ctx context.Context, bucket string) error {
	return nil
}

func (m *mockStorageClient) PutObject(ctx context.Context, bucket, objectKey string, reader io.Reader, objectSize int64, userMetadata map[string]string) error {
	data, err := io.ReadAll(reader)
	if err != nil {
		return err
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	m.content[objectKey] = data
	m.objects[objectKey] = &model.ObjectInfo{
		Key:          objectKey,
		Size:         int64(len(data)),
		UserMetadata: userMetadata,
	}
	return nil
}

func (m *mockStorageClient) StatObject(ctx context.Context, bucket, objectKey string) (*model.ObjectInfo, bool, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	obj, ok := m.objects[objectKey]
	if !ok {
		return nil, false, nil
	}
	return obj, true, nil
}

func (m *mockStorageClient) GetObject(ctx context.Context, bucket, objectKey string) (io.ReadCloser, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	data, ok := m.content[objectKey]
	if !ok {
		return nil, fmt.Errorf("mock: object %s not found", objectKey)
	}
	return io.NopCloser(bytes.NewReader(data)), nil
}

func TestPipelineDryRun(t *testing.T) {
	logger := slog.New(slog.NewTextHandler(os.Stdout, nil))
	mockStorage := newMockStorageClient()
	pipe := ingest.NewPipeline(nil, mockStorage, nil, nil, "aurora", 2, logger)

	man := &model.Manifest{
		SchemaVersion: 1,
		Source:        "test",
		Samples: []model.Sample{
			{
				SampleID:   model.SampleID(123, 42),
				TICID:      123,
				Sector:     42,
				PairStatus: model.PairStatusTPFOnly,
				TargetPixel: &model.ManifestProduct{
					SourceProductID: "tess1",
					Kind:            model.KindTargetPixel,
					Filename:        "tess1_tp.fits",
					DataURI:         "mast:TESS/tess1_tp.fits",
					SizeBytes:       100,
					Sector:          42,
					TICID:           123,
				},
			},
		},
	}

	summary, results, err := pipe.IngestManifest(context.Background(), man, true)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if summary.SkippedCount != 1 {
		t.Errorf("expected 1 skipped product in dry-run, got %d", summary.SkippedCount)
	}
	if len(results) != 1 || results[0].Status != model.StatusSkipped {
		t.Errorf("expected result status SKIPPED, got %v", results[0].Status)
	}
	if len(mockStorage.objects) != 0 {
		t.Errorf("dry-run should not write to storage, but stored %d objects", len(mockStorage.objects))
	}
}

func TestPipelineStreamingIngestion(t *testing.T) {
	tpData := "FAKE_TARGET_PIXEL_FITS_DATA"
	lcData := "FAKE_LIGHT_CURVE_FITS_DATA"

	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/tp.fits":
			w.Header().Set("Content-Type", "application/fits")
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte(tpData))
		case "/lc.fits":
			w.Header().Set("Content-Type", "application/fits")
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte(lcData))
		default:
			http.NotFound(w, r)
		}
	}))
	defer ts.Close()

	mastClient := mast.NewClient(ts.URL, 5*time.Second)
	mastClient.SetDownloadURL(ts.URL)

	mockStorage := newMockStorageClient()
	logger := slog.New(slog.NewTextHandler(os.Stdout, nil))
	pipe := ingest.NewPipeline(mastClient, mockStorage, nil, nil, "aurora", 2, logger)

	man := &model.Manifest{
		SchemaVersion: 1,
		Source:        "test",
		Samples: []model.Sample{
			{
				SampleID:   model.SampleID(999, 10),
				TICID:      999,
				Sector:     10,
				PairStatus: model.PairStatusPaired,
				TargetPixel: &model.ManifestProduct{
					SourceProductID: "p-tp",
					Kind:            model.KindTargetPixel,
					Filename:        "test_tp.fits",
					DataURI:         ts.URL + "/tp.fits",
					SizeBytes:       int64(len(tpData)),
					Sector:          10,
					TICID:           999,
				},
				LightCurve: &model.ManifestProduct{
					SourceProductID: "p-lc",
					Kind:            model.KindLightCurve,
					Filename:        "test_lc.fits",
					DataURI:         ts.URL + "/lc.fits",
					SizeBytes:       int64(len(lcData)),
					Sector:          10,
					TICID:           999,
				},
			},
		},
	}

	summary, results, err := pipe.IngestManifest(context.Background(), man, false)
	if err != nil {
		t.Fatalf("unexpected pipeline error: %v", err)
	}

	if summary.StoredCount != 2 {
		t.Errorf("expected 2 stored products, got %d", summary.StoredCount)
	}
	if summary.StoredBytes != int64(len(tpData)+len(lcData)) {
		t.Errorf("expected %d stored bytes, got %d", len(tpData)+len(lcData), summary.StoredBytes)
	}
	if len(results) != 2 {
		t.Fatalf("expected 2 product results, got %d", len(results))
	}

	tpKey := "bronze/tess/target-pixel/sector=0010/tic=999/test_tp.fits"
	storedTp, exists := mockStorage.objects[tpKey]
	if !exists {
		t.Fatalf("expected object %s in mock storage", tpKey)
	}
	if storedTp.Size != int64(len(tpData)) {
		t.Errorf("expected size %d, got %d", len(tpData), storedTp.Size)
	}
	if string(mockStorage.content[tpKey]) != tpData {
		t.Errorf("content mismatch for TP fits")
	}
}

func TestPipelineSkipExistingValidObject(t *testing.T) {
	mockStorage := newMockStorageClient()
	tpKey := "bronze/tess/target-pixel/sector=0005/tic=777/existing_tp.fits"
	existingData := []byte("EXISTING_VALID_CONTENT")
	mockStorage.objects[tpKey] = &model.ObjectInfo{
		Key:          tpKey,
		Size:         int64(len(existingData)),
		UserMetadata: map[string]string{"sha256": "dummyhash"},
	}
	mockStorage.content[tpKey] = existingData

	logger := slog.New(slog.NewTextHandler(os.Stdout, nil))
	pipe := ingest.NewPipeline(nil, mockStorage, nil, nil, "aurora", 1, logger)

	man := &model.Manifest{
		SchemaVersion: 1,
		Source:        "test",
		Samples: []model.Sample{
			{
				SampleID:   model.SampleID(777, 5),
				TICID:      777,
				Sector:     5,
				PairStatus: model.PairStatusTPFOnly,
				TargetPixel: &model.ManifestProduct{
					SourceProductID: "p-exist",
					Kind:            model.KindTargetPixel,
					Filename:        "existing_tp.fits",
					DataURI:         "mast:TESS/existing_tp.fits",
					SizeBytes:       int64(len(existingData)),
					Sector:          5,
					TICID:           777,
				},
			},
		},
	}

	summary, results, err := pipe.IngestManifest(context.Background(), man, false)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if summary.SkippedCount != 1 {
		t.Errorf("expected 1 skipped product, got %d", summary.SkippedCount)
	}
	if results[0].Status != model.StatusSkipped {
		t.Errorf("expected status SKIPPED, got %s", results[0].Status)
	}
}

func TestPipelineSizeMismatchFailure(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/fits")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("SHORT"))
	}))
	defer ts.Close()

	mastClient := mast.NewClient(ts.URL, 5*time.Second)
	mastClient.SetDownloadURL(ts.URL)

	mockStorage := newMockStorageClient()
	logger := slog.New(slog.NewTextHandler(os.Stdout, nil))
	pipe := ingest.NewPipeline(mastClient, mockStorage, nil, nil, "aurora", 1, logger)

	man := &model.Manifest{
		SchemaVersion: 1,
		Source:        "test",
		Samples: []model.Sample{
			{
				SampleID:   model.SampleID(888, 1),
				TICID:      888,
				Sector:     1,
				PairStatus: model.PairStatusTPFOnly,
				TargetPixel: &model.ManifestProduct{
					SourceProductID: "p-mismatch",
					Kind:            model.KindTargetPixel,
					Filename:        "mismatch_tp.fits",
					DataURI:         ts.URL + "/short.fits",
					SizeBytes:       1000,
					Sector:          1,
					TICID:           888,
				},
			},
		},
	}

	summary, results, err := pipe.IngestManifest(context.Background(), man, false)
	if err != nil {
		t.Fatalf("unexpected pipeline execution error: %v", err)
	}

	if summary.FailedCount != 1 {
		t.Errorf("expected 1 failed product due to size mismatch, got %d", summary.FailedCount)
	}
	if len(results) != 1 || results[0].Status != model.StatusFailed {
		t.Errorf("expected FAILED status in result, got %v", results[0].Status)
	}
}
