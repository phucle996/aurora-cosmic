package repository

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"go-api/infra/clickhouse"
	"go-api/internal/domain/entity"
	"go-api/internal/domain/repo"
	"strconv"
)

type AnalyticsClickHouse struct{ client *clickhouse.Client }

// A first scientific candidate model needs enough independent targets to
// split train/validation/test without one TOI determining the entire model.
const (
	minimumScientificPositiveTargets = 100
	minimumScientificNegativeTargets = 300
)

func toInt64(v any) int64 {
	switch val := v.(type) {
	case float64:
		return int64(val)
	case string:
		n, _ := strconv.ParseInt(val, 10, 64)
		return n
	default:
		return 0
	}
}

func toBool(v any) bool {
	switch val := v.(type) {
	case bool:
		return val
	case float64:
		return val != 0
	case string:
		return val == "true" || val == "1"
	default:
		return false
	}
}

func NewAnalyticsClickHouse(client *clickhouse.Client) *AnalyticsClickHouse {
	return &AnalyticsClickHouse{client: client}
}

func (r *AnalyticsClickHouse) Ping(ctx context.Context) error { return r.client.Ping(ctx) }

func (r *AnalyticsClickHouse) TrainingReadiness(ctx context.Context, snapshotIDs []string) (*entity.TrainingReadiness, error) {
	if len(snapshotIDs) == 0 {
		return nil, fmt.Errorf("at least one gold snapshot id is required")
	}
	quoted := make([]string, 0, len(snapshotIDs))
	for _, snapshotID := range snapshotIDs {
		quoted = append(quoted, "'"+strings.ReplaceAll(snapshotID, "'", "''")+"'")
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
	readiness := &entity.TrainingReadiness{SnapshotIDs: append([]string(nil), snapshotIDs...), PolicyVersion: "candidate-auto-label-v1"}
	if len(snapshotIDs) == 1 {
		readiness.SnapshotID = snapshotIDs[0]
	}
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
	if readiness.TotalRows == 0 {
		readiness.Blocker = "Gold snapshot has no projected training cohort"
	} else if readiness.PositiveTargets < minimumScientificPositiveTargets || readiness.NegativeTargets < minimumScientificNegativeTargets {
		readiness.Blocker = fmt.Sprintf("Scientific cohort needs at least %d independent POSITIVE and %d hard-NEGATIVE TIC targets before supervised training", minimumScientificPositiveTargets, minimumScientificNegativeTargets)
	} else {
		readiness.Ready = true
	}
	return readiness, nil
}

func (r *AnalyticsClickHouse) OverrideTrainingLabel(ctx context.Context, value entity.TrainingLabelOverride) error {
	escapedSnapshot := strings.ReplaceAll(value.SnapshotID, "'", "''")
	escapedSource := strings.ReplaceAll(value.SourceProductID, "'", "''")
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
	evidence := strings.ReplaceAll(row.Evidence, "'", "''")
	insert := fmt.Sprintf("INSERT INTO candidate_training_cohort_v1 (snapshot_id, source_product_id, tic_id, sector, training_label, confidence, label_source, review_status, train_eligible, policy_version, evidence_json, updated_at) VALUES ('%s','%s',%d,%d,'%s',1.0,'HUMAN_REVIEW','REVIEWED',%d,'candidate-auto-label-v1','%s',now64(3))", escapedSnapshot, escapedSource, toInt64(row.TICID), row.Sector, value.TrainingLabel, eligible, evidence)
	return r.client.Exec(ctx, insert)
}

func (r *AnalyticsClickHouse) ListTrainingReviews(ctx context.Context, limit int) ([]entity.TrainingReview, error) {
	query := fmt.Sprintf(`SELECT snapshot_id, source_product_id, tic_id, sector, training_label, review_status, toString(updated_at) AS updated_at
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
			SnapshotID      string `json:"snapshot_id"`
			SourceProductID string `json:"source_product_id"`
			TICID           any    `json:"tic_id"`
			Sector          int    `json:"sector"`
			TrainingLabel   string `json:"training_label"`
			ReviewStatus    string `json:"review_status"`
			UpdatedAt       string `json:"updated_at"`
		} `json:"data"`
	}
	if err := json.Unmarshal(body, &response); err != nil {
		return nil, fmt.Errorf("parse training review history: %w", err)
	}
	items := make([]entity.TrainingReview, 0, len(response.Data))
	for _, row := range response.Data {
		items = append(items, entity.TrainingReview{
			SnapshotID: row.SnapshotID, SourceProductID: row.SourceProductID, TICID: toInt64(row.TICID),
			Sector: row.Sector, TrainingLabel: row.TrainingLabel, ReviewStatus: row.ReviewStatus, UpdatedAt: row.UpdatedAt,
		})
	}
	return items, nil
}

func (r *AnalyticsClickHouse) ListCandidates(ctx context.Context, sector int, snapshotID string, page entity.PageRequest) (entity.Page[entity.Candidate], error) {
	query := "SELECT prediction_id, source_product_id, tic_id, sector, raw_logit, candidate_score, decision_threshold, above_threshold, model_version, registered_model_id, gold_snapshot_id, runtime_validation_id, runtime_package_id, predicted_at FROM candidate_predictions"
	conditions := make([]string, 0, 2)
	if sector > 0 {
		conditions = append(conditions, fmt.Sprintf("sector = %d", sector))
	}
	if snapshotID != "" {
		conditions = append(conditions, fmt.Sprintf("gold_snapshot_id = '%s'", strings.ReplaceAll(snapshotID, "'", "''")))
	}
	if len(conditions) > 0 {
		query += " WHERE " + strings.Join(conditions, " AND ")
	}
	query += fmt.Sprintf(" ORDER BY candidate_score DESC LIMIT %d OFFSET %d FORMAT JSON", page.Limit, page.Offset)

	body, err := r.client.Query(ctx, query)
	if err != nil {
		return entity.Page[entity.Candidate]{}, err
	}
	var response struct {
		Data []struct {
			PredictionID    string  `json:"prediction_id"`
			SourceProductID string  `json:"source_product_id"`
			TICID           any     `json:"tic_id"`
			Sector          int     `json:"sector"`
			RawLogit        float64 `json:"raw_logit"`
			CandidateScore  float64 `json:"candidate_score"`
			Threshold       float64 `json:"decision_threshold"`
			AboveThreshold  any     `json:"above_threshold"`
			ModelVersion    string  `json:"model_version"`
			RegisteredModel string  `json:"registered_model_id"`
			SnapshotID      string  `json:"gold_snapshot_id"`
			ValidationID    string  `json:"runtime_validation_id"`
			RuntimePkgID    string  `json:"runtime_package_id"`
			PredictedAt     string  `json:"predicted_at"`
		} `json:"data"`
	}
	if err := json.Unmarshal(body, &response); err != nil {
		return entity.Page[entity.Candidate]{}, fmt.Errorf("parse candidates: %w", err)
	}

	items := make([]entity.Candidate, len(response.Data))
	for i, row := range response.Data {
		items[i] = entity.Candidate{
			PredictionID:    row.PredictionID,
			SourceProductID: row.SourceProductID,
			TICID:           toInt64(row.TICID),
			Sector:          row.Sector,
			RawLogit:        row.RawLogit,
			CandidateScore:  row.CandidateScore,
			Threshold:       row.Threshold,
			AboveThreshold:  toBool(row.AboveThreshold),
			ModelVersion:    row.ModelVersion,
			RegisteredModel: row.RegisteredModel,
			SnapshotID:      row.SnapshotID,
			ValidationID:    row.ValidationID,
			RuntimePkgID:    row.RuntimePkgID,
			PredictedAt:     row.PredictedAt,
		}
	}
	return entity.Page[entity.Candidate]{
		Items:   items,
		Count:   len(items),
		Limit:   page.Limit,
		Offset:  page.Offset,
		HasMore: len(items) == page.Limit,
	}, nil
}

func (r *AnalyticsClickHouse) GetCandidate(ctx context.Context, predictionID string, snapshotID string) (*entity.CandidateDetail, error) {
	whereClause := fmt.Sprintf("p.prediction_id = '%s'", strings.ReplaceAll(predictionID, "'", "''"))
	if snapshotID != "" {
		whereClause += fmt.Sprintf(" AND p.gold_snapshot_id = '%s'", strings.ReplaceAll(snapshotID, "'", "''"))
	}
	query := fmt.Sprintf(`SELECT
		p.prediction_id, p.source_product_id, p.tic_id, p.sector, p.raw_logit,
		p.candidate_score, p.decision_threshold, p.above_threshold, p.model_version,
		p.registered_model_id, p.gold_snapshot_id, p.runtime_validation_id,
		p.runtime_package_id, p.predicted_at,
		ifNull(f.lineage_id, '') AS lineage_id, ifNull(f.lc_feature_version, '') AS lc_feature_version, ifNull(f.lc_feature_fingerprint, '') AS lc_feature_fingerprint,
		ifNull(f.n_points, 0) AS n_points, ifNull(f.time_span, 0) AS time_span, ifNull(f.median_cadence, 0) AS median_cadence, ifNull(f.max_gap, 0) AS max_gap,
		ifNull(f.flux_mean, 0) AS flux_mean, ifNull(f.flux_std, 0) AS flux_std, ifNull(f.flux_amplitude, 0) AS flux_amplitude, ifNull(f.flux_rms, 0) AS flux_rms, ifNull(f.median_flux_err, 0) AS median_flux_err,
		ifNull(f.bls_available, 0) AS bls_available, ifNull(f.bls_period, 0) AS bls_period, ifNull(f.bls_duration, 0) AS bls_duration, ifNull(f.bls_transit_time, 0) AS bls_transit_time, ifNull(f.bls_depth, 0) AS bls_depth, ifNull(f.bls_power, 0) AS bls_power,
		ifNull(f.pixel_mad_median, 0) AS pixel_mad_median, ifNull(f.variability_peak_fraction, 0) AS variability_peak_fraction,
		ifNull(f.transit_evidence_available, 0) AS transit_evidence_available, ifNull(f.transit_deficit_sum, 0) AS transit_deficit_sum, ifNull(f.transit_deficit_center_offset_pixels, 0) AS transit_deficit_center_offset_pixels,
		ifNull(f.tic_available, 0) AS tic_available, ifNull(f.tmag, 0) AS tmag, ifNull(f.teff, 0) AS teff, ifNull(f.stellar_radius, 0) AS stellar_radius, ifNull(f.stellar_mass, 0) AS stellar_mass, ifNull(f.logg, 0) AS logg,
		ifNull(f.matched_toi_id, '') AS matched_toi_id, ifNull(f.toi_match_status, '') AS toi_match_status,
		if(r.source_product_id = '', 'UNRESOLVED', r.training_label) AS training_label,
		if(r.source_product_id = '', '', r.label_source) AS label_source,
		if(r.source_product_id = '', 'PENDING', r.review_status) AS review_status,
		if(r.source_product_id = '', 0, r.train_eligible) AS train_eligible,
		if(r.source_product_id = '', '', toString(r.updated_at)) AS review_updated_at
	FROM candidate_predictions AS p
	LEFT JOIN candidate_features_current_v1 AS f
		ON f.snapshot_id = p.gold_snapshot_id AND f.source_product_id = p.source_product_id
	LEFT JOIN candidate_training_cohort_v1 AS r FINAL
		ON r.snapshot_id = p.gold_snapshot_id AND r.source_product_id = p.source_product_id
	WHERE %s
	LIMIT 1 FORMAT JSON`, whereClause)

	body, err := r.client.Query(ctx, query)
	if err != nil {
		return nil, err
	}
	var response struct {
		Data []struct {
			PredictionID               string  `json:"prediction_id"`
			SourceProductID            string  `json:"source_product_id"`
			TICID                      any     `json:"tic_id"`
			Sector                     int     `json:"sector"`
			RawLogit                   float64 `json:"raw_logit"`
			CandidateScore             float64 `json:"candidate_score"`
			Threshold                  float64 `json:"decision_threshold"`
			AboveThreshold             any     `json:"above_threshold"`
			ModelVersion               string  `json:"model_version"`
			RegisteredModel            string  `json:"registered_model_id"`
			SnapshotID                 string  `json:"gold_snapshot_id"`
			ValidationID               string  `json:"runtime_validation_id"`
			RuntimePkgID               string  `json:"runtime_package_id"`
			PredictedAt                string  `json:"predicted_at"`
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
			TrainingLabel              string  `json:"training_label"`
			LabelSource                string  `json:"label_source"`
			ReviewStatus               string  `json:"review_status"`
			TrainEligible              any     `json:"train_eligible"`
			ReviewUpdatedAt            string  `json:"review_updated_at"`
		} `json:"data"`
	}
	if err := json.Unmarshal(body, &response); err != nil {
		return nil, fmt.Errorf("parse candidate detail: %w", err)
	}
	if len(response.Data) == 0 {
		return nil, fmt.Errorf("candidate %s not found", predictionID)
	}
	row := response.Data[0]
	return &entity.CandidateDetail{
		Candidate: entity.Candidate{
			PredictionID: row.PredictionID, SourceProductID: row.SourceProductID, TICID: toInt64(row.TICID), Sector: row.Sector,
			RawLogit: row.RawLogit, CandidateScore: row.CandidateScore, Threshold: row.Threshold, AboveThreshold: toBool(row.AboveThreshold),
			ModelVersion: row.ModelVersion, RegisteredModel: row.RegisteredModel, SnapshotID: row.SnapshotID,
			ValidationID: row.ValidationID, RuntimePkgID: row.RuntimePkgID, PredictedAt: row.PredictedAt,
		},
		Evidence: entity.CandidateEvidence{
			LineageID: row.LineageID, FeatureVersion: row.FeatureVersion, FeatureFingerprint: row.FeatureFingerprint,
			NPoints: toInt64(row.NPoints), TimeSpan: row.TimeSpan, MedianCadence: row.MedianCadence, MaxGap: row.MaxGap,
			FluxMean: row.FluxMean, FluxStd: row.FluxStd, FluxAmplitude: row.FluxAmplitude, FluxRMS: row.FluxRMS, MedianFluxErr: row.MedianFluxErr,
			BLSAvailable: row.BLSAvailable == 1, BLSPeriod: row.BLSPeriod, BLSDuration: row.BLSDuration, BLSTransitTime: row.BLSTransitTime, BLSDepth: row.BLSDepth, BLSPower: row.BLSPower,
			PixelMADMedian: row.PixelMADMedian, VariabilityPeakFraction: row.VariabilityPeakFraction,
			TransitEvidenceAvailable: row.TransitEvidenceAvailable == 1, TransitDeficitSum: row.TransitDeficitSum, TransitDeficitCenterOffset: row.TransitDeficitCenterOffset,
			TICAvailable: row.TICAvailable == 1, TMag: row.TMag, Teff: row.Teff, StellarRadius: row.StellarRadius, StellarMass: row.StellarMass, LogG: row.LogG,
			MatchedTOIID: row.MatchedTOIID, TOIMatchStatus: row.TOIMatchStatus,
		},
		Review: entity.CandidateReview{
			TrainingLabel: row.TrainingLabel, LabelSource: row.LabelSource,
			ReviewStatus: row.ReviewStatus, TrainEligible: toBool(row.TrainEligible), UpdatedAt: row.ReviewUpdatedAt,
		},
	}, nil
}

func (r *AnalyticsClickHouse) ListAnomalies(ctx context.Context, sector int, snapshotID string, flaggedOnly bool, page entity.PageRequest) (entity.Page[entity.Anomaly], error) {
	query := "SELECT prediction_id, source_product_id, tic_id, sector, reconstruction_mse, decision_threshold, above_threshold, model_version, registered_model_id, gold_snapshot_id, runtime_validation_id, runtime_package_id, predicted_at FROM anomaly_predictions"
	conditions := make([]string, 0, 3)
	if sector > 0 {
		conditions = append(conditions, fmt.Sprintf("sector = %d", sector))
	}
	if snapshotID != "" {
		conditions = append(conditions, fmt.Sprintf("gold_snapshot_id = '%s'", strings.ReplaceAll(snapshotID, "'", "''")))
	}
	if flaggedOnly {
		conditions = append(conditions, "above_threshold = 1")
	}
	if len(conditions) > 0 {
		query += " WHERE " + strings.Join(conditions, " AND ")
	}
	query += fmt.Sprintf(" ORDER BY reconstruction_mse DESC LIMIT %d OFFSET %d FORMAT JSON", page.Limit, page.Offset)

	body, err := r.client.Query(ctx, query)
	if err != nil {
		return entity.Page[entity.Anomaly]{}, err
	}
	var response struct {
		Data []struct {
			PredictionID      string  `json:"prediction_id"`
			SourceProductID   string  `json:"source_product_id"`
			TICID             any     `json:"tic_id"`
			Sector            int     `json:"sector"`
			ReconstructionMSE float64 `json:"reconstruction_mse"`
			Threshold         float64 `json:"decision_threshold"`
			AboveThreshold    any     `json:"above_threshold"`
			ModelVersion      string  `json:"model_version"`
			RegisteredModel   string  `json:"registered_model_id"`
			SnapshotID        string  `json:"gold_snapshot_id"`
			ValidationID      string  `json:"runtime_validation_id"`
			RuntimePkgID      string  `json:"runtime_package_id"`
			PredictedAt       string  `json:"predicted_at"`
		} `json:"data"`
	}
	if err := json.Unmarshal(body, &response); err != nil {
		return entity.Page[entity.Anomaly]{}, fmt.Errorf("parse anomalies: %w", err)
	}

	items := make([]entity.Anomaly, len(response.Data))
	for i, row := range response.Data {
		items[i] = entity.Anomaly{
			PredictionID:      row.PredictionID,
			SourceProductID:   row.SourceProductID,
			TICID:             toInt64(row.TICID),
			Sector:            row.Sector,
			ReconstructionMSE: row.ReconstructionMSE,
			Threshold:         row.Threshold,
			AboveThreshold:    toBool(row.AboveThreshold),
			ModelVersion:      row.ModelVersion,
			RegisteredModel:   row.RegisteredModel,
			SnapshotID:        row.SnapshotID,
			ValidationID:      row.ValidationID,
			RuntimePkgID:      row.RuntimePkgID,
			PredictedAt:       row.PredictedAt,
		}
	}
	return entity.Page[entity.Anomaly]{
		Items:   items,
		Count:   len(items),
		Limit:   page.Limit,
		Offset:  page.Offset,
		HasMore: len(items) == page.Limit,
	}, nil
}

func (r *AnalyticsClickHouse) GetAnomaly(ctx context.Context, predictionID string, snapshotID string) (*entity.Anomaly, error) {
	query := fmt.Sprintf("SELECT prediction_id, source_product_id, tic_id, sector, reconstruction_mse, decision_threshold, above_threshold, model_version, registered_model_id, gold_snapshot_id, runtime_validation_id, runtime_package_id, predicted_at FROM anomaly_predictions WHERE prediction_id = '%s' AND gold_snapshot_id = '%s' LIMIT 1 FORMAT JSON", strings.ReplaceAll(predictionID, "'", "''"), strings.ReplaceAll(snapshotID, "'", "''"))
	body, err := r.client.Query(ctx, query)
	if err != nil {
		return nil, err
	}
	var response struct {
		Data []struct {
			PredictionID      string  `json:"prediction_id"`
			SourceProductID   string  `json:"source_product_id"`
			TICID             any     `json:"tic_id"`
			Sector            int     `json:"sector"`
			ReconstructionMSE float64 `json:"reconstruction_mse"`
			Threshold         float64 `json:"decision_threshold"`
			AboveThreshold    any     `json:"above_threshold"`
			ModelVersion      string  `json:"model_version"`
			RegisteredModel   string  `json:"registered_model_id"`
			SnapshotID        string  `json:"gold_snapshot_id"`
			ValidationID      string  `json:"runtime_validation_id"`
			RuntimePkgID      string  `json:"runtime_package_id"`
			PredictedAt       string  `json:"predicted_at"`
		} `json:"data"`
	}
	if err := json.Unmarshal(body, &response); err != nil {
		return nil, fmt.Errorf("parse anomaly detail: %w", err)
	}
	if len(response.Data) == 0 {
		return nil, fmt.Errorf("%w: anomaly prediction %s", repo.ErrNotFound, predictionID)
	}
	row := response.Data[0]
	return &entity.Anomaly{
		PredictionID: row.PredictionID, SourceProductID: row.SourceProductID, TICID: toInt64(row.TICID), Sector: row.Sector,
		ReconstructionMSE: row.ReconstructionMSE, Threshold: row.Threshold, AboveThreshold: toBool(row.AboveThreshold),
		ModelVersion: row.ModelVersion, RegisteredModel: row.RegisteredModel, SnapshotID: row.SnapshotID,
		ValidationID: row.ValidationID, RuntimePkgID: row.RuntimePkgID, PredictedAt: row.PredictedAt,
	}, nil
}

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
		escapedSnapshotID := strings.ReplaceAll(snapshotID, "'", "''")
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
		conditions = append(conditions, fmt.Sprintf("multiIf(ap.anomaly_prediction_id != '' OR cp.candidate_prediction_id != '', 'scored', if(lc.lightcurve_points > 0, lc.lightcurve_points, gf.gold_points) > 0, 'ingested', 'discovered') = '%s'", strings.ReplaceAll(filter.PipelineStatus, "'", "''")))
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
	escapedSnapshotID := strings.ReplaceAll(target.GoldSnapshotID, "'", "''")
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
