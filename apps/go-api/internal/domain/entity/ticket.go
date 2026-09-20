package entity

// RunnerTicket represents a durable runner ticket persisted in ClickHouse.
type RunnerTicket struct {
	TicketID    string `json:"ticket_id" ch:"ticket_id"`
	CreatedAt   string `json:"created_at" ch:"created_at"`
	Description string `json:"description,omitempty" ch:"description"`
	UpdatedAt   string `json:"updated_at,omitempty" ch:"updated_at"`
}

// CreateTicketRequest represents the operator request command to create a runner ticket.
type CreateTicketRequest struct {
	TicketID    string `json:"ticket_id"`
	Description string `json:"description"`
}

// PipelineRun represents an observed pipeline execution run stage.
type PipelineRun struct {
	Pipeline         string `json:"pipeline" ch:"pipeline"`
	RunID            string `json:"run_id" ch:"run_id"`
	Mode             string `json:"mode" ch:"mode"`
	Status           string `json:"status" ch:"status"`
	StartedAt        string `json:"started_at" ch:"started_at"`
	FinishedAt       string `json:"finished_at,omitempty" ch:"finished_at"`
	MaxBatchRecords  int64  `json:"max_batch_records" ch:"max_batch_records"`
	IdleFlushSeconds int64  `json:"idle_flush_seconds" ch:"idle_flush_seconds"`
	PendingInputs    int64  `json:"pending_inputs" ch:"pending_inputs"`
	CompletedBatches int64  `json:"completed_batches" ch:"completed_batches"`
	InputRecords     int64  `json:"input_records" ch:"input_records"`
	OutputRows       int64  `json:"output_rows" ch:"output_rows"`
	IndexedRows      int64  `json:"indexed_rows" ch:"indexed_rows"`
	LastSnapshotID   string `json:"last_snapshot_id,omitempty" ch:"last_snapshot_id"`
	LastError        string `json:"last_error,omitempty" ch:"last_error"`
	UpdatedAt        string `json:"updated_at" ch:"updated_at"`
}

// PipelineRunDetail represents the execution context of a specific pipeline run.
type PipelineRunDetail struct {
	Run                PipelineRun              `json:"run"`
	Batches            []PipelineBatch          `json:"batches"`
	Components         []PipelineComponentEvent `json:"components"`
	ScientificEvidence *ScientificEvidence      `json:"scientific_evidence,omitempty"`
}
