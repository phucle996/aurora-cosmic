package entity

import "time"

// DAGStage defines the pipeline execution stage.
type DAGStage string

const (
	StageAll           DAGStage = "all"
	StagePreprocessing DAGStage = "preprocessing"
	StageEnrichment    DAGStage = "enrichment"
)

// DAGHop describes the observed pipeline contract, live runtime telemetry,
// and durable evidence for one processing step across Preprocessing and Enrichment.
type DAGHop struct {
	ID                          string                              `json:"id"`
	Stage                       DAGStage                            `json:"stage,omitempty"`
	Label                       string                              `json:"label"`
	Description                 string                              `json:"description"`
	Contract                    string                              `json:"contract"`
	Status                      string                              `json:"status"`
	Input                       string                              `json:"input"`
	Output                      string                              `json:"output"`
	ObservedAt                  time.Time                           `json:"observed_at"`
	Metrics                     map[string]float64                  `json:"metrics"`
	Telemetry                   map[string][]MonitoringPoint        `json:"telemetry"`
	Details                     map[string]string                   `json:"details,omitempty"`
	ScatterPoints               []PreprocessingScatterPoint         `json:"scatter_points,omitempty"`
	TPFTransformPoints          []PreprocessingTPFTransformPoint    `json:"tpf_transform_points,omitempty"`
	MaterializationPoints       []PreprocessingMaterializationPoint `json:"materialization_points,omitempty"`
	EncodeFailures              []PreprocessingEncodeFailure        `json:"encode_failures,omitempty"`
	SilverFailures              []PreprocessingSilverFailure        `json:"silver_failures,omitempty"`
	CheckpointPoints            []PreprocessingCheckpointPoint      `json:"checkpoint_points,omitempty"`
	LCFeatureEvidence           *LCFeatureEvidence                  `json:"lc_feature_evidence,omitempty"`
	BLSSearchEvidence           *BLSSearchEvidence                  `json:"bls_search_evidence,omitempty"`
	TPFSpatialEvidence          *TPFSpatialEvidence                 `json:"tpf_spatial_evidence,omitempty"`
	CandidateAssemblyEvidence   *CandidateAssemblyEvidence          `json:"candidate_assembly_evidence,omitempty"`
	GoldMaterializationEvidence *GoldMaterializationEvidence        `json:"gold_materialization_evidence,omitempty"`
	GoldProjectionEvidence      *GoldProjectionEvidence             `json:"gold_projection_evidence,omitempty"`
	GoldCommitEvidence          *GoldCommitEvidence                 `json:"gold_commit_evidence,omitempty"`
}

// DAGEdge represents a directed execution or data-flow edge between two hops.
type DAGEdge struct {
	ID         string    `json:"id"`
	Source     string    `json:"source"`
	Target     string    `json:"target"`
	Status     string    `json:"status"`
	ObservedAt time.Time `json:"observed_at"`
}

// DAGGraph is the unified visual topology projection of the pipeline DAG.
type DAGGraph struct {
	Status     string                       `json:"status"`
	Stage      DAGStage                     `json:"stage,omitempty"`
	ObservedAt time.Time                    `json:"observed_at"`
	Run        *PreprocessingControlJob     `json:"run"`
	Progress   PreprocessingProgress        `json:"progress"`
	Runtime    PreprocessingRuntimeSnapshot `json:"runtime"`
	Hops       []DAGHop                     `json:"hops"`
	Edges      []DAGEdge                    `json:"edges"`
}

// DAGHopMeta contains static catalog metadata for a pipeline hop.
type DAGHopMeta struct {
	ID            string
	Stage         DAGStage
	StepNumber    string
	Label         string
	Description   string
	AstronomyGoal string
	Formula       string
	Contract      string
	Input         string
	Output        string
}
