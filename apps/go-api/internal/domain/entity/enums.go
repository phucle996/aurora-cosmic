package entity

type Task string

const (
	TaskCandidateVetting Task = "candidate_vetting"
	TaskAnomalyDetection Task = "astronomical_anomaly_detection"
)

type ModelStatus string

const (
	ModelStatusValidated ModelStatus = "validated"
	ModelStatusChampion  ModelStatus = "champion"
	ModelStatusInvalid   ModelStatus = "invalid"
)

type JobStatus string

const (
	JobStatusPlanned   JobStatus = "planned"
	JobStatusCompleted JobStatus = "completed"
	JobStatusQueued    JobStatus = "queued"
)

type ComponentStatus string

const (
	ComponentStatusUp     ComponentStatus = "up"
	ComponentStatusNoData ComponentStatus = "no_data"
)

type ComponentGroup string

const (
	GroupPipeline      ComponentGroup = "Pipeline"
	GroupPlatform      ComponentGroup = "Platform"
	GroupObservability ComponentGroup = "Observability"
)

type SystemStatus string

const (
	SystemStatusHealthy    SystemStatus = "HEALTHY"
	SystemStatusDegraded   SystemStatus = "DEGRADED"
	SystemStatusReady      SystemStatus = "READY"
	SystemStatusNotReady   SystemStatus = "NOT_READY"
	SystemStatusUp         SystemStatus = "UP"
	SystemStatusDown       SystemStatus = "DOWN"
	SystemStatusNotChecked SystemStatus = "NOT_CHECKED"
)
