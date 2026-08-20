package handler

import (
	"math"
	"net/http"
	"regexp"
	"strconv"
	"strings"

	"go-api/internal/domain/entity"
	"go-api/internal/domain/service"
	"go-api/internal/taxonomy"

	"github.com/gin-gonic/gin"
)

const (
	defaultPageSize = 100
	maxPageSize     = 1000
	maxOffset       = 10_000_000
)

var snapshotPattern = regexp.MustCompile(`^[A-Za-z0-9._-]{1,128}$`)

// ============================================================================
// ANALYTICS HTTP HANDLER (Bộ xử lý HTTP REST cho các API phân tích thiên văn)
// ============================================================================
// AnalyticsHandler cung cấp các endpoint phục vụ Dashboard và Client:
// 1. GET /candidates: Liệt kê các ứng viên ngoại hành tinh đã được chấm điểm ML.
// 2. GET /candidates/:prediction_id: Xem chi tiết Candidate kèm đánh giá vật lý Habitability.
// 3. GET /anomalies: Liệt kê các dị thường quang học (Autoencoder reconstruction error).
// 4. GET /targets: Tìm kiếm & phân trang danh sách các ngôi sao mục tiêu TIC.
// 5. GET /targets/:tic_id: Xem chi tiết một ngôi sao mục tiêu.
// 6. GET /targets/:tic_id/lightcurve: Lấy chuỗi thời gian đường cong ánh sáng (Flux time-series).
type AnalyticsHandler struct {
	analytics service.Analytics
}

func NewAnalyticsHandler(analytics service.Analytics) *AnalyticsHandler {
	return &AnalyticsHandler{analytics: analytics}
}

// ============================================================================
// ENDPOINT: LIST CANDIDATES (GET /candidates)
// ============================================================================
// ListCandidates phân trang danh sách các ứng viên ngoại hành tinh đã được mô hình ML
// (Candidate Vetting CNN) phân tích và dự đoán xác suất `candidate_score`.
func (h *AnalyticsHandler) ListCandidates(c *gin.Context) {
	page := entity.PageRequest{Limit: defaultPageSize}
	if raw := c.Query("limit"); raw != "" {
		limit, err := strconv.Atoi(raw)
		if err != nil || limit < 1 || limit > maxPageSize {
			c.JSON(http.StatusBadRequest, gin.H{"error": taxonomy.ErrInvalidPage.Error()})
			return
		}
		page.Limit = limit
	}
	if raw := c.Query("offset"); raw != "" {
		offset, err := strconv.Atoi(raw)
		if err != nil || offset < 0 || offset > maxOffset {
			c.JSON(http.StatusBadRequest, gin.H{"error": taxonomy.ErrInvalidPage.Error()})
			return
		}
		page.Offset = offset
	}

	var sector int
	if raw := c.Query("sector"); raw != "" {
		s, err := strconv.Atoi(raw)
		if err != nil || s < 1 {
			c.JSON(http.StatusBadRequest, gin.H{"error": taxonomy.ErrInvalidSector.Error()})
			return
		}
		sector = s
	}
	snapshot := c.Query("snapshot_id")
	if snapshot == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": taxonomy.ErrMissingSnapshot.Error()})
		return
	}
	if !snapshotPattern.MatchString(snapshot) {
		c.JSON(http.StatusBadRequest, gin.H{"error": taxonomy.ErrInvalidSnapshot.Error()})
		return
	}

	result, err := h.analytics.ListCandidates(c.Request.Context(), sector, snapshot, page)
	if err != nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "analytical data store is unavailable"})
		return
	}

	candidates := make([]gin.H, len(result.Items))
	for i, item := range result.Items {
		candidates[i] = gin.H{
			"prediction_id":         item.PredictionID,
			"source_product_id":     item.SourceProductID,
			"tic_id":                item.TICID,
			"sector":                item.Sector,
			"raw_logit":             item.RawLogit,
			"candidate_score":       item.CandidateScore,
			"decision_threshold":    item.Threshold,
			"above_threshold":       item.AboveThreshold,
			"model_version":         item.ModelVersion,
			"registered_model_id":   item.RegisteredModel,
			"gold_snapshot_id":      item.SnapshotID,
			"runtime_validation_id": item.ValidationID,
			"runtime_package_id":    item.RuntimePkgID,
			"predicted_at":          item.PredictedAt,
		}
	}

	c.JSON(http.StatusOK, gin.H{
		"task":       "candidate_vetting",
		"count":      result.Count,
		"candidates": candidates,
		"page": gin.H{
			"count":    result.Count,
			"limit":    result.Limit,
			"offset":   result.Offset,
			"has_more": result.HasMore,
		},
		"snapshot_id": snapshot,
	})
}

// ============================================================================
// ENDPOINT: GET CANDIDATE DETAIL (GET /candidates/:prediction_id)
// ============================================================================
// GetCandidate trả về toàn bộ thông tin về một ứng viên hành tinh, bao gồm:
// - Dự đoán ML (`candidate`)
// - Bằng chứng quan sát & trắc quang (`evidence`)
// - Các đặc tính vật lý thiên văn giải tích (`planet_physics`)
// - Đánh giá khả năng sống được (`habitability`)
func (h *AnalyticsHandler) GetCandidate(c *gin.Context) {
	predictionID := c.Param("prediction_id")
	if predictionID == "" || !snapshotPattern.MatchString(predictionID) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "prediction_id is invalid"})
		return
	}
	snapshot := c.Query("snapshot_id")
	if snapshot == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": taxonomy.ErrMissingSnapshot.Error()})
		return
	}
	if !snapshotPattern.MatchString(snapshot) {
		c.JSON(http.StatusBadRequest, gin.H{"error": taxonomy.ErrInvalidSnapshot.Error()})
		return
	}
	detail, err := h.analytics.GetCandidate(c.Request.Context(), predictionID, snapshot)
	if err != nil {
		if strings.Contains(err.Error(), "not found") {
			c.JSON(http.StatusNotFound, gin.H{"error": taxonomy.ErrNotFound.Error()})
		} else {
			c.JSON(http.StatusServiceUnavailable, gin.H{"error": taxonomy.ErrAnalyticsUnavailable.Error()})
		}
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"candidate": gin.H{
			"prediction_id":         detail.Candidate.PredictionID,
			"source_product_id":     detail.Candidate.SourceProductID,
			"tic_id":                detail.Candidate.TICID,
			"sector":                detail.Candidate.Sector,
			"raw_logit":             detail.Candidate.RawLogit,
			"candidate_score":       detail.Candidate.CandidateScore,
			"decision_threshold":    detail.Candidate.Threshold,
			"above_threshold":       detail.Candidate.AboveThreshold,
			"model_version":         detail.Candidate.ModelVersion,
			"registered_model_id":   detail.Candidate.RegisteredModel,
			"gold_snapshot_id":      detail.Candidate.SnapshotID,
			"runtime_validation_id": detail.Candidate.ValidationID,
			"runtime_package_id":    detail.Candidate.RuntimePkgID,
			"predicted_at":          detail.Candidate.PredictedAt,
		},
		"evidence": gin.H{
			"lineage_id": detail.Evidence.LineageID, "feature_version": detail.Evidence.FeatureVersion, "feature_fingerprint": detail.Evidence.FeatureFingerprint,
			"n_points": detail.Evidence.NPoints, "time_span": detail.Evidence.TimeSpan, "median_cadence": detail.Evidence.MedianCadence, "max_gap": detail.Evidence.MaxGap,
			"flux_mean": detail.Evidence.FluxMean, "flux_std": detail.Evidence.FluxStd, "flux_amplitude": detail.Evidence.FluxAmplitude, "flux_rms": detail.Evidence.FluxRMS, "median_flux_err": detail.Evidence.MedianFluxErr,
			"bls_available": detail.Evidence.BLSAvailable, "bls_period": detail.Evidence.BLSPeriod, "bls_duration": detail.Evidence.BLSDuration, "bls_transit_time": detail.Evidence.BLSTransitTime, "bls_depth": detail.Evidence.BLSDepth, "bls_power": detail.Evidence.BLSPower,
			"tpf_evidence_available": detail.Evidence.TPFEvidenceAvailable, "pixel_mad_median": detail.Evidence.PixelMADMedian, "variability_peak_fraction": detail.Evidence.VariabilityPeakFraction,
			"transit_evidence_available": detail.Evidence.TransitEvidenceAvailable, "transit_deficit_sum": detail.Evidence.TransitDeficitSum, "transit_deficit_center_offset": detail.Evidence.TransitDeficitCenterOffset,
			"tic_available": detail.Evidence.TICAvailable, "tmag": detail.Evidence.TMag, "teff": detail.Evidence.Teff, "stellar_radius": detail.Evidence.StellarRadius, "stellar_mass": detail.Evidence.StellarMass, "logg": detail.Evidence.LogG,
			"matched_toi_id": detail.Evidence.MatchedTOIID, "toi_match_status": detail.Evidence.TOIMatchStatus, "matched_tce_id": detail.Evidence.MatchedTCEID, "tce_match_status": detail.Evidence.TCEMatchStatus,
		},
		"planet_physics": gin.H{
			"planet_candidate_id":       detail.Physics.PlanetCandidateID,
			"model_version":             detail.Physics.ModelVersion,
			"orbital_period_days":       detail.Physics.OrbitalPeriodDays,
			"transit_depth_fraction":    detail.Physics.TransitDepthFraction,
			"planet_radius_earth":       detail.Physics.PlanetRadiusEarth,
			"semi_major_axis_au":        detail.Physics.SemiMajorAxisAU,
			"stellar_luminosity_solar":  detail.Physics.StellarLuminositySolar,
			"insolation_earth":          detail.Physics.InsolationEarth,
			"equilibrium_temperature_k": detail.Physics.EquilibriumTemperatureK,
			"bond_albedo_assumption":    detail.Physics.BondAlbedoAssumption,
			"hz_classification":         detail.Physics.HZClassification,
			"hz_flux_boundaries": gin.H{
				"conservative_inner": detail.Physics.ConservativeHZInnerFlux,
				"conservative_outer": detail.Physics.ConservativeHZOuterFlux,
				"optimistic_inner":   detail.Physics.OptimisticHZInnerFlux,
				"optimistic_outer":   detail.Physics.OptimisticHZOuterFlux,
			},
			"completeness": detail.Physics.Completeness,
			"warnings":     detail.Physics.Warnings,
		},
		"habitability": gin.H{
			"assessment_version": detail.Habitability.AssessmentVersion,
			"status":             detail.Habitability.Status,
			"physics_score":      detail.Habitability.PhysicsScore,
			"confidence":         detail.Habitability.Confidence,
			"tier":               detail.Habitability.Tier,
			"components": func() []gin.H {
				comps := make([]gin.H, len(detail.Habitability.Components))
				for i, c := range detail.Habitability.Components {
					comps[i] = gin.H{
						"key":       c.Key,
						"label":     c.Label,
						"score":     c.Score,
						"max_score": c.MaxScore,
						"available": c.Available,
						"reason":    c.Reason,
					}
				}
				return comps
			}(),
			"ml_score":           detail.Habitability.MLScore,
			"ml_status":          detail.Habitability.MLStatus,
			"disclaimer":         detail.Habitability.Disclaimer,
		},
		"snapshot_id": snapshot,
	})
}

// ============================================================================
// ENDPOINT: LIST ANOMALIES (GET /anomalies)
// ============================================================================
// ListAnomalies phân trang danh sách các dị thường trắc quang được phát hiện
// bởi mô hình Autoencoder (Reconstruction MSE vượt ngưỡng threshold).
func (h *AnalyticsHandler) ListAnomalies(c *gin.Context) {
	page := entity.PageRequest{Limit: defaultPageSize}
	if raw := c.Query("limit"); raw != "" {
		limit, err := strconv.Atoi(raw)
		if err != nil || limit < 1 || limit > maxPageSize {
			c.JSON(http.StatusBadRequest, gin.H{"error": taxonomy.ErrInvalidPage.Error()})
			return
		}
		page.Limit = limit
	}
	if raw := c.Query("offset"); raw != "" {
		offset, err := strconv.Atoi(raw)
		if err != nil || offset < 0 || offset > maxOffset {
			c.JSON(http.StatusBadRequest, gin.H{"error": taxonomy.ErrInvalidPage.Error()})
			return
		}
		page.Offset = offset
	}

	var sector int
	if raw := c.Query("sector"); raw != "" {
		s, parseErr := strconv.Atoi(raw)
		if parseErr != nil || s < 1 {
			c.JSON(http.StatusBadRequest, gin.H{"error": taxonomy.ErrInvalidSector.Error()})
			return
		}
		sector = s
	}
	snapshot := c.Query("snapshot_id")
	if snapshot == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": taxonomy.ErrMissingSnapshot.Error()})
		return
	}
	if !snapshotPattern.MatchString(snapshot) {
		c.JSON(http.StatusBadRequest, gin.H{"error": taxonomy.ErrInvalidSnapshot.Error()})
		return
	}
	flaggedOnly := true
	if raw := c.Query("only_flagged"); raw != "" {
		parsed, err := strconv.ParseBool(raw)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "only_flagged must be a boolean"})
			return
		}
		flaggedOnly = parsed
	}

	result, err := h.analytics.ListAnomalies(c.Request.Context(), sector, snapshot, flaggedOnly, page)
	if err != nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "analytical data store is unavailable"})
		return
	}

	anomalies := make([]gin.H, len(result.Items))
	for i, item := range result.Items {
		anomalies[i] = gin.H{
			"prediction_id":         item.PredictionID,
			"source_product_id":     item.SourceProductID,
			"tic_id":                item.TICID,
			"sector":                item.Sector,
			"reconstruction_mse":    item.ReconstructionMSE,
			"decision_threshold":    item.Threshold,
			"above_threshold":       item.AboveThreshold,
			"model_version":         item.ModelVersion,
			"registered_model_id":   item.RegisteredModel,
			"gold_snapshot_id":      item.SnapshotID,
			"runtime_validation_id": item.ValidationID,
			"runtime_package_id":    item.RuntimePkgID,
			"predicted_at":          item.PredictedAt,
		}
	}

	c.JSON(http.StatusOK, gin.H{
		"task":      "astronomical_anomaly_detection",
		"count":     result.Count,
		"anomalies": anomalies,
		"page": gin.H{
			"count":    result.Count,
			"limit":    result.Limit,
			"offset":   result.Offset,
			"has_more": result.HasMore,
		},
		"snapshot_id":  snapshot,
		"only_flagged": flaggedOnly,
	})
}

// ============================================================================
// ENDPOINT: LIST TARGETS (GET /targets)
// ============================================================================
// ListTargets lọc và phân trang danh sách các ngôi sao mục tiêu trong TESS Input Catalog (TIC),
// hỗ trợ các bộ lọc tọa độ RA/Dec, cấp sao TMag, nhiệt độ Teff, và trạng thái pipeline.
func (h *AnalyticsHandler) ListTargets(c *gin.Context) {
	page := entity.PageRequest{Limit: defaultPageSize}
	if raw := c.Query("limit"); raw != "" {
		limit, err := strconv.Atoi(raw)
		if err != nil || limit < 1 || limit > maxPageSize {
			c.JSON(http.StatusBadRequest, gin.H{"error": taxonomy.ErrInvalidPage.Error()})
			return
		}
		page.Limit = limit
	}
	if raw := c.Query("offset"); raw != "" {
		offset, err := strconv.Atoi(raw)
		if err != nil || offset < 0 || offset > maxOffset {
			c.JSON(http.StatusBadRequest, gin.H{"error": taxonomy.ErrInvalidPage.Error()})
			return
		}
		page.Offset = offset
	}

	query := entity.TargetQuery{Page: page}
	if raw := c.Query("tic_id"); raw != "" {
		ticID, err := strconv.ParseInt(raw, 10, 64)
		if err != nil || ticID < 1 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "tic_id must be a positive integer"})
			return
		}
		query.TICID = ticID
	}
	if raw := c.Query("sector"); raw != "" {
		sector, err := strconv.Atoi(raw)
		if err != nil || sector < 1 {
			c.JSON(http.StatusBadRequest, gin.H{"error": taxonomy.ErrInvalidSector.Error()})
			return
		}
		query.Sector = sector
	}
	parseFloat := func(name string, target **float64) bool {
		raw := c.Query(name)
		if raw == "" {
			return true
		}
		value, err := strconv.ParseFloat(raw, 64)
		if err != nil || math.IsNaN(value) || math.IsInf(value, 0) {
			return false
		}
		*target = &value
		return true
	}
	if !parseFloat("tmag_min", &query.TessMagMin) || !parseFloat("tmag_max", &query.TessMagMax) ||
		!parseFloat("teff_min", &query.EffectiveTMin) || !parseFloat("teff_max", &query.EffectiveTMax) ||
		!parseFloat("ra_min", &query.RAMin) || !parseFloat("ra_max", &query.RAMax) ||
		!parseFloat("dec_min", &query.DecMin) || !parseFloat("dec_max", &query.DecMax) {
		c.JSON(http.StatusBadRequest, gin.H{"error": taxonomy.ErrInvalidTargetFilter.Error()})
		return
	}
	if query.TessMagMin != nil && query.TessMagMax != nil && *query.TessMagMin > *query.TessMagMax {
		c.JSON(http.StatusBadRequest, gin.H{"error": "tmag_min must not exceed tmag_max"})
		return
	}
	if query.EffectiveTMin != nil && query.EffectiveTMax != nil && *query.EffectiveTMin > *query.EffectiveTMax {
		c.JSON(http.StatusBadRequest, gin.H{"error": "teff_min must not exceed teff_max"})
		return
	}
	if query.RAMin != nil && (*query.RAMin < 0 || *query.RAMin > 360) || query.RAMax != nil && (*query.RAMax < 0 || *query.RAMax > 360) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "RA must be between 0 and 360 degrees"})
		return
	}
	if query.DecMin != nil && (*query.DecMin < -90 || *query.DecMin > 90) || query.DecMax != nil && (*query.DecMax < -90 || *query.DecMax > 90) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Dec must be between -90 and 90 degrees"})
		return
	}
	if query.RAMin != nil && query.RAMax != nil && *query.RAMin > *query.RAMax {
		c.JSON(http.StatusBadRequest, gin.H{"error": "ra_min must not exceed ra_max"})
		return
	}
	if query.DecMin != nil && query.DecMax != nil && *query.DecMin > *query.DecMax {
		c.JSON(http.StatusBadRequest, gin.H{"error": "dec_min must not exceed dec_max"})
		return
	}
	if status := c.Query("pipeline_status"); status != "" {
		if status != "discovered" && status != "ingested" && status != "scored" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "pipeline_status must be discovered, ingested, or scored"})
			return
		}
		query.PipelineStatus = status
	}
	parseBoolFilter := func(name string, target **bool) bool {
		raw := c.Query(name)
		if raw == "" {
			return true
		}
		value, err := strconv.ParseBool(raw)
		if err != nil {
			return false
		}
		*target = &value
		return true
	}
	if !parseBoolFilter("has_lightcurve", &query.HasLightcurve) || !parseBoolFilter("has_candidate", &query.HasCandidate) || !parseBoolFilter("has_anomaly", &query.HasAnomaly) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "has_lightcurve, has_candidate, and has_anomaly must be boolean"})
		return
	}
	query.Sort = c.Query("sort")
	if query.Sort != "" && query.Sort != "tmag_asc" && query.Sort != "tmag_desc" && query.Sort != "teff_asc" && query.Sort != "teff_desc" && query.Sort != "candidate_desc" && query.Sort != "anomaly_desc" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "unsupported target sort"})
		return
	}

	result, err := h.analytics.ListTargets(c.Request.Context(), query)
	if err != nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "analytical data store is unavailable"})
		return
	}

	targets := make([]gin.H, len(result.Items))
	for i, item := range result.Items {
		targets[i] = gin.H{
			"tic_id": item.TICID, "tess_mag": item.TessMag, "ra": item.RA, "dec": item.Dec,
			"effective_t": item.EffectiveT, "surface_grav": item.SurfaceGrav, "radius": item.Radius,
			"sector": item.Sector, "matched_toi": item.TOI, "disposition": item.Disposition,
			"has_lightcurve": item.HasLightcurve, "lightcurve_points": item.LightcurvePoints, "lightcurve_time_span": item.LightcurveTimeSpan,
			"has_candidate": item.HasCandidate, "candidate_prediction_id": item.CandidatePredictionID, "candidate_score": item.CandidateScore, "candidate_above_threshold": item.CandidateAboveThreshold,
			"has_anomaly": item.HasAnomaly, "anomaly_prediction_id": item.AnomalyPredictionID, "anomaly_score": item.AnomalyScore,
			"pipeline_status": item.PipelineStatus,
		}
	}

	c.JSON(http.StatusOK, gin.H{
		"count":   result.Count,
		"targets": targets,
		"page": gin.H{
			"count":    result.Count,
			"limit":    result.Limit,
			"offset":   result.Offset,
			"has_more": result.HasMore,
		},
	})
}

// ============================================================================
// ENDPOINT: GET TARGET (GET /targets/:tic_id)
// ============================================================================
func (h *AnalyticsHandler) GetTarget(c *gin.Context) {
	ticID, err := strconv.ParseInt(c.Param("tic_id"), 10, 64)
	if err != nil || ticID < 1 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "tic_id must be a positive integer"})
		return
	}
	sector := 0
	if raw := c.Query("sector"); raw != "" {
		sector, err = strconv.Atoi(raw)
		if err != nil || sector < 1 {
			c.JSON(http.StatusBadRequest, gin.H{"error": taxonomy.ErrInvalidSector.Error()})
			return
		}
	}
	target, err := h.analytics.GetTarget(c.Request.Context(), ticID, sector)
	if err != nil {
		if strings.Contains(err.Error(), "not found") {
			c.JSON(http.StatusNotFound, gin.H{"error": taxonomy.ErrNotFound.Error()})
		} else {
			c.JSON(http.StatusServiceUnavailable, gin.H{"error": taxonomy.ErrAnalyticsUnavailable.Error()})
		}
		return
	}
	item := target.Target
	resp := gin.H{
		"target": gin.H{
			"tic_id": item.TICID, "tess_mag": item.TessMag, "ra": item.RA, "dec": item.Dec,
			"effective_t": item.EffectiveT, "surface_grav": item.SurfaceGrav, "radius": item.Radius,
			"sector": item.Sector, "matched_toi": item.TOI, "disposition": item.Disposition,
			"has_lightcurve": item.HasLightcurve, "lightcurve_points": item.LightcurvePoints, "lightcurve_time_span": item.LightcurveTimeSpan,
			"has_candidate": item.HasCandidate, "candidate_prediction_id": item.CandidatePredictionID, "candidate_score": item.CandidateScore, "candidate_above_threshold": item.CandidateAboveThreshold,
			"has_anomaly": item.HasAnomaly, "anomaly_prediction_id": item.AnomalyPredictionID, "anomaly_score": item.AnomalyScore,
			"pipeline_status": item.PipelineStatus,
		},
	}
	if target.Physics != nil {
		resp["planet_physics"] = gin.H{
			"planet_candidate_id":       target.Physics.PlanetCandidateID,
			"model_version":             target.Physics.ModelVersion,
			"orbital_period_days":       target.Physics.OrbitalPeriodDays,
			"transit_depth_fraction":    target.Physics.TransitDepthFraction,
			"planet_radius_earth":       target.Physics.PlanetRadiusEarth,
			"semi_major_axis_au":        target.Physics.SemiMajorAxisAU,
			"stellar_luminosity_solar":  target.Physics.StellarLuminositySolar,
			"insolation_earth":          target.Physics.InsolationEarth,
			"equilibrium_temperature_k": target.Physics.EquilibriumTemperatureK,
			"bond_albedo_assumption":    target.Physics.BondAlbedoAssumption,
			"hz_classification":         target.Physics.HZClassification,
			"hz_flux_boundaries": gin.H{
				"conservative_inner": target.Physics.ConservativeHZInnerFlux,
				"conservative_outer": target.Physics.ConservativeHZOuterFlux,
				"optimistic_inner":   target.Physics.OptimisticHZInnerFlux,
				"optimistic_outer":   target.Physics.OptimisticHZOuterFlux,
			},
			"completeness": target.Physics.Completeness,
			"warnings":     target.Physics.Warnings,
		}
	}
	if target.Habitability != nil {
		comps := make([]gin.H, len(target.Habitability.Components))
		for i, c := range target.Habitability.Components {
			comps[i] = gin.H{
				"key":       c.Key,
				"label":     c.Label,
				"score":     c.Score,
				"max_score": c.MaxScore,
				"available": c.Available,
				"reason":    c.Reason,
			}
		}
		resp["habitability"] = gin.H{
			"assessment_version": target.Habitability.AssessmentVersion,
			"status":             target.Habitability.Status,
			"physics_score":      target.Habitability.PhysicsScore,
			"confidence":         target.Habitability.Confidence,
			"tier":               target.Habitability.Tier,
			"components":         comps,
			"ml_score":           target.Habitability.MLScore,
			"ml_status":          target.Habitability.MLStatus,
			"disclaimer":         target.Habitability.Disclaimer,
		}
	}
	if target.Evidence != nil {
		resp["evidence"] = gin.H{
			"bls_available":  target.Evidence.BLSAvailable,
			"bls_period":     target.Evidence.BLSPeriod,
			"bls_duration":   target.Evidence.BLSDuration,
			"bls_depth":      target.Evidence.BLSDepth,
			"bls_power":      target.Evidence.BLSPower,
			"teff":           target.Evidence.Teff,
			"stellar_radius": target.Evidence.StellarRadius,
			"stellar_mass":   target.Evidence.StellarMass,
			"tmag":           target.Evidence.TMag,
		}
	}
	c.JSON(http.StatusOK, resp)
}

// ============================================================================
// ENDPOINT: GET TARGET LIGHTCURVE (GET /targets/:tic_id/lightcurve)
// ============================================================================
func (h *AnalyticsHandler) GetLightcurve(c *gin.Context) {
	page := entity.PageRequest{Limit: defaultPageSize}
	if raw := c.Query("limit"); raw != "" {
		limit, err := strconv.Atoi(raw)
		if err != nil || limit < 1 || limit > maxPageSize {
			c.JSON(http.StatusBadRequest, gin.H{"error": taxonomy.ErrInvalidPage.Error()})
			return
		}
		page.Limit = limit
	}
	if raw := c.Query("offset"); raw != "" {
		offset, err := strconv.Atoi(raw)
		if err != nil || offset < 0 || offset > maxOffset {
			c.JSON(http.StatusBadRequest, gin.H{"error": taxonomy.ErrInvalidPage.Error()})
			return
		}
		page.Offset = offset
	}

	raw := c.Query("tic_id")
	if raw == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "tic_id is required"})
		return
	}
	ticID, err := strconv.ParseInt(raw, 10, 64)
	if err != nil || ticID < 1 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "tic_id must be a positive integer"})
		return
	}
	sector := 0
	if raw := c.Query("sector"); raw != "" {
		parsed, parseErr := strconv.Atoi(raw)
		if parseErr != nil || parsed < 1 {
			c.JSON(http.StatusBadRequest, gin.H{"error": taxonomy.ErrInvalidSector.Error()})
			return
		}
		sector = parsed
	}

	result, err := h.analytics.GetLightcurve(c.Request.Context(), ticID, sector, page)
	if err != nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "analytical data store is unavailable"})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"tic_id": result.TICID,
		"sector": result.Sector,
		"time":   result.Time,
		"flux":   result.Flux,
		"page": gin.H{
			"limit":  page.Limit,
			"offset": page.Offset,
		},
	})
}
