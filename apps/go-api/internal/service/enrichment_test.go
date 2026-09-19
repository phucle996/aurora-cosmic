package service

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"testing"

	"github.com/parquet-go/parquet-go"
	"go-api/internal/domain/entity"
	"go-api/internal/provider"
)

type testEnrichmentRow struct {
	SourceProductID string  `parquet:"source_product_id"`
	Score           float64 `parquet:"score"`
}

type memoryEnrichmentObjects struct{ data map[string][]byte }

type recordingEnrichmentPublisher struct{ events []provider.Event }

func (p *recordingEnrichmentPublisher) Publish(_ context.Context, _ string, event provider.Event) error {
	p.events = append(p.events, event)
	return nil
}

func (m *memoryEnrichmentObjects) Ping(context.Context) error { return nil }
func (m *memoryEnrichmentObjects) ListObjects(_ context.Context, prefix string) ([]provider.ObjectInfo, error) {
	objects := make([]provider.ObjectInfo, 0)
	for key := range m.data {
		if strings.HasPrefix(key, prefix) {
			objects = append(objects, provider.ObjectInfo{Key: key})
		}
	}
	return objects, nil
}
func (m *memoryEnrichmentObjects) ListObjectsWithMetadata(_ context.Context, prefix string) ([]provider.ObjectInfo, error) {
	return m.ListObjects(context.Background(), prefix)
}
func (m *memoryEnrichmentObjects) ListObjectsCursor(context.Context, string, string, int) ([]provider.ObjectInfo, string, bool, error) {
	return nil, "", false, nil
}
func (m *memoryEnrichmentObjects) GetObject(_ context.Context, key string) ([]byte, error) {
	value, ok := m.data[key]
	if !ok {
		return nil, fmt.Errorf("%w: %s", provider.ErrObjectNotFound, key)
	}
	return value, nil
}
func (m *memoryEnrichmentObjects) PutObject(_ context.Context, key string, data []byte, _ string) error {
	m.data[key] = append([]byte(nil), data...)
	return nil
}
func (m *memoryEnrichmentObjects) DeleteObject(_ context.Context, key string) error {
	delete(m.data, key)
	return nil
}

func TestEnrichmentLineageOnlyMarksCommittedManifestInputsExtracted(t *testing.T) {
	committed, err := json.Marshal(entity.EnrichmentSnapshotDetail{
		SnapshotID: "gold-v1-committed", Status: "COMMITTED",
		CompletenessContract: entity.EnrichmentCompletenessContract{Policy: "research-ready-target-pair-v4"},
		Artifacts:            []entity.EnrichmentArtifact{{Dataset: "candidate", RowCount: 1}},
		Inputs:               []entity.EnrichmentSnapshotInput{{SourceProductID: "tess-lc-1", SilverObjectKey: "silver/tess/lc-1.parquet"}},
	})
	if err != nil {
		t.Fatal(err)
	}
	pending, err := json.Marshal(entity.EnrichmentSnapshotDetail{
		SnapshotID: "gold-v1-pending", Status: "PENDING",
		Artifacts: []entity.EnrichmentArtifact{{Dataset: "candidate", RowCount: 1}},
		Inputs:    []entity.EnrichmentSnapshotInput{{SourceProductID: "tess-lc-2"}},
	})
	if err != nil {
		t.Fatal(err)
	}
	objects := &memoryEnrichmentObjects{data: map[string][]byte{
		"gold/snapshots/gold-v1-committed/manifest.json": committed,
		"gold/snapshots/gold-v1-pending/manifest.json":   pending,
	}}
	service := NewEnrichmentControlService(objects, nil)
	resolved, err := service.ResolveLineage(context.Background(), []entity.EnrichmentLineageLookup{
		{SourceProductID: "tess-lc-1"}, {SourceProductID: "tess-lc-2"}, {SourceProductID: "missing"},
	})
	if err != nil {
		t.Fatal(err)
	}
	if resolved[0].Status != "EXTRACTED" || resolved[0].SnapshotID != "gold-v1-committed" || len(resolved[0].Datasets) != 1 {
		t.Fatalf("expected committed input to be extracted, got %#v", resolved[0])
	}
	if resolved[1].Status != "PENDING" || resolved[2].Status != "PENDING" {
		t.Fatalf("pending or missing inputs must not be inferred as extracted: %#v", resolved)
	}
}

func TestEnrichmentLineageDoesNotTreatLegacyPartialSnapshotAsExtracted(t *testing.T) {
	legacy, err := json.Marshal(entity.EnrichmentSnapshotDetail{
		SnapshotID: "gold-v1-legacy", Status: "COMMITTED",
		Artifacts: []entity.EnrichmentArtifact{{Dataset: "candidate", RowCount: 1}},
		Inputs:    []entity.EnrichmentSnapshotInput{{SourceProductID: "tess-lc-legacy"}},
	})
	if err != nil {
		t.Fatal(err)
	}
	service := NewEnrichmentControlService(&memoryEnrichmentObjects{data: map[string][]byte{
		"gold/snapshots/gold-v1-legacy/manifest.json": legacy,
	}}, nil)
	resolved, err := service.ResolveLineage(context.Background(), []entity.EnrichmentLineageLookup{{SourceProductID: "tess-lc-legacy"}})
	if err != nil {
		t.Fatal(err)
	}
	if resolved[0].Status != "PENDING" {
		t.Fatalf("legacy partial snapshot must not resolve as extracted: %#v", resolved[0])
	}
}

func TestEnrichmentControlStartsAndPausesDurably(t *testing.T) {
	objects := &memoryEnrichmentObjects{data: map[string][]byte{}}
	publisher := &recordingEnrichmentPublisher{}
	service := NewEnrichmentControlService(objects, publisher)

	initial, err := service.GetControlOverview(context.Background())
	if err != nil || initial.Control.Mode != "PAUSED" {
		t.Fatalf("expected default paused control, got %#v err=%v", initial, err)
	}

	started, err := service.Start(context.Background(), entity.EnrichmentControlStartRequest{
		Mode: "stream", IdleFlushSeconds: 180, MaxBatchRecords: 5000, TicketID: "enrichment-observer-test",
	})
	if err != nil || started.Status != "armed" || started.TicketID == "" {
		t.Fatalf("expected durable stream command result, got %#v err=%v", started, err)
	}
	if len(publisher.events) != 1 || publisher.events[0].Topic != "gold:enrichment-observer-test" {
		t.Fatalf("expected ticket-scoped start event, got %#v", publisher.events)
	}
	var eventData map[string]any
	if err := json.Unmarshal(publisher.events[0].Data, &eventData); err != nil {
		t.Fatalf("unmarshal event data: %v", err)
	}
	if eventData["ticket_id"] != "enrichment-observer-test" {
		t.Fatalf("unexpected event data: %#v", eventData)
	}

	stopped, err := service.Stop(context.Background())
	if err != nil || stopped.Status != "pause_requested" || stopped.TicketID == "" {
		t.Fatalf("expected durable paused command result, got %#v err=%v", stopped, err)
	}

	overview, err := service.GetControlOverview(context.Background())
	if err != nil || overview.Control.Mode != "PAUSED" {
		t.Fatalf("expected paused control in overview, got %#v err=%v", overview, err)
	}
}

func TestEnrichmentControlReadsDurableReadinessTelemetry(t *testing.T) {
	runtime, err := json.Marshal(entity.EnrichmentRuntimeStatus{
		SchemaVersion: 2,
		State:         "WAITING_FOR_MODALITY",
		Readiness: entity.EnrichmentReadinessStatus{
			CatalogReady:          true,
			TICCatalogReady:       true,
			TOICatalogReady:       true,
			WaitingLightcurves:    7,
			MissingTPF:            2,
			TPFContexts:           11,
			ContractedLightcurves: 7,
		},
		CatalogSync: entity.EnrichmentCatalogSyncStatus{
			Mode: "ON_DEMAND", State: "READY", TargetCount: 7,
			TICRecords: 7, TOIRecords: 2, SnapshotIDs: map[string]string{"TIC": "tic-v1-test", "TOI": "toi-v1-test"},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	objects := &memoryEnrichmentObjects{data: map[string][]byte{enrichmentRuntimeStatusKey: runtime}}
	overview, err := NewEnrichmentControlService(objects, nil).GetControlOverview(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if overview.Runtime == nil || overview.Runtime.Readiness.TPFContexts != 11 || overview.Runtime.Readiness.ContractedLightcurves != 7 || overview.Runtime.CatalogSync.State != "READY" || overview.Runtime.CatalogSync.TICRecords != 7 {
		t.Fatalf("expected durable readiness telemetry, got %#v", overview.Runtime)
	}
}

func TestEnrichmentControlPersistedControlRejectsInvalidWithoutFallback(t *testing.T) {
	// Persisted control with invalid idle flush fails without fallback
	badPersisted, _ := json.Marshal(map[string]any{
		"schema_version":     1,
		"mode":               "STREAM",
		"idle_flush_seconds": 10,
		"max_batch_records":  5000,
	})
	badService := NewEnrichmentControlService(&memoryEnrichmentObjects{
		data: map[string][]byte{enrichmentControlKey: badPersisted},
	}, nil)
	if _, err := badService.GetControlOverview(context.Background()); err == nil {
		t.Fatal("expected invalid persisted idle flush to fail without fallback")
	}
}

func TestEnrichmentArtifactReadsRealParquetSchemaPreviewAndLineage(t *testing.T) {
	var parquetBytes bytes.Buffer
	writer := parquet.NewGenericWriter[testEnrichmentRow](&parquetBytes)
	if _, err := writer.Write([]testEnrichmentRow{{SourceProductID: "tess-lc-1", Score: 0.98}}); err != nil {
		t.Fatalf("write test parquet: %v", err)
	}
	if err := writer.Close(); err != nil {
		t.Fatalf("close test parquet: %v", err)
	}
	artifactKey := "gold/snapshots/gold-v1-test/data/candidate/sector=0042/part-00000.parquet"
	manifest, err := json.Marshal(entity.EnrichmentSnapshotDetail{
		SnapshotID: "gold-v1-test",
		Artifacts: []entity.EnrichmentArtifact{{
			Dataset: "candidate", Sector: 42, ObjectKey: artifactKey, SizeBytes: int64(parquetBytes.Len()), RowCount: 1,
		}},
		Inputs: []entity.EnrichmentSnapshotInput{{
			ProductKind: "LIGHT_CURVE", SilverObjectKey: "silver/tess/lc-1.parquet", SilverSHA256: "abc",
		}},
	})
	if err != nil {
		t.Fatalf("marshal manifest: %v", err)
	}
	objects := &memoryEnrichmentObjects{data: map[string][]byte{
		"gold/snapshots/gold-v1-test/manifest.json": manifest,
		artifactKey: parquetBytes.Bytes(),
	}}
	service := NewEnrichmentControlService(objects, nil)
	detail, err := service.Artifact(context.Background(), "gold-v1-test", "candidate", 42, entity.EnrichmentArtifactPreviewQuery{Limit: 10})
	if err != nil {
		t.Fatalf("read artifact detail: %v", err)
	}
	if len(detail.Schema) != 2 || len(detail.Preview) != 1 {
		t.Fatalf("unexpected artifact detail: %#v", detail)
	}
	if detail.Preview[0]["source_product_id"] != "tess-lc-1" {
		t.Fatalf("expected real Parquet preview, got %#v", detail.Preview[0])
	}
}

func TestEnrichmentArtifactPreviewPaginatesAndFiltersRealParquetRows(t *testing.T) {
	var parquetBytes bytes.Buffer
	writer := parquet.NewGenericWriter[testEnrichmentRow](&parquetBytes)
	if _, err := writer.Write([]testEnrichmentRow{{SourceProductID: "alpha", Score: 0.1}, {SourceProductID: "beta", Score: 0.2}, {SourceProductID: "beta", Score: 0.3}}); err != nil {
		t.Fatalf("write test parquet: %v", err)
	}
	if err := writer.Close(); err != nil {
		t.Fatalf("close test parquet: %v", err)
	}
	artifactKey := "gold/snapshots/gold-v1-page/data/candidate/sector=0042/part-00000.parquet"
	manifest, err := json.Marshal(entity.EnrichmentSnapshotDetail{
		SnapshotID: "gold-v1-page",
		Artifacts:  []entity.EnrichmentArtifact{{Dataset: "candidate", Sector: 42, ObjectKey: artifactKey, SizeBytes: int64(parquetBytes.Len()), RowCount: 3}},
	})
	if err != nil {
		t.Fatal(err)
	}
	service := NewEnrichmentControlService(&memoryEnrichmentObjects{data: map[string][]byte{"gold/snapshots/gold-v1-page/manifest.json": manifest, artifactKey: parquetBytes.Bytes()}}, nil)
	detail, err := service.Artifact(context.Background(), "gold-v1-page", "candidate", 42, entity.EnrichmentArtifactPreviewQuery{Limit: 1, Offset: 1, FilterColumn: "source_product_id", FilterValue: "beta"})
	if err != nil {
		t.Fatalf("read paginated artifact: %v", err)
	}
	if detail.MatchedRows != 2 || detail.PreviewOffset != 1 || len(detail.Preview) != 1 || detail.Preview[0]["score"] != float64(0.3) {
		t.Fatalf("unexpected filtered preview: %#v", detail)
	}
}
