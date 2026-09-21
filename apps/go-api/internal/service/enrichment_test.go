package service

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"testing"

	"go-api/internal/domain/entity"
	"go-api/internal/provider"
)

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

func TestEnrichmentControlStartsAndPausesDurably(t *testing.T) {
	objects := &memoryEnrichmentObjects{data: map[string][]byte{}}
	publisher := &recordingEnrichmentPublisher{}
	service := NewEnrichmentControlService(objects, publisher)

	// Start requires a persisted control state — seed one first.
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

	// After start, GetControlOverview must read persisted state.
	overview, err := service.GetControlOverview(context.Background())
	if err != nil {
		t.Fatalf("expected readable control overview after start, got err=%v", err)
	}
	if overview.Control.Mode != "STREAM" {
		t.Fatalf("expected STREAM mode after start, got %s", overview.Control.Mode)
	}

	stopped, err := service.Stop(context.Background())
	if err != nil || stopped.Status != "pause_requested" || stopped.TicketID == "" {
		t.Fatalf("expected durable paused command result, got %#v err=%v", stopped, err)
	}

	overview, err = service.GetControlOverview(context.Background())
	if err != nil || overview.Control.Mode != "PAUSED" {
		t.Fatalf("expected paused control in overview, got %#v err=%v", overview, err)
	}
}

func TestEnrichmentControlReadsDurableReadinessTelemetry(t *testing.T) {
	// Seed a valid control state alongside runtime telemetry.
	controlData, _ := json.Marshal(entity.EnrichmentControlState{
		SchemaVersion: 1, Mode: "PAUSED",
	})
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
	objects := &memoryEnrichmentObjects{data: map[string][]byte{
		enrichmentControlKey:       controlData,
		enrichmentRuntimeStatusKey: runtime,
	}}
	overview, err := NewEnrichmentControlService(objects, nil).GetControlOverview(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if overview.Runtime == nil || overview.Runtime.Readiness.TPFContexts != 11 || overview.Runtime.Readiness.ContractedLightcurves != 7 || overview.Runtime.CatalogSync.State != "READY" || overview.Runtime.CatalogSync.TICRecords != 7 {
		t.Fatalf("expected durable readiness telemetry, got %#v", overview.Runtime)
	}
}

func TestEnrichmentControlPersistedControlRejectsInvalidWithoutFallback(t *testing.T) {
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

func TestEnrichmentControlAutoSeedsWhenNoControlExists(t *testing.T) {
	// With no control file at all, GetControlOverview auto-seeds default control.
	objects := &memoryEnrichmentObjects{data: map[string][]byte{}}
	service := NewEnrichmentControlService(objects, nil)
	overview, err := service.GetControlOverview(context.Background())
	if err != nil {
		t.Fatalf("expected auto-seed on absent control file, got err=%v", err)
	}
	if overview.Control.Mode != "STREAM" {
		t.Fatalf("expected default STREAM mode, got %s", overview.Control.Mode)
	}
	if len(objects.data[enrichmentControlKey]) == 0 {
		t.Fatal("expected control document to be seeded into storage")
	}
}

func TestEnrichmentSnapshotLoadsManifest(t *testing.T) {
	manifest, err := json.Marshal(entity.EnrichmentSnapshotDetail{
		SnapshotID: "gold-v1-test",
		Artifacts: []entity.EnrichmentArtifact{
			{Dataset: "candidate", Sector: 42, ObjectKey: "gold/snapshots/gold-v1-test/data/candidate/sector=0042/part-00000.parquet", SizeBytes: 1024, RowCount: 1},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	objects := &memoryEnrichmentObjects{data: map[string][]byte{
		"gold/snapshots/gold-v1-test/manifest.json": manifest,
	}}
	service := NewEnrichmentControlService(objects, nil)
	snapshot, err := service.Snapshot(context.Background(), "gold-v1-test")
	if err != nil {
		t.Fatalf("snapshot read failed: %v", err)
	}
	if snapshot.SnapshotID != "gold-v1-test" || len(snapshot.Artifacts) != 1 {
		t.Fatalf("unexpected snapshot: %#v", snapshot)
	}
}

func TestEnrichmentListSnapshotsReturnsManifestSummaries(t *testing.T) {
	manifest, err := json.Marshal(entity.EnrichmentSnapshotDetail{
		SnapshotID: "gold-v1-page",
		Status:     "COMMITTED",
		Artifacts:  []entity.EnrichmentArtifact{{Dataset: "candidate", Sector: 42, SizeBytes: 2048, RowCount: 3}},
	})
	if err != nil {
		t.Fatal(err)
	}
	service := NewEnrichmentControlService(&memoryEnrichmentObjects{data: map[string][]byte{
		"gold/snapshots/gold-v1-page/manifest.json": manifest,
	}}, nil)
	summaries, err := service.ListSnapshots(context.Background(), 10)
	if err != nil {
		t.Fatalf("list snapshots failed: %v", err)
	}
	if len(summaries) != 1 || summaries[0].SnapshotID != "gold-v1-page" || summaries[0].SizeBytes != 2048 {
		t.Fatalf("unexpected summaries: %#v", summaries)
	}
}
