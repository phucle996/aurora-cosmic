package entity

// TrainingPreflight represents the pre-flight verification checklist and supervised-label
// coverage evaluation for an immutable set of Gold snapshots before launching model training.
type TrainingPreflight struct {
	SnapshotIDs                               []string `json:"snapshot_ids"`
	TotalRows                                 int64    `json:"total_rows"`
	PositiveRows                              int64    `json:"positive_rows"`
	NegativeRows                              int64    `json:"negative_rows"`
	UnresolvedRows                            int64    `json:"unresolved_rows"`
	PositiveTargets                           int64    `json:"positive_targets"`
	NegativeTargets                           int64    `json:"negative_targets"`
	Tier                                      string   `json:"tier"`
	ExperimentalMinimumPositiveTargets        int64    `json:"experimental_minimum_positive_targets"`
	ExperimentalMinimumNegativeTargets        int64    `json:"experimental_minimum_negative_targets"`
	ProductionCandidateMinimumPositiveTargets int64    `json:"production_candidate_minimum_positive_targets"`
	ProductionCandidateMinimumNegativeTargets int64    `json:"production_candidate_minimum_negative_targets"`
	NegativeDiversityTarget                   int64    `json:"negative_diversity_target"`
}

// ModelTrainingSnapshot represents a committed Gold snapshot item available in ClickHouse for candidate training.
type ModelTrainingSnapshot struct {
	SnapshotID     string `json:"snapshot_id" ch:"snapshot_id"`
	Key            string `json:"key"`
	ManifestKey    string `json:"manifest_key" ch:"manifest_key"`
	LastModified   string `json:"last_modified" ch:"last_modified"`
	SizeBytes      int64  `json:"size_bytes" ch:"size_bytes"`
	CandidateCount int64  `json:"candidate_count" db:"candidate_count"`
}

// StartTrainingSpec defines the parameters to initiate a training run.
type StartTrainingSpec struct {
	TicketID      string   `json:"ticket_id"`
	Task          string   `json:"task"`
	SnapshotIDs   []string `json:"gold_snapshot_ids"`
	TrainingMode  string   `json:"training_mode"`
	BaseModelID   string   `json:"base_model_id,omitempty"`
	ComputeTarget string   `json:"compute_target"`
	Epochs        int      `json:"epochs"`
	BatchSize     int      `json:"batch_size"`
	LearningRate  float64  `json:"learning_rate"`
	Seed          int      `json:"seed"`
}

// TrainingResult represents the response returned upon dispatching a training run.
type TrainingResult struct {
	TicketID      string   `json:"ticket_id"`
	Task          string   `json:"task"`
	SnapshotIDs   []string `json:"gold_snapshot_ids"`
	TrainingMode  string   `json:"training_mode"`
	BaseModelID   string   `json:"base_model_id,omitempty"`
	ComputeTarget string   `json:"compute_target"`
	Status        string   `json:"status"`
	CreatedAt     string   `json:"created_at"`
	Message       string   `json:"message"`
}

// TrainingControlSpec defines the parameters for controlling an in-flight training run.
type TrainingControlSpec struct {
	TicketID string `json:"ticket_id"`
	Action   string `json:"action"` // "cancel" or "checkpoint"
}

// TrainingControlResult represents the confirmation returned after dispatching a control signal.
type TrainingControlResult struct {
	TicketID  string `json:"ticket_id"`
	Action    string `json:"action"`
	Status    string `json:"status"` // "dispatched"
	Timestamp string `json:"timestamp"`
}

// LossPoint captures epoch-level loss progression for real-time visualization.
type LossPoint struct {
	Epoch     int     `json:"epoch"`
	TrainLoss float64 `json:"train_loss"`
	ValLoss   float64 `json:"val_loss"`
	IsBest    bool    `json:"is_best"`
}

// TrainingLogEntry represents an in-flight log line streamed from the worker.
type TrainingLogEntry struct {
	Timestamp string `json:"timestamp"`
	Message   string `json:"message"`
	Level     string `json:"level"` // "info", "warn", "error", "success"
}

// TrainingActiveState represents the in-memory soft state of an active or recent training run.
type TrainingActiveState struct {
	TicketID        string             `json:"ticket_id"`
	Task            string             `json:"task"`
	SnapshotCount   int                `json:"snapshot_count"`
	BaseModelID     string             `json:"base_model_id,omitempty"`
	ComputeTarget   string             `json:"compute_target"`
	Status          string             `json:"status"` // "queued", "running", "completed", "failed", "cancelled"
	Phase           string             `json:"phase"`  // "queued", "worker_acknowledged", "loading_gold", "preparing_dataset", "training", "evaluating", "packaging_runtime", "completed", "failed", "cancelled"
	ProgressPercent float64            `json:"progress_percent"`
	CurrentEpoch    int                `json:"current_epoch"`
	TotalEpochs     int                `json:"total_epochs"`
	BestEpoch       int                `json:"best_epoch"`
	BestValLoss     float64            `json:"best_val_loss"`
	TrainLoss       float64            `json:"train_loss"`
	ValLoss         float64            `json:"val_loss"`
	LossHistory     []LossPoint        `json:"loss_history"`
	Logs            []TrainingLogEntry `json:"logs"`
	StartedAt       int64              `json:"started_at"` // Unix millisecond timestamp for frontend
	UpdatedAt       string             `json:"updated_at"`
	Error           string             `json:"error,omitempty"`
}
