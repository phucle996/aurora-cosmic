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

	engine.GET("/api/v1/lakehouse/objects", module.LakehouseHandler.List)
	engine.GET("/api/v1/lakehouse/preview", module.LakehouseHandler.Preview)
	engine.GET("/api/v1/targets", module.TargetHandler.ListTargets)
	engine.GET("/api/v1/targets/:tic_id", module.TargetHandler.GetTarget)
	engine.GET("/api/v1/candidates", module.CandidateHandler.ListCandidates)
	engine.GET("/api/v1/candidates/:prediction_id", module.CandidateHandler.GetCandidate)
	engine.PUT("/api/v1/candidates/:prediction_id/review", module.CandidateHandler.ReviewCandidate)
	engine.GET("/api/v1/lightcurves", module.TargetHandler.GetLightcurve)
	engine.GET("/api/v1/models", module.ModelsHandler.ListModels)
	engine.GET("/api/v1/models/:runtime_package_id/evaluation", module.ModelsHandler.GetModelEvaluation)
	// Labeling Studio Workflow
	engine.GET("/api/v1/labeling/snapshots", module.LabelingHandler.ListSnapshots)
	engine.GET("/api/v1/labeling/workspace", module.LabelingHandler.GetCohortWorkspace)
	engine.GET("/api/v1/labeling/target-evidence", module.LabelingHandler.GetTargetEvidence)
	engine.GET("/api/v1/models/training-readiness", module.ModelsHandler.TrainingReadiness)
	engine.GET("/api/v1/models/training-preflight", module.ModelNewHandler.TrainingPreflight)
	engine.GET("/api/v1/models/snapshots", module.ModelNewHandler.ListSnapshots)
	engine.GET("/api/v1/models/training-cohort/reviews", module.ModelsHandler.ListTrainingReviews)
	engine.GET("/api/v1/models/training-cohort/review-queue", module.ModelsHandler.ListTrainingReviewQueue)
	engine.POST("/api/v1/models/training-cohort/labels", module.ModelsHandler.OverrideTrainingLabel)
	engine.POST("/api/v1/models/train", module.ModelNewHandler.StartTraining)
	engine.POST("/api/v1/models/train/control", module.ModelNewHandler.ControlTraining)
	engine.POST("/api/v1/models/deploy", module.ModelsHandler.DeployModel)
	engine.GET("/api/v1/inference/jobs", module.ModelsHandler.ListInferenceJobs)
	engine.POST("/api/v1/inference/jobs/:job_id/retry", module.ModelsHandler.RetryInferenceJob)
}
