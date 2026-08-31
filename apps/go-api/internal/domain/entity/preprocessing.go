package entity

import "time"

type PreprocessingStartRequest struct {
	Mode        string `json:"mode"`
	WorkerCount int    `json:"worker_count"`
	IngestRunID string `json:"ingest_run_id"`
	Prefix      string `json:"prefix"`
}

type PreprocessingControlJob struct {
	JobID       string
	Status      string
	Mode        string
	WorkerCount int
	IngestRunID string
	Prefix      string
	StartedAt   time.Time
	UpdatedAt   time.Time
	Error       string
}

// PreprocessingRuntimeEvent is the compact, ephemeral event published by the
// Rust worker pool on Core NATS. It deliberately has no cadence-level data.
type PreprocessingRuntimeEvent struct {
	Event       string    `json:"event"`
	JobID       string    `json:"job_id"`
	WorkerID    string    `json:"worker_id"`
	WorkerState string    `json:"worker_state"`
	ProductKind string    `json:"product_kind,omitempty"`
	ObjectKey   string    `json:"object_key,omitempty"`
	Stage       string    `json:"stage,omitempty"`
	ElapsedMS   int64     `json:"elapsed_ms,omitempty"`
	Error       string    `json:"error,omitempty"`
	OccurredAt  time.Time `json:"occurred_at"`
}

type PreprocessingWorkerRuntime struct {
	WorkerID       string    `json:"worker_id"`
	State          string    `json:"state"`
	ProductKind    string    `json:"product_kind,omitempty"`
	ObjectKey      string    `json:"object_key,omitempty"`
	Stage          string    `json:"stage,omitempty"`
	StartedAt      time.Time `json:"started_at,omitempty"`
	UpdatedAt      time.Time `json:"updated_at"`
	LastDurationMS int64     `json:"last_duration_ms,omitempty"`
	Completed      int64     `json:"completed"`
	Failed         int64     `json:"failed"`
}

type PreprocessingRuntimeSnapshot struct {
	DesiredWorkers int                          `json:"desired_workers"`
	ActualWorkers  int                          `json:"actual_workers"`
	Processing     int                          `json:"processing"`
	Throughput     float64                      `json:"throughput"`
	Completed      int64                        `json:"completed"`
	Failed         int64                        `json:"failed"`
	Workers        []PreprocessingWorkerRuntime `json:"workers"`
	Trace          []PreprocessingRuntimeEvent  `json:"trace"`
	ObservedAt     time.Time                    `json:"observed_at"`
}

// PreprocessingProgress is the compact runtime snapshot shown by the control
// plane. Checkpoint counts come from durable MinIO state; backlog counts come
// from the JetStream consumer observer.
type PreprocessingProgress struct {
	BronzeTotal         int
	BronzeBytes         int64
	BronzeCompleted     int
	BronzePending       int
	BronzeFailed        int
	BronzeObserved      bool
	SilverTotal         int
	SilverBytes         int64
	GoldTotal           int
	GoldBytes           int64
	FootprintObserved   bool
	CheckpointTotal     int
	CheckpointCompleted int
	CheckpointPending   int
	CheckpointFailed    int
	BacklogPending      int
	BacklogAckPending   int
	ItemsToProcess      int
	ObservedAt          time.Time
}

// PreprocessingHop is service-scoped because preprocessor metrics do not carry
// a TIC label. It describes the observed pipeline contract, not a single run.
type PreprocessingHop struct {
	ID          string
	Label       string
	Description string
	Contract    string
	Status      string
	Input       string
	Output      string
	ObservedAt  time.Time
	Metrics     map[string]float64
	Telemetry   map[string][]MonitoringPoint
	Details     map[string]string
}

type PreprocessingEdge struct {
	ID         string
	Source     string
	Target     string
	Status     string
	ObservedAt time.Time
}

type PreprocessingGraph struct {
	Source           string
	ObservationScope string
	Status           string
	ObservedAt       time.Time
	Run              *PreprocessingControlJob
	Progress         PreprocessingProgress
	Runtime          PreprocessingRuntimeSnapshot
	Hops             []PreprocessingHop
	Edges            []PreprocessingEdge
}
