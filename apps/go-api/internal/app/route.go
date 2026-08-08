package app

import (
	"net/http"

	"go-api/internal/config"
	"go-api/internal/http/middleware"

	"github.com/gin-gonic/gin"
)

type Router struct {
	engine *gin.Engine
	module *Module
}

func NewRouter(cfg *config.Config, module *Module) *Router {
	gin.SetMode(gin.ReleaseMode)
	engine := gin.New()
	engine.Use(gin.Recovery())
	engine.Use(middleware.CORS(cfg))

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
		api.GET("/targets", r.module.AnalyticsHandler.ListTargets)
		api.GET("/candidates", r.module.AnalyticsHandler.ListCandidates)
		api.GET("/anomalies", r.module.AnalyticsHandler.ListAnomalies)
		api.GET("/lightcurves", r.module.AnalyticsHandler.GetLightcurve)
		api.GET("/models", r.module.ModelsHandler.ListModels)
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
