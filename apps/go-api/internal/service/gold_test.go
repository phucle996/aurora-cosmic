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
	"go-api/internal/domain/repo"
)

type testGoldRow struct {
	SourceProductID string  `parquet:"source_product_id"`
	Score           float64 `parquet:"score"`
}

type memoryGoldObjects struct{ data map[string][]byte }

type recordingGoldPublisher struct{ events []entity.WorkflowEvent }

func (p *recordingGoldPublisher) Publish(_ context.Context, event entity.WorkflowEvent) error {
	p.events = append(p.events, event)
	return nil
}

func (m *memoryGoldObjects) Ping(context.Context) error { return nil }
func (m *memoryGoldObjects) ListObjects(_ context.Context, prefix string) ([]repo.ObjectInfo, error) {
	objects := make([]repo.ObjectInfo, 0)
	for key := range m.data {
		if strings.HasPrefix(key, prefix) {
			objects = append(objects, repo.ObjectInfo{Key: key})
		}
	}
	return objects, nil
}

func TestGoldLineageOnlyMarksCommittedManifestInputsExtracted(t *testing.T) {
	committed, err := json.Marshal(entity.GoldSnapshotDetail{
		SnapshotID: "gold-v1-committed", Status: "COMMITTED",
		CompletenessContract: entity.GoldCompletenessContract{Policy: "research-ready-target-pair-v4"},
		Artifacts:            []entity.GoldArtifact{{Dataset: "candidate", RowCount: 1}},
		Inputs:               []entity.GoldSnapshotInput{{SourceProductID: "tess-lc-1", SilverObjectKey: "silver/tess/lc-1.parquet"}},
	})
	if err != nil {
		t.Fatal(err)
	}
	pending, err := json.Marshal(entity.GoldSnapshotDetail{
		SnapshotID: "gold-v1-pending", Status: "PENDING",
		Artifacts: []entity.GoldArtifact{{Dataset: "candidate", RowCount: 1}},
		Inputs:    []entity.GoldSnapshotInput{{SourceProductID: "tess-lc-2"}},
	})
	if err != nil {
		t.Fatal(err)
	}
	objects := &memoryGoldObjects{data: map[string][]byte{
		"gold/snapshots/gold-v1-committed/manifest.json": committed,
		"gold/snapshots/gold-v1-pending/manifest.json":   pending,
	}}
	service := NewGoldControlService(objects, nil)
	resolved, err := service.ResolveLineage(context.Background(), []entity.GoldLineageLookup{
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

func TestGoldLineageDoesNotTreatLegacyPartialSnapshotAsExtracted(t *testing.T) {
	legacy, err := json.Marshal(entity.GoldSnapshotDetail{
		SnapshotID: "gold-v1-legacy", Status: "COMMITTED",
		Artifacts: []entity.GoldArtifact{{Dataset: "candidate", RowCount: 1}},
		Inputs:    []entity.GoldSnapshotInput{{SourceProductID: "tess-lc-legacy"}},
	})
	if err != nil {
		t.Fatal(err)
	}
	service := NewGoldControlService(&memoryGoldObjects{data: map[string][]byte{
		"gold/snapshots/gold-v1-legacy/manifest.json": legacy,
	}}, nil)
	resolved, err := service.ResolveLineage(context.Background(), []entity.GoldLineageLookup{{SourceProductID: "tess-lc-legacy"}})
	if err != nil {
		t.Fatal(err)
	}
	if resolved[0].Status != "PENDING" {
		t.Fatalf("legacy partial Gold must not resolve as extracted: %#v", resolved[0])
	}
}
func (m *memoryGoldObjects) GetObject(_ context.Context, key string) ([]byte, error) {
	value, ok := m.data[key]
	if !ok {
		return nil, fmt.Errorf("%w: %s", repo.ErrObjectNotFound, key)
	}
	return value, nil
}
func (m *memoryGoldObjects) PutObject(_ context.Context, key string, data []byte, _ string) error {
	m.data[key] = append([]byte(nil), data...)
	return nil
}
func (m *memoryGoldObjects) DeleteObject(_ context.Context, key string) error {
	delete(m.data, key)
	return nil
}

func TestGoldControlStartsAndPausesDurably(t *testing.T) {
	objects := &memoryGoldObjects{data: map[string][]byte{}}
	publisher := &recordingGoldPublisher{}
	service := NewGoldControlService(objects, publisher)

	initial, err := service.Query(context.Background())
	if err != nil || initial.Control.Mode != "PAUSED" {
		t.Fatalf("expected default paused control, got %#v err=%v", initial, err)
	}

	started, err := service.Start(context.Background(), entity.GoldControlStartRequest{
		Mode: "stream", IdleFlushSeconds: 180, TicketID: "gold-observer-test",
	})
	if err != nil || started.Control.Mode != "STREAM" || started.Control.CommandID == "" {
		t.Fatalf("expected durable stream control, got %#v err=%v", started, err)
	}
	if len(publisher.events) != 1 || publisher.events[0].TicketID != "gold-observer-test" || publisher.events[0].JobID != started.Control.CommandID {
		t.Fatalf("expected ticket-scoped start event, got %#v", publisher.events)
	}

	stopped, err := service.Stop(context.Background())
	if err != nil || stopped.Control.Mode != "PAUSED" || stopped.Control.CommandID == "" {
		t.Fatalf("expected durable paused control, got %#v err=%v", stopped, err)
	}
}

func TestGoldControlReadsDurableReadinessTelemetry(t *testing.T) {
	runtime, err := json.Marshal(entity.GoldRuntimeStatus{
		SchemaVersion: 2,
		State:         "WAITING_FOR_MODALITY",
		Readiness: entity.GoldReadinessStatus{
			CatalogReady:          true,
			TICCatalogReady:       true,
			TOICatalogReady:       true,
			WaitingLightcurves:    7,
			MissingTPF:            2,
			TPFContexts:           11,
			ContractedLightcurves: 7,
		},
		CatalogSync: entity.GoldCatalogSyncStatus{
			Mode: "ON_DEMAND", State: "READY", TargetCount: 7,
			TICRecords: 7, TOIRecords: 2, SnapshotIDs: map[string]string{"TIC": "tic-v1-test", "TOI": "toi-v1-test"},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	objects := &memoryGoldObjects{data: map[string][]byte{goldRuntimeStatusKey: runtime}}
	overview, err := NewGoldControlService(objects, nil).Query(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if overview.Runtime == nil || overview.Runtime.Readiness.TPFContexts != 11 || overview.Runtime.Readiness.ContractedLightcurves != 7 || overview.Runtime.CatalogSync.State != "READY" || overview.Runtime.CatalogSync.TICRecords != 7 {
		t.Fatalf("expected durable readiness telemetry, got %#v", overview.Runtime)
	}
}

func TestGoldControlRejectsShortIdleWindow(t *testing.T) {
	objects := &memoryGoldObjects{data: map[string][]byte{}}
	service := NewGoldControlService(objects, nil)
	if _, err := service.Start(context.Background(), entity.GoldControlStartRequest{Mode: "stream", IdleFlushSeconds: 30}); err == nil {
		t.Fatal("expected short idle window to be rejected")
	}
}

func TestGoldArtifactReadsRealParquetSchemaPreviewAndLineage(t *testing.T) {
	var parquetBytes bytes.Buffer
	writer := parquet.NewGenericWriter[testGoldRow](&parquetBytes)
	if _, err := writer.Write([]testGoldRow{{SourceProductID: "tess-lc-1", Score: 0.98}}); err != nil {
		t.Fatalf("write test parquet: %v", err)
	}
	if err := writer.Close(); err != nil {
		t.Fatalf("close test parquet: %v", err)
	}
	artifactKey := "gold/snapshots/gold-v1-test/data/candidate/sector=0042/part-00000.parquet"
	manifest, err := json.Marshal(entity.GoldSnapshotDetail{
		SnapshotID: "gold-v1-test",
		Artifacts: []entity.GoldArtifact{{
			Dataset: "candidate", Sector: 42, ObjectKey: artifactKey, SizeBytes: int64(parquetBytes.Len()), RowCount: 1,
		}},
		Inputs: []entity.GoldSnapshotInput{{
			ProductKind: "LIGHT_CURVE", SilverObjectKey: "silver/tess/lc-1.parquet", SilverSHA256: "abc",
		}},
	})
	if err != nil {
		t.Fatalf("marshal manifest: %v", err)
	}
	objects := &memoryGoldObjects{data: map[string][]byte{
		"gold/snapshots/gold-v1-test/manifest.json": manifest,
		artifactKey: parquetBytes.Bytes(),
	}}
	service := NewGoldControlService(objects, nil)
	detail, err := service.Artifact(context.Background(), "gold-v1-test", "candidate", 42, entity.GoldArtifactPreviewQuery{Limit: 10})
	if err != nil {
		t.Fatalf("read Gold artifact detail: %v", err)
	}
	if len(detail.Schema) != 2 || len(detail.Preview) != 1 {
		t.Fatalf("unexpected artifact detail: %#v", detail)
	}
	if detail.Preview[0]["source_product_id"] != "tess-lc-1" {
		t.Fatalf("expected real Parquet preview, got %#v", detail.Preview[0])
	}
}

func TestGoldArtifactPreviewPaginatesAndFiltersRealParquetRows(t *testing.T) {
	var parquetBytes bytes.Buffer
	writer := parquet.NewGenericWriter[testGoldRow](&parquetBytes)
	if _, err := writer.Write([]testGoldRow{{SourceProductID: "alpha", Score: 0.1}, {SourceProductID: "beta", Score: 0.2}, {SourceProductID: "beta", Score: 0.3}}); err != nil {
		t.Fatalf("write test parquet: %v", err)
	}
	if err := writer.Close(); err != nil {
		t.Fatalf("close test parquet: %v", err)
	}
	artifactKey := "gold/snapshots/gold-v1-page/data/candidate/sector=0042/part-00000.parquet"
	manifest, err := json.Marshal(entity.GoldSnapshotDetail{SnapshotID: "gold-v1-page", Artifacts: []entity.GoldArtifact{{Dataset: "candidate", Sector: 42, ObjectKey: artifactKey, SizeBytes: int64(parquetBytes.Len()), RowCount: 3}}})
	if err != nil {
		t.Fatal(err)
	}
	service := NewGoldControlService(&memoryGoldObjects{data: map[string][]byte{"gold/snapshots/gold-v1-page/manifest.json": manifest, artifactKey: parquetBytes.Bytes()}}, nil)
	detail, err := service.Artifact(context.Background(), "gold-v1-page", "candidate", 42, entity.GoldArtifactPreviewQuery{Limit: 1, Offset: 1, FilterColumn: "source_product_id", FilterValue: "beta"})
	if err != nil {
		t.Fatalf("read paginated artifact: %v", err)
	}
	if detail.MatchedRows != 2 || detail.PreviewOffset != 1 || len(detail.Preview) != 1 || detail.Preview[0]["score"] != float64(0.3) {
		t.Fatalf("unexpected filtered preview: %#v", detail)
	}
}
