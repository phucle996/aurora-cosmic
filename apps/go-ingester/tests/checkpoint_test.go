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

	"go-ingester/infra/mast"
	"go-ingester/internal/model"
	"go-ingester/internal/pipeline/checkpoint"
	"go-ingester/internal/pipeline/ingest"
)

func TestCheckpointStateTransitions(t *testing.T) {
	mockStorage := newMockStorageClient()
	cpStore := checkpoint.NewStore(mockStorage, "aurora")

	prod := model.ManifestProduct{
		SourceProductID: "p-trans",
		Kind:            model.KindTargetPixel,
		Filename:        "trans_tp.fits",
		DataURI:         "mast:TESS/trans_tp.fits",
		SizeBytes:       500,
		Sector:          1,
		TICID:           123,
	}

	cp := model.CreateNewInitialCheckpoint("run-1", "manifest.json", "hash123", []model.ManifestProduct{prod})
	mgr := checkpoint.NewManager(cpStore, cp)

	pc, ok := mgr.GetProductCheckpoint("p-trans")
	if !ok || pc.State != model.StatePlanned {
		t.Fatalf("expected initial StatePlanned, got %s", pc.State)
	}

	mgr.UpdateProductState("p-trans", model.StateDownloading, 0, "", nil)
	pc, _ = mgr.GetProductCheckpoint("p-trans")
	if pc.State != model.StateDownloading || pc.Attempts != 1 {
		t.Errorf("expected StateDownloading with attempts 1, got %s / %d", pc.State, pc.Attempts)
	}

	mgr.UpdateProductState("p-trans", model.StateStored, 500, "hashhex", nil)
	pc, _ = mgr.GetProductCheckpoint("p-trans")
	if pc.State != model.StateStored || pc.SizeBytes != 500 {
		t.Errorf("expected StateStored with size 500, got %s / %d", pc.State, pc.SizeBytes)
	}

	mgr.UpdateProductState("p-trans", model.StatePublished, 500, "hashhex", nil)
	pc, _ = mgr.GetProductCheckpoint("p-trans")
	if pc.State != model.StatePublished {
		t.Errorf("expected StatePublished, got %s", pc.State)
	}

	if err := mgr.Flush(context.Background()); err != nil {
		t.Fatalf("failed to flush checkpoint: %v", err)
	}

	// Verify persistence in mock storage
	loadedCp, exists, err := cpStore.LoadCurrent(context.Background())
	if err != nil || !exists {
		t.Fatalf("failed to load stored checkpoint: %v", err)
	}
	if loadedCp.Products["p-trans"].State != model.StatePublished {
		t.Errorf("persisted state mismatch: got %s, want PUBLISHED", loadedCp.Products["p-trans"].State)
	}
}

func TestCheckpointCrashRecoveryStoredToPublished(t *testing.T) {
	downloadCount := 0
	fitsPayload := "RECOVERED_FITS_PAYLOAD_BINARY"
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		downloadCount++
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

	prod := model.ManifestProduct{
		SourceProductID: "p-crash",
		Kind:            model.KindTargetPixel,
		Filename:        "crash_tp.fits",
		DataURI:         "mast:TESS/crash_tp.fits",
		SizeBytes:       int64(len(fitsPayload)),
		Sector:          5,
		TICID:           555,
	}

	objectKey := "bronze/tess/target-pixel/sector=0005/tic=555/crash_tp.fits"
	mockStorage.objects[objectKey] = &model.ObjectInfo{
		Key:          objectKey,
		Size:         int64(len(fitsPayload)),
		UserMetadata: map[string]string{"sha256": "abcdef123456"},
	}
	mockStorage.content[objectKey] = []byte(fitsPayload)

	cpStore := checkpoint.NewStore(mockStorage, "aurora")
	cp := model.CreateNewInitialCheckpoint("run-crash", "manifest.json", "hash-crash", []model.ManifestProduct{prod})
	cp.Products["p-crash"].State = model.StateStored
	cp.Products["p-crash"].ObjectKey = objectKey
	cp.Products["p-crash"].SizeBytes = int64(len(fitsPayload))
	cp.Products["p-crash"].SHA256 = "abcdef123456"

	mgr := checkpoint.NewManager(cpStore, cp)
	pipe := ingest.NewPipeline(mastClient, mockStorage, mockPub, mgr, "aurora", 1, logger)

	man := &model.Manifest{
		SchemaVersion: 1,
		Source:        "test",
		Samples: []model.Sample{
			{
				SampleID:    "s-crash",
				TICID:       555,
				Sector:      5,
				PairStatus:  model.PairStatusTPFOnly,
				TargetPixel: &prod,
			},
		},
	}

	summary, results, err := pipe.IngestManifest(context.Background(), man, false)
	if err != nil {
		t.Fatalf("unexpected pipeline error: %v", err)
	}

	if downloadCount != 0 {
		t.Errorf("FITS file was downloaded %d times, expected 0 downloads during recovery!", downloadCount)
	}

	if summary.PublishedCount != 1 {
		t.Errorf("expected 1 published event during recovery, got %d", summary.PublishedCount)
	}
	if len(results) != 1 || results[0].Status != model.StatusPublished {
		t.Errorf("expected status PUBLISHED, got %s", results[0].Status)
	}

	pc, _ := mgr.GetProductCheckpoint("p-crash")
	if pc.State != model.StatePublished {
		t.Errorf("expected final checkpoint state PUBLISHED, got %s", pc.State)
	}
}

func TestCheckpointIdempotentRerun(t *testing.T) {
	downloadCount := 0
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		downloadCount++
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("DATA"))
	}))
	defer ts.Close()

	mastClient := mast.NewClient(ts.URL, 5*time.Second)
	mastClient.SetDownloadURL(ts.URL)

	mockStorage := newMockStorageClient()
	mockPub := &mockPublisher{}
	logger := slog.New(slog.NewTextHandler(os.Stdout, nil))

	prod := model.ManifestProduct{
		SourceProductID: "p-done",
		Kind:            model.KindTargetPixel,
		Filename:        "done_tp.fits",
		DataURI:         "mast:TESS/done_tp.fits",
		SizeBytes:       4,
		Sector:          1,
		TICID:           111,
	}

	cpStore := checkpoint.NewStore(mockStorage, "aurora")
	cp := model.CreateNewInitialCheckpoint("run-rerun", "manifest.json", "hash-rerun", []model.ManifestProduct{prod})
	cp.Products["p-done"].State = model.StatePublished
	cp.Products["p-done"].ObjectKey = "bronze/tess/target-pixel/sector=0001/tic=111/done_tp.fits"
	cp.Products["p-done"].SizeBytes = 4

	mgr := checkpoint.NewManager(cpStore, cp)
	pipe := ingest.NewPipeline(mastClient, mockStorage, mockPub, mgr, "aurora", 1, logger)

	man := &model.Manifest{
		SchemaVersion: 1,
		Source:        "test",
		Samples: []model.Sample{
			{
				SampleID:    "s-done",
				TICID:       111,
				Sector:      1,
				PairStatus:  model.PairStatusTPFOnly,
				TargetPixel: &prod,
			},
		},
	}

	summary, results, err := pipe.IngestManifest(context.Background(), man, false)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if summary.SkippedCount != 1 {
		t.Errorf("expected 1 skipped product on rerun, got %d", summary.SkippedCount)
	}
	if summary.PublishedCount != 0 || summary.StoredCount != 0 {
		t.Errorf("rerun should have 0 published and 0 stored count")
	}
	if downloadCount != 0 {
		t.Errorf("rerun downloaded FITS %d times, expected 0", downloadCount)
	}
	if len(mockPub.published) != 0 {
		t.Errorf("rerun published NATS event %d times, expected 0", len(mockPub.published))
	}
	if results[0].Status != model.StatusSkipped {
		t.Errorf("expected SKIPPED status, got %s", results[0].Status)
	}
}

func TestCheckpointManagerConcurrency(t *testing.T) {
	cpStore := checkpoint.NewStore(newMockStorageClient(), "aurora")
	cp := model.CreateNewInitialCheckpoint("run-concurrent", "m.json", "hash", nil)
	cp.Products = make(map[string]*model.ProductCheckpoint)

	for i := 0; i < 50; i++ {
		pid := fmt.Sprintf("p-%d", i)
		cp.Products[pid] = &model.ProductCheckpoint{
			SourceProductID: pid,
			State:           model.StatePlanned,
		}
	}

	mgr := checkpoint.NewManager(cpStore, cp)

	var wg sync.WaitGroup
	for i := 0; i < 50; i++ {
		wg.Add(1)
		go func(idx int) {
			defer wg.Done()
			pid := fmt.Sprintf("p-%d", idx)
			mgr.UpdateProductState(pid, model.StateDownloading, 0, "", nil)
			time.Sleep(1 * time.Millisecond)
			mgr.UpdateProductState(pid, model.StateStored, 100, "hash", nil)
			time.Sleep(1 * time.Millisecond)
			mgr.UpdateProductState(pid, model.StatePublished, 100, "hash", nil)
		}(i)
	}

	wg.Wait()
	status := mgr.FinalizeRun()

	if status != model.RunStatusCompleted {
		t.Errorf("expected RunStatusCompleted, got %s", status)
	}

	for i := 0; i < 50; i++ {
		pid := fmt.Sprintf("p-%d", i)
		pc, ok := mgr.GetProductCheckpoint(pid)
		if !ok || pc.State != model.StatePublished {
			t.Errorf("product %s state mismatch: got %s, want PUBLISHED", pid, pc.State)
		}
	}
}
