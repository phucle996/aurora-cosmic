package handler

import (
	"net/http"
	"time"

	"go-api/internal/domain/service"

	"github.com/gin-gonic/gin"
)

type PreprocessingHandler struct{ preprocessing service.Preprocessing }

func NewPreprocessingHandler(preprocessing service.Preprocessing) *PreprocessingHandler {
	return &PreprocessingHandler{preprocessing: preprocessing}
}

func (h *PreprocessingHandler) Query(c *gin.Context) {
	graph, err := h.preprocessing.Query(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "Prometheus preprocessing observation is unavailable"})
		return
	}
	hops := make([]gin.H, len(graph.Hops))
	for i, hop := range graph.Hops {
		hops[i] = gin.H{"id": hop.ID, "label": hop.Label, "description": hop.Description, "contract": hop.Contract, "status": hop.Status, "input": hop.Input, "output": hop.Output, "observed_at": hop.ObservedAt.Format(time.RFC3339), "metrics": hop.Metrics}
	}
	edges := make([]gin.H, len(graph.Edges))
	for i, edge := range graph.Edges {
		edges[i] = gin.H{"id": edge.ID, "source": edge.Source, "target": edge.Target, "status": edge.Status, "observed_at": edge.ObservedAt.Format(time.RFC3339)}
	}
	c.JSON(http.StatusOK, gin.H{"source": graph.Source, "observation_scope": graph.ObservationScope, "status": graph.Status, "observed_at": graph.ObservedAt.Format(time.RFC3339), "hops": hops, "edges": edges})
}
