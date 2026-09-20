package handler

import (
	"errors"
	"net/http"
	"strconv"
	"strings"

	"go-api/internal/domain/entity"
	"go-api/internal/domain/repo"
	"go-api/internal/domain/service"

	"github.com/gin-gonic/gin"
)

type TicketHandler struct{ tickets service.Ticket }

func NewTicketHandler(tickets service.Ticket) *TicketHandler {
	return &TicketHandler{tickets: tickets}
}

// 1. List lists runner tickets
func (h *TicketHandler) List(c *gin.Context) {
	limit := 100
	if raw := strings.TrimSpace(c.Query("limit")); raw != "" {
		parsed, err := strconv.Atoi(raw)
		if err != nil || parsed < 1 || parsed > 200 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "limit must be between 1 and 200"})
			return
		}
		limit = parsed
	}
	tickets, err := h.tickets.ListTickets(c.Request.Context(), limit)
	if err != nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"items": tickets})
}

// 2. Create creates a new runner ticket
func (h *TicketHandler) Create(c *gin.Context) {
	var req entity.CreateTicketRequest
	_ = c.ShouldBindJSON(&req)

	ticket, err := h.tickets.CreateTicket(c.Request.Context(), strings.TrimSpace(req.TicketID), strings.TrimSpace(req.Description))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, ticket)
}

// 3. ListRuns lists observed pipeline stage runs
func (h *TicketHandler) ListRuns(c *gin.Context) {
	limit := 50
	if raw := strings.TrimSpace(c.Query("limit")); raw != "" {
		parsed, err := strconv.Atoi(raw)
		if err != nil || parsed < 1 || parsed > 100 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "limit must be between 1 and 100"})
			return
		}
		limit = parsed
	}
	runs, err := h.tickets.ListRuns(c.Request.Context(), strings.TrimSpace(c.Query("pipeline")), limit)
	if err != nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"items": runs})
}

// 4. Detail gets detailed execution context of a run
func (h *TicketHandler) Detail(c *gin.Context) {
	runID := strings.TrimSpace(c.Param("run_id"))
	if runID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "run_id is required"})
		return
	}
	detail, err := h.tickets.Detail(c.Request.Context(), runID)
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
