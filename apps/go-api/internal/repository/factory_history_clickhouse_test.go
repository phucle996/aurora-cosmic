package repository

import (
	"context"
	"crypto/sha256"
	"fmt"
	"testing"

	"go-api/internal/domain/entity"
	domainrepo "go-api/internal/domain/repo"
)

type factoryHistoryDecodeProbe struct {
	PendingInputs    int64 `json:"pending_inputs"`
	CompletedBatches int64 `json:"completed_batches"`
	InputRecords     int64 `json:"input_records"`
}

func TestDecodeFactoryRowsAcceptsClickHouseQuotedInt64Metrics(t *testing.T) {
	rows, err := decodeFactoryRows[factoryHistoryDecodeProbe]([]byte(`{
		"data": [{
			"pending_inputs": "14645",
			"completed_batches": "5",
			"input_records": "1249"
		}]
	}`))
	if err != nil {
		t.Fatalf("decodeFactoryRows() error = %v", err)
	}
	if len(rows) != 1 {
		t.Fatalf("decoded rows = %d, want 1", len(rows))
	}
	if rows[0].PendingInputs != 14645 || rows[0].CompletedBatches != 5 || rows[0].InputRecords != 1249 {
		t.Fatalf("decoded row = %+v, want numeric metrics", rows[0])
	}
}

func TestDecodeFactoryRowsKeepsNumericMetrics(t *testing.T) {
	rows, err := decodeFactoryRows[factoryHistoryDecodeProbe]([]byte(`{
		"data": [{
			"pending_inputs": 14645,
			"completed_batches": 5,
			"input_records": 1249
		}]
	}`))
	if err != nil {
		t.Fatalf("decodeFactoryRows() error = %v", err)
	}
	if rows[0].PendingInputs != 14645 || rows[0].CompletedBatches != 5 || rows[0].InputRecords != 1249 {
		t.Fatalf("decoded row = %+v, want numeric metrics", rows[0])
	}
}

type commitObjectRepository struct {
	objects map[string][]byte
}

func (r commitObjectRepository) Ping(context.Context) error { return nil }
func (r commitObjectRepository) ListObjects(context.Context, string) ([]domainrepo.ObjectInfo, error) {
	return nil, nil
}
func (r commitObjectRepository) GetObject(_ context.Context, key string) ([]byte, error) {
	value, ok := r.objects[key]
	if !ok {
		return nil, domainrepo.ErrObjectNotFound
	}
	return value, nil
}
func (r commitObjectRepository) PutObject(context.Context, string, []byte, string) error { return nil }
func (r commitObjectRepository) DeleteObject(context.Context, string) error              { return nil }

func TestGoldCommitEvidenceVerifiesImmutableChainWithoutRequiringCurrentActivation(t *testing.T) {
	manifest := []byte(`{"snapshot_id":"snapshot-1","snapshot_fingerprint":"fingerprint-1","status":"COMMITTED","manifest_key":"gold/snapshots/snapshot-1/manifest.json","row_count":42,"artifacts":[{"sector":1,"object_key":"gold/snapshots/snapshot-1/data/candidate/part.parquet","row_count":42,"size_bytes":128,"content_sha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","parquet_sha256":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"}]}`)
	manifestSHA := fmt.Sprintf("%x", sha256.Sum256(manifest))
	r := &FactoryHistoryClickHouse{objects: commitObjectRepository{objects: map[string][]byte{
		"gold/snapshots/snapshot-1/manifest.json": manifest,
		"gold/current/CANDIDATE.json":             []byte(`{"snapshot_id":"newer-snapshot"}`),
	}}}
	batches := []entity.FactoryBatch{{
		Status: "COMPLETED", SnapshotID: "snapshot-1", SnapshotFingerprint: "fingerprint-1",
		ManifestKey: "gold/snapshots/snapshot-1/manifest.json", ManifestSHA256: manifestSHA,
		CandidateRows: 42, IndexedRows: 42, ArtifactCount: 1,
	}}
	materialization := &entity.GoldMaterializationEvidence{Artifacts: []entity.GoldArtifactEvidence{{
		SnapshotID: "snapshot-1", ObjectPresent: true, SizeVerified: true, ChecksumsDeclared: true,
	}}}
	projection := &entity.GoldProjectionEvidence{Snapshots: []entity.GoldProjectionSnapshotEvidence{{
		SnapshotID: "snapshot-1", ActualCandidateRows: 42, RegistryStatus: "READY", MarkerStatus: "READY",
		ManifestBindingValid: true, RowParityValid: true,
	}}}

	evidence := r.loadGoldCommitEvidence(context.Background(), batches, materialization, projection)
	if evidence.EndToEndVerifiedSnapshots != 1 || len(evidence.Snapshots) != 1 || !evidence.Snapshots[0].EndToEndValid {
		t.Fatalf("commit evidence = %+v, want one end-to-end verified snapshot", evidence)
	}
	if evidence.ActiveCurrentSnapshots != 0 || evidence.Snapshots[0].Current {
		t.Fatalf("historical snapshot current activation = %+v, want inactive without integrity failure", evidence.Snapshots[0])
	}
	if len(evidence.Issues) != 0 {
		t.Fatalf("commit issues = %v, want none", evidence.Issues)
	}
}
