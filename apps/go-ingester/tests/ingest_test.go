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
	"go-ingester/internal/manifest"
	"go-ingester/internal/mast"
	"go-ingester/internal/storage"
)

// mockStorageClient implements storage.Client for in-memory testing.
type mockStorageClient struct {
	mu      sync.Mutex
	objects map[string]*storage.ObjectInfo
	content map[string][]byte
}

func newMockStorageClient() *mockStorageClient {
	return &mockStorageClient{
		objects: make(map[string]*storage.ObjectInfo),
		content: make(map[string][]byte),
	}
}

func (m *mockStorageClient) EnsureBucket(ctx context.Context, bucket string) error {
	return nil
}

func (m *mockStorageClient) PutObject(ctx context.Context, bucket, objectKey string, reader io.Reader, size int64, userMeta map[string]string) error {
	data, err := io.ReadAll(reader)
	if err != nil {
		return err
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	m.objects[objectKey] = &storage.ObjectInfo{
		Key:          objectKey,
		Size:         int64(len(data)),
		UserMetadata: userMeta,
	}
	m.content[objectKey] = data
	return nil
}

func (m *mockStorageClient) StatObject(ctx context.Context, bucket, objectKey string) (*storage.ObjectInfo, bool, error) {
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
	pipe := ingest.NewPipeline(nil, mockStorage, nil, "aurora", 2, logger)

	man := &manifest.Manifest{
		SchemaVersion: 1,
		Source:        "test",
		Samples: []manifest.Sample{
			{
				SampleID:   "s1",
				TICID:      123,
				Sector:     42,
				PairStatus: manifest.PairStatusPaired,
				TargetPixel: &manifest.ManifestProduct{
					SourceProductID: "p1",
					Kind:            mast.KindTargetPixel,
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
	if summary.PlannedProducts != 1 {
		t.Errorf("expected 1 planned product, got %d", summary.PlannedProducts)
	}
	if summary.SkippedCount != 1 {
		t.Errorf("expected 1 skipped in dry run, got %d", summary.SkippedCount)
	}
	if len(results) != 1 || results[0].Status != ingest.StatusSkipped {
		t.Errorf("expected skipped result status")
	}
	if len(mockStorage.objects) != 0 {
		t.Errorf("dry run should not write to storage")
	}
}

func TestPipelineStreamingIngestion(t *testing.T) {
	fitsPayload := "FITS_MOCK_HEADER_DATA_12345"
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/fits")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(fitsPayload))
	}))
	defer ts.Close()

	mastClient := mast.NewClient(ts.URL, 5*time.Second)
	mastClient.SetDownloadURL(ts.URL)

	mockStorage := newMockStorageClient()
	logger := slog.New(slog.NewTextHandler(os.Stdout, nil))
	pipe := ingest.NewPipeline(mastClient, mockStorage, nil, "aurora", 2, logger)

	man := &manifest.Manifest{
		SchemaVersion: 1,
		Source:        "test",
		Samples: []manifest.Sample{
			{
				SampleID:   "sample-1",
				TICID:      999,
				Sector:     10,
				PairStatus: manifest.PairStatusPaired,
				TargetPixel: &manifest.ManifestProduct{
					SourceProductID: "p-tp",
					Kind:            mast.KindTargetPixel,
					Filename:        "test_tp.fits",
					DataURI:         "mast:TESS/test_tp.fits",
					SizeBytes:       int64(len(fitsPayload)),
					Sector:          10,
					TICID:           999,
				},
				LightCurve: &manifest.ManifestProduct{
					SourceProductID: "p-lc",
					Kind:            mast.KindLightCurve,
					Filename:        "test_lc.fits",
					DataURI:         "mast:TESS/test_lc.fits",
					SizeBytes:       int64(len(fitsPayload)),
					Sector:          10,
					TICID:           999,
				},
			},
		},
	}

	summary, results, err := pipe.IngestManifest(context.Background(), man, false)
	if err != nil {
		t.Fatalf("ingestion failed: %v", err)
	}

	if summary.StoredCount != 2 {
		t.Errorf("expected 2 stored products, got %d", summary.StoredCount)
	}
	if summary.FailedCount != 0 {
		t.Errorf("expected 0 failed products, got %d", summary.FailedCount)
	}
	if len(results) != 2 {
		t.Fatalf("expected 2 results, got %d", len(results))
	}

	for _, res := range results {
		if res.Status != ingest.StatusStored {
			t.Errorf("product %s status = %s, err = %v", res.SourceProductID, res.Status, res.Error)
		}
		if res.SHA256 == "" {
			t.Errorf("product %s missing SHA256", res.SourceProductID)
		}
	}

	// Verify MinIO objects were written correctly
	tpKey := "bronze/tess/target-pixel/sector=0010/tic=999/test_tp.fits"
	lcKey := "bronze/tess/lightcurve/sector=0010/tic=999/test_lc.fits"

	if string(mockStorage.content[tpKey]) != fitsPayload {
		t.Errorf("stored target pixel content mismatch")
	}
	if string(mockStorage.content[lcKey]) != fitsPayload {
		t.Errorf("stored light curve content mismatch")
	}
}

func TestPipelineSkipExistingValidObject(t *testing.T) {
	mockStorage := newMockStorageClient()
	tpKey := "bronze/tess/target-pixel/sector=0005/tic=777/existing_tp.fits"
	existingData := []byte("already_ingested_data")
	mockStorage.objects[tpKey] = &storage.ObjectInfo{
		Key:          tpKey,
		Size:         int64(len(existingData)),
		UserMetadata: map[string]string{"sha256": "abcdef"},
	}
	mockStorage.content[tpKey] = existingData

	logger := slog.New(slog.NewTextHandler(os.Stdout, nil))
	pipe := ingest.NewPipeline(nil, mockStorage, nil, "aurora", 1, logger)

	man := &manifest.Manifest{
		SchemaVersion: 1,
		Source:        "test",
		Samples: []manifest.Sample{
			{
				SampleID:   "s-existing",
				TICID:      777,
				Sector:     5,
				PairStatus: manifest.PairStatusTPFOnly,
				TargetPixel: &manifest.ManifestProduct{
					SourceProductID: "p-exist",
					Kind:            mast.KindTargetPixel,
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
	if summary.StoredCount != 0 {
		t.Errorf("expected 0 stored products, got %d", summary.StoredCount)
	}
	if results[0].Status != ingest.StatusSkipped {
		t.Errorf("expected result status SKIPPED, got %s", results[0].Status)
	}
}

func TestPipelineSizeMismatchFailure(t *testing.T) {
	// Server returns smaller payload than expected size in manifest
	serverPayload := "short"
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/fits")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(serverPayload))
	}))
	defer ts.Close()

	mastClient := mast.NewClient(ts.URL, 5*time.Second)
	mastClient.SetDownloadURL(ts.URL)

	mockStorage := newMockStorageClient()
	logger := slog.New(slog.NewTextHandler(os.Stdout, nil))
	pipe := ingest.NewPipeline(mastClient, mockStorage, nil, "aurora", 1, logger)

	man := &manifest.Manifest{
		SchemaVersion: 1,
		Source:        "test",
		Samples: []manifest.Sample{
			{
				SampleID:   "s-bad-size",
				TICID:      888,
				Sector:     1,
				PairStatus: manifest.PairStatusTPFOnly,
				TargetPixel: &manifest.ManifestProduct{
					SourceProductID: "p-bad",
					Kind:            mast.KindTargetPixel,
					Filename:        "bad_size_tp.fits",
					DataURI:         "mast:TESS/bad_size_tp.fits",
					SizeBytes:       999999, // mismatch!
					Sector:          1,
					TICID:           888,
				},
			},
		},
	}

	summary, results, err := pipe.IngestManifest(context.Background(), man, false)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if summary.FailedCount != 1 {
		t.Errorf("expected 1 failed product, got %d", summary.FailedCount)
	}
	if results[0].Status != ingest.StatusFailed {
		t.Errorf("expected result status FAILED, got %s", results[0].Status)
	}
	if results[0].Error == nil {
		t.Error("expected size mismatch error, got nil")
	}
}
