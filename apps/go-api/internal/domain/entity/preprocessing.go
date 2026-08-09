package entity

import "time"

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
