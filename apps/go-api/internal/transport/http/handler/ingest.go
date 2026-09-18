package handler

import (
	"errors"
	"net/http"
	"strconv"
	"strings"

	"go-api/internal/domain/entity"
	"go-api/internal/domain/service"

	"github.com/gin-gonic/gin"
)

type IngestHandler struct{ ingest service.Ingest }

func NewIngestHandler(ingest service.Ingest) *IngestHandler {
	return &IngestHandler{ingest: ingest}
}

func (h *IngestHandler) Status(c *gin.Context) {
	status, err := h.ingest.Status(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "ingest status unavailable"})
		return
	}
	// Keep the public status payload bounded by default. Callers that truly
	// need the complete checkpoint can opt out with products_limit=0.
	productsLimit := 100
	if raw := strings.TrimSpace(c.Query("products_limit")); raw != "" {
		parsed, parseErr := strconv.Atoi(raw)
		if parseErr != nil || parsed < 0 || parsed > 500 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "products_limit must be between 0 and 500"})
			return
		}
		productsLimit = parsed
	}

	products := status.Products
	truncated := status.ProductsTruncated
	if productsLimit > 0 && len(products) > productsLimit {
		products = products[:productsLimit]
		truncated = true
	}

	productList := make([]gin.H, len(products))
	for i, p := range products {
		item := gin.H{
			"id":                  p.ID,
			"kind":                p.Kind,
			"object_key":          p.ObjectKey,
			"state":               p.State,
			"size_bytes":          p.SizeBytes,
			"expected_size_bytes": p.Expected,
			"attempts":            p.Attempts,
			"updated_at":          p.UpdatedAt,
		}
		if p.LastError != "" {
			item["last_error"] = p.LastError
		}
		productList[i] = item
	}

	resp := gin.H{
		"observed":            status.Observed,
		"run_id":              status.RunID,
		"ticket_id":           status.TicketID,
		"status":              status.Status,
		"manifest_path":       status.ManifestPath,
		"started_at":          status.StartedAt,
		"updated_at":          status.UpdatedAt,
		"total_products":      status.TotalProducts,
		"completed_products":  status.CompletedProducts,
		"downloading":         status.Downloading,
		"failed_products":     status.FailedProducts,
		"expected_bytes":      status.ExpectedBytes,
		"completed_bytes":     status.CompletedBytes,
		"products_per_second": status.ProductsPerSecond,
		"bytes_per_second":    status.BytesPerSecond,
		"queue_depth":         status.QueueDepth,
		"inflight_products":   status.InflightProducts,
		"observed_at":         status.ObservedAt,
		"products":            productList,
		"products_truncated":  truncated,
		"product_kinds":       status.ProductKinds,
	}
	if status.Error != "" {
		resp["error"] = status.Error
	}
	if status.CatalogProgress != nil {
		resp["catalog_progress"] = status.CatalogProgress
	}
	if status.ManifestProgress != nil {
		resp["manifest_progress"] = status.ManifestProgress
	}

	c.JSON(http.StatusOK, resp)
}

func (h *IngestHandler) Storage(c *gin.Context) {
	page := 1
	if raw := strings.TrimSpace(c.Query("page")); raw != "" {
		parsed, err := strconv.Atoi(raw)
		if err != nil || parsed < 1 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "page must be a positive integer"})
			return
		}
		page = parsed
	}
	limit := 100
	if raw := strings.TrimSpace(c.Query("limit")); raw != "" {
		parsed, err := strconv.Atoi(raw)
		if err != nil || parsed < 1 || parsed > 200 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "limit must be between 1 and 200"})
			return
		}
		limit = parsed
	}
	listing, err := h.ingest.Storage(c.Request.Context(), c.Query("prefix"), page, limit)
	if err != nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "storage listing unavailable"})
		return
	}

	objects := make([]gin.H, len(listing.Objects))
	for i, obj := range listing.Objects {
		o := gin.H{
			"key":           obj.Key,
			"size_bytes":    obj.SizeBytes,
			"last_modified": obj.LastModified,
		}
		if obj.ETag != "" {
			o["etag"] = obj.ETag
		}
		objects[i] = o
	}

	c.JSON(http.StatusOK, gin.H{
		"bucket":      listing.Bucket,
		"prefix":      listing.Prefix,
		"page":        listing.Page,
		"page_size":   listing.PageSize,
		"total":       listing.Total,
		"total_bytes": listing.TotalBytes,
		"truncated":   listing.Truncated,
		"objects":     objects,
	})
}

func (h *IngestHandler) Start(c *gin.Context) {
	var req struct {
		TicketID     string `json:"ticket_id"`
		ManifestPath string `json:"manifest_path"`
		Sector       int    `json:"sector"`
		Limit        int    `json:"limit"`
		Concurrency  int    `json:"concurrency"`
		Resume       bool   `json:"resume"`
		Fresh        bool   `json:"fresh"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid ingest start request"})
		return
	}
	if req.ManifestPath == "" && req.Sector <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "sector or manifest_path is required"})
		return
	}
	job, err := h.ingest.Start(c.Request.Context(), entity.IngestStartRequest{
		TicketID:     req.TicketID,
		ManifestPath: req.ManifestPath,
		Sector:       req.Sector,
		Limit:        req.Limit,
		Concurrency:  req.Concurrency,
		Resume:       req.Resume,
		Fresh:        req.Fresh,
	})
	if err != nil {
		if errors.Is(err, entity.ErrIngestAlreadyRunning) || strings.Contains(err.Error(), "already running") {
			c.JSON(http.StatusConflict, gin.H{"error": "an ingest job is already running"})
			return
		}
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": err.Error()})
		return
	}

	resp := gin.H{
		"job_id":        job.JobID,
		"ticket_id":     job.TicketID,
		"status":        job.Status,
		"manifest_path": job.ManifestPath,
		"sector":        job.Sector,
		"concurrency":   job.Concurrency,
		"started_at":    job.StartedAt,
		"updated_at":    job.UpdatedAt,
	}
	if job.Error != "" {
		resp["error"] = job.Error
	}
	c.JSON(http.StatusAccepted, resp)
}

func (h *IngestHandler) Cancel(c *gin.Context) {
	job, err := h.ingest.Cancel(c.Request.Context(), strings.TrimSpace(c.Param("job_id")))
	if err != nil {
		if errors.Is(err, entity.ErrIngestJobNotFound) || strings.Contains(err.Error(), "not found") {
			c.JSON(http.StatusNotFound, gin.H{"error": "ingest job not found"})
			return
		}
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": err.Error()})
		return
	}

	resp := gin.H{
		"job_id":        job.JobID,
		"ticket_id":     job.TicketID,
		"status":        job.Status,
		"manifest_path": job.ManifestPath,
		"sector":        job.Sector,
		"concurrency":   job.Concurrency,
		"started_at":    job.StartedAt,
		"updated_at":    job.UpdatedAt,
	}
	if job.Error != "" {
		resp["error"] = job.Error
	}
	c.JSON(http.StatusAccepted, resp)
}
