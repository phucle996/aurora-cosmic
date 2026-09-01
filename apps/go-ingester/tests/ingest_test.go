package tests

import (
	"bytes"
	"context"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"go-ingester/infra/mast"
	"go-ingester/internal/model"
	"go-ingester/internal/pipeline/checkpoint"
	"go-ingester/internal/pipeline/event"
	"go-ingester/internal/pipeline/ingest"
	"go-ingester/internal/pipeline/plan"
	storagecontract "go-ingester/internal/pipeline/storage"
)

type mockStorageClient struct {
	mu      sync.Mutex
	objects map[string]*storagecontract.ObjectInfo
	content map[string][]byte
}

type fixedSourceReader struct {
	data []byte
	size int64
}

type gatedSourceReader struct {
	data    []byte
	started chan struct{}
	release chan struct{}
	once    sync.Once
	mu      sync.Mutex
	opens   int
}

func (s *gatedSourceReader) OpenProduct(context.Context, string) (io.ReadCloser, int64, error) {
	s.mu.Lock()
	s.opens++
	s.mu.Unlock()
	return &gatedReadCloser{source: s}, int64(len(s.data)), nil
}

type gatedReadCloser struct {
	source *gatedSourceReader
	offset int
}

func (r *gatedReadCloser) Read(output []byte) (int, error) {
	r.source.once.Do(func() { close(r.source.started) })
	<-r.source.release
	if r.offset >= len(r.source.data) {
		return 0, io.EOF
	}
	n := copy(output, r.source.data[r.offset:])
	r.offset += n
	return n, nil
}

func (*gatedReadCloser) Close() error { return nil }

func (s fixedSourceReader) OpenProduct(context.Context, string) (io.ReadCloser, int64, error) {
	return io.NopCloser(bytes.NewReader(s.data)), s.size, nil
}

type recordingCapacityGate struct {
	mu       sync.Mutex
	acquired []int64
	released int64
}

func (g *recordingCapacityGate) Acquire(_ context.Context, size int64) (func(), error) {
	g.mu.Lock()
	g.acquired = append(g.acquired, size)
	g.mu.Unlock()
	return func() {
		g.mu.Lock()
		g.released += size
		g.mu.Unlock()
	}, nil
}

func newMockStorageClient() *mockStorageClient {
	return &mockStorageClient{
		objects: make(map[string]*storagecontract.ObjectInfo),
		content: make(map[string][]byte),
	}
}

func newTestPipeline(source ingest.SourceReader, storage storagecontract.Client, publisher event.Publisher, checkpoints *checkpoint.Manager, bucket string, workers int, logger *slog.Logger) *ingest.Pipeline {
	return ingest.NewPipeline(
		ingest.Dependencies{
			Source:      source,
			Storage:     storage,
			Publisher:   publisher,
			Checkpoints: checkpoints,
		},
		ingest.Options{
			Bucket:      bucket,
			WorkerCount: workers,
			Logger:      logger,
		},
	)
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
	m.objects[objectKey] = &storagecontract.ObjectInfo{
		Key:          objectKey,
		Size:         int64(len(data)),
		UserMetadata: userMetadata,
	}
	return nil
}

func (m *mockStorageClient) StatObject(ctx context.Context, bucket, objectKey string) (*storagecontract.ObjectInfo, bool, error) {
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
		return nil, storagecontract.ErrObjectNotFound
	}
	return io.NopCloser(bytes.NewReader(data)), nil
}

func (m *mockStorageClient) ListObjectsWithPrefix(_ context.Context, _ string, prefix string) ([]storagecontract.ObjectInfo, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	var result []storagecontract.ObjectInfo
	for key, info := range m.objects {
		if info != nil && strings.HasPrefix(key, prefix) {
			result = append(result, *info)
		}
	}
	return result, nil
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
	var progressMu sync.Mutex
	var progressEvents []ingest.ProgressEvent
	pipe := ingest.NewPipeline(
		ingest.Dependencies{Source: mastClient, Storage: mockStorage},
		ingest.Options{
			Bucket:      "aurora",
			WorkerCount: 2,
			Logger:      logger,
			Progress: func(event ingest.ProgressEvent) {
				progressMu.Lock()
				progressEvents = append(progressEvents, event)
				progressMu.Unlock()
			},
		},
	)

	man := &model.Manifest{
		SchemaVersion: 1,
		Source:        "test",
		Samples: []model.Sample{
			{
				SampleID: plan.SampleID(999, 10),
				TICID:    999,
				Sector:   10,
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

	summary, results, err := pipe.IngestManifest(context.Background(), man)
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
	progressMu.Lock()
	defer progressMu.Unlock()
	if len(progressEvents) != 2 {
		t.Fatalf("expected 2 progress events, got %d", len(progressEvents))
	}
	if progressEvents[len(progressEvents)-1].CompletedProducts != 2 || progressEvents[len(progressEvents)-1].ConfiguredWorkers != 2 {
		t.Errorf("unexpected progress counters: %+v", progressEvents[len(progressEvents)-1])
	}
}

func TestPipelineDrainFinishesClaimedProductWithoutStartingNext(t *testing.T) {
	drain := make(chan struct{})
	source := &gatedSourceReader{
		data:    []byte("CURRENT_FITS_TRANSFER"),
		started: make(chan struct{}),
		release: make(chan struct{}),
	}
	storage := newMockStorageClient()
	pipe := ingest.NewPipeline(
		ingest.Dependencies{Source: source, Storage: storage},
		ingest.Options{Bucket: "aurora", WorkerCount: 1, Drain: drain},
	)
	manifest := &model.Manifest{Samples: []model.Sample{
		{LightCurve: &model.ManifestProduct{SourceProductID: "current", Kind: model.KindLightCurve, Filename: "current_lc.fits", DataURI: "memory://current", SizeBytes: int64(len(source.data)), Sector: 1, TICID: 1}},
		{LightCurve: &model.ManifestProduct{SourceProductID: "next", Kind: model.KindLightCurve, Filename: "next_lc.fits", DataURI: "memory://next", SizeBytes: int64(len(source.data)), Sector: 1, TICID: 2}},
	}}
	type outcome struct {
		summary *model.Summary
		results []model.ProductResult
		err     error
	}
	done := make(chan outcome, 1)
	go func() {
		summary, results, err := pipe.IngestManifest(context.Background(), manifest)
		done <- outcome{summary: summary, results: results, err: err}
	}()
	<-source.started
	close(drain)
	close(source.release)

	result := <-done
	if result.err != nil {
		t.Fatalf("drain pipeline: %v", result.err)
	}
	if result.summary.StoredCount != 1 || len(result.results) != 1 {
		t.Fatalf("drain should finish only the claimed product, summary=%+v results=%+v", result.summary, result.results)
	}
	source.mu.Lock()
	defer source.mu.Unlock()
	if source.opens != 1 {
		t.Fatalf("drain started %d products, want exactly the active transfer", source.opens)
	}
}

func TestPipelineSkipExistingValidObject(t *testing.T) {
	mockStorage := newMockStorageClient()
	tpKey := "bronze/tess/target-pixel/sector=0005/tic=777/existing_tp.fits"
	existingData := []byte("EXISTING_VALID_CONTENT")
	mockStorage.objects[tpKey] = &storagecontract.ObjectInfo{
		Key:          tpKey,
		Size:         int64(len(existingData)),
		UserMetadata: map[string]string{"sha256": "dummyhash"},
	}
	mockStorage.content[tpKey] = existingData

	logger := slog.New(slog.NewTextHandler(os.Stdout, nil))
	pipe := newTestPipeline(nil, mockStorage, nil, nil, "aurora", 1, logger)

	man := &model.Manifest{
		SchemaVersion: 1,
		Source:        "test",
		Samples: []model.Sample{
			{
				SampleID: plan.SampleID(777, 5),
				TICID:    777,
				Sector:   5,
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

	summary, results, err := pipe.IngestManifest(context.Background(), man)
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

func TestPipelineSkipExistingObjectWithUnknownExpectedSize(t *testing.T) {
	mockStorage := newMockStorageClient()
	objectKey := "bronze/tess/lightcurve/sector=0005/tic=777/unknown-size_lc.fits"
	existingData := []byte("EXISTING_OBJECT_WITH_UNKNOWN_MANIFEST_SIZE")
	mockStorage.objects[objectKey] = &storagecontract.ObjectInfo{
		Key:          objectKey,
		Size:         int64(len(existingData)),
		UserMetadata: map[string]string{"sha256": "dummyhash"},
	}
	mockStorage.content[objectKey] = existingData

	pipe := newTestPipeline(nil, mockStorage, nil, nil, "aurora", 1, nil)
	man := &model.Manifest{Samples: []model.Sample{{LightCurve: &model.ManifestProduct{
		SourceProductID: "p-unknown-size",
		Kind:            model.KindLightCurve,
		Filename:        "unknown-size_lc.fits",
		DataURI:         "mast:TESS/unknown-size_lc.fits",
		SizeBytes:       0,
		Sector:          5,
		TICID:           777,
	}}}}

	summary, results, err := pipe.IngestManifest(context.Background(), man)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if summary.SkippedCount != 1 || len(results) != 1 || results[0].Status != model.StatusSkipped {
		t.Fatalf("expected existing object to be skipped, summary=%+v results=%+v", summary, results)
	}
}

// TestPipelineSizeMismatchAdvisory verifies that a divergence between the
// MAST catalog estimate and actual stream bytes is treated as advisory:
// the product is stored successfully with a warning log, not failed.
// MAST catalog sizes are estimates and routinely diverge from actual file sizes.
func TestPipelineSizeMismatchAdvisory(t *testing.T) {
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
	pipe := newTestPipeline(mastClient, mockStorage, nil, nil, "aurora", 1, logger)

	man := &model.Manifest{
		SchemaVersion: 1,
		Source:        "test",
		Samples: []model.Sample{
			{
				SampleID: plan.SampleID(888, 1),
				TICID:    888,
				Sector:   1,
				TargetPixel: &model.ManifestProduct{
					SourceProductID: "p-mismatch",
					Kind:            model.KindTargetPixel,
					Filename:        "mismatch_tp.fits",
					DataURI:         ts.URL + "/short.fits",
					SizeBytes:       1000, // MAST estimate — actual stream is 5 bytes
					Sector:          1,
					TICID:           888,
				},
			},
		},
	}

	summary, results, err := pipe.IngestManifest(context.Background(), man)
	if err != nil {
		t.Fatalf("unexpected pipeline execution error: %v", err)
	}

	// MAST size estimates are advisory — divergence must not cause a failure.
	if summary.FailedCount != 0 {
		t.Errorf("expected 0 failures for MAST size estimate divergence, got %d", summary.FailedCount)
	}
	if len(results) != 1 {
		t.Fatalf("expected 1 result, got %d", len(results))
	}
	if results[0].Status == model.StatusFailed {
		t.Errorf("product should not be FAILED for advisory size divergence, got %v", results[0].Status)
	}
}

func TestPipelineReservesHTTPSizeAboveCatalogEstimate(t *testing.T) {
	gate := &recordingCapacityGate{}
	data := []byte("actual payload")
	pipe := ingest.NewPipeline(
		ingest.Dependencies{Source: fixedSourceReader{data: data, size: int64(len(data))}, Storage: newMockStorageClient()},
		ingest.Options{Bucket: "aurora", WorkerCount: 1, CapacityGate: gate},
	)
	manifest := &model.Manifest{Samples: []model.Sample{{LightCurve: &model.ManifestProduct{
		SourceProductID: "capacity-delta",
		Kind:            model.KindLightCurve,
		Filename:        "capacity_lc.fits",
		DataURI:         "memory://capacity",
		SizeBytes:       4,
		Sector:          1,
		TICID:           42,
	}}}}

	summary, _, err := pipe.IngestManifest(context.Background(), manifest)
	if err != nil {
		t.Fatalf("ingest: %v", err)
	}
	if summary.StoredCount != 1 {
		t.Fatalf("stored=%d, want 1", summary.StoredCount)
	}
	gate.mu.Lock()
	defer gate.mu.Unlock()
	if len(gate.acquired) != 2 || gate.acquired[0] != 4 || gate.acquired[1] != int64(len(data))-4 {
		t.Fatalf("capacity acquisitions=%v, want catalog estimate plus HTTP delta", gate.acquired)
	}
	if gate.released != int64(len(data)) {
		t.Fatalf("released=%d, want %d", gate.released, len(data))
	}
}

func TestPipelineRejectsInvalidManifestSizes(t *testing.T) {
	pipe := newTestPipeline(nil, newMockStorageClient(), nil, nil, "aurora", 1, nil)
	if _, _, err := pipe.IngestManifest(context.Background(), nil); err == nil {
		t.Fatal("expected nil manifest rejection")
	}
	man := &model.Manifest{Samples: []model.Sample{{TargetPixel: &model.ManifestProduct{
		SourceProductID: "negative-size", SizeBytes: -1,
	}}}}
	if _, _, err := pipe.IngestManifest(context.Background(), man); err == nil {
		t.Fatal("expected negative product size rejection")
	}
}
