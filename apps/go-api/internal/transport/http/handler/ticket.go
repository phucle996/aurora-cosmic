package handler

import (
	"errors"
	"net/http"
	"strconv"
	"strings"

	"go-api/internal/domain/repo"
	"go-api/internal/domain/service"

	"github.com/gin-gonic/gin"
)

type FactoryHistoryHandler struct{ history service.FactoryHistory }

func NewFactoryHistoryHandler(history service.FactoryHistory) *FactoryHistoryHandler {
	return &FactoryHistoryHandler{history: history}
}

func (h *FactoryHistoryHandler) List(c *gin.Context) {
	limit := 50
	if raw := strings.TrimSpace(c.Query("limit")); raw != "" {
		parsed, err := strconv.Atoi(raw)
		if err != nil || parsed < 1 || parsed > 100 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "limit must be between 1 and 100"})
			return
		}
		limit = parsed
	}
	runs, err := h.history.ListRuns(c.Request.Context(), strings.TrimSpace(c.Query("pipeline")), limit)
	if err != nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"items": runs})
}

func (h *FactoryHistoryHandler) Detail(c *gin.Context) {
	detail, err := h.history.GetRun(c.Request.Context(), strings.TrimSpace(c.Param("run_id")))
	if errors.Is(err, repo.ErrNotFound) {
		c.JSON(http.StatusNotFound, gin.H{"error": "run was not found"})
		return
	}
	if err != nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, detail)
}

func (h *FactoryHistoryHandler) ListTickets(c *gin.Context) {
	limit := 100
	if raw := strings.TrimSpace(c.Query("limit")); raw != "" {
		parsed, err := strconv.Atoi(raw)
		if err == nil && parsed >= 1 && parsed <= 200 {
			limit = parsed
		}
	}
	tickets, err := h.history.ListTickets(c.Request.Context(), limit)
	if err != nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"items": tickets})
}

type createTicketRequest struct {
	TicketID    string `json:"ticket_id"`
	Description string `json:"description"`
}

func (h *FactoryHistoryHandler) CreateTicket(c *gin.Context) {
	var req createTicketRequest
	_ = c.ShouldBindJSON(&req)

	ticket, err := h.history.CreateTicket(c.Request.Context(), req.TicketID, req.Description)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, ticket)
}
