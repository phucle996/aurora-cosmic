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
	BronzeTotal              int
	BronzeBytes              int64
	BronzeCompleted          int
	BronzePending            int
	BronzeFailed             int
	BronzeObserved           bool
	BronzeLightCurves        int
	BronzeTargetPixels       int
	SilverTotal              int
	SilverBytes              int64
	SilverLightCurves        int
	SilverTargetPixels       int
	GoldTotal                int
	GoldBytes                int64
	FootprintObserved        bool
	CheckpointTotal          int
	CheckpointCompleted      int
	CheckpointPending        int
	CheckpointFailed         int
	SilverEventObserved      bool
	SilverEventMessages      int64
	SilverEventBytes         int64
	SilverEventConsumers     int
	SilverEventLightCurves   int64
	SilverEventTargetPixels  int64
	SilverEventFirstAt       time.Time
	SilverEventLastAt        time.Time
	BronzeConsumerObserved   bool
	BronzeStreamMessages     int64
	BronzeStreamBytes        int64
	BronzeDeliveredConsumer  int64
	BronzeDeliveredStream    int64
	BronzeAckFloorConsumer   int64
	BronzeAckFloorStream     int64
	BronzeConsumerAckPending int
	BronzeConsumerPending    int64
	BronzeCurrentRedelivered int
	BronzeConsumerWaiting    int
	BronzeLastDeliveredAt    time.Time
	BronzeLastAckAt          time.Time
	CompletedLightCurves     int
	CompletedTargetPixels    int
	ScienceCountsObserved    bool
	LCInputSamples           int64
	LCOutputSamples          int64
	LCQualityRemoved         int64
	LCInvalidRemoved         int64
	LCNonfiniteRemoved       int64
	LCNonpositiveRemoved     int64
	LCOutlierRemoved         int64
	LCSigmaClip3To4          int64
	LCSigmaClip4To5          int64
	LCSigmaClipGE5           int64
	LCTransformProducts      int
	LCScatterProducts        int
	LCScatterBeforeMean      float64
	LCScatterBeforeP50       float64
	LCScatterBeforeP95       float64
	LCScatterAfterMean       float64
	LCScatterAfterP50        float64
	LCScatterAfterP95        float64
	LCOutlierFractionP50     float64
	LCOutlierFractionP95     float64
	TPFInputSamples          int64
	TPFOutputSamples         int64
	TPFQualityRemoved        int64
	TPFInvalidRemoved        int64
	TPFNonfiniteRemoved      int64
	TPFNonpositiveRemoved    int64
	TPFFiniteProducts        int
	TPFFiniteFractionMean    float64
	TPFFiniteFractionP05     float64
	TPFFiniteFractionP50     float64
	BacklogPending           int
	BacklogAckPending        int
	ItemsToProcess           int
	ObservedAt               time.Time
	LCScatterPoints          []PreprocessingScatterPoint
	TPFTransformPoints       []PreprocessingTPFTransformPoint
	MaterializationPoints    []PreprocessingMaterializationPoint
	EncodeFailures           []PreprocessingEncodeFailure
	SilverFailures           []PreprocessingSilverFailure
	CheckpointPoints         []PreprocessingCheckpointPoint
}

// PreprocessingScatterPoint is one durable Light Curve artifact observation.
// It intentionally carries no cadence-level samples, keeping the graph payload
// bounded while still allowing before/after scientific comparison per product.
type PreprocessingScatterPoint struct {
	ObjectKey      string  `json:"object_key"`
	BeforePPM      float64 `json:"before_ppm"`
	AfterPPM       float64 `json:"after_ppm"`
	OutlierRemoved int64   `json:"outlier_removed"`
	PreclipSamples int64   `json:"preclip_samples"`
	SigmaClipLevel float64 `json:"sigma_clip_level"`
}

// PreprocessingTPFTransformPoint is one bounded, product-level summary of
// temporal pixel normalization. It deliberately avoids cadence or pixel IDs.
type PreprocessingTPFTransformPoint struct {
	ObjectKey              string    `json:"object_key"`
	CompletedAt            time.Time `json:"completed_at"`
	DiagnosticsObserved    bool      `json:"diagnostics_observed"`
	FinitePixelFraction    float64   `json:"finite_pixel_fraction"`
	InputCadences          int64     `json:"input_cadences"`
	OutputCadences         int64     `json:"output_cadences"`
	InputPixelValues       int64     `json:"input_pixel_values"`
	NormalizedPixelValues  int64     `json:"normalized_pixel_values"`
	NonfinitePixelValues   int64     `json:"nonfinite_pixel_values"`
	InvalidReferenceValues int64     `json:"invalid_reference_values"`
	InvalidReferencePixels int64     `json:"invalid_reference_pixels"`
	ScatterP50PPM          float64   `json:"scatter_p50_ppm"`
	ScatterP95PPM          float64   `json:"scatter_p95_ppm"`
	DriftP50PPM            float64   `json:"drift_p50_ppm"`
	DriftP95PPM            float64   `json:"drift_p95_ppm"`
	BoundaryJumpP50PPM     float64   `json:"boundary_jump_p50_ppm"`
	BoundaryJumpP95PPM     float64   `json:"boundary_jump_p95_ppm"`
	ChunkCount             int64     `json:"chunk_count"`
}

type PreprocessingMaterializationPoint struct {
	ObjectKey            string    `json:"object_key"`
	ProductKind          string    `json:"product_kind"`
	Rows                 int64     `json:"rows"`
	SizeBytes            int64     `json:"size_bytes"`
	SourceBytes          int64     `json:"source_bytes"`
	EncodeDurationMS     float64   `json:"encode_duration_ms"`
	CompletedAt          time.Time `json:"completed_at"`
	ETag                 string    `json:"etag"`
	SchemaVersion        string    `json:"schema_version"`
	ChecksumBound        bool      `json:"checksum_bound"`
	LineageBound         bool      `json:"lineage_bound"`
	SizeVerified         bool      `json:"size_verified"`
	SchemaVerified       bool      `json:"schema_verified"`
	CheckpointLinked     bool      `json:"checkpoint_linked"`
	IntegrityVerified    bool      `json:"integrity_verified"`
	VerificationAttempts int64     `json:"verification_attempts"`
}

type PreprocessingEncodeFailure struct {
	ObjectKey   string    `json:"object_key"`
	ProductKind string    `json:"product_kind"`
	Reason      string    `json:"reason"`
	Recovered   bool      `json:"recovered"`
	OccurredAt  time.Time `json:"occurred_at"`
}

type PreprocessingSilverFailure struct {
	ObjectKey   string    `json:"object_key"`
	ProductKind string    `json:"product_kind"`
	Kind        string    `json:"kind"`
	Reason      string    `json:"reason"`
	Recovered   bool      `json:"recovered"`
	Attempts    int64     `json:"attempts"`
	OccurredAt  time.Time `json:"occurred_at"`
}

// PreprocessingCheckpointPoint is one durable recovery record. ResumeAction
// is resolved by the backend after joining the checkpoint with the verified
// Silver inventory; clients render that decision instead of reconstructing it.
type PreprocessingCheckpointPoint struct {
	CheckpointID       string    `json:"checkpoint_id"`
	ProductKind        string    `json:"product_kind"`
	State              string    `json:"state"`
	SchemaVersion      int64     `json:"schema_version"`
	Attempts           int64     `json:"attempts"`
	Terminal           bool      `json:"terminal"`
	SilverObjectKey    string    `json:"silver_object_key"`
	SilverVerified     bool      `json:"silver_verified"`
	ResumeAction       string    `json:"resume_action"`
	LastErrorKind      string    `json:"last_error_kind"`
	LifecycleElapsedMS int64     `json:"lifecycle_elapsed_ms"`
	CreatedAt          time.Time `json:"created_at"`
	UpdatedAt          time.Time `json:"updated_at"`
}

// PreprocessingHop is service-scoped because preprocessor metrics do not carry
// a TIC label. It describes the observed pipeline contract, not a single run.
type PreprocessingHop struct {
	ID                    string
	Label                 string
	Description           string
	Contract              string
	Status                string
	Input                 string
	Output                string
	ObservedAt            time.Time
	Metrics               map[string]float64
	Telemetry             map[string][]MonitoringPoint
	Details               map[string]string
	ScatterPoints         []PreprocessingScatterPoint
	TPFTransformPoints    []PreprocessingTPFTransformPoint
	MaterializationPoints []PreprocessingMaterializationPoint
	EncodeFailures        []PreprocessingEncodeFailure
	SilverFailures        []PreprocessingSilverFailure
	CheckpointPoints      []PreprocessingCheckpointPoint
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
