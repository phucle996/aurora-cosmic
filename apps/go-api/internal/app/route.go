package app

import (
	"github.com/gin-gonic/gin"
)

// RegisterRoutes registers all application HTTP endpoints directly using flat paths.
func RegisterRoutes(engine *gin.Engine, module *Module) {
	engine.GET("/healthz", module.SystemHandler.Healthz)
	engine.GET("/readyz", module.SystemHandler.Readyz)

	engine.GET("/api/v1/system", module.SystemHandler.System)
	engine.GET("/api/v1/monitoring", module.MonitoringHandler.Query)
	engine.GET("/api/v1/dag/hops/:hop_id", module.DAGAggregationHandler.QueryHop)
	engine.GET("/api/v1/dag/graph", module.DAGAggregationHandler.QueryGraph)

	engine.GET("/api/v1/data-factory/tickets", module.TicketHandler.List)
	engine.POST("/api/v1/data-factory/tickets", module.TicketHandler.Create)
	engine.GET("/api/v1/data-factory/runs", module.TicketHandler.ListRuns)
	engine.GET("/api/v1/data-factory/runs/:run_id", module.TicketHandler.Detail)

	engine.POST("/api/v1/preprocessing/tickets", module.PreprocessingHandler.Start)
	engine.POST("/api/v1/preprocessing/tickets/:ticket_id/stop", module.PreprocessingHandler.Stop)
	// Enrichment workflow routes
	engine.GET("/api/v1/enrichment/control", module.EnrichmentControlHandler.GetControlOverview)
	engine.POST("/api/v1/enrichment/control/start", module.EnrichmentControlHandler.Start)
	engine.POST("/api/v1/enrichment/control/stop", module.EnrichmentControlHandler.Stop)
	engine.GET("/api/v1/enrichment/snapshots", module.EnrichmentControlHandler.ListSnapshots)
	engine.GET("/api/v1/enrichment/snapshots/:snapshot_id", module.EnrichmentControlHandler.Snapshot)
	// Lineage workflow routes
	engine.POST("/api/v1/lineage/trace", module.LineageHandler.TraceLineage)
	engine.GET("/api/v1/lineage/ledger", module.LineageHandler.Ledger)

	engine.GET("/api/v1/events", module.EventsHandler.Stream)
	engine.GET("/api/v1/ingest/status", module.IngestHandler.Status)
	engine.GET("/api/v1/storage", module.IngestHandler.Storage)
	engine.POST("/api/v1/ingest/jobs", module.IngestHandler.Start)
	engine.POST("/api/v1/ingest/jobs/:ticket_id/cancel", module.IngestHandler.Cancel)

	engine.GET("/api/v1/lakehouse/summary", module.LakehouseHandler.Summary)
	engine.GET("/api/v1/lakehouse/objects", module.LakehouseHandler.List)
	engine.GET("/api/v1/lakehouse/preview", module.LakehouseHandler.Preview)
	engine.GET("/api/v1/targets", module.TargetHandler.ListTargets)
	engine.GET("/api/v1/targets/:tic_id/insights", module.TargetHandler.GetTargetInsight)
	engine.GET("/api/v1/targets/:tic_id/observation", module.TargetHandler.GetTargetObservation)
	engine.GET("/api/v1/lightcurves", module.TargetHandler.GetLightcurve)
	engine.GET("/api/v1/models", module.ModelHandler.ListModels)
	engine.GET("/api/v1/models/:runtime_package_id/evaluation", module.ModelHandler.GetModelEvaluation)
	engine.GET("/api/v1/models/:runtime_package_id/evolution", module.ModelHandler.GetModelEvolution)
	engine.GET("/api/v1/inference/jobs", module.ModelHandler.ListInferenceJobs)
	engine.POST("/api/v1/inference/jobs/:job_id/retry", module.ModelHandler.RetryInferenceJob)
	// Labeling Studio Workflow
	engine.GET("/api/v1/labeling/snapshots", module.LabelingHandler.ListSnapshots)
	engine.GET("/api/v1/labeling/workspace", module.LabelingHandler.GetCohortWorkspace)
	engine.GET("/api/v1/labeling/target-evidence", module.LabelingHandler.GetTargetEvidence)
	engine.POST("/api/v1/labeling/cohort/labels", module.LabelingHandler.SaveCohortLabel)
	engine.POST("/api/v1/models/training-cohort/labels", module.LabelingHandler.SaveCohortLabel)
	engine.GET("/api/v1/models/training-preflight", module.ModelHandler.TrainingPreflight)
	engine.GET("/api/v1/models/training-readiness", module.ModelHandler.TrainingPreflight)
	engine.GET("/api/v1/models/snapshots", module.ModelHandler.ListSnapshots)
	engine.POST("/api/v1/models/train", module.ModelHandler.StartTraining)
	engine.POST("/api/v1/models/train/control", module.ModelHandler.ControlTraining)
	engine.GET("/api/v1/models/train/active", module.ModelHandler.GetActiveTraining)
}
