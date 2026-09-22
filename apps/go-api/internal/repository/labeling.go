package repository

import (
	"context"
	"encoding/json"
	"fmt"

	"go-api/infra/clickhouse"
	"go-api/internal/domain/entity"
	"go-api/internal/domain/repo"
)

type LabelingClickHouse struct {
	client *clickhouse.Client
}

func NewLabelingClickHouse(client *clickhouse.Client) repo.LabelingRepository {
	return &LabelingClickHouse{
		client: client,
	}
}

// GetCohortWorkspace thực thi 1 CTE query duy nhất để lấy đúng những gì client cần:
// 1. Cohort Disposition (phần trên-phải)
// 2. Target Queue Summary (phần dưới-trái)
func (r *LabelingClickHouse) GetCohortWorkspace(ctx context.Context, snapshotIDs []string, page entity.PageRequest) (*entity.LabelingCohortWorkspace, error) {
	query := `WITH latest_cohort AS (
		SELECT
			source_product_id,
			argMax(snapshot_id, tuple(updated_at, snapshot_id)) AS snap_id,
			argMax(tic_id, tuple(updated_at, snapshot_id)) AS tic_id,
			argMax(sector, tuple(updated_at, snapshot_id)) AS sector,
			argMax(training_label, tuple(updated_at, snapshot_id)) AS training_label,
			argMax(train_eligible, tuple(updated_at, snapshot_id)) AS train_eligible
		FROM candidate_training_cohort_v1 FINAL
		WHERE snapshot_id IN (?)
		GROUP BY source_product_id
	),
	disposition AS (
		SELECT
			toInt64(count()) AS total_rows,
			toInt64(countIf(training_label = 'POSITIVE' AND train_eligible = 1)) AS positive_rows,
			toInt64(countIf(training_label = 'NEGATIVE' AND train_eligible = 1)) AS negative_rows,
			toInt64(countIf(training_label = 'UNRESOLVED' OR train_eligible = 0)) AS unresolved_rows,
			toInt64(uniqExactIf(tic_id, training_label = 'POSITIVE' AND train_eligible = 1)) AS positive_targets,
			toInt64(uniqExactIf(tic_id, training_label = 'NEGATIVE' AND train_eligible = 1)) AS negative_targets
		FROM latest_cohort
	),
	latest_predictions AS (
		SELECT gold_snapshot_id AS pred_snapshot_id, source_product_id,
			argMax(candidate_score, predicted_at) AS candidate_score,
			argMax(above_threshold, predicted_at) AS above_threshold
		FROM candidate_predictions
		WHERE gold_snapshot_id IN (?)
		GROUP BY gold_snapshot_id, source_product_id
	),
	queue_filtered AS (
		SELECT 
			c.snap_id AS snapshot_id,
			c.source_product_id AS source_product_id,
			c.tic_id AS tic_id,
			toInt32(c.sector) AS sector,
			toFloat64(ifNull(f.bls_power, 0)) AS bls_power,
			toString(ifNull(f.toi_match_status, '')) AS toi_match_status,
			toString(ifNull(f.matched_toi_id, '')) AS matched_toi_id,
			if(p.pred_snapshot_id != '', p.candidate_score, NULL) AS candidate_score,
			if(p.pred_snapshot_id != '', p.above_threshold, NULL) AS above_threshold
		FROM latest_cohort AS c
		LEFT JOIN candidate_features_current_v1 AS f 
			ON f.snapshot_id = c.snap_id AND f.source_product_id = c.source_product_id
		LEFT JOIN latest_predictions AS p 
			ON p.pred_snapshot_id = c.snap_id AND p.source_product_id = c.source_product_id
		WHERE c.training_label = 'UNRESOLVED' OR c.train_eligible = 0
		ORDER BY c.snap_id, c.tic_id, c.source_product_id
	),
	queue_paged AS (
		SELECT 
			toJSONString(groupArray(cast(tuple(
				snapshot_id,
				source_product_id,
				tic_id,
				sector,
				bls_power,
				toi_match_status,
				matched_toi_id,
				candidate_score,
				above_threshold
			), 'Tuple(
				snapshot_id String,
				source_product_id String,
				tic_id Int64,
				sector Int32,
				bls_power Float64,
				toi_match_status String,
				matched_toi_id String,
				candidate_score Nullable(Float64),
				above_threshold Nullable(Bool)
			)'))) AS items_json
		FROM (
			SELECT * FROM queue_filtered LIMIT ? OFFSET ?
		)
	)
	SELECT 
		d.total_rows,
		d.positive_rows,
		d.negative_rows,
		d.unresolved_rows,
		d.positive_targets,
		d.negative_targets,
		toInt64((SELECT count() FROM queue_filtered)) AS total_queue_count,
		qp.items_json
	FROM disposition AS d
	CROSS JOIN queue_paged AS qp`

	var (
		totalRows       int64
		positiveRows    int64
		negativeRows    int64
		unresolvedRows  int64
		positiveTargets int64
		negativeTargets int64
		totalQueueCount int64
		itemsJSON       string
	)

	row := r.client.QueryRow(ctx, query, snapshotIDs, snapshotIDs, page.Limit, page.Offset)
	if err := row.Scan(
		&totalRows,
		&positiveRows,
		&negativeRows,
		&unresolvedRows,
		&positiveTargets,
		&negativeTargets,
		&totalQueueCount,
		&itemsJSON,
	); err != nil {
		return nil, fmt.Errorf("query cohort workspace: %w", err)
	}

	disposition := &entity.LabelingCohortDisposition{
		TotalRows:       totalRows,
		PositiveRows:    positiveRows,
		NegativeRows:    negativeRows,
		UnresolvedRows:  unresolvedRows,
		PositiveTargets: positiveTargets,
		NegativeTargets: negativeTargets,
	}

	var items []entity.LabelingQueueSummaryItem
	if itemsJSON != "" && itemsJSON != "[]" {
		if err := json.Unmarshal([]byte(itemsJSON), &items); err != nil {
			return nil, fmt.Errorf("unmarshal queue items: %w", err)
		}
	}
	if items == nil {
		items = []entity.LabelingQueueSummaryItem{}
	}

	hasMore := int64(page.Offset+len(items)) < totalQueueCount

	return &entity.LabelingCohortWorkspace{
		Disposition: disposition,
		Queue: entity.LabelingQueuePage{
			Items:      items,
			TotalCount: totalQueueCount,
			Limit:      page.Limit,
			Offset:     page.Offset,
			HasMore:    hasMore,
		},
	}, nil
}

// ListSnapshots truy vấn danh sách Gold snapshot đã index và sẵn sàng cho Labeling Studio ("Select visible").
func (r *LabelingClickHouse) ListSnapshots(ctx context.Context, limit int) ([]entity.LabelingSnapshotItem, error) {
	query := `SELECT 
		s.snapshot_id,
		formatDateTime(s.indexed_at, '%Y-%m-%dT%H:%i:%sZ') AS last_modified,
		toInt64(ifNull(o.size_bytes, 0)) AS size_bytes,
		s.indexed_row_count AS row_count
	FROM aurora.gold_snapshots_v1 AS s
	LEFT JOIN aurora.lakehouse_objects AS o 
		ON o.object_key = s.manifest_key
	WHERE s.index_status = 'READY'
	ORDER BY s.indexed_at DESC
	LIMIT ?`

	var items []entity.LabelingSnapshotItem
	if err := r.client.Select(ctx, &items, query, limit); err != nil {
		return nil, fmt.Errorf("list labeling snapshots: %w", err)
	}
	if items == nil {
		items = []entity.LabelingSnapshotItem{}
	}
	return items, nil
}

// GetTargetEvidence lấy chi tiết bằng chứng khoa học và gợi ý model cho 1 target cụ thể (dưới-phải).
func (r *LabelingClickHouse) GetTargetEvidence(ctx context.Context, snapshotID string, sourceProductID string) (*entity.LabelingTargetDetail, error) {
	query := `
	WITH target_cohort AS (
		SELECT 
			snapshot_id, source_product_id, tic_id, sector,
			training_label, label_source, review_status, review_reason, confidence
		FROM candidate_training_cohort_v1
		WHERE snapshot_id = ? AND source_product_id = ?
		ORDER BY updated_at DESC
		LIMIT 1
	),
	target_prediction AS (
		SELECT 
			gold_snapshot_id, source_product_id,
			candidate_score, decision_threshold, above_threshold,
			registered_model_id AS model_id, model_version, runtime_package_id,
			toString(predicted_at) AS predicted_at
		FROM candidate_predictions
		WHERE gold_snapshot_id = ? AND source_product_id = ?
		ORDER BY predicted_at DESC
		LIMIT 1
	),
	sector_baseline AS (
		SELECT sector, max(time_span) AS sector_baseline_days
		FROM candidate_features_current_v1
		WHERE sector = (SELECT sector FROM target_cohort)
		GROUP BY sector
	)
	SELECT 
		c.snapshot_id AS snapshot_id,
		c.source_product_id AS source_product_id,
		c.tic_id AS tic_id,
		toInt32(c.sector) AS sector,
		c.training_label AS training_label,
		c.label_source AS label_source,
		c.review_status AS review_status,
		c.review_reason AS review_reason,
		c.confidence AS confidence,
		toInt64(ifNull(f.n_points, 0)) AS n_points,
		toFloat64(ifNull(f.time_span, 0)) AS time_span_days,
		toFloat64(ifNull(sb.sector_baseline_days, 0)) AS sector_baseline_days,
		toFloat64(if(sb.sector_baseline_days > 0, least(100.0, ifNull(f.time_span, 0) / sb.sector_baseline_days * 100.0), 0.0)) AS sector_coverage_percent,
		toFloat64(ifNull(f.max_gap, 0) * 24) AS largest_gap_hours,
		toFloat64(ifNull(f.median_cadence, 0) * 24 * 60) AS median_cadence_minutes,
		toFloat64(ifNull(f.flux_std, 0) * 1000000) AS flux_std_ppm,
		toFloat64(ifNull(f.flux_amplitude, 0) * 1000000) AS flux_amplitude_ppm,
		toFloat64(ifNull(f.median_flux_err, 0) * 1000000) AS median_flux_err_ppm,
		cast(ifNull(f.bls_available, 0) AS Bool) AS bls_available,
		toFloat64(ifNull(f.bls_period, 0)) AS bls_period_days,
		toFloat64(ifNull(f.bls_duration, 0) * 24) AS bls_duration_hours,
		toFloat64(ifNull(f.bls_transit_time, 0)) AS bls_transit_time_btjd,
		toFloat64(ifNull(f.bls_depth, 0) * 1000000) AS bls_depth_ppm,
		toFloat64(ifNull(f.bls_power, 0)) AS bls_power,
		toFloat64(ifNull(f.variability_peak_fraction, 0)) AS variability_peak_fraction,
		cast(ifNull(f.transit_evidence_available, 0) AS Bool) AS transit_evidence_available,
		toFloat64(ifNull(f.transit_deficit_sum, 0)) AS transit_deficit_sum,
		toFloat64(ifNull(f.transit_deficit_center_offset_pixels, 0)) AS centroid_offset_pixels,
		if(f.transit_deficit_center_offset_pixels IS NOT NULL, toFloat64(f.transit_deficit_center_offset_pixels), NULL) AS transit_deficit_center_offset_pixels,
		if(f.transit_deficit_centroid_row IS NOT NULL, toFloat64(f.transit_deficit_centroid_row), NULL) AS centroid_row,
		if(f.transit_deficit_centroid_col IS NOT NULL, toFloat64(f.transit_deficit_centroid_col), NULL) AS centroid_col,
		if(f.tmag IS NOT NULL, toFloat64(f.tmag), NULL) AS tmag,
		if(f.teff IS NOT NULL, toFloat64(f.teff), NULL) AS teff,
		if(f.stellar_radius IS NOT NULL, toFloat64(f.stellar_radius), NULL) AS stellar_radius,
		if(f.stellar_mass IS NOT NULL, toFloat64(f.stellar_mass), NULL) AS stellar_mass,
		if(f.logg IS NOT NULL, toFloat64(f.logg), NULL) AS logg,
		ifNull(f.toi_match_status, '') AS toi_match_status,
		ifNull(f.matched_toi_id, '') AS matched_toi_id,
		cast(if(p.gold_snapshot_id != '', 1, 0) AS Bool) AS prediction_available,
		if(p.gold_snapshot_id != '', p.candidate_score, NULL) AS candidate_score,
		if(p.gold_snapshot_id != '', p.decision_threshold, NULL) AS decision_threshold,
		if(p.gold_snapshot_id != '', p.above_threshold, NULL) AS above_threshold,
		if(p.gold_snapshot_id != '', ifNull(p.model_id, ''), '') AS model_id,
		if(p.gold_snapshot_id != '', ifNull(p.model_version, ''), '') AS model_version,
		if(p.gold_snapshot_id != '', ifNull(p.runtime_package_id, ''), '') AS runtime_package_id,
		if(p.gold_snapshot_id != '', ifNull(p.predicted_at, ''), '') AS predicted_at
	FROM target_cohort AS c
	LEFT JOIN candidate_features_current_v1 AS f 
		ON f.snapshot_id = c.snapshot_id AND f.source_product_id = c.source_product_id
	LEFT JOIN sector_baseline AS sb ON sb.sector = c.sector
	LEFT JOIN target_prediction AS p 
		ON p.gold_snapshot_id = c.snapshot_id AND p.source_product_id = c.source_product_id
	LIMIT 1`

	var rows []entity.LabelingTargetDetail
	if err := r.client.Select(ctx, &rows, query, snapshotID, sourceProductID, snapshotID, sourceProductID); err != nil {
		return nil, fmt.Errorf("get target evidence: %w", err)
	}
	if len(rows) == 0 {
		return nil, fmt.Errorf("target evidence not found for snapshot_id=%s, source_product_id=%s", snapshotID, sourceProductID)
	}

	return &rows[0], nil
}

// SaveCohortLabel chèn bản ghi nhãn mới do con người chỉ định vào candidate_training_cohort_v1.
// Sử dụng cơ chế ReplacingMergeTree(updated_at) để ghi đè nhãn tự động trước đó mà không làm thay đổi các bảng raw/gold.
func (r *LabelingClickHouse) SaveCohortLabel(ctx context.Context, req entity.SaveCohortLabelRequest) error {
	query := `INSERT INTO aurora.candidate_training_cohort_v1 (
		snapshot_id,
		source_product_id,
		tic_id,
		sector,
		training_label,
		confidence,
		label_source,
		review_status,
		train_eligible,
		policy_version,
		evidence_json,
		review_reason,
		updated_at
	)
	SELECT
		f.snapshot_id,
		f.source_product_id,
		f.tic_id,
		toInt32(f.sector),
		?,
		?,
		'HUMAN_SUPERVISION',
		'REVIEWED',
		if(? IN ('POSITIVE', 'NEGATIVE'), toUInt8(1), toUInt8(0)),
		'human-v1',
		ifNull(c.evidence_json, '{}'),
		?,
		now64(3, 'UTC')
	FROM aurora.candidate_features_current_v1 AS f
	LEFT JOIN (
		SELECT snapshot_id, source_product_id, evidence_json
		FROM aurora.candidate_training_cohort_v1
		WHERE snapshot_id = ? AND source_product_id = ?
		ORDER BY updated_at DESC
		LIMIT 1
	) AS c ON c.snapshot_id = f.snapshot_id AND c.source_product_id = f.source_product_id
	WHERE f.snapshot_id = ? AND f.source_product_id = ?
	LIMIT 1`

	err := r.client.Exec(ctx, query,
		req.TrainingLabel,
		req.Confidence,
		req.TrainingLabel,
		req.ReviewReason,
		req.SnapshotID,
		req.SourceProductID,
		req.SnapshotID,
		req.SourceProductID,
	)
	if err != nil {
		return fmt.Errorf("save cohort label: %w", err)
	}
	return nil
}
