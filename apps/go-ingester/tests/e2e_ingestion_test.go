package tests

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
	"time"

	"go-ingester/internal/checkpoint"
	"go-ingester/internal/ingest"
	"go-ingester/internal/manifest"
	"go-ingester/internal/mast"
)

func TestE2EIngestionOfflinePipeline(t *testing.T) {
	// 1. Setup Mock MAST Server
	tpfData := "SIMPLE  =                    T / FITS STANDARD HEADER                          BITPIX  =                    8 / 8-BIT UNSIGNED INTEGERS                       NAXIS   =                    0 / NO AXES IN MAIN FITS ARRAY                    END                                                                             "
	lcData := "SIMPLE  =                    T / FITS STANDARD HEADER LC                       BITPIX  =                    8 / 8-BIT UNSIGNED INTEGERS                       NAXIS   =                    0 / NO AXES IN MAIN FITS ARRAY                    END                                                                             "

	downloadCounts := make(map[string]int)

	mastServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/tpf.fits":
			downloadCounts["tpf.fits"]++
			w.Header().Set("Content-Type", "application/fits")
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte(tpfData))
		case "/lc.fits":
			downloadCounts["lc.fits"]++
			w.Header().Set("Content-Type", "application/fits")
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte(lcData))
		default:
			http.NotFound(w, r)
		}
	}))
	defer mastServer.Close()

	mastClient := mast.NewClient(mastServer.URL, 5*time.Second)
	mastClient.SetDownloadURL(mastServer.URL)

	mockStorage := newMockStorageClient()
	mockPub := &mockPublisher{}
	logger := slog.New(slog.NewTextHandler(os.Stdout, nil))

	// 2. Build Test Manifest with 1 paired sample (TPF + LC)
	tpfProd := manifest.ManifestProduct{
		SourceProductID: "p-tpf-e2e",
		Kind:            mast.KindTargetPixel,
		Filename:        "tess_tpf_e2e_tp.fits",
		DataURI:         mastServer.URL + "/tpf.fits",
		SizeBytes:       int64(len(tpfData)),
		Sector:          42,
		TICID:           123456789,
	}

	lcProd := manifest.ManifestProduct{
		SourceProductID: "p-lc-e2e",
		Kind:            mast.KindLightCurve,
		Filename:        "tess_lc_e2e_lc.fits",
		DataURI:         mastServer.URL + "/lc.fits",
		SizeBytes:       int64(len(lcData)),
		Sector:          42,
		TICID:           123456789,
	}

	man := &manifest.Manifest{
		SchemaVersion: 1,
		Source:        "test-e2e",
		Samples: []manifest.Sample{
			{
				SampleID:    manifest.SampleID(123456789, 42),
				TICID:       123456789,
				Sector:      42,
				PairStatus:  manifest.PairStatusPaired,
				TargetPixel: &tpfProd,
				LightCurve:  &lcProd,
			},
		},
		Statistics: manifest.Statistics{
			PairedCount: 1,
			TotalBytes:  int64(len(tpfData) + len(lcData)),
		},
	}

	// 3. Test Phase A: Dry-Run Ingestion (No Storage writes, No NATS events)
	dryPipe := ingest.NewPipeline(mastClient, mockStorage, mockPub, nil, "aurora", 2, logger)
	drySummary, dryResults, err := dryPipe.IngestManifest(context.Background(), man, true)
	if err != nil {
		t.Fatalf("dry-run ingestion failed: %v", err)
	}

	if drySummary.SkippedCount != 2 || len(dryResults) != 2 {
		t.Errorf("dry-run expected 2 skipped products, got %d", drySummary.SkippedCount)
	}
	if len(mockStorage.objects) != 0 {
		t.Errorf("dry-run modified storage, found %d objects", len(mockStorage.objects))
	}
	if len(mockPub.published) != 0 {
		t.Errorf("dry-run published NATS events, found %d events", len(mockPub.published))
	}

	// 4. Test Phase B: Real Ingestion Run with Checkpoint Manager
	cpStore := checkpoint.NewStore(mockStorage, "aurora")
	initCp := checkpoint.CreateNewInitialCheckpoint("run-e2e-1", "manifest.json", "hash-e2e", []manifest.ManifestProduct{tpfProd, lcProd})
	mgr := checkpoint.NewManager(cpStore, initCp)

	realPipe := ingest.NewPipeline(mastClient, mockStorage, mockPub, mgr, "aurora", 2, logger)
	summary, results, err := realPipe.IngestManifest(context.Background(), man, false)
	if err != nil {
		t.Fatalf("real ingestion failed: %v", err)
	}

	// Invariant Checks for Phase B
	if summary.PublishedCount != 2 || summary.FailedCount != 0 {
		t.Errorf("expected 2 published products and 0 failed, got published=%d failed=%d", summary.PublishedCount, summary.FailedCount)
	}
	if downloadCounts["tpf.fits"] != 1 || downloadCounts["lc.fits"] != 1 {
		t.Errorf("expected 1 MAST download per product, got tpf=%d lc=%d", downloadCounts["tpf.fits"], downloadCounts["lc.fits"])
	}

	// Check MinIO Object Key and Bytes
	tpfKey := "bronze/tess/target-pixel/sector=0042/tic=123456789/tess_tpf_e2e_tp.fits"
	lcKey := "bronze/tess/lightcurve/sector=0042/tic=123456789/tess_lc_e2e_lc.fits"

	if string(mockStorage.content[tpfKey]) != tpfData {
		t.Errorf("MinIO Bronze TPF binary mismatch!")
	}
	if string(mockStorage.content[lcKey]) != lcData {
		t.Errorf("MinIO Bronze LC binary mismatch!")
	}

	// Invariant: NATS event payload MUST NOT contain binary FITS data!
	for _, evt := range mockPub.published {
		evtBytes, _ := json.Marshal(evt)
		evtStr := string(evtBytes)
		if len(evtStr) > 2000 {
			t.Errorf("NATS event payload unexpectedly large (%d bytes), potential FITS binary leakage!", len(evtStr))
		}
		if evt.ObjectKey != tpfKey && evt.ObjectKey != lcKey {
			t.Errorf("NATS event object_key %s not found in expected keys", evt.ObjectKey)
		}
	}

	// Checkpoint state must be PUBLISHED
	if mgr.GetCheckpoint().Status != checkpoint.RunStatusCompleted {
		t.Errorf("expected Checkpoint RunStatusCompleted, got %s", mgr.GetCheckpoint().Status)
	}

	// 5. Test Phase C: Idempotent Rerun (0 extra downloads, 0 extra NATS publishes)
	rerunSummary, _, err := realPipe.IngestManifest(context.Background(), man, false)
	if err != nil {
		t.Fatalf("idempotent rerun failed: %v", err)
	}
	if rerunSummary.SkippedCount != 2 {
		t.Errorf("expected 2 skipped products on rerun, got %d", rerunSummary.SkippedCount)
	}
	if downloadCounts["tpf.fits"] != 1 || downloadCounts["lc.fits"] != 1 {
		t.Errorf("rerun caused extra MAST downloads: tpf=%d lc=%d", downloadCounts["tpf.fits"], downloadCounts["lc.fits"])
	}

	_ = results
}
