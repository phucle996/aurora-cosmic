package tests

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"sync"
	"testing"
	"time"

	"go-ingester/infra/mast"
	"go-ingester/internal/model"
	"go-ingester/internal/pipeline/event"
	"go-ingester/internal/pipeline/plan"
)

type mockPublisher struct {
	mu        sync.Mutex
	published []*event.BronzeReady
	failNext  bool
}

func (m *mockPublisher) PublishBronzeReady(ctx context.Context, evt *event.BronzeReady) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.failNext {
		return fmt.Errorf("simulated nats publish failure")
	}
	m.published = append(m.published, evt)
	return nil
}

func (m *mockPublisher) Close() error {
	return nil
}

func TestSubjectMapping(t *testing.T) {
	tpfSub, err := event.SubjectFor(model.KindTargetPixel)
	if err != nil || tpfSub != event.SubjectTargetPixel {
		t.Errorf("expected %s, got %s (err: %v)", event.SubjectTargetPixel, tpfSub, err)
	}

	lcSub, err := event.SubjectFor(model.KindLightCurve)
	if err != nil || lcSub != event.SubjectLightCurve {
		t.Errorf("expected %s, got %s (err: %v)", event.SubjectLightCurve, lcSub, err)
	}

	_, err = event.SubjectFor(model.KindUnknown)
	if err == nil {
		t.Errorf("expected error for KindUnknown, got nil")
	}
}

func TestBuildBronzeEvent(t *testing.T) {
	prod := model.ManifestProduct{
		SourceProductID: "p123",
		Kind:            model.KindTargetPixel,
		Filename:        "tess_tp.fits",
		DataURI:         "mast:TESS/tess_tp.fits",
		SizeBytes:       1024,
		Sector:          42,
		TICID:           123456789,
	}

	evt, err := event.NewBronzeReady("evt-1", "aurora", prod, "bronze/tess/target-pixel/sector=0042/tic=123456789/tess_tp.fits", "hash123")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if evt.EventID != "evt-1" {
		t.Errorf("expected EventID evt-1, got %s", evt.EventID)
	}
	if evt.EventType != event.TypeBronzeObjectReady {
		t.Errorf("expected EventType %s, got %s", event.TypeBronzeObjectReady, evt.EventType)
	}
	if evt.Bucket != "aurora" {
		t.Errorf("expected Bucket aurora, got %s", evt.Bucket)
	}
	if evt.TICID != 123456789 || evt.Sector != 42 {
		t.Errorf("expected TIC 123456789 / Sector 42, got TIC %d / Sector %d", evt.TICID, evt.Sector)
	}
	if evt.SampleID != "sample:tic=123456789:sector=0042" {
		t.Errorf("expected SampleID sample:tic=123456789:sector=0042, got %s", evt.SampleID)
	}
	payload, err := event.MarshalBronzeReady(evt)
	if err != nil {
		t.Fatalf("marshal Bronze event: %v", err)
	}
	var document map[string]any
	if err := json.Unmarshal(payload, &document); err != nil {
		t.Fatalf("decode Bronze event JSON: %v", err)
	}
	if document["source_product_id"] != "p123" || document["object_key"] == nil {
		t.Fatalf("event codec changed the NATS wire contract: %s", payload)
	}
}

func TestPipelinePublishOrdering(t *testing.T) {
	fitsData := "VALID_FITS_DATA_PAYLOAD"

	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/fits")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(fitsData))
	}))
	defer ts.Close()

	mastClient := mast.NewClient(ts.URL, 5*time.Second)
	mastClient.SetDownloadURL(ts.URL)

	mockStorage := newMockStorageClient()
	mockPub := &mockPublisher{}
	logger := slog.New(slog.NewTextHandler(os.Stdout, nil))
	pipe := newTestPipeline(mastClient, mockStorage, mockPub, nil, "aurora", 1, logger)

	man := &model.Manifest{
		SchemaVersion: 1,
		Source:        "test",
		Samples: []model.Sample{
			{
				SampleID: plan.SampleID(100, 1),
				TICID:    100,
				Sector:   1,
				TargetPixel: &model.ManifestProduct{
					SourceProductID: "p-order",
					Kind:            model.KindTargetPixel,
					Filename:        "order_tp.fits",
					DataURI:         ts.URL + "/order_tp.fits",
					// Discovery may not know the remote object size. The event must
					// carry the measured size from the streamed download instead.
					SizeBytes: 0,
					Sector:    1,
					TICID:     100,
				},
			},
		},
	}

	summary, results, err := pipe.IngestManifest(context.Background(), man)
	if err != nil {
		t.Fatalf("unexpected pipeline error: %v", err)
	}

	if summary.PublishedCount != 1 {
		t.Errorf("expected 1 published count, got %d", summary.PublishedCount)
	}
	if len(results) != 1 || results[0].Status != model.StatusPublished {
		t.Errorf("expected result status PUBLISHED, got %v", results[0].Status)
	}

	key := "bronze/tess/target-pixel/sector=0001/tic=100/order_tp.fits"
	if _, exists := mockStorage.objects[key]; !exists {
		t.Fatalf("MinIO object key %s missing", key)
	}

	if len(mockPub.published) != 1 {
		t.Fatalf("expected 1 NATS published event, got %d", len(mockPub.published))
	}
	evt := mockPub.published[0]
	if evt.ObjectKey != key {
		t.Errorf("published event key %s != expected %s", evt.ObjectKey, key)
	}
	if evt.SizeBytes != int64(len(fitsData)) {
		t.Errorf("published event size %d != measured size %d", evt.SizeBytes, len(fitsData))
	}
}

func TestPipelinePublishFailurePreservesStorage(t *testing.T) {
	fitsData := "FAIL_PUB_FITS_DATA_PAYLOAD"

	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/fits")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(fitsData))
	}))
	defer ts.Close()

	mastClient := mast.NewClient(ts.URL, 5*time.Second)
	mastClient.SetDownloadURL(ts.URL)

	mockStorage := newMockStorageClient()
	mockPub := &mockPublisher{failNext: true}
	logger := slog.New(slog.NewTextHandler(os.Stdout, nil))
	pipe := newTestPipeline(mastClient, mockStorage, mockPub, nil, "aurora", 1, logger)

	man := &model.Manifest{
		SchemaVersion: 1,
		Source:        "test",
		Samples: []model.Sample{
			{
				SampleID: plan.SampleID(200, 2),
				TICID:    200,
				Sector:   2,
				TargetPixel: &model.ManifestProduct{
					SourceProductID: "p-fail-pub",
					Kind:            model.KindTargetPixel,
					Filename:        "fail_pub_tp.fits",
					DataURI:         ts.URL + "/fail_pub_tp.fits",
					SizeBytes:       int64(len(fitsData)),
					Sector:          2,
					TICID:           200,
				},
			},
		},
	}

	summary, results, err := pipe.IngestManifest(context.Background(), man)
	if err != nil {
		t.Fatalf("unexpected pipeline execution error: %v", err)
	}

	if summary.StoredEventFailedCount != 1 {
		t.Errorf("expected 1 StoredEventFailedCount, got %d", summary.StoredEventFailedCount)
	}
	if results[0].Status != model.StatusStoredEventFailed {
		t.Errorf("expected result status STORED_EVENT_FAILED, got %v", results[0].Status)
	}

	key := "bronze/tess/target-pixel/sector=0002/tic=200/fail_pub_tp.fits"
	if _, exists := mockStorage.objects[key]; !exists {
		t.Fatalf("MinIO object key %s missing despite NATS publish failure!", key)
	}
}
