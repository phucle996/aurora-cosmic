package entity

import "time"

type PreprocessingStartRequest struct {
	Mode        string
	IngestRunID string
	Prefix      string
}

type PreprocessingControlJob struct {
	JobID       string
	Status      string
	Mode        string
	IngestRunID string
	Prefix      string
	StartedAt   time.Time
	UpdatedAt   time.Time
	Error       string
}

// PreprocessingProgress is the compact runtime snapshot shown by the control
// plane. Checkpoint counts come from durable MinIO state; backlog counts come
// from the JetStream consumer observer.
type PreprocessingProgress struct {
	CheckpointTotal     int
	CheckpointCompleted int
	CheckpointPending   int
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
	Hops             []PreprocessingHop
	Edges            []PreprocessingEdge
}
