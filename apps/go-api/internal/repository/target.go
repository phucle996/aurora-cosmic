package repository

import (
	"context"
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

	ctePrefix := `WITH
active_snapshot AS (
    SELECT snapshot_id
    FROM gold_snapshots_v1
    WHERE index_status = 'READY'
      AND (? = '' OR snapshot_id = ?)
    ORDER BY indexed_at DESC, snapshot_id DESC
    LIMIT 1
),
gf AS (
    SELECT
        f.tic_id AS tic_id,
        f.sector AS sector,
        f.snapshot_id AS gold_snapshot_id,
        toInt64(f.n_points) AS gold_points,
        toFloat64(f.time_span) AS gold_time_span,
        cast(f.tic_available AS Bool) AS tic_context_available,
        ifNull(f.matched_toi_id, '') AS gold_matched_toi,
        f.toi_match_status AS toi_match_status
    FROM candidate_features_current_v1 AS f
    WHERE f.snapshot_id = (SELECT snapshot_id FROM active_snapshot)
      AND f.tic_id IS NOT NULL
),
cp AS (
    SELECT
        p.tic_id AS tic_id,
        p.sector AS sector,
        p.prediction_id AS candidate_prediction_id,
        toFloat64(p.candidate_score) AS candidate_score,
        cast(p.above_threshold AS Bool) AS candidate_above_threshold
    FROM candidate_predictions AS p
    WHERE p.gold_snapshot_id = (SELECT snapshot_id FROM active_snapshot)
)
`

	joins := `FROM targets AS t FINAL
LEFT JOIN gf ON gf.tic_id = t.tic_id AND gf.sector = t.sector
LEFT JOIN cp ON cp.tic_id = t.tic_id AND cp.sector = t.sector`

	conditions := make([]string, 0, 12)
	baseArgs := []any{filter.SnapshotID, filter.SnapshotID}
	var whereArgs []any

	if filter.TICID > 0 {
		conditions = append(conditions, "t.tic_id = ?")
		whereArgs = append(whereArgs, filter.TICID)
	}
	if filter.Sector > 0 {
		conditions = append(conditions, "t.sector = ?")
		whereArgs = append(whereArgs, filter.Sector)
	}
	if filter.TessMagMin != nil {
		conditions = append(conditions, "t.tess_mag >= ?")
		whereArgs = append(whereArgs, *filter.TessMagMin)
	}
	if filter.TessMagMax != nil {
		conditions = append(conditions, "t.tess_mag <= ?")
		whereArgs = append(whereArgs, *filter.TessMagMax)
	}
	if filter.EffectiveTMin != nil {
		conditions = append(conditions, "t.effective_t >= ?")
		whereArgs = append(whereArgs, *filter.EffectiveTMin)
	}
	if filter.EffectiveTMax != nil {
		conditions = append(conditions, "t.effective_t <= ?")
		whereArgs = append(whereArgs, *filter.EffectiveTMax)
	}
	if filter.RAMin != nil {
		conditions = append(conditions, "t.ra >= ?")
		whereArgs = append(whereArgs, *filter.RAMin)
	}
	if filter.RAMax != nil {
		conditions = append(conditions, "t.ra <= ?")
		whereArgs = append(whereArgs, *filter.RAMax)
	}
	if filter.DecMin != nil {
		conditions = append(conditions, "t.dec >= ?")
		whereArgs = append(whereArgs, *filter.DecMin)
	}
	if filter.DecMax != nil {
		conditions = append(conditions, "t.dec <= ?")
		whereArgs = append(whereArgs, *filter.DecMax)
	}
	if filter.HasLightcurve != nil {
		flag := 0
		if *filter.HasLightcurve {
			flag = 1
		}
		conditions = append(conditions, "if(gf.gold_points > 0, 1, 0) = ?")
		whereArgs = append(whereArgs, flag)
	}
	if filter.HasCandidate != nil {
		flag := 0
		if *filter.HasCandidate {
			flag = 1
		}
		conditions = append(conditions, "if(cp.candidate_prediction_id != '', 1, 0) = ?")
		whereArgs = append(whereArgs, flag)
	}
	if filter.PipelineStatus != "" {
		conditions = append(conditions, "multiIf(cp.candidate_prediction_id != '', 'scored', gf.gold_points > 0, 'ingested', 'discovered') = ?")
		whereArgs = append(whereArgs, filter.PipelineStatus)
	}
	where := ""
	if len(conditions) > 0 {
		where = " WHERE " + strings.Join(conditions, " AND ")
	}

	countArgs := append(append([]any(nil), baseArgs...), whereArgs...)
	countQuery := ctePrefix + "SELECT toInt64(count()) AS total " + joins + where
	var total int64
	if err := r.client.QueryRow(ctx, countQuery, countArgs...).Scan(&total); err != nil {
		return entity.Page[entity.Target]{}, err
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
	}

	query := ctePrefix + `SELECT
		ifNull(gf.gold_snapshot_id, '') AS gold_snapshot_id,
		t.tic_id AS tic_id,
		toFloat64(t.tess_mag) AS tess_mag,
		toFloat64(t.ra) AS ra,
		toFloat64(t.dec) AS dec,
		toFloat64(t.effective_t) AS effective_t,
		toFloat64(t.surface_grav) AS surface_grav,
		toFloat64(t.radius) AS radius,
		toInt32(t.sector) AS sector,
		ifNull(gf.gold_matched_toi, '') AS matched_toi,
		ifNull(t.disposition, '') AS disposition,
		cast(if(gf.gold_points > 0, 1, 0) AS Bool) AS has_lightcurve,
		toInt64(ifNull(gf.gold_points, 0)) AS lightcurve_points,
		toFloat64(ifNull(gf.gold_time_span, 0)) AS lightcurve_time_span,
		cast(if(cp.candidate_prediction_id != '', 1, 0) AS Bool) AS has_candidate,
		ifNull(cp.candidate_prediction_id, '') AS candidate_prediction_id,
		toFloat64(ifNull(cp.candidate_score, 0)) AS candidate_score,
		cast(ifNull(cp.candidate_above_threshold, 0) AS Bool) AS candidate_above_threshold,
		multiIf(cp.candidate_prediction_id != '', 'scored', gf.gold_points > 0, 'ingested', 'discovered') AS pipeline_status,
		cast(ifNull(gf.tic_context_available, 0) AS Bool) AS tic_context_available,
		ifNull(gf.toi_match_status, '') AS toi_match_status
	` + joins + where + fmt.Sprintf(" ORDER BY %s LIMIT ? OFFSET ?", orderBy)

	fetchArgs := append(append([]any(nil), countArgs...), page.Limit, page.Offset)

	var items []entity.Target
	if err := r.client.Select(ctx, &items, query, fetchArgs...); err != nil {
		return entity.Page[entity.Target]{}, fmt.Errorf("select targets: %w", err)
	}

	return entity.Page[entity.Target]{
		Items:   items,
		Count:   int(total),
		Limit:   page.Limit,
		Offset:  page.Offset,
		HasMore: page.Offset+len(items) < int(total),
	}, nil
}

func (r *TargetClickHouse) GetTargetInsight(ctx context.Context, ticID int64, sector int, snapshotID string) (*entity.TargetInsightRecord, error) {
	sectorFilter := ""
	args := []any{snapshotID, snapshotID, ticID, ticID, ticID}
	if sector > 0 {
		sectorFilter = " AND t.sector = ?"
		args = append(args, sector)
	}

	targetQuery := `WITH
active_snapshot AS (
    SELECT snapshot_id
    FROM gold_snapshots_v1
    WHERE index_status = 'READY'
      AND (? = '' OR snapshot_id = ?)
    ORDER BY indexed_at DESC, snapshot_id DESC
    LIMIT 1
),
gf AS (
    SELECT
        f.tic_id AS tic_id,
        f.sector AS sector,
        f.snapshot_id AS gold_snapshot_id,
        toInt64(f.n_points) AS gold_points,
        toFloat64(f.time_span) AS gold_time_span,
        cast(f.tic_available AS Bool) AS tic_context_available,
        ifNull(f.matched_toi_id, '') AS gold_matched_toi,
        f.toi_match_status AS toi_match_status
    FROM candidate_features_current_v1 AS f
    WHERE f.snapshot_id = (SELECT snapshot_id FROM active_snapshot)
      AND f.tic_id = ?
),
cp AS (
    SELECT
        p.tic_id AS tic_id,
        p.sector AS sector,
        p.prediction_id AS candidate_prediction_id,
        toFloat64(p.candidate_score) AS candidate_score,
        cast(p.above_threshold AS Bool) AS candidate_above_threshold
    FROM candidate_predictions AS p
    WHERE p.gold_snapshot_id = (SELECT snapshot_id FROM active_snapshot)
      AND p.tic_id = ?
)
SELECT
    ifNull(gf.gold_snapshot_id, ifNull((SELECT snapshot_id FROM active_snapshot), '')) AS gold_snapshot_id,
    t.tic_id AS tic_id,
    toFloat64(t.tess_mag) AS tess_mag,
    toFloat64(t.ra) AS ra,
    toFloat64(t.dec) AS dec,
    toFloat64(t.effective_t) AS effective_t,
    toFloat64(t.surface_grav) AS surface_grav,
    toFloat64(t.radius) AS radius,
    toInt32(t.sector) AS sector,
    ifNull(gf.gold_matched_toi, '') AS matched_toi,
    ifNull(t.disposition, '') AS disposition,
    cast(if(ifNull(gf.gold_points, 0) > 0, 1, 0) AS Bool) AS has_lightcurve,
    toInt64(ifNull(gf.gold_points, 0)) AS lightcurve_points,
    toFloat64(ifNull(gf.gold_time_span, 0)) AS lightcurve_time_span,
    cast(if(ifNull(cp.candidate_prediction_id, '') != '', 1, 0) AS Bool) AS has_candidate,
    ifNull(cp.candidate_prediction_id, '') AS candidate_prediction_id,
    toFloat64(ifNull(cp.candidate_score, 0)) AS candidate_score,
    cast(ifNull(cp.candidate_above_threshold, 0) AS Bool) AS candidate_above_threshold,
    multiIf(
        ifNull(cp.candidate_prediction_id, '') != '', 'scored',
        ifNull(gf.gold_points, 0) > 0, 'ingested',
        'discovered'
    ) AS pipeline_status,
    cast(ifNull(gf.tic_context_available, 0) AS Bool) AS tic_context_available,
    ifNull(gf.toi_match_status, '') AS toi_match_status
FROM targets AS t FINAL
LEFT JOIN gf ON gf.tic_id = t.tic_id AND gf.sector = t.sector
LEFT JOIN cp ON cp.tic_id = t.tic_id AND cp.sector = t.sector
WHERE t.tic_id = ?` + sectorFilter + `
ORDER BY t.sector DESC
LIMIT 1`

	var targets []entity.Target
	if err := r.client.Select(ctx, &targets, targetQuery, args...); err != nil {
		return nil, fmt.Errorf("select target insight: %w", err)
	}
	if len(targets) == 0 {
		return nil, fmt.Errorf("target %d not found", ticID)
	}
	selectedTarget := targets[0]

	var evidence *entity.CandidateEvidence
	evidenceQuery := `SELECT
		lineage_id,
		lc_feature_version AS feature_version,
		lc_feature_fingerprint AS feature_fingerprint,
		toInt64(ifNull(n_points, 0)) AS n_points,
		toFloat64(ifNull(time_span, 0)) AS time_span,
		toFloat64(ifNull(median_cadence, 0)) AS median_cadence,
		toFloat64(ifNull(max_gap, 0)) AS max_gap,
		toFloat64(ifNull(flux_mean, 0)) AS flux_mean,
		toFloat64(ifNull(flux_std, 0)) AS flux_std,
		toFloat64(ifNull(flux_amplitude, 0)) AS flux_amplitude,
		toFloat64(ifNull(flux_rms, 0)) AS flux_rms,
		toFloat64(ifNull(median_flux_err, 0)) AS median_flux_err,
		cast(ifNull(bls_available, 0) AS Bool) AS bls_available,
		toFloat64(ifNull(bls_period, 0)) AS bls_period,
		toFloat64(ifNull(bls_duration, 0)) AS bls_duration,
		toFloat64(ifNull(bls_transit_time, 0)) AS bls_transit_time,
		toFloat64(ifNull(bls_depth, 0)) AS bls_depth,
		toFloat64(ifNull(bls_power, 0)) AS bls_power,
		toFloat64(ifNull(pixel_mad_median, 0)) AS pixel_mad_median,
		toFloat64(ifNull(variability_peak_fraction, 0)) AS variability_peak_fraction,
		cast(ifNull(transit_evidence_available, 0) AS Bool) AS transit_evidence_available,
		toFloat64(ifNull(transit_deficit_sum, 0)) AS transit_deficit_sum,
		toFloat64(ifNull(transit_deficit_center_offset_pixels, 0)) AS transit_deficit_center_offset,
		cast(ifNull(tic_available, 0) AS Bool) AS tic_available,
		toFloat64(ifNull(tmag, 0)) AS tmag,
		toFloat64(ifNull(teff, 0)) AS teff,
		toFloat64(ifNull(stellar_radius, 0)) AS stellar_radius,
		toFloat64(ifNull(stellar_mass, 0)) AS stellar_mass,
		toFloat64(ifNull(logg, 0)) AS logg,
		ifNull(matched_toi_id, '') AS matched_toi_id,
		ifNull(toi_match_status, '') AS toi_match_status
	FROM candidate_features_current_v1
	WHERE tic_id = ? AND sector = ? AND (? = '' OR snapshot_id = ?)
	ORDER BY source_product_id ASC
	LIMIT 1`

	var evidences []entity.CandidateEvidence
	if err := r.client.Select(ctx, &evidences, evidenceQuery, selectedTarget.TICID, int32(selectedTarget.Sector), snapshotID, snapshotID); err == nil && len(evidences) > 0 {
		evidence = &evidences[0]
	}

	return &entity.TargetInsightRecord{
		Target:   selectedTarget,
		Evidence: evidence,
	}, nil
}

type lightcurvePointRow struct {
	Time float64 `ch:"time"`
	Flux float64 `ch:"flux"`
}

func (r *TargetClickHouse) GetLightcurve(ctx context.Context, ticID int64, sector int, page entity.PageRequest) (*entity.Lightcurve, error) {
	query := "SELECT toFloat64(time) AS time, toFloat64(flux) AS flux FROM lightcurve_samples_v1 FINAL WHERE tic_id = ?"
	args := []any{ticID}
	if sector > 0 {
		query += " AND sector = ?"
		args = append(args, sector)
	}
	query += " ORDER BY time ASC LIMIT ? OFFSET ?"
	args = append(args, page.Limit, page.Offset)

	var points []lightcurvePointRow
	if err := r.client.Select(ctx, &points, query, args...); err != nil {
		return nil, fmt.Errorf("select lightcurve points: %w", err)
	}

	result := &entity.Lightcurve{
		TICID:  ticID,
		Sector: sector,
		Time:   make([]float64, len(points)),
		Flux:   make([]float64, len(points)),
	}
	for i, pt := range points {
		result.Time[i] = pt.Time
		result.Flux[i] = pt.Flux
	}
	return result, nil
}

type tpfSampleRow struct {
	Rows                 int32     `ch:"rows"`
	Cols                 int32     `ch:"cols"`
	ApertureMask         []uint8   `ch:"aperture_mask"`
	MedianFluxMap        []float64 `ch:"median_flux_map"`
	DifferenceFluxMap    []float64 `ch:"difference_flux_map"`
	CentroidRow          float64   `ch:"centroid_row"`
	CentroidCol          float64   `ch:"centroid_col"`
	CentroidOffsetPixels float64   `ch:"centroid_offset_pixels"`
	PixelMADMedian       float64   `ch:"pixel_mad_median"`
	VariabilityPeakFrac  float64   `ch:"variability_peak_fraction"`
}

func (r *TargetClickHouse) GetTargetObservation(ctx context.Context, ticID int64, sector int, limit int) (*entity.TargetObservationResponse, error) {
	if limit <= 0 || limit > 50000 {
		limit = 50000
	}
	lcQuery := "SELECT toFloat64(time) AS time, toFloat64(flux) AS flux FROM lightcurve_samples_v1 FINAL WHERE tic_id = ?"
	lcArgs := []any{ticID}
	if sector > 0 {
		lcQuery += " AND sector = ?"
		lcArgs = append(lcArgs, sector)
	}
	lcQuery += " ORDER BY time ASC LIMIT ?"
	lcArgs = append(lcArgs, limit)

	var points []lightcurvePointRow
	if err := r.client.Select(ctx, &points, lcQuery, lcArgs...); err != nil {
		return nil, fmt.Errorf("select lightcurve points: %w", err)
	}

	times := make([]float64, len(points))
	fluxes := make([]float64, len(points))
	for i, pt := range points {
		times[i] = pt.Time
		fluxes[i] = pt.Flux
	}

	tpfQuery := `
		SELECT 
			rows, cols, aperture_mask, median_flux_map, difference_flux_map,
			centroid_row, centroid_col, centroid_offset_pixels,
			pixel_mad_median, variability_peak_fraction
		FROM tpf_samples_v1 FINAL
		WHERE tic_id = ?
	`
	tpfArgs := []any{ticID}
	if sector > 0 {
		tpfQuery += " AND sector = ?"
		tpfArgs = append(tpfArgs, sector)
	}
	tpfQuery += " ORDER BY projected_at DESC LIMIT 1"

	var tpfRows []tpfSampleRow
	var tpfSample *entity.TPFSample
	if err := r.client.Select(ctx, &tpfRows, tpfQuery, tpfArgs...); err == nil && len(tpfRows) > 0 {
		row := tpfRows[0]
		mask := make([]int, len(row.ApertureMask))
		for i, v := range row.ApertureMask {
			mask[i] = int(v)
		}
		tpfSample = &entity.TPFSample{
			Rows:                 int(row.Rows),
			Cols:                 int(row.Cols),
			ApertureMask:         mask,
			MedianFluxMap:        row.MedianFluxMap,
			DifferenceFluxMap:    row.DifferenceFluxMap,
			CentroidRow:          row.CentroidRow,
			CentroidCol:          row.CentroidCol,
			CentroidOffsetPixels: row.CentroidOffsetPixels,
			PixelMADMedian:       row.PixelMADMedian,
			VariabilityPeakFrac:  row.VariabilityPeakFrac,
		}
	}

	return &entity.TargetObservationResponse{
		TICID:  ticID,
		Sector: sector,
		Lightcurve: entity.TargetObservationLC{
			Points: len(times),
			Time:   times,
			Flux:   fluxes,
		},
		TPF: tpfSample,
	}, nil
}
