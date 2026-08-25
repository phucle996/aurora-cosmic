package app

import (
	"net/http"

	"go-api/internal/config"
	"go-api/internal/observer"
	"go-api/internal/transport/http/middleware"

	"github.com/gin-gonic/gin"
)

type Router struct {
	engine *gin.Engine
	module *Module
}

func NewRouter(cfg *config.Config, module *Module, metrics ...*observer.Metrics) *Router {
	gin.SetMode(gin.ReleaseMode)
	engine := gin.New()
	engine.Use(gin.Recovery())
	engine.Use(middleware.CORS(cfg))
	if len(metrics) > 0 {
		engine.Use(middleware.Metrics(metrics[0]))
	}

	r := &Router{engine: engine, module: module}
	r.registerRoutes()
	return r
}

func (r *Router) registerRoutes() {
	r.engine.GET("/healthz", r.module.SystemHandler.Healthz)
	r.engine.GET("/readyz", r.module.SystemHandler.Readyz)

	api := r.engine.Group("/api/v1")
	{
		api.GET("/system", r.module.SystemHandler.System)
		api.GET("/monitoring", r.module.MonitoringHandler.Query)
		api.GET("/preprocessing/graph", r.module.PreprocessingHandler.Query)
		api.POST("/preprocessing/jobs", r.module.PreprocessingHandler.Start)
		api.POST("/preprocessing/jobs/:job_id/stop", r.module.PreprocessingHandler.Stop)
		if r.module.EventsHandler != nil {
			api.GET("/events", r.module.EventsHandler.Stream)
		}
		api.GET("/ingest/status", r.module.IngestHandler.Status)
		api.GET("/storage", r.module.IngestHandler.Storage)
		api.POST("/ingest/jobs", r.module.IngestHandler.Start)
		api.POST("/ingest/jobs/:job_id/cancel", r.module.IngestHandler.Cancel)
		api.GET("/targets", r.module.AnalyticsHandler.ListTargets)
		api.GET("/targets/:tic_id", r.module.AnalyticsHandler.GetTarget)
		api.GET("/candidates", r.module.AnalyticsHandler.ListCandidates)
		api.GET("/candidates/:prediction_id", r.module.AnalyticsHandler.GetCandidate)
		api.GET("/anomalies", r.module.AnalyticsHandler.ListAnomalies)
		api.GET("/anomalies/:prediction_id", r.module.AnalyticsHandler.GetAnomalyDetail)
		api.GET("/lightcurves", r.module.AnalyticsHandler.GetLightcurve)
		api.GET("/models", r.module.ModelsHandler.ListModels)
		api.POST("/models/train", r.module.ModelsHandler.StartTraining)
		api.POST("/models/deploy", r.module.ModelsHandler.DeployModel)
		api.GET("/inference/jobs", r.module.ModelsHandler.ListInferenceJobs)
		api.POST("/inference/jobs/:job_id/retry", r.module.ModelsHandler.RetryInferenceJob)
	}
}

func (r *Router) ServeHTTP(w http.ResponseWriter, req *http.Request) {
	r.engine.ServeHTTP(w, req)
}

func (r *Router) Engine() *gin.Engine {
	return r.engine
}
