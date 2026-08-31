package entity

// FactoryRun is an observed, durable operational run. It is never generated
// from dashboard state; Gold Builder writes it only after seeing control/runtime.
type FactoryRun struct {
	Pipeline         string `json:"pipeline"`
	RunID            string `json:"run_id"`
	Mode             string `json:"mode"`
	Status           string `json:"status"`
	StartedAt        string `json:"started_at"`
	FinishedAt       string `json:"finished_at,omitempty"`
	MaxBatchRecords  int64  `json:"max_batch_records"`
	IdleFlushSeconds int64  `json:"idle_flush_seconds"`
	PendingInputs    int64  `json:"pending_inputs"`
	CompletedBatches int64  `json:"completed_batches"`
	InputRecords     int64  `json:"input_records"`
	OutputRows       int64  `json:"output_rows"`
	IndexedRows      int64  `json:"indexed_rows"`
	LastSnapshotID   string `json:"last_snapshot_id,omitempty"`
	LastError        string `json:"last_error,omitempty"`
	UpdatedAt        string `json:"updated_at"`
}

type FactoryBatch struct {
	BatchID             string `json:"batch_id"`
	Mode                string `json:"mode"`
	Status              string `json:"status"`
	StartedAt           string `json:"started_at"`
	CompletedAt         string `json:"completed_at,omitempty"`
	InputRecords        int64  `json:"input_records"`
	CandidateRows       int64  `json:"candidate_rows"`
	ArtifactCount       int64  `json:"artifact_count"`
	IndexedRows         int64  `json:"indexed_rows"`
	SnapshotID          string `json:"snapshot_id,omitempty"`
	SnapshotFingerprint string `json:"snapshot_fingerprint,omitempty"`
	ManifestKey         string `json:"manifest_key,omitempty"`
	ManifestSHA256      string `json:"manifest_sha256,omitempty"`
	Error               string `json:"error,omitempty"`
}

type FactoryComponentEvent struct {
	ComponentID  string `json:"component_id"`
	Status       string `json:"status"`
	OccurredAt   string `json:"occurred_at"`
	InputRecords int64  `json:"input_records"`
	OutputRows   int64  `json:"output_rows"`
	IndexedRows  int64  `json:"indexed_rows"`
	SnapshotID   string `json:"snapshot_id,omitempty"`
	Error        string `json:"error,omitempty"`
}

type FactoryRunDetail struct {
	Run        FactoryRun              `json:"run"`
	Batches    []FactoryBatch          `json:"batches"`
	Components []FactoryComponentEvent `json:"components"`
}
