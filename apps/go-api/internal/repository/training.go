package repository

import (
	"context"
	"fmt"
	"time"

	"go-api/infra/clickhouse"
	"go-api/internal/domain/entity"
	"go-api/internal/domain/repo"
)

type TrainingClickHouse struct {
	client *clickhouse.Client
}

func NewTrainingClickHouse(client *clickhouse.Client) repo.TrainingRepository {
	return &TrainingClickHouse{client: client}
}

// Training starts with a balanced experimental cohort. Higher maturity levels
// remain observable without turning the long-term hard-negative diversity
// target into an absolute launch blocker.
const (
	minimumExperimentalPositiveTargets        = 60
	minimumExperimentalNegativeTargets        = 60
	minimumProductionCandidatePositiveTargets = 100
	minimumProductionCandidateNegativeTargets = 100
	negativeDiversityTarget                   = 300
)

func newTrainingReadiness(snapshotIDs []string) *entity.TrainingReadiness {
	readiness := &entity.TrainingReadiness{
		SnapshotIDs:                               append([]string(nil), snapshotIDs...),
		Tier:                                      "BLOCKED",
		PolicyVersion:                             "candidate-cohort-readiness-v2",
		ExperimentalMinimumPositiveTargets:        minimumExperimentalPositiveTargets,
		ExperimentalMinimumNegativeTargets:        minimumExperimentalNegativeTargets,
		ProductionCandidateMinimumPositiveTargets: minimumProductionCandidatePositiveTargets,
		ProductionCandidateMinimumNegativeTargets: minimumProductionCandidateNegativeTargets,
		NegativeDiversityTarget:                   negativeDiversityTarget,
	}
	if len(snapshotIDs) == 1 {
		readiness.SnapshotID = snapshotIDs[0]
	}
	return readiness
}

func applyTrainingReadinessPolicy(readiness *entity.TrainingReadiness) {
	readiness.NegativeDiversityTargetMet = readiness.NegativeTargets >= negativeDiversityTarget
	if readiness.TotalRows == 0 {
		readiness.Blocker = "Gold snapshot has no projected training cohort"
		return
	}
	if readiness.PositiveTargets < minimumExperimentalPositiveTargets || readiness.NegativeTargets < minimumExperimentalNegativeTargets {
		readiness.Blocker = fmt.Sprintf(
			"Experimental training needs at least %d independent POSITIVE and %d hard-NEGATIVE TIC targets",
			minimumExperimentalPositiveTargets,
			minimumExperimentalNegativeTargets,
		)
		return
	}

	readiness.Ready = true
	readiness.Tier = "EXPERIMENTAL"
	if readiness.PositiveTargets >= minimumProductionCandidatePositiveTargets && readiness.NegativeTargets >= minimumProductionCandidateNegativeTargets {
		readiness.Tier = "PRODUCTION_CANDIDATE"
	}
}

func (r *TrainingClickHouse) TrainingReadiness(ctx context.Context, snapshotIDs []string) (*entity.TrainingReadiness, error) {
	if len(snapshotIDs) == 0 {
		return nil, fmt.Errorf("at least one gold snapshot id is required")
	}
	query := `WITH latest_sources AS (
		SELECT
			source_product_id,
			argMax(tic_id, tuple(updated_at, snapshot_id)) AS tic_id,
			argMax(training_label, tuple(updated_at, snapshot_id)) AS training_label,
			argMax(train_eligible, tuple(updated_at, snapshot_id)) AS train_eligible
		FROM candidate_training_cohort_v1 FINAL
		WHERE snapshot_id IN (?)
		GROUP BY source_product_id
	)
	SELECT
		toInt64(count()) AS total_rows,
		toInt64(countIf(training_label = 'POSITIVE' AND train_eligible = 1)) AS positive_rows,
		toInt64(countIf(training_label = 'NEGATIVE' AND train_eligible = 1)) AS negative_rows,
		toInt64(countIf(training_label = 'UNRESOLVED' OR train_eligible = 0)) AS unresolved_rows,
		toInt64(uniqExactIf(tic_id, training_label = 'POSITIVE' AND train_eligible = 1)) AS positive_targets,
		toInt64(uniqExactIf(tic_id, training_label = 'NEGATIVE' AND train_eligible = 1)) AS negative_targets
		FROM latest_sources`

	readiness := newTrainingReadiness(snapshotIDs)
	row := r.client.QueryRow(ctx, query, snapshotIDs)
	if err := row.Scan(
		&readiness.TotalRows,
		&readiness.PositiveRows,
		&readiness.NegativeRows,
		&readiness.UnresolvedRows,
		&readiness.PositiveTargets,
		&readiness.NegativeTargets,
	); err != nil {
		readiness.Blocker = "Gold snapshot has no indexed candidate rows"
		return readiness, nil
	}
	applyTrainingReadinessPolicy(readiness)
	return readiness, nil
}

func (r *TrainingClickHouse) OverrideTrainingLabel(ctx context.Context, value entity.TrainingLabelOverride) error {
	type cohortRow struct {
		TICID    int64  `ch:"tic_id"`
		Sector   int32  `ch:"sector"`
		Evidence string `ch:"evidence_json"`
	}
	var rows []cohortRow
	query := "SELECT tic_id, sector, evidence_json FROM candidate_training_cohort_v1 FINAL WHERE snapshot_id = ? AND source_product_id = ? LIMIT 1"
	if err := r.client.Select(ctx, &rows, query, value.SnapshotID, value.SourceProductID); err != nil {
		return err
	}
	if len(rows) == 0 {
		return repo.ErrNotFound
	}
	row := rows[0]

	eligible := 0
	if value.TrainingLabel != "UNRESOLVED" {
		eligible = 1
	}

	now := time.Now().UTC()
	insertQuery := `INSERT INTO candidate_training_cohort_v1
		(snapshot_id, source_product_id, tic_id, sector, training_label, confidence, label_source, review_status, train_eligible, policy_version, evidence_json, review_reason, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, 'HUMAN_REVIEW', 'REVIEWED', ?, 'candidate-auto-label-v1', ?, ?, ?)`

	return r.client.Exec(ctx, insertQuery,
		value.SnapshotID, value.SourceProductID, row.TICID, row.Sector,
		value.TrainingLabel, value.Confidence, eligible, row.Evidence, value.ReviewReason, now,
	)
}

type trainingReviewRow struct {
	SnapshotID      string  `ch:"snapshot_id"`
	SourceProductID string  `ch:"source_product_id"`
	TICID           int64   `ch:"tic_id"`
	Sector          int32   `ch:"sector"`
	TrainingLabel   string  `ch:"training_label"`
	ReviewStatus    string  `ch:"review_status"`
	ReviewReason    string  `ch:"review_reason"`
	Confidence      float64 `ch:"confidence"`
	UpdatedAt       string  `ch:"updated_at"`
}

func (r *TrainingClickHouse) ListTrainingReviews(ctx context.Context, limit int) ([]entity.TrainingReview, error) {
	query := `SELECT snapshot_id, source_product_id, tic_id, sector, training_label, review_status,
		ifNull(review_reason, '') AS review_reason, confidence, toString(updated_at) AS updated_at
		FROM candidate_training_cohort_v1 FINAL
		WHERE label_source = 'HUMAN_REVIEW'
		ORDER BY updated_at DESC
		LIMIT ?`

	var rows []trainingReviewRow
	if err := r.client.Select(ctx, &rows, query, limit); err != nil {
		return nil, err
	}
	items := make([]entity.TrainingReview, len(rows))
	for i, row := range rows {
		items[i] = entity.TrainingReview{
			SnapshotID:      row.SnapshotID,
			SourceProductID: row.SourceProductID,
			TICID:           row.TICID,
			Sector:          int(row.Sector),
			TrainingLabel:   row.TrainingLabel,
			ReviewStatus:    row.ReviewStatus,
			ReviewReason:    row.ReviewReason,
			Confidence:      row.Confidence,
			UpdatedAt:       row.UpdatedAt,
		}
	}
	return items, nil
}

type queueItemRow struct {
	SnapshotID               string  `ch:"snapshot_id"`
	SourceProductID          string  `ch:"source_product_id"`
	TICID                    int64   `ch:"tic_id"`
	Sector                   int32   `ch:"sector"`
	TrainingLabel            string  `ch:"training_label"`
	LabelSource              string  `ch:"label_source"`
	ReviewStatus             string  `ch:"review_status"`
	ReviewReason             string  `ch:"review_reason"`
	Confidence               float64 `ch:"confidence"`
	PolicyVersion            string  `ch:"policy_version"`
	NPoints                  int64   `ch:"n_points"`
	TimeSpanDays             float64 `ch:"time_span_days"`
	SectorBaselineDays       float64 `ch:"sector_baseline_days"`
	SectorCoveragePercent    float64 `ch:"sector_coverage_percent"`
	LargestGapHours          float64 `ch:"largest_gap_hours"`
	MedianCadenceMinutes     float64 `ch:"median_cadence_minutes"`
	FluxStdPPM               float64 `ch:"flux_std_ppm"`
	FluxAmplitudePPM         float64 `ch:"flux_amplitude_ppm"`
	MedianFluxErrPPM         float64 `ch:"median_flux_err_ppm"`
	BLSAvailable             bool    `ch:"bls_available"`
	BLSPeriodDays            float64 `ch:"bls_period_days"`
	BLSDurationHours         float64 `ch:"bls_duration_hours"`
	BLSTransitTimeBTJD       float64 `ch:"bls_transit_time_btjd"`
	BLSDepthPPM              float64 `ch:"bls_depth_ppm"`
	BLSPower                 float64 `ch:"bls_power"`
	VariabilityPeakFraction  float64 `ch:"variability_peak_fraction"`
	TransitEvidenceAvailable bool    `ch:"transit_evidence_available"`
	TransitDeficitSum        float64 `ch:"transit_deficit_sum"`
	CentroidOffsetPixels     float64 `ch:"centroid_offset_pixels"`
	TOIMatchStatus           string  `ch:"toi_match_status"`
	MatchedTOIID             string  `ch:"matched_toi_id"`
	PredictionAvailable      bool    `ch:"prediction_available"`
	CandidateScore           float64 `ch:"candidate_score"`
	DecisionThreshold        float64 `ch:"decision_threshold"`
	AboveThreshold           bool    `ch:"above_threshold"`
	ModelID                  string  `ch:"model_id"`
	ModelVersion             string  `ch:"model_version"`
	RuntimePackageID         string  `ch:"runtime_package_id"`
	PredictedAt              string  `ch:"predicted_at"`
	TotalCount               int64   `ch:"total_count"`
}

func (r *TrainingClickHouse) ListTrainingReviewQueue(ctx context.Context, snapshotIDs []string, page entity.PageRequest) (entity.Page[entity.TrainingReviewQueueItem], error) {
	query := `WITH latest_cohort AS (
		SELECT cohort.source_product_id AS source_product_id,
			argMax(cohort.snapshot_id, tuple(cohort.updated_at, cohort.snapshot_id)) AS snapshot_id,
			argMax(cohort.tic_id, tuple(cohort.updated_at, cohort.snapshot_id)) AS tic_id,
			argMax(cohort.sector, tuple(cohort.updated_at, cohort.snapshot_id)) AS sector,
			argMax(cohort.training_label, tuple(cohort.updated_at, cohort.snapshot_id)) AS training_label,
			argMax(cohort.label_source, tuple(cohort.updated_at, cohort.snapshot_id)) AS label_source,
			argMax(cohort.review_status, tuple(cohort.updated_at, cohort.snapshot_id)) AS review_status,
			argMax(cohort.review_reason, tuple(cohort.updated_at, cohort.snapshot_id)) AS review_reason,
			argMax(cohort.confidence, tuple(cohort.updated_at, cohort.snapshot_id)) AS confidence,
			argMax(cohort.policy_version, tuple(cohort.updated_at, cohort.snapshot_id)) AS policy_version
		FROM candidate_training_cohort_v1 AS cohort FINAL
		WHERE cohort.snapshot_id IN (?)
		GROUP BY cohort.source_product_id
	), sector_baselines AS (
		SELECT sector, max(time_span) AS sector_baseline_days
		FROM candidate_features_current_v1
		WHERE snapshot_id IN (?)
		GROUP BY sector
	), latest_predictions AS (
		SELECT gold_snapshot_id AS snapshot_id, source_product_id,
			argMax(candidate_score, predicted_at) AS candidate_score,
			argMax(decision_threshold, predicted_at) AS decision_threshold,
			argMax(above_threshold, predicted_at) AS above_threshold,
			argMax(registered_model_id, predicted_at) AS model_id,
			argMax(model_version, predicted_at) AS model_version,
			argMax(runtime_package_id, predicted_at) AS runtime_package_id,
			toString(max(predicted_at)) AS prediction_observed_at
		FROM candidate_predictions
		WHERE gold_snapshot_id IN (?)
		GROUP BY gold_snapshot_id, source_product_id
	)
	SELECT c.snapshot_id AS snapshot_id, c.source_product_id AS source_product_id,
		c.tic_id AS tic_id, toInt32(c.sector) AS sector,
		c.training_label AS training_label, c.label_source AS label_source,
		c.review_status AS review_status, c.review_reason AS review_reason,
		c.confidence AS confidence, c.policy_version AS policy_version,
		toInt64(ifNull(f.n_points, 0)) AS n_points,
		toFloat64(ifNull(f.time_span, 0)) AS time_span_days,
		toFloat64(ifNull(sb.sector_baseline_days, 0)) AS sector_baseline_days,
		toFloat64(if(sb.sector_baseline_days > 0,
			least(100.0, ifNull(f.time_span, 0) / sb.sector_baseline_days * 100.0),
			0.0)) AS sector_coverage_percent,
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
		ifNull(f.toi_match_status, '') AS toi_match_status,
		ifNull(f.matched_toi_id, '') AS matched_toi_id,
		cast(if(p.source_product_id = '', 0, 1) AS Bool) AS prediction_available,
		toFloat64(ifNull(p.candidate_score, 0)) AS candidate_score,
		toFloat64(ifNull(p.decision_threshold, 0)) AS decision_threshold,
		cast(ifNull(p.above_threshold, 0) AS Bool) AS above_threshold,
		ifNull(p.model_id, '') AS model_id,
		ifNull(p.model_version, '') AS model_version,
		ifNull(p.runtime_package_id, '') AS runtime_package_id,
		ifNull(p.prediction_observed_at, '') AS predicted_at,
		toInt64(count() OVER ()) AS total_count
	FROM latest_cohort AS c
	LEFT JOIN candidate_features_current_v1 AS f
		ON f.snapshot_id = c.snapshot_id AND f.source_product_id = c.source_product_id
	LEFT JOIN sector_baselines AS sb ON sb.sector = c.sector
	LEFT JOIN latest_predictions AS p
		ON p.snapshot_id = c.snapshot_id AND p.source_product_id = c.source_product_id
	WHERE c.training_label = 'UNRESOLVED'
	ORDER BY prediction_available DESC,
		if(prediction_available = 1, abs(candidate_score - decision_threshold), 1) ASC,
		bls_power DESC, c.tic_id ASC
	LIMIT ? OFFSET ?`

	var rows []queueItemRow
	if err := r.client.Select(ctx, &rows, query, snapshotIDs, snapshotIDs, snapshotIDs, page.Limit, page.Offset); err != nil {
		return entity.Page[entity.TrainingReviewQueueItem]{}, err
	}

	items := make([]entity.TrainingReviewQueueItem, len(rows))
	total := 0
	for i, row := range rows {
		item := entity.TrainingReviewQueueItem{
			SnapshotID:      row.SnapshotID,
			SourceProductID: row.SourceProductID,
			TICID:           row.TICID,
			Sector:          int(row.Sector),
			TrainingLabel:   row.TrainingLabel,
			LabelSource:     row.LabelSource,
			ReviewStatus:    row.ReviewStatus,
			ReviewReason:    row.ReviewReason,
			Confidence:      row.Confidence,
			PolicyVersion:   row.PolicyVersion,
			Evidence: entity.TrainingReviewEvidence{
				NPoints:                  row.NPoints,
				TimeSpanDays:             row.TimeSpanDays,
				SectorBaselineDays:       row.SectorBaselineDays,
				SectorCoveragePercent:    row.SectorCoveragePercent,
				LargestGapHours:          row.LargestGapHours,
				MedianCadenceMinutes:     row.MedianCadenceMinutes,
				FluxStdPPM:               row.FluxStdPPM,
				FluxAmplitudePPM:         row.FluxAmplitudePPM,
				MedianFluxErrPPM:         row.MedianFluxErrPPM,
				BLSAvailable:             row.BLSAvailable,
				BLSPeriodDays:            row.BLSPeriodDays,
				BLSDurationHours:         row.BLSDurationHours,
				BLSTransitTimeBTJD:       row.BLSTransitTimeBTJD,
				BLSDepthPPM:              row.BLSDepthPPM,
				BLSPower:                 row.BLSPower,
				VariabilityPeakFraction:  row.VariabilityPeakFraction,
				TransitEvidenceAvailable: row.TransitEvidenceAvailable,
				TransitDeficitSum:        row.TransitDeficitSum,
				CentroidOffsetPixels:     row.CentroidOffsetPixels,
				TOIMatchStatus:           row.TOIMatchStatus,
				MatchedTOIID:             row.MatchedTOIID,
			},
		}
		if row.PredictionAvailable {
			item.ModelSuggestion = &entity.TrainingModelSuggestion{
				CandidateScore:   row.CandidateScore,
				Threshold:        row.DecisionThreshold,
				AboveThreshold:   row.AboveThreshold,
				ModelID:          row.ModelID,
				ModelVersion:     row.ModelVersion,
				RuntimePackageID: row.RuntimePackageID,
				PredictedAt:      row.PredictedAt,
			}
		}
		items[i] = item
		total = int(row.TotalCount)
	}

	return entity.Page[entity.TrainingReviewQueueItem]{
		Items:   items,
		Count:   total,
		Limit:   page.Limit,
		Offset:  page.Offset,
		HasMore: page.Offset+len(items) < total,
	}, nil
}
