package handler

import (
	"net/http"
	"strings"

	"go-api/internal/domain/entity"
	"go-api/internal/domain/service"

	"github.com/gin-gonic/gin"
)

type PreprocessingHandler struct{ preprocessing service.Preprocessing }

func NewPreprocessingHandler(preprocessing service.Preprocessing) *PreprocessingHandler {
	return &PreprocessingHandler{preprocessing: preprocessing}
}

func (h *PreprocessingHandler) Start(c *gin.Context) {
	var request entity.PreprocessingStartRequest
	if err := c.ShouldBindJSON(&request); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid preprocessing start request"})
		return
	}
	request.TicketID = strings.TrimSpace(request.TicketID)
	if request.TicketID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "ticket_id is required"})
		return
	}
	mode := strings.ToLower(strings.TrimSpace(request.Mode))
	if mode == "continuous" {
		mode = "stream"
	}
	if mode == "" {
		mode = "stream"
	}
	if mode != "stream" && mode != "batch" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "mode must be stream or batch"})
		return
	}
	request.Mode = mode
	if request.WorkerCount < 1 || request.WorkerCount > 64 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "worker_count must be between 1 and 64"})
		return
	}
	request.IngestRunID = strings.TrimSpace(request.IngestRunID)
	request.Prefix = strings.TrimSpace(request.Prefix)
	job, err := h.preprocessing.Start(c.Request.Context(), request)
	if err != nil {
		status := http.StatusServiceUnavailable
		if strings.Contains(err.Error(), "still active") {
			status = http.StatusConflict
		} else if strings.Contains(err.Error(), "must be") || strings.Contains(err.Error(), "not supported") || strings.Contains(err.Error(), "is required") {
			status = http.StatusBadRequest
		}
		c.JSON(status, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusAccepted, job)
}

func (h *PreprocessingHandler) Stop(c *gin.Context) {
	ticketID := strings.TrimSpace(c.Param("ticket_id"))
	if ticketID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "ticket_id is required"})
		return
	}
	job, err := h.preprocessing.Stop(c.Request.Context(), ticketID)
	if err != nil {
		c.JSON(http.StatusConflict, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusAccepted, job)
}
