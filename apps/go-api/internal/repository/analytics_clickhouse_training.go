package repository

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"go-api/internal/domain/entity"
	"go-api/internal/domain/repo"
)

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
		SnapshotIDs:                        append([]string(nil), snapshotIDs...),
		Tier:                               "BLOCKED",
		PolicyVersion:                      "candidate-cohort-readiness-v2",
		ExperimentalMinimumPositiveTargets: minimumExperimentalPositiveTargets,
		ExperimentalMinimumNegativeTargets: minimumExperimentalNegativeTargets,
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

func (r *AnalyticsClickHouse) TrainingReadiness(ctx context.Context, snapshotIDs []string) (*entity.TrainingReadiness, error) {
	if len(snapshotIDs) == 0 {
		return nil, fmt.Errorf("at least one gold snapshot id is required")
	}
	quoted := make([]string, 0, len(snapshotIDs))
	for _, snapshotID := range snapshotIDs {
		quoted = append(quoted, "'"+escapeSQL(snapshotID)+"'")
	}
	query := fmt.Sprintf(`WITH latest_sources AS (
		SELECT
			source_product_id,
			argMax(tic_id, tuple(updated_at, snapshot_id)) AS tic_id,
			argMax(training_label, tuple(updated_at, snapshot_id)) AS training_label,
			argMax(train_eligible, tuple(updated_at, snapshot_id)) AS train_eligible
		FROM candidate_training_cohort_v1 FINAL
		WHERE snapshot_id IN (%s)
		GROUP BY source_product_id
	)
	SELECT
		count() AS total_rows,
		countIf(training_label = 'POSITIVE' AND train_eligible = 1) AS positive_rows,
		countIf(training_label = 'NEGATIVE' AND train_eligible = 1) AS negative_rows,
		countIf(training_label = 'UNRESOLVED' OR train_eligible = 0) AS unresolved_rows,
		uniqExactIf(tic_id, training_label = 'POSITIVE' AND train_eligible = 1) AS positive_targets,
		uniqExactIf(tic_id, training_label = 'NEGATIVE' AND train_eligible = 1) AS negative_targets
		FROM latest_sources
		FORMAT JSON`, strings.Join(quoted, ","))
	body, err := r.client.Query(ctx, query)
	if err != nil {
		return nil, err
	}
	var response struct {
		Data []struct {
			TotalRows       any `json:"total_rows"`
			PositiveRows    any `json:"positive_rows"`
			NegativeRows    any `json:"negative_rows"`
			UnresolvedRows  any `json:"unresolved_rows"`
			PositiveTargets any `json:"positive_targets"`
			NegativeTargets any `json:"negative_targets"`
		} `json:"data"`
	}
	if err := json.Unmarshal(body, &response); err != nil {
		return nil, fmt.Errorf("parse training readiness: %w", err)
	}
	readiness := newTrainingReadiness(snapshotIDs)
	if len(response.Data) == 0 {
		readiness.Blocker = "Gold snapshot has no indexed candidate rows"
		return readiness, nil
	}
	row := response.Data[0]
	readiness.TotalRows = toInt64(row.TotalRows)
	readiness.PositiveRows = toInt64(row.PositiveRows)
	readiness.NegativeRows = toInt64(row.NegativeRows)
	readiness.UnresolvedRows = toInt64(row.UnresolvedRows)
	readiness.PositiveTargets = toInt64(row.PositiveTargets)
	readiness.NegativeTargets = toInt64(row.NegativeTargets)
	applyTrainingReadinessPolicy(readiness)
	return readiness, nil
}

func (r *AnalyticsClickHouse) OverrideTrainingLabel(ctx context.Context, value entity.TrainingLabelOverride) error {
	escapedSnapshot := escapeSQL(value.SnapshotID)
	escapedSource := escapeSQL(value.SourceProductID)
	query := fmt.Sprintf("SELECT tic_id, sector, evidence_json FROM candidate_training_cohort_v1 FINAL WHERE snapshot_id = '%s' AND source_product_id = '%s' LIMIT 1 FORMAT JSON", escapedSnapshot, escapedSource)
	body, err := r.client.Query(ctx, query)
	if err != nil {
		return err
	}
	var response struct {
		Data []struct {
			TICID    any    `json:"tic_id"`
			Sector   int    `json:"sector"`
			Evidence string `json:"evidence_json"`
		} `json:"data"`
	}
	if err := json.Unmarshal(body, &response); err != nil {
		return fmt.Errorf("parse cohort review: %w", err)
	}
	if len(response.Data) == 0 {
		return repo.ErrNotFound
	}
	row := response.Data[0]
	eligible := 0
	if value.TrainingLabel != "UNRESOLVED" {
		eligible = 1
	}
	evidence := escapeSQL(row.Evidence)
	reason := escapeSQL(value.ReviewReason)
	insert := fmt.Sprintf("INSERT INTO candidate_training_cohort_v1 (snapshot_id, source_product_id, tic_id, sector, training_label, confidence, label_source, review_status, train_eligible, policy_version, evidence_json, review_reason, updated_at) VALUES ('%s','%s',%d,%d,'%s',%.6f,'HUMAN_REVIEW','REVIEWED',%d,'candidate-auto-label-v1','%s','%s',now64(3))", escapedSnapshot, escapedSource, toInt64(row.TICID), row.Sector, value.TrainingLabel, value.Confidence, eligible, evidence, reason)
	return r.client.Exec(ctx, insert)
}

func (r *AnalyticsClickHouse) ListTrainingReviews(ctx context.Context, limit int) ([]entity.TrainingReview, error) {
	query := fmt.Sprintf(`SELECT snapshot_id, source_product_id, tic_id, sector, training_label, review_status,
		ifNull(review_reason, '') AS review_reason, confidence, toString(updated_at) AS updated_at
		FROM candidate_training_cohort_v1 FINAL
		WHERE label_source = 'HUMAN_REVIEW'
		ORDER BY updated_at DESC
		LIMIT %d FORMAT JSON`, limit)
	body, err := r.client.Query(ctx, query)
	if err != nil {
		return nil, err
	}
	var response struct {
		Data []struct {
			SnapshotID      string  `json:"snapshot_id"`
			SourceProductID string  `json:"source_product_id"`
			TICID           any     `json:"tic_id"`
			Sector          int     `json:"sector"`
			TrainingLabel   string  `json:"training_label"`
			ReviewStatus    string  `json:"review_status"`
			ReviewReason    string  `json:"review_reason"`
			Confidence      float64 `json:"confidence"`
			UpdatedAt       string  `json:"updated_at"`
		} `json:"data"`
	}
	if err := json.Unmarshal(body, &response); err != nil {
		return nil, fmt.Errorf("parse training review history: %w", err)
	}
	items := make([]entity.TrainingReview, 0, len(response.Data))
	for _, row := range response.Data {
		items = append(items, entity.TrainingReview{
			SnapshotID: row.SnapshotID, SourceProductID: row.SourceProductID, TICID: toInt64(row.TICID),
			Sector: row.Sector, TrainingLabel: row.TrainingLabel, ReviewStatus: row.ReviewStatus,
			ReviewReason: row.ReviewReason, Confidence: row.Confidence, UpdatedAt: row.UpdatedAt,
		})
	}
	return items, nil
}

func (r *AnalyticsClickHouse) ListTrainingReviewQueue(ctx context.Context, snapshotIDs []string, page entity.PageRequest) (entity.Page[entity.TrainingReviewQueueItem], error) {
	quoted := make([]string, 0, len(snapshotIDs))
	for _, snapshotID := range snapshotIDs {
		quoted = append(quoted, "'"+escapeSQL(snapshotID)+"'")
	}
	query := fmt.Sprintf(`WITH latest_cohort AS (
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
		WHERE cohort.snapshot_id IN (%s)
		GROUP BY cohort.source_product_id
	), sector_baselines AS (
		SELECT sector, max(time_span) AS sector_baseline_days
		FROM candidate_features_current_v1
		WHERE snapshot_id IN (%s)
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
		WHERE gold_snapshot_id IN (%s)
		GROUP BY gold_snapshot_id, source_product_id
	)
	SELECT c.snapshot_id AS snapshot_id, c.source_product_id AS source_product_id,
		c.tic_id AS tic_id, c.sector AS sector,
		c.training_label AS training_label, c.label_source AS label_source,
		c.review_status AS review_status, c.review_reason AS review_reason,
		c.confidence AS confidence, c.policy_version AS policy_version,
		ifNull(f.n_points, 0) AS n_points,
		ifNull(f.time_span, 0) AS time_span_days,
		ifNull(sb.sector_baseline_days, 0) AS sector_baseline_days,
		if(sb.sector_baseline_days > 0,
			least(100.0, ifNull(f.time_span, 0) / sb.sector_baseline_days * 100.0),
			0.0) AS sector_coverage_percent,
		ifNull(f.max_gap, 0) * 24 AS largest_gap_hours,
		ifNull(f.median_cadence, 0) * 24 * 60 AS median_cadence_minutes,
		ifNull(f.flux_std, 0) * 1000000 AS flux_std_ppm,
		ifNull(f.flux_amplitude, 0) * 1000000 AS flux_amplitude_ppm,
		ifNull(f.median_flux_err, 0) * 1000000 AS median_flux_err_ppm,
		ifNull(f.bls_available, 0) AS bls_available,
		ifNull(f.bls_period, 0) AS bls_period_days,
		ifNull(f.bls_duration, 0) * 24 AS bls_duration_hours,
		ifNull(f.bls_transit_time, 0) AS bls_transit_time_btjd,
		ifNull(f.bls_depth, 0) * 1000000 AS bls_depth_ppm,
		ifNull(f.bls_power, 0) AS bls_power,
		ifNull(f.variability_peak_fraction, 0) AS variability_peak_fraction,
		ifNull(f.transit_evidence_available, 0) AS transit_evidence_available,
		ifNull(f.transit_deficit_sum, 0) AS transit_deficit_sum,
		ifNull(f.transit_deficit_center_offset_pixels, 0) AS centroid_offset_pixels,
		ifNull(f.toi_match_status, '') AS toi_match_status,
		ifNull(f.matched_toi_id, '') AS matched_toi_id,
		if(p.source_product_id = '', 0, 1) AS prediction_available,
		ifNull(p.candidate_score, 0) AS candidate_score,
		ifNull(p.decision_threshold, 0) AS decision_threshold,
		ifNull(p.above_threshold, 0) AS above_threshold,
		ifNull(p.model_id, '') AS model_id,
		ifNull(p.model_version, '') AS model_version,
		ifNull(p.runtime_package_id, '') AS runtime_package_id,
		ifNull(p.prediction_observed_at, '') AS predicted_at,
		count() OVER () AS total_count
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
	LIMIT %d OFFSET %d FORMAT JSON`, strings.Join(quoted, ","), strings.Join(quoted, ","), strings.Join(quoted, ","), page.Limit, page.Offset)
	body, err := r.client.Query(ctx, query)
	if err != nil {
		return entity.Page[entity.TrainingReviewQueueItem]{}, err
	}
	var response struct {
		Data []struct {
			SnapshotID               string  `json:"snapshot_id"`
			SourceProductID          string  `json:"source_product_id"`
			TICID                    any     `json:"tic_id"`
			Sector                   int     `json:"sector"`
			TrainingLabel            string  `json:"training_label"`
			LabelSource              string  `json:"label_source"`
			ReviewStatus             string  `json:"review_status"`
			ReviewReason             string  `json:"review_reason"`
			Confidence               float64 `json:"confidence"`
			PolicyVersion            string  `json:"policy_version"`
			NPoints                  any     `json:"n_points"`
			TimeSpanDays             float64 `json:"time_span_days"`
			SectorBaselineDays       float64 `json:"sector_baseline_days"`
			SectorCoveragePercent    float64 `json:"sector_coverage_percent"`
			LargestGapHours          float64 `json:"largest_gap_hours"`
			MedianCadenceMinutes     float64 `json:"median_cadence_minutes"`
			FluxStdPPM               float64 `json:"flux_std_ppm"`
			FluxAmplitudePPM         float64 `json:"flux_amplitude_ppm"`
			MedianFluxErrPPM         float64 `json:"median_flux_err_ppm"`
			BLSAvailable             any     `json:"bls_available"`
			BLSPeriodDays            float64 `json:"bls_period_days"`
			BLSDurationHours         float64 `json:"bls_duration_hours"`
			BLSTransitTimeBTJD       float64 `json:"bls_transit_time_btjd"`
			BLSDepthPPM              float64 `json:"bls_depth_ppm"`
			BLSPower                 float64 `json:"bls_power"`
			VariabilityPeakFraction  float64 `json:"variability_peak_fraction"`
			TransitEvidenceAvailable any     `json:"transit_evidence_available"`
			TransitDeficitSum        float64 `json:"transit_deficit_sum"`
			CentroidOffsetPixels     float64 `json:"centroid_offset_pixels"`
			TOIMatchStatus           string  `json:"toi_match_status"`
			MatchedTOIID             string  `json:"matched_toi_id"`
			PredictionAvailable      any     `json:"prediction_available"`
			CandidateScore           float64 `json:"candidate_score"`
			DecisionThreshold        float64 `json:"decision_threshold"`
			AboveThreshold           any     `json:"above_threshold"`
			ModelID                  string  `json:"model_id"`
			ModelVersion             string  `json:"model_version"`
			RuntimePackageID         string  `json:"runtime_package_id"`
			PredictedAt              string  `json:"predicted_at"`
			TotalCount               any     `json:"total_count"`
		} `json:"data"`
	}
	if err := json.Unmarshal(body, &response); err != nil {
		return entity.Page[entity.TrainingReviewQueueItem]{}, fmt.Errorf("parse training review queue: %w", err)
	}
	items := make([]entity.TrainingReviewQueueItem, 0, len(response.Data))
	total := 0
	for _, row := range response.Data {
		item := entity.TrainingReviewQueueItem{
			SnapshotID: row.SnapshotID, SourceProductID: row.SourceProductID,
			TICID: toInt64(row.TICID), Sector: row.Sector, TrainingLabel: row.TrainingLabel,
			LabelSource: row.LabelSource, ReviewStatus: row.ReviewStatus, ReviewReason: row.ReviewReason,
			Confidence: row.Confidence, PolicyVersion: row.PolicyVersion,
			Evidence: entity.TrainingReviewEvidence{
				NPoints: toInt64(row.NPoints), TimeSpanDays: row.TimeSpanDays,
				SectorBaselineDays: row.SectorBaselineDays, SectorCoveragePercent: row.SectorCoveragePercent,
				LargestGapHours: row.LargestGapHours, MedianCadenceMinutes: row.MedianCadenceMinutes,
				FluxStdPPM: row.FluxStdPPM, FluxAmplitudePPM: row.FluxAmplitudePPM, MedianFluxErrPPM: row.MedianFluxErrPPM,
				BLSAvailable: toBool(row.BLSAvailable), BLSPeriodDays: row.BLSPeriodDays,
				BLSDurationHours: row.BLSDurationHours, BLSTransitTimeBTJD: row.BLSTransitTimeBTJD,
				BLSDepthPPM: row.BLSDepthPPM, BLSPower: row.BLSPower, VariabilityPeakFraction: row.VariabilityPeakFraction,
				TransitEvidenceAvailable: toBool(row.TransitEvidenceAvailable), TransitDeficitSum: row.TransitDeficitSum,
				CentroidOffsetPixels: row.CentroidOffsetPixels,
				TOIMatchStatus:       row.TOIMatchStatus, MatchedTOIID: row.MatchedTOIID,
			},
		}
		if toBool(row.PredictionAvailable) {
			item.ModelSuggestion = &entity.TrainingModelSuggestion{
				CandidateScore: row.CandidateScore, Threshold: row.DecisionThreshold,
				AboveThreshold: toBool(row.AboveThreshold), ModelID: row.ModelID,
				ModelVersion: row.ModelVersion, RuntimePackageID: row.RuntimePackageID, PredictedAt: row.PredictedAt,
			}
		}
		items = append(items, item)
		total = int(toInt64(row.TotalCount))
	}
	return entity.Page[entity.TrainingReviewQueueItem]{
		Items: items, Count: total, Limit: page.Limit, Offset: page.Offset,
		HasMore: page.Offset+len(items) < total,
	}, nil
}
