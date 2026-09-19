package handler

import (
	"fmt"
	"net/http"

	"github.com/gin-gonic/gin"
	"go-api/internal/domain/entity"
	"go-api/internal/domain/service"
)

const maxLineageTraceInputs = 100

type LineageHandler struct {
	service service.LineageService
}

func NewLineageHandler(service service.LineageService) *LineageHandler {
	return &LineageHandler{service: service}
}

func (h *LineageHandler) TraceLineage(c *gin.Context) {
	var request entity.LineageTraceRequest
	if err := c.ShouldBindJSON(&request); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid lineage trace request"})
		return
	}
	if len(request.Inputs) > maxLineageTraceInputs {
		c.JSON(http.StatusBadRequest, gin.H{"error": fmt.Sprintf("at most %d lineage trace inputs are allowed", maxLineageTraceInputs)})
		return
	}
	resolutions, err := h.service.TraceLineage(c.Request.Context(), request.Inputs)
	if err != nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"items": resolutions})
}
