package repository

import (
	"context"
	"encoding/json"
	"fmt"
	"strconv"
	"strings"

	"go-api/internal/domain/entity"
)

func (r *AnalyticsClickHouse) ListTargets(ctx context.Context, filter entity.TargetQuery) (entity.Page[entity.Target], error) {
	return r.listTargets(ctx, filter, true)
}

// listTargets keeps the target-detail path from executing a full count query.
// Counting a filtered TIC is needless work and used to double the most
// expensive analytical request in the application.
func (r *AnalyticsClickHouse) listTargets(ctx context.Context, filter entity.TargetQuery, includeCount bool) (entity.Page[entity.Target], error) {
	page := filter.Page
	if page.Limit < 1 {
		page.Limit = 100
	}

	snapshotID := strings.TrimSpace(filter.SnapshotID)
	if snapshotID != "" && (strings.Contains(snapshotID, "/") || !strings.HasPrefix(snapshotID, "gold-v1-")) {
		return entity.Page[entity.Target]{}, fmt.Errorf("invalid Gold snapshot id")
	}
	featureSnapshotFilter := ""
	predictionSnapshotFilter := ""
	if snapshotID != "" {
		escapedSnapshotID := escapeSQL(snapshotID)
		featureSnapshotFilter = " AND f.snapshot_id = '" + escapedSnapshotID + "'"
		predictionSnapshotFilter = " AND p.gold_snapshot_id = '" + escapedSnapshotID + "'"
	}

	joins := `
	LEFT JOIN (
		SELECT tic_id, sector, toInt64(count()) AS lightcurve_points, max(time) - min(time) AS lightcurve_time_span
		FROM lightcurves
		GROUP BY tic_id, sector
) AS lc ON lc.tic_id = t.tic_id AND lc.sector = t.sector
LEFT JOIN (
		SELECT
			f.tic_id AS tic_id,
			f.sector AS sector,
			argMax(f.snapshot_id, tuple(g.indexed_at, f.snapshot_id)) AS gold_snapshot_id,
			argMax(f.n_points, tuple(g.indexed_at, f.snapshot_id)) AS gold_points,
			argMax(f.time_span, tuple(g.indexed_at, f.snapshot_id)) AS gold_time_span,
			argMax(f.tic_available, tuple(g.indexed_at, f.snapshot_id)) AS tic_context_available,
			ifNull(argMax(f.matched_toi_id, tuple(g.indexed_at, f.snapshot_id)), '') AS gold_matched_toi,
			argMax(f.toi_match_status, tuple(g.indexed_at, f.snapshot_id)) AS toi_match_status
		FROM candidate_features_current_v1 AS f
		INNER JOIN gold_snapshots_v1 AS g ON g.snapshot_id = f.snapshot_id
		WHERE f.tic_id IS NOT NULL AND g.index_status = 'READY'` + featureSnapshotFilter + `
		GROUP BY f.tic_id, f.sector
) AS gf ON gf.tic_id = t.tic_id AND gf.sector = t.sector
LEFT JOIN (
		SELECT p.tic_id AS tic_id, p.sector AS sector,
			argMax(p.prediction_id, tuple(p.predicted_at, g.indexed_at)) AS candidate_prediction_id,
			argMax(p.candidate_score, tuple(p.predicted_at, g.indexed_at)) AS candidate_score,
			argMax(p.above_threshold, tuple(p.predicted_at, g.indexed_at)) AS candidate_above_threshold
		FROM candidate_predictions AS p
		INNER JOIN gold_snapshots_v1 AS g ON g.snapshot_id = p.gold_snapshot_id
		WHERE g.index_status = 'READY'` + predictionSnapshotFilter + `
		GROUP BY p.tic_id, p.sector
) AS cp ON cp.tic_id = t.tic_id AND cp.sector = t.sector
LEFT JOIN (
		SELECT p.tic_id AS tic_id, p.sector AS sector,
			argMax(p.prediction_id, tuple(p.predicted_at, g.indexed_at)) AS anomaly_prediction_id,
			argMax(p.reconstruction_mse, tuple(p.predicted_at, g.indexed_at)) AS anomaly_score
		FROM anomaly_predictions AS p
		INNER JOIN gold_snapshots_v1 AS g ON g.snapshot_id = p.gold_snapshot_id
		WHERE g.index_status = 'READY'` + predictionSnapshotFilter + `
		GROUP BY p.tic_id, p.sector
) AS ap ON ap.tic_id = t.tic_id AND ap.sector = t.sector`

	conditions := make([]string, 0, 12)
	if filter.TICID > 0 {
		conditions = append(conditions, fmt.Sprintf("t.tic_id = %d", filter.TICID))
	}
	if filter.Sector > 0 {
		conditions = append(conditions, fmt.Sprintf("t.sector = %d", filter.Sector))
	}
	if filter.TessMagMin != nil {
		conditions = append(conditions, fmt.Sprintf("t.tess_mag >= %.12f", *filter.TessMagMin))
	}
	if filter.TessMagMax != nil {
		conditions = append(conditions, fmt.Sprintf("t.tess_mag <= %.12f", *filter.TessMagMax))
	}
	if filter.EffectiveTMin != nil {
		conditions = append(conditions, fmt.Sprintf("t.effective_t >= %.12f", *filter.EffectiveTMin))
	}
	if filter.EffectiveTMax != nil {
		conditions = append(conditions, fmt.Sprintf("t.effective_t <= %.12f", *filter.EffectiveTMax))
	}
	if filter.RAMin != nil {
		conditions = append(conditions, fmt.Sprintf("t.ra >= %.12f", *filter.RAMin))
	}
	if filter.RAMax != nil {
		conditions = append(conditions, fmt.Sprintf("t.ra <= %.12f", *filter.RAMax))
	}
	if filter.DecMin != nil {
		conditions = append(conditions, fmt.Sprintf("t.dec >= %.12f", *filter.DecMin))
	}
	if filter.DecMax != nil {
		conditions = append(conditions, fmt.Sprintf("t.dec <= %.12f", *filter.DecMax))
	}
	if filter.HasLightcurve != nil {
		flag := 0
		if *filter.HasLightcurve {
			flag = 1
		}
		conditions = append(conditions, fmt.Sprintf("if(if(lc.lightcurve_points > 0, lc.lightcurve_points, gf.gold_points) > 0, 1, 0) = %d", flag))
	}
	if filter.HasCandidate != nil {
		flag := 0
		if *filter.HasCandidate {
			flag = 1
		}
		conditions = append(conditions, fmt.Sprintf("if(cp.candidate_prediction_id != '', 1, 0) = %d", flag))
	}
	if filter.HasAnomaly != nil {
		flag := 0
		if *filter.HasAnomaly {
			flag = 1
		}
		conditions = append(conditions, fmt.Sprintf("if(ap.anomaly_prediction_id != '', 1, 0) = %d", flag))
	}
	if filter.PipelineStatus != "" {
		conditions = append(conditions, fmt.Sprintf("multiIf(ap.anomaly_prediction_id != '' OR cp.candidate_prediction_id != '', 'scored', if(lc.lightcurve_points > 0, lc.lightcurve_points, gf.gold_points) > 0, 'ingested', 'discovered') = '%s'", escapeSQL(filter.PipelineStatus)))
	}
	where := ""
	if len(conditions) > 0 {
		where = " WHERE " + strings.Join(conditions, " AND ")
	}

	total := 0
	if includeCount {
		countQuery := "SELECT count() AS total FROM targets AS t FINAL" + joins + where + " FORMAT JSON"
		countBody, err := r.client.Query(ctx, countQuery)
		if err != nil {
			return entity.Page[entity.Target]{}, err
		}
		var countResponse struct {
			Data []struct {
				Total string `json:"total"`
			} `json:"data"`
		}
		if err := json.Unmarshal(countBody, &countResponse); err != nil {
			return entity.Page[entity.Target]{}, fmt.Errorf("parse target count: %w", err)
		}
		if len(countResponse.Data) > 0 {
			total, err = strconv.Atoi(countResponse.Data[0].Total)
			if err != nil {
				return entity.Page[entity.Target]{}, fmt.Errorf("parse target count value: %w", err)
			}
		}
	}

	orderBy := "t.tic_id ASC, t.sector ASC"
	switch filter.Sort {
	case "tmag_asc":
		orderBy = "t.tess_mag ASC, t.tic_id ASC"
	case "tmag_desc":
		orderBy = "t.tess_mag DESC, t.tic_id ASC"
	case "teff_asc":
		orderBy = "t.effective_t ASC, t.tic_id ASC"
	case "teff_desc":
		orderBy = "t.effective_t DESC, t.tic_id ASC"
	case "candidate_desc":
		orderBy = "cp.candidate_score DESC, t.tic_id ASC"
	case "anomaly_desc":
		orderBy = "ap.anomaly_score DESC, t.tic_id ASC"
	}
	query := `SELECT
		t.tic_id AS tic_id, t.tess_mag AS tess_mag, t.ra AS ra, t.dec AS dec, t.effective_t AS effective_t, t.surface_grav AS surface_grav, t.radius AS radius, t.sector AS sector,
		if(gf.gold_matched_toi != '', gf.gold_matched_toi, ifNull(t.matched_toi, '')) AS matched_toi, ifNull(t.disposition, '') AS disposition,
		if(lc.lightcurve_points > 0, lc.lightcurve_points, gf.gold_points) AS lightcurve_points, if(lc.lightcurve_points > 0, lc.lightcurve_time_span, gf.gold_time_span) AS lightcurve_time_span,
		if(if(lc.lightcurve_points > 0, lc.lightcurve_points, gf.gold_points) > 0, 1, 0) AS has_lightcurve,
		if(cp.candidate_prediction_id != '', 1, 0) AS has_candidate, ifNull(cp.candidate_prediction_id, '') AS candidate_prediction_id,
		ifNull(cp.candidate_score, 0) AS candidate_score, ifNull(cp.candidate_above_threshold, 0) AS candidate_above_threshold,
		if(ap.anomaly_prediction_id != '', 1, 0) AS has_anomaly, ifNull(ap.anomaly_prediction_id, '') AS anomaly_prediction_id,
		ifNull(ap.anomaly_score, 0) AS anomaly_score,
		multiIf(ap.anomaly_prediction_id != '' OR cp.candidate_prediction_id != '', 'scored', if(lc.lightcurve_points > 0, lc.lightcurve_points, gf.gold_points) > 0, 'ingested', 'discovered') AS pipeline_status,
		ifNull(gf.tic_context_available, 0) AS tic_context_available, ifNull(gf.toi_match_status, '') AS toi_match_status,
		ifNull(gf.gold_snapshot_id, '') AS gold_snapshot_id
	FROM targets AS t FINAL` + joins + where + fmt.Sprintf(" ORDER BY %s LIMIT %d OFFSET %d FORMAT JSON", orderBy, page.Limit, page.Offset)

	body, err := r.client.Query(ctx, query)
	if err != nil {
		return entity.Page[entity.Target]{}, err
	}
	var response struct {
		Data []struct {
			GoldSnapshotID          string  `json:"gold_snapshot_id"`
			TICID                   any     `json:"tic_id"`
			TessMag                 float64 `json:"tess_mag"`
			RA                      float64 `json:"ra"`
			Dec                     float64 `json:"dec"`
			EffectiveT              float64 `json:"effective_t"`
			SurfaceGrav             float64 `json:"surface_grav"`
			Radius                  float64 `json:"radius"`
			Sector                  int     `json:"sector"`
			TOI                     string  `json:"matched_toi"`
			Disposition             string  `json:"disposition"`
			LightcurvePoints        any     `json:"lightcurve_points"`
			LightcurveTimeSpan      float64 `json:"lightcurve_time_span"`
			HasLightcurve           uint8   `json:"has_lightcurve"`
			HasCandidate            uint8   `json:"has_candidate"`
			CandidatePredictionID   string  `json:"candidate_prediction_id"`
			CandidateScore          float64 `json:"candidate_score"`
			CandidateAboveThreshold any     `json:"candidate_above_threshold"`
			HasAnomaly              uint8   `json:"has_anomaly"`
			AnomalyPredictionID     string  `json:"anomaly_prediction_id"`
			AnomalyScore            float64 `json:"anomaly_score"`
			PipelineStatus          string  `json:"pipeline_status"`
			TICContextAvailable     uint8   `json:"tic_context_available"`
			TOIMatchStatus          string  `json:"toi_match_status"`
		} `json:"data"`
	}
	if err := json.Unmarshal(body, &response); err != nil {
		return entity.Page[entity.Target]{}, fmt.Errorf("parse targets: %w", err)
	}

	items := make([]entity.Target, len(response.Data))
	for i, row := range response.Data {
		items[i] = entity.Target{
			GoldSnapshotID: row.GoldSnapshotID,
			TICID:          toInt64(row.TICID), TessMag: row.TessMag, RA: row.RA, Dec: row.Dec, EffectiveT: row.EffectiveT,
			SurfaceGrav: row.SurfaceGrav, Radius: row.Radius, Sector: row.Sector, TOI: row.TOI, Disposition: row.Disposition,
			HasLightcurve: row.HasLightcurve == 1, LightcurvePoints: toInt64(row.LightcurvePoints), LightcurveTimeSpan: row.LightcurveTimeSpan,
			HasCandidate: row.HasCandidate == 1, CandidatePredictionID: row.CandidatePredictionID, CandidateScore: row.CandidateScore,
			CandidateAboveThreshold: toBool(row.CandidateAboveThreshold), HasAnomaly: row.HasAnomaly == 1,
			AnomalyPredictionID: row.AnomalyPredictionID, AnomalyScore: row.AnomalyScore, PipelineStatus: row.PipelineStatus,
			TICContextAvailable: row.TICContextAvailable == 1, TOIMatchStatus: row.TOIMatchStatus,
		}
	}
	if !includeCount {
		total = len(items)
	}
	return entity.Page[entity.Target]{Items: items, Count: total, Limit: page.Limit, Offset: page.Offset, HasMore: includeCount && page.Offset+len(items) < total}, nil
}

func (r *AnalyticsClickHouse) GetTarget(ctx context.Context, ticID int64, sector int, snapshotID string) (*entity.TargetDetail, error) {
	result, err := r.listTargets(ctx, entity.TargetQuery{SnapshotID: snapshotID, TICID: ticID, Sector: sector, Page: entity.PageRequest{Limit: 1}}, false)
	if err != nil {
		return nil, err
	}
	if len(result.Items) == 0 {
		return nil, fmt.Errorf("target %d not found", ticID)
	}
	detail := &entity.TargetDetail{Target: result.Items[0]}
	if detail.Target.GoldSnapshotID == "" {
		return detail, nil
	}
	evidence, err := r.getTargetGoldEvidence(ctx, detail.Target)
	if err != nil {
		return nil, err
	}
	detail.Evidence = evidence
	return detail, nil
}

func (r *AnalyticsClickHouse) getTargetGoldEvidence(ctx context.Context, target entity.Target) (*entity.CandidateEvidence, error) {
	escapedSnapshotID := escapeSQL(target.GoldSnapshotID)
	query := fmt.Sprintf(`SELECT
		lineage_id,
		lc_feature_version,
		lc_feature_fingerprint,
		n_points,
		time_span,
		median_cadence,
		max_gap,
		flux_mean,
		flux_std,
		flux_amplitude,
		flux_rms,
		ifNull(median_flux_err, 0) AS median_flux_err,
		bls_available,
		ifNull(bls_period, 0) AS bls_period,
		ifNull(bls_duration, 0) AS bls_duration,
		ifNull(bls_transit_time, 0) AS bls_transit_time,
		ifNull(bls_depth, 0) AS bls_depth,
		ifNull(bls_power, 0) AS bls_power,
		ifNull(pixel_mad_median, 0) AS pixel_mad_median,
		ifNull(variability_peak_fraction, 0) AS variability_peak_fraction,
		transit_evidence_available,
		ifNull(transit_deficit_sum, 0) AS transit_deficit_sum,
		ifNull(transit_deficit_center_offset_pixels, 0) AS transit_deficit_center_offset_pixels,
		tic_available,
		ifNull(tmag, 0) AS tmag,
		ifNull(teff, 0) AS teff,
		ifNull(stellar_radius, 0) AS stellar_radius,
		ifNull(stellar_mass, 0) AS stellar_mass,
		ifNull(logg, 0) AS logg,
		ifNull(matched_toi_id, '') AS matched_toi_id,
		toi_match_status
	FROM candidate_features_current_v1
	WHERE snapshot_id = '%s' AND tic_id = %d AND sector = %d
	ORDER BY source_product_id ASC
	LIMIT 1 FORMAT JSON`, escapedSnapshotID, target.TICID, target.Sector)
	body, err := r.client.Query(ctx, query)
	if err != nil {
		return nil, err
	}
	var response struct {
		Data []struct {
			LineageID                  string  `json:"lineage_id"`
			FeatureVersion             string  `json:"lc_feature_version"`
			FeatureFingerprint         string  `json:"lc_feature_fingerprint"`
			NPoints                    any     `json:"n_points"`
			TimeSpan                   float64 `json:"time_span"`
			MedianCadence              float64 `json:"median_cadence"`
			MaxGap                     float64 `json:"max_gap"`
			FluxMean                   float64 `json:"flux_mean"`
			FluxStd                    float64 `json:"flux_std"`
			FluxAmplitude              float64 `json:"flux_amplitude"`
			FluxRMS                    float64 `json:"flux_rms"`
			MedianFluxErr              float64 `json:"median_flux_err"`
			BLSAvailable               uint8   `json:"bls_available"`
			BLSPeriod                  float64 `json:"bls_period"`
			BLSDuration                float64 `json:"bls_duration"`
			BLSTransitTime             float64 `json:"bls_transit_time"`
			BLSDepth                   float64 `json:"bls_depth"`
			BLSPower                   float64 `json:"bls_power"`
			PixelMADMedian             float64 `json:"pixel_mad_median"`
			VariabilityPeakFraction    float64 `json:"variability_peak_fraction"`
			TransitEvidenceAvailable   uint8   `json:"transit_evidence_available"`
			TransitDeficitSum          float64 `json:"transit_deficit_sum"`
			TransitDeficitCenterOffset float64 `json:"transit_deficit_center_offset_pixels"`
			TICAvailable               uint8   `json:"tic_available"`
			TMag                       float64 `json:"tmag"`
			Teff                       float64 `json:"teff"`
			StellarRadius              float64 `json:"stellar_radius"`
			StellarMass                float64 `json:"stellar_mass"`
			LogG                       float64 `json:"logg"`
			MatchedTOIID               string  `json:"matched_toi_id"`
			TOIMatchStatus             string  `json:"toi_match_status"`
		} `json:"data"`
	}
	if err := json.Unmarshal(body, &response); err != nil {
		return nil, fmt.Errorf("parse target Gold evidence: %w", err)
	}
	if len(response.Data) == 0 {
		return nil, nil
	}
	row := response.Data[0]
	return &entity.CandidateEvidence{
		LineageID: row.LineageID, FeatureVersion: row.FeatureVersion, FeatureFingerprint: row.FeatureFingerprint,
		NPoints: toInt64(row.NPoints), TimeSpan: row.TimeSpan, MedianCadence: row.MedianCadence, MaxGap: row.MaxGap,
		FluxMean: row.FluxMean, FluxStd: row.FluxStd, FluxAmplitude: row.FluxAmplitude, FluxRMS: row.FluxRMS, MedianFluxErr: row.MedianFluxErr,
		BLSAvailable: row.BLSAvailable == 1, BLSPeriod: row.BLSPeriod, BLSDuration: row.BLSDuration, BLSTransitTime: row.BLSTransitTime, BLSDepth: row.BLSDepth, BLSPower: row.BLSPower,
		PixelMADMedian: row.PixelMADMedian, VariabilityPeakFraction: row.VariabilityPeakFraction,
		TransitEvidenceAvailable: row.TransitEvidenceAvailable == 1, TransitDeficitSum: row.TransitDeficitSum, TransitDeficitCenterOffset: row.TransitDeficitCenterOffset,
		TICAvailable: row.TICAvailable == 1, TMag: row.TMag, Teff: row.Teff, StellarRadius: row.StellarRadius, StellarMass: row.StellarMass, LogG: row.LogG,
		MatchedTOIID: row.MatchedTOIID, TOIMatchStatus: row.TOIMatchStatus,
	}, nil
}

func (r *AnalyticsClickHouse) GetLightcurve(ctx context.Context, ticID int64, sector int, page entity.PageRequest) (*entity.Lightcurve, error) {
	query := fmt.Sprintf("SELECT time, flux FROM lightcurve_samples_v1 FINAL WHERE tic_id = %d", ticID)
	if sector > 0 {
		query += fmt.Sprintf(" AND sector = %d", sector)
	}
	query += fmt.Sprintf(" ORDER BY time ASC LIMIT %d OFFSET %d FORMAT JSON", page.Limit, page.Offset)
	body, err := r.client.Query(ctx, query)
	if err != nil {
		return nil, err
	}
	var response struct {
		Data []struct {
			Time float64 `json:"time"`
			Flux float64 `json:"flux"`
		} `json:"data"`
	}
	if err := json.Unmarshal(body, &response); err != nil {
		return nil, fmt.Errorf("parse lightcurve: %w", err)
	}
	result := &entity.Lightcurve{TICID: ticID, Sector: sector, Time: make([]float64, len(response.Data)), Flux: make([]float64, len(response.Data))}
	for i, point := range response.Data {
		result.Time[i], result.Flux[i] = point.Time, point.Flux
	}
	return result, nil
}
