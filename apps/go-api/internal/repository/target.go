package repository

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"go-api/infra/clickhouse"
	"go-api/internal/domain/entity"
	"go-api/internal/domain/repo"
)

type TargetClickHouse struct {
	client *clickhouse.Client
}

func NewTargetClickHouse(client *clickhouse.Client) repo.TargetRepository {
	return &TargetClickHouse{client: client}
}

func (r *TargetClickHouse) ListTargets(ctx context.Context, filter entity.TargetQuery) (entity.Page[entity.Target], error) {
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
	countQuery := "SELECT toInt64(count()) AS total FROM targets AS t FINAL" + joins + where + " FORMAT JSON"
	countBody, err := r.client.Query(ctx, countQuery)
	if err != nil {
		return entity.Page[entity.Target]{}, err
	}
	var countResponse struct {
		Data []struct {
			Total int `json:"total"`
		} `json:"data"`
	}
	if err := json.Unmarshal(countBody, &countResponse); err != nil {
		return entity.Page[entity.Target]{}, fmt.Errorf("parse target count: %w", err)
	}
	if len(countResponse.Data) > 0 {
		total = countResponse.Data[0].Total
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
		ifNull(gf.gold_snapshot_id, '') AS gold_snapshot_id,
		t.tic_id AS tic_id,
		toFloat64(t.tess_mag) AS tess_mag,
		toFloat64(t.ra) AS ra,
		toFloat64(t.dec) AS dec,
		toFloat64(t.effective_t) AS effective_t,
		toFloat64(t.surface_grav) AS surface_grav,
		toFloat64(t.radius) AS radius,
		toInt32(t.sector) AS sector,
		if(gf.gold_matched_toi != '', gf.gold_matched_toi, ifNull(t.matched_toi, '')) AS matched_toi,
		ifNull(t.disposition, '') AS disposition,
		cast(if(if(lc.lightcurve_points > 0, lc.lightcurve_points, gf.gold_points) > 0, 1, 0) AS Bool) AS has_lightcurve,
		toInt64(if(lc.lightcurve_points > 0, lc.lightcurve_points, gf.gold_points)) AS lightcurve_points,
		toFloat64(if(lc.lightcurve_points > 0, lc.lightcurve_time_span, gf.gold_time_span)) AS lightcurve_time_span,
		cast(if(cp.candidate_prediction_id != '', 1, 0) AS Bool) AS has_candidate,
		ifNull(cp.candidate_prediction_id, '') AS candidate_prediction_id,
		toFloat64(ifNull(cp.candidate_score, 0)) AS candidate_score,
		cast(ifNull(cp.candidate_above_threshold, 0) AS Bool) AS candidate_above_threshold,
		cast(if(ap.anomaly_prediction_id != '', 1, 0) AS Bool) AS has_anomaly,
		ifNull(ap.anomaly_prediction_id, '') AS anomaly_prediction_id,
		toFloat64(ifNull(ap.anomaly_score, 0)) AS anomaly_score,
		multiIf(ap.anomaly_prediction_id != '' OR cp.candidate_prediction_id != '', 'scored', if(lc.lightcurve_points > 0, lc.lightcurve_points, gf.gold_points) > 0, 'ingested', 'discovered') AS pipeline_status,
		cast(ifNull(gf.tic_context_available, 0) AS Bool) AS tic_context_available,
		ifNull(gf.toi_match_status, '') AS toi_match_status
	FROM targets AS t FINAL` + joins + where + fmt.Sprintf(" ORDER BY %s LIMIT %d OFFSET %d FORMAT JSON", orderBy, page.Limit, page.Offset)

	body, err := r.client.Query(ctx, query)
	if err != nil {
		return entity.Page[entity.Target]{}, err
	}
	var response struct {
		Data []entity.Target `json:"data"`
	}
	if err := json.Unmarshal(body, &response); err != nil {
		return entity.Page[entity.Target]{}, fmt.Errorf("parse targets: %w", err)
	}

	return entity.Page[entity.Target]{
		Items:   response.Data,
		Count:   total,
		Limit:   page.Limit,
		Offset:  page.Offset,
		HasMore: page.Offset+len(response.Data) < total,
	}, nil
}

func (r *TargetClickHouse) GetTarget(ctx context.Context, ticID int64, sector int, snapshotID string) (*entity.TargetDetail, error) {
	snapshotID = strings.TrimSpace(snapshotID)
	if snapshotID != "" && (strings.Contains(snapshotID, "/") || !strings.HasPrefix(snapshotID, "gold-v1-")) {
		return nil, fmt.Errorf("invalid Gold snapshot id")
	}

	snapshotFilter := ""
	if snapshotID != "" {
		snapshotFilter = fmt.Sprintf("AND snapshot_id = '%s'", escapeSQL(snapshotID))
	}

	sectorTargetFilter := ""
	if sector > 0 {
		sectorTargetFilter = fmt.Sprintf("AND t.sector = %d", sector)
	}

	query := fmt.Sprintf(`WITH
target_row AS (
    SELECT
        t.tic_id,
        t.sector,
        t.tess_mag,
        t.ra,
        t.dec,
        t.effective_t,
        t.surface_grav,
        t.radius,
        ifNull(t.matched_toi, '') AS matched_toi,
        ifNull(t.disposition, '') AS disposition
    FROM targets AS t FINAL
    WHERE t.tic_id = %d %s
    LIMIT 1
),
lc_summary AS (
    SELECT
        toInt64(count()) AS lightcurve_points,
        toFloat64(max(time) - min(time)) AS lightcurve_time_span
    FROM lightcurves
    WHERE tic_id = (SELECT tic_id FROM target_row)
      AND sector = (SELECT sector FROM target_row)
),
active_snapshot AS (
    SELECT snapshot_id
    FROM gold_snapshots_v1
    WHERE index_status = 'READY' %s
    ORDER BY indexed_at DESC, snapshot_id DESC
    LIMIT 1
),
cp AS (
    SELECT
        prediction_id AS candidate_prediction_id,
        candidate_score,
        cast(above_threshold AS Bool) AS candidate_above_threshold
    FROM candidate_predictions
    WHERE tic_id = (SELECT tic_id FROM target_row)
      AND sector = (SELECT sector FROM target_row)
      AND gold_snapshot_id = (SELECT snapshot_id FROM active_snapshot)
    ORDER BY predicted_at DESC
    LIMIT 1
),
ap AS (
    SELECT
        prediction_id AS anomaly_prediction_id,
        reconstruction_mse AS anomaly_score
    FROM anomaly_predictions
    WHERE tic_id = (SELECT tic_id FROM target_row)
      AND sector = (SELECT sector FROM target_row)
      AND gold_snapshot_id = (SELECT snapshot_id FROM active_snapshot)
    ORDER BY predicted_at DESC
    LIMIT 1
),
gf AS (
    SELECT
        snapshot_id AS gold_snapshot_id,
        lineage_id,
        lc_feature_version AS feature_version,
        lc_feature_fingerprint AS feature_fingerprint,
        toInt64(n_points) AS n_points,
        toFloat64(time_span) AS time_span,
        toFloat64(median_cadence) AS median_cadence,
        toFloat64(max_gap) AS max_gap,
        toFloat64(flux_mean) AS flux_mean,
        toFloat64(flux_std) AS flux_std,
        toFloat64(flux_amplitude) AS flux_amplitude,
        toFloat64(flux_rms) AS flux_rms,
        toFloat64(ifNull(median_flux_err, 0)) AS median_flux_err,
        cast(bls_available AS Bool) AS bls_available,
        toFloat64(ifNull(bls_period, 0)) AS bls_period,
        toFloat64(ifNull(bls_duration, 0)) AS bls_duration,
        toFloat64(ifNull(bls_transit_time, 0)) AS bls_transit_time,
        toFloat64(ifNull(bls_depth, 0)) AS bls_depth,
        toFloat64(ifNull(bls_power, 0)) AS bls_power,
        toFloat64(ifNull(pixel_mad_median, 0)) AS pixel_mad_median,
        toFloat64(ifNull(variability_peak_fraction, 0)) AS variability_peak_fraction,
        cast(transit_evidence_available AS Bool) AS transit_evidence_available,
        toFloat64(ifNull(transit_deficit_sum, 0)) AS transit_deficit_sum,
        toFloat64(ifNull(transit_deficit_center_offset_pixels, 0)) AS transit_deficit_center_offset,
        cast(tic_available AS Bool) AS tic_available,
        toFloat64(ifNull(tmag, 0)) AS tmag,
        toFloat64(ifNull(teff, 0)) AS teff,
        toFloat64(ifNull(stellar_radius, 0)) AS stellar_radius,
        toFloat64(ifNull(stellar_mass, 0)) AS stellar_mass,
        toFloat64(ifNull(logg, 0)) AS logg,
        ifNull(matched_toi_id, '') AS matched_toi_id,
        toi_match_status
    FROM candidate_features_current_v1
    WHERE tic_id = (SELECT tic_id FROM target_row)
      AND sector = (SELECT sector FROM target_row)
      AND snapshot_id = (SELECT snapshot_id FROM active_snapshot)
    ORDER BY source_product_id ASC
    LIMIT 1
)
SELECT
    CAST((
        ifNull(gf.gold_snapshot_id, ifNull((SELECT snapshot_id FROM active_snapshot), '')),
        t.tic_id,
        toFloat64(t.tess_mag),
        toFloat64(t.ra),
        toFloat64(t.dec),
        toFloat64(t.effective_t),
        toFloat64(t.surface_grav),
        toFloat64(t.radius),
        toInt32(t.sector),
        if(ifNull(gf.matched_toi_id, '') != '', gf.matched_toi_id, t.matched_toi),
        t.disposition,
        cast(if(ifNull(lc.lightcurve_points, 0) > 0 OR ifNull(gf.n_points, 0) > 0, 1, 0) AS Bool),
        if(ifNull(lc.lightcurve_points, 0) > 0, lc.lightcurve_points, ifNull(gf.n_points, 0)),
        toFloat64(if(ifNull(lc.lightcurve_points, 0) > 0, lc.lightcurve_time_span, ifNull(gf.time_span, 0))),
        cast(if(ifNull(cp.candidate_prediction_id, '') != '', 1, 0) AS Bool),
        ifNull(cp.candidate_prediction_id, ''),
        toFloat64(ifNull(cp.candidate_score, 0)),
        ifNull(cp.candidate_above_threshold, false),
        cast(if(ifNull(ap.anomaly_prediction_id, '') != '', 1, 0) AS Bool),
        ifNull(ap.anomaly_prediction_id, ''),
        toFloat64(ifNull(ap.anomaly_score, 0)),
        multiIf(
            ifNull(ap.anomaly_prediction_id, '') != '' OR ifNull(cp.candidate_prediction_id, '') != '', 'scored',
            if(ifNull(lc.lightcurve_points, 0) > 0 OR ifNull(gf.n_points, 0) > 0, 1, 0) = 1, 'ingested',
            'discovered'
        ),
        ifNull(gf.tic_available, false),
        ifNull(gf.toi_match_status, '')
    ), 'Tuple(
      gold_snapshot_id String, tic_id Int64, tess_mag Float64, ra Float64, dec Float64,
      effective_t Float64, surface_grav Float64, radius Float64, sector Int32,
      matched_toi String, disposition String, has_lightcurve Bool, lightcurve_points Int64,
      lightcurve_time_span Float64, has_candidate Bool, candidate_prediction_id String,
      candidate_score Float64, candidate_above_threshold Bool, has_anomaly Bool,
      anomaly_prediction_id String, anomaly_score Float64, pipeline_status String,
      tic_context_available Bool, toi_match_status String
    )') AS target,
    if(ifNull(gf.lineage_id, '') != '', CAST((
        gf.lineage_id,
        gf.feature_version,
        gf.feature_fingerprint,
        gf.n_points,
        gf.time_span,
        gf.median_cadence,
        gf.max_gap,
        gf.flux_mean,
        gf.flux_std,
        gf.flux_amplitude,
        gf.flux_rms,
        gf.median_flux_err,
        gf.bls_available,
        gf.bls_period,
        gf.bls_duration,
        gf.bls_transit_time,
        gf.bls_depth,
        gf.bls_power,
        gf.pixel_mad_median,
        gf.variability_peak_fraction,
        gf.transit_evidence_available,
        gf.transit_deficit_sum,
        gf.transit_deficit_center_offset,
        gf.tic_available,
        gf.tmag,
        gf.teff,
        gf.stellar_radius,
        gf.stellar_mass,
        gf.logg,
        gf.matched_toi_id,
        gf.toi_match_status
    ), 'Nullable(Tuple(
      lineage_id String, feature_version String, feature_fingerprint String,
      n_points Int64, time_span Float64, median_cadence Float64, max_gap Float64,
      flux_mean Float64, flux_std Float64, flux_amplitude Float64, flux_rms Float64,
      median_flux_err Float64, bls_available Bool, bls_period Float64,
      bls_duration Float64, bls_transit_time Float64, bls_depth Float64, bls_power Float64,
      pixel_mad_median Float64, variability_peak_fraction Float64,
      transit_evidence_available Bool, transit_deficit_sum Float64,
      transit_deficit_center_offset Float64, tic_available Bool,
      tmag Float64, teff Float64, stellar_radius Float64, stellar_mass Float64, logg Float64,
      matched_toi_id String, toi_match_status String
    ))'), CAST(NULL, 'Nullable(Tuple(
      lineage_id String, feature_version String, feature_fingerprint String,
      n_points Int64, time_span Float64, median_cadence Float64, max_gap Float64,
      flux_mean Float64, flux_std Float64, flux_amplitude Float64, flux_rms Float64,
      median_flux_err Float64, bls_available Bool, bls_period Float64,
      bls_duration Float64, bls_transit_time Float64, bls_depth Float64, bls_power Float64,
      pixel_mad_median Float64, variability_peak_fraction Float64,
      transit_evidence_available Bool, transit_deficit_sum Float64,
      transit_deficit_center_offset Float64, tic_available Bool,
      tmag Float64, teff Float64, stellar_radius Float64, stellar_mass Float64, logg Float64,
      matched_toi_id String, toi_match_status String
    ))')) AS evidence
FROM target_row AS t
LEFT JOIN lc_summary AS lc ON 1=1
LEFT JOIN cp ON 1=1
LEFT JOIN ap ON 1=1
LEFT JOIN gf ON 1=1
FORMAT JSON`, ticID, sectorTargetFilter, snapshotFilter)

	body, err := r.client.Query(ctx, query)
	if err != nil {
		return nil, err
	}
	var response struct {
		Data []entity.TargetDetail `json:"data"`
	}
	if err := json.Unmarshal(body, &response); err != nil {
		return nil, fmt.Errorf("parse target detail: %w", err)
	}
	if len(response.Data) == 0 {
		return nil, fmt.Errorf("target %d not found", ticID)
	}

	return &response.Data[0], nil
}

func (r *TargetClickHouse) GetLightcurve(ctx context.Context, ticID int64, sector int, page entity.PageRequest) (*entity.Lightcurve, error) {
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

