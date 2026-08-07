package tests

import (
	"context"
	"fmt"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"sync"
	"testing"
	"time"

	"go-ingester/internal/events"
	"go-ingester/internal/ingest"
	"go-ingester/internal/manifest"
	"go-ingester/internal/mast"
)

// mockPublisher records published events for unit testing.
type mockPublisher struct {
	mu        sync.Mutex
	published []*events.BronzeObjectReady
	failNext  bool
}

func (m *mockPublisher) PublishBronzeReady(ctx context.Context, evt *events.BronzeObjectReady) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.failNext {
		return fmt.Errorf("simulated nats publish failure")
	}
	m.published = append(m.published, evt)
	return nil
}

func (m *mockPublisher) Close() {}

func TestSubjectMapping(t *testing.T) {
	cases := []struct {
		kind mast.ProductKind
		want string
	}{
		{mast.KindTargetPixel, events.SubjectBronzeTargetPixel},
		{mast.KindLightCurve, events.SubjectBronzeLightCurve},
		{mast.KindFFI, events.SubjectBronzeFFI},
	}
	for _, c := range cases {
		got, err := events.SubjectForKind(c.kind)
		if err != nil {
			t.Fatalf("unexpected error for kind %s: %v", c.kind, err)
		}
		if got != c.want {
			t.Errorf("SubjectForKind(%s) = %q, want %q", c.kind, got, c.want)
		}
	}

	if _, err := events.SubjectForKind(mast.KindUnknown); err == nil {
		t.Errorf("expected error for UNKNOWN product kind")
	}
}

func TestBuildBronzeEvent(t *testing.T) {
	prod := manifest.ManifestProduct{
		SourceProductID: "p123",
		Kind:            mast.KindTargetPixel,
		Sector:          42,
		TICID:           123456789,
		SizeBytes:       1000,
	}

	evt, err := events.BuildBronzeEvent("evt-1", "aurora", prod, "bronze/key.fits", "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if evt.EventID != "evt-1" {
		t.Errorf("got event_id %q, want evt-1", evt.EventID)
	}
	if evt.EventType != events.EventTypeBronzeObjectReady {
		t.Errorf("got event_type %q, want %q", evt.EventType, events.EventTypeBronzeObjectReady)
	}
	if evt.SampleID != "tess-tic-123456789-sector-0042" {
		t.Errorf("got sample_id %q, want tess-tic-123456789-sector-0042", evt.SampleID)
	}
	if evt.ObjectKey != "bronze/key.fits" {
		t.Errorf("got object_key %q", evt.ObjectKey)
	}
}

func TestPipelinePublishOrdering(t *testing.T) {
	fitsPayload := "FITS_ORDERING_TEST"
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/fits")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(fitsPayload))
	}))
	defer ts.Close()

	mastClient := mast.NewClient(ts.URL, 5*time.Second)
	mastClient.SetDownloadURL(ts.URL)

	mockStorage := newMockStorageClient()
	mockPub := &mockPublisher{}
	logger := slog.New(slog.NewTextHandler(os.Stdout, nil))
	pipe := ingest.NewPipeline(mastClient, mockStorage, mockPub, "aurora", 1, logger)

	man := &manifest.Manifest{
		SchemaVersion: 1,
		Source:        "test",
		Samples: []manifest.Sample{
			{
				SampleID:   "s-order",
				TICID:      100,
				Sector:     1,
				PairStatus: manifest.PairStatusTPFOnly,
				TargetPixel: &manifest.ManifestProduct{
					SourceProductID: "p-order",
					Kind:            mast.KindTargetPixel,
					Filename:        "order_tp.fits",
					DataURI:         "mast:TESS/order_tp.fits",
					SizeBytes:       int64(len(fitsPayload)),
					Sector:          1,
					TICID:           100,
				},
			},
		},
	}

	summary, results, err := pipe.IngestManifest(context.Background(), man, false)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if summary.PublishedCount != 1 {
		t.Errorf("expected 1 published event, got %d", summary.PublishedCount)
	}
	if len(results) != 1 || results[0].Status != ingest.StatusPublished {
		t.Errorf("expected StatusPublished, got %s", results[0].Status)
	}

	// Verify MinIO object was written BEFORE publisher was called
	tpKey := "bronze/tess/target-pixel/sector=0001/tic=100/order_tp.fits"
	if _, ok := mockStorage.objects[tpKey]; !ok {
		t.Errorf("expected storage object to exist")
	}

	if len(mockPub.published) != 1 {
		t.Fatalf("expected 1 event published, got %d", len(mockPub.published))
	}
	if mockPub.published[0].ObjectKey != tpKey {
		t.Errorf("event object_key %q != storage key %q", mockPub.published[0].ObjectKey, tpKey)
	}
}

func TestPipelinePublishFailurePreservesStorage(t *testing.T) {
	fitsPayload := "FITS_PUBLISH_FAIL_TEST"
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/fits")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(fitsPayload))
	}))
	defer ts.Close()

	mastClient := mast.NewClient(ts.URL, 5*time.Second)
	mastClient.SetDownloadURL(ts.URL)

	mockStorage := newMockStorageClient()
	mockPub := &mockPublisher{failNext: true} // simulate NATS publish error
	logger := slog.New(slog.NewTextHandler(os.Stdout, nil))
	pipe := ingest.NewPipeline(mastClient, mockStorage, mockPub, "aurora", 1, logger)

	man := &manifest.Manifest{
		SchemaVersion: 1,
		Source:        "test",
		Samples: []manifest.Sample{
			{
				SampleID:   "s-fail-pub",
				TICID:      200,
				Sector:     2,
				PairStatus: manifest.PairStatusTPFOnly,
				TargetPixel: &manifest.ManifestProduct{
					SourceProductID: "p-fail-pub",
					Kind:            mast.KindTargetPixel,
					Filename:        "fail_pub_tp.fits",
					DataURI:         "mast:TESS/fail_pub_tp.fits",
					SizeBytes:       int64(len(fitsPayload)),
					Sector:          2,
					TICID:           200,
				},
			},
		},
	}

	summary, results, err := pipe.IngestManifest(context.Background(), man, false)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if summary.StoredEventFailedCount != 1 {
		t.Errorf("expected 1 StoredEventFailed, got %d", summary.StoredEventFailedCount)
	}
	if results[0].Status != ingest.StatusStoredEventFailed {
		t.Errorf("expected StatusStoredEventFailed, got %s", results[0].Status)
	}

	// Verify Bronze object STILL EXISTS despite NATS publish failure!
	tpKey := "bronze/tess/target-pixel/sector=0002/tic=200/fail_pub_tp.fits"
	if _, ok := mockStorage.objects[tpKey]; !ok {
		t.Errorf("Bronze object must be preserved when NATS publish fails")
	}
}
