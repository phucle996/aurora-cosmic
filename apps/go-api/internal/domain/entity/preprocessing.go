package entity

import "time"

type PreprocessingStartRequest struct {
	Mode        string `json:"mode,omitempty"`
	IngestRunID string `json:"ingest_run_id,omitempty"`
	Prefix      string `json:"prefix,omitempty"`
}

type PreprocessingControlJob struct {
	JobID       string    `json:"job_id"`
	Status      string    `json:"status"`
	Mode        string    `json:"mode"`
	IngestRunID string    `json:"ingest_run_id,omitempty"`
	Prefix      string    `json:"prefix,omitempty"`
	StartedAt   time.Time `json:"started_at"`
	UpdatedAt   time.Time `json:"updated_at"`
	Error       string    `json:"error,omitempty"`
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
	Hops             []PreprocessingHop
	Edges            []PreprocessingEdge
}
