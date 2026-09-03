package repository

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"go-api/internal/domain/entity"
)

func (r *AnalyticsClickHouse) ensureCandidateReviewSchema(ctx context.Context) error {
	r.candidateReviewSchemaMu.Lock()
	defer r.candidateReviewSchemaMu.Unlock()
	if r.candidateReviewSchemaReady {
		return nil
	}
	err := r.client.Exec(ctx, `CREATE TABLE IF NOT EXISTS candidate_scientific_reviews_v1 (
		snapshot_id String,
		prediction_id String,
		source_product_id String,
		tic_id Int64,
		sector Int32,
		scientific_decision LowCardinality(String),
		review_status LowCardinality(String),
		reviewer String,
		review_note String,
		updated_at DateTime64(3, 'UTC')
	) ENGINE = ReplacingMergeTree(updated_at)
	PARTITION BY snapshot_id
	ORDER BY (snapshot_id, prediction_id)`)
	if err == nil {
		r.candidateReviewSchemaReady = true
	}
	return err
}

func (r *AnalyticsClickHouse) ListCandidates(ctx context.Context, sector int, snapshotID string, page entity.PageRequest) (entity.Page[entity.Candidate], error) {
	query := "SELECT prediction_id, source_product_id, tic_id, sector, raw_logit, candidate_score, decision_threshold, above_threshold, model_version, registered_model_id, gold_snapshot_id, runtime_validation_id, runtime_package_id, predicted_at FROM candidate_predictions"
	conditions := make([]string, 0, 2)
	if sector > 0 {
		conditions = append(conditions, fmt.Sprintf("sector = %d", sector))
	}
	if snapshotID != "" {
		conditions = append(conditions, fmt.Sprintf("gold_snapshot_id = '%s'", escapeSQL(snapshotID)))
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
	if err := r.ensureCandidateReviewSchema(ctx); err != nil {
		return nil, err
	}
	whereClause := fmt.Sprintf("p.prediction_id = '%s'", escapeSQL(predictionID))
	if snapshotID != "" {
		whereClause += fmt.Sprintf(" AND p.gold_snapshot_id = '%s'", escapeSQL(snapshotID))
	}
	query := fmt.Sprintf(`SELECT
		p.prediction_id AS prediction_id,
		p.source_product_id AS source_product_id,
		p.tic_id AS tic_id,
		p.sector AS sector,
		p.raw_logit AS raw_logit,
		p.candidate_score AS candidate_score,
		p.decision_threshold AS decision_threshold,
		p.above_threshold AS above_threshold,
		p.model_version AS model_version,
		p.registered_model_id AS registered_model_id,
		p.gold_snapshot_id AS gold_snapshot_id,
		p.runtime_validation_id AS runtime_validation_id,
		p.runtime_package_id AS runtime_package_id,
		p.predicted_at AS predicted_at,
		ifNull(f.lineage_id, '') AS lineage_id, ifNull(f.lc_feature_version, '') AS lc_feature_version, ifNull(f.lc_feature_fingerprint, '') AS lc_feature_fingerprint,
		ifNull(f.n_points, 0) AS n_points, ifNull(f.time_span, 0) AS time_span, ifNull(f.median_cadence, 0) AS median_cadence, ifNull(f.max_gap, 0) AS max_gap,
		ifNull(f.flux_mean, 0) AS flux_mean, ifNull(f.flux_std, 0) AS flux_std, ifNull(f.flux_amplitude, 0) AS flux_amplitude, ifNull(f.flux_rms, 0) AS flux_rms, ifNull(f.median_flux_err, 0) AS median_flux_err,
		ifNull(f.bls_available, 0) AS bls_available, ifNull(f.bls_period, 0) AS bls_period, ifNull(f.bls_duration, 0) AS bls_duration, ifNull(f.bls_transit_time, 0) AS bls_transit_time, ifNull(f.bls_depth, 0) AS bls_depth, ifNull(f.bls_power, 0) AS bls_power,
		ifNull(f.pixel_mad_median, 0) AS pixel_mad_median, ifNull(f.variability_peak_fraction, 0) AS variability_peak_fraction,
		ifNull(f.transit_evidence_available, 0) AS transit_evidence_available, ifNull(f.transit_deficit_sum, 0) AS transit_deficit_sum, ifNull(f.transit_deficit_center_offset_pixels, 0) AS transit_deficit_center_offset_pixels,
		ifNull(f.tic_available, 0) AS tic_available, ifNull(f.tmag, 0) AS tmag, ifNull(f.teff, 0) AS teff, ifNull(f.stellar_radius, 0) AS stellar_radius, ifNull(f.stellar_mass, 0) AS stellar_mass, ifNull(f.logg, 0) AS logg,
		ifNull(f.matched_toi_id, '') AS matched_toi_id, ifNull(f.toi_match_status, '') AS toi_match_status,
		if(r.prediction_id = '', 'PENDING', r.scientific_decision) AS scientific_decision,
		if(r.prediction_id = '', 'PENDING', r.review_status) AS review_status,
		if(r.prediction_id = '', '', r.reviewer) AS reviewer,
		if(r.prediction_id = '', '', r.review_note) AS review_note,
		if(r.prediction_id = '', '', toString(r.updated_at)) AS review_updated_at
	FROM candidate_predictions AS p
	LEFT JOIN candidate_features_current_v1 AS f
		ON f.snapshot_id = p.gold_snapshot_id AND f.source_product_id = p.source_product_id
	LEFT JOIN candidate_scientific_reviews_v1 AS r FINAL
		ON r.snapshot_id = p.gold_snapshot_id AND r.prediction_id = p.prediction_id
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
			ScientificDecision         string  `json:"scientific_decision"`
			ReviewStatus               string  `json:"review_status"`
			Reviewer                   string  `json:"reviewer"`
			ReviewNote                 string  `json:"review_note"`
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
			SnapshotID: row.SnapshotID, PredictionID: row.PredictionID,
			SourceProductID: row.SourceProductID, TICID: toInt64(row.TICID), Sector: row.Sector,
			Decision: row.ScientificDecision, ReviewStatus: row.ReviewStatus,
			Reviewer: row.Reviewer, Note: row.ReviewNote, UpdatedAt: row.ReviewUpdatedAt,
		},
	}, nil
}

func (r *AnalyticsClickHouse) SaveCandidateReview(ctx context.Context, review entity.CandidateReview) error {
	if err := r.ensureCandidateReviewSchema(ctx); err != nil {
		return err
	}
	query := fmt.Sprintf(`INSERT INTO candidate_scientific_reviews_v1
		(snapshot_id, prediction_id, source_product_id, tic_id, sector, scientific_decision, review_status, reviewer, review_note, updated_at)
		VALUES ('%s','%s','%s',%d,%d,'%s','%s','%s','%s',now64(3))`,
		escapeSQL(review.SnapshotID), escapeSQL(review.PredictionID), escapeSQL(review.SourceProductID),
		review.TICID, review.Sector, escapeSQL(review.Decision), escapeSQL(review.ReviewStatus),
		escapeSQL(review.Reviewer), escapeSQL(review.Note))
	return r.client.Exec(ctx, query)
}
