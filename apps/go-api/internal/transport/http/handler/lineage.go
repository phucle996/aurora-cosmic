package handler

import (
	"fmt"
	"net/http"
	"strconv"
	"strings"

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
	var lookups []entity.LineageLookup
	if err := c.ShouldBindJSON(&lookups); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid lineage trace request: expected array of lineage lookups"})
		return
	}

	if len(lookups) > maxLineageTraceInputs {
		c.JSON(http.StatusBadRequest, gin.H{"error": fmt.Sprintf("at most %d lineage trace inputs are allowed", maxLineageTraceInputs)})
		return
	}
	resolutions, err := h.service.TraceLineage(c.Request.Context(), lookups)
	if err != nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"items": resolutions})
}

func (h *LineageHandler) Ledger(c *gin.Context) {
	page, err := strconv.Atoi(c.DefaultQuery("page", "1"))
	if err != nil || page < 1 {
		page = 1
	}

	pageSizeStr := c.DefaultQuery("page_size", c.DefaultQuery("limit", "25"))
	pageSize, err := strconv.Atoi(pageSizeStr)
	if err != nil || pageSize < 1 {
		pageSize = 25
	}
	if pageSize > 200 {
		pageSize = 200
	}

	productKind := strings.ToLower(strings.TrimSpace(c.DefaultQuery("product_kind", "lightcurve")))
	if productKind != "target-pixel" {
		productKind = "lightcurve"
	}

	stageFilter := strings.ToLower(strings.TrimSpace(c.DefaultQuery("stage_filter", "all")))
	switch stageFilter {
	case "bronze", "silver", "gold":
		// valid stages
	case "lineage":
		stageFilter = "silver"
	default:
		stageFilter = "all"
	}

	query := entity.LineageLedgerQuery{
		ProductKind: productKind,
		Page:        page,
		PageSize:    pageSize,
		StageFilter: stageFilter,
		Search:      strings.TrimSpace(c.Query("search")),
	}

	response, err := h.service.GetLedger(c.Request.Context(), query)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, response)
}

