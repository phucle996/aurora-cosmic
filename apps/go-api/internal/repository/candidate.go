package repository

import (
	"context"
	"fmt"
	"strings"
	"sync"
	"time"

	"go-api/infra/clickhouse"
	"go-api/internal/domain/entity"
	"go-api/internal/domain/repo"
)

type CandidateClickHouse struct {
	client                     *clickhouse.Client
	candidateReviewSchemaMu    sync.Mutex
	candidateReviewSchemaReady bool
}

func NewCandidateClickHouse(client *clickhouse.Client) repo.CandidateRepository {
	return &CandidateClickHouse{client: client}
}

func (r *CandidateClickHouse) ensureCandidateReviewSchema(ctx context.Context) error {
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

func (r *CandidateClickHouse) ListCandidates(ctx context.Context, query entity.CandidateQuery) (entity.Page[entity.Candidate], error) {
	rawQuery := `SELECT prediction_id, source_product_id, tic_id, sector, raw_logit, candidate_score,
		decision_threshold, above_threshold, model_version, registered_model_id, gold_snapshot_id,
		runtime_validation_id, runtime_package_id, toString(predicted_at) AS predicted_at
		FROM candidate_predictions`
	var conditions []string
	var args []any
	if query.Sector > 0 {
		conditions = append(conditions, "sector = ?")
		args = append(args, query.Sector)
	}
	if query.SnapshotID != "" {
		conditions = append(conditions, "gold_snapshot_id = ?")
		args = append(args, query.SnapshotID)
	}
	if len(conditions) > 0 {
		rawQuery += " WHERE " + strings.Join(conditions, " AND ")
	}
	rawQuery += " ORDER BY candidate_score DESC LIMIT ? OFFSET ?"
	args = append(args, query.Page.Limit, query.Page.Offset)

	var items []entity.Candidate
	if err := r.client.Select(ctx, &items, rawQuery, args...); err != nil {
		return entity.Page[entity.Candidate]{}, fmt.Errorf("select candidates: %w", err)
	}

	return entity.Page[entity.Candidate]{
		Items:   items,
		Count:   len(items),
		Limit:   query.Page.Limit,
		Offset:  query.Page.Offset,
		HasMore: len(items) == query.Page.Limit,
	}, nil
}

func (r *CandidateClickHouse) GetCandidate(ctx context.Context, predictionID string, snapshotID string) (*entity.CandidateDetail, error) {
	if err := r.ensureCandidateReviewSchema(ctx); err != nil {
		return nil, err
	}

	candQuery := `SELECT prediction_id, source_product_id, tic_id, sector, raw_logit, candidate_score,
		decision_threshold, above_threshold, model_version, registered_model_id, gold_snapshot_id,
		runtime_validation_id, runtime_package_id, toString(predicted_at) AS predicted_at
		FROM candidate_predictions
		WHERE prediction_id = ?`
	candArgs := []any{predictionID}
	if snapshotID != "" {
		candQuery += " AND gold_snapshot_id = ?"
		candArgs = append(candArgs, snapshotID)
	}
	candQuery += " LIMIT 1"

	var cands []entity.Candidate
	if err := r.client.Select(ctx, &cands, candQuery, candArgs...); err != nil {
		return nil, fmt.Errorf("select candidate: %w", err)
	}
	if len(cands) == 0 {
		return nil, fmt.Errorf("candidate %s not found", predictionID)
	}
	cand := cands[0]

	evidenceQuery := `SELECT
		ifNull(lineage_id, '') AS lineage_id,
		ifNull(lc_feature_version, '') AS feature_version,
		ifNull(lc_feature_fingerprint, '') AS feature_fingerprint,
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
		WHERE snapshot_id = ? AND source_product_id = ?
		LIMIT 1`

	var evidences []entity.CandidateEvidence
	_ = r.client.Select(ctx, &evidences, evidenceQuery, cand.SnapshotID, cand.SourceProductID)
	var evidence entity.CandidateEvidence
	if len(evidences) > 0 {
		evidence = evidences[0]
	}

	reviewQuery := `SELECT
		snapshot_id, prediction_id, source_product_id, tic_id, sector,
		scientific_decision, review_status, reviewer, review_note,
		toString(updated_at) AS updated_at
		FROM candidate_scientific_reviews_v1 FINAL
		WHERE snapshot_id = ? AND prediction_id = ?
		LIMIT 1`

	var reviews []entity.CandidateReview
	_ = r.client.Select(ctx, &reviews, reviewQuery, cand.SnapshotID, cand.PredictionID)
	review := entity.CandidateReview{
		SnapshotID:      cand.SnapshotID,
		PredictionID:    cand.PredictionID,
		SourceProductID: cand.SourceProductID,
		TICID:           cand.TICID,
		Sector:          cand.Sector,
		Decision:        "PENDING",
		ReviewStatus:    "PENDING",
	}
	if len(reviews) > 0 {
		review = reviews[0]
	}

	return &entity.CandidateDetail{
		Candidate: cand,
		Evidence:  evidence,
		Review:    review,
	}, nil
}

func (r *CandidateClickHouse) SaveCandidateReview(ctx context.Context, input entity.CandidateReviewInput) (*entity.CandidateReview, error) {
	if err := r.ensureCandidateReviewSchema(ctx); err != nil {
		return nil, err
	}

	type candRef struct {
		SourceProductID string `ch:"source_product_id"`
		TICID           int64  `ch:"tic_id"`
		Sector          int32  `ch:"sector"`
	}
	var refs []candRef
	query := "SELECT source_product_id, tic_id, sector FROM candidate_predictions WHERE prediction_id = ? AND gold_snapshot_id = ? LIMIT 1"
	if err := r.client.Select(ctx, &refs, query, input.PredictionID, input.SnapshotID); err != nil {
		return nil, err
	}
	if len(refs) == 0 {
		return nil, fmt.Errorf("candidate %s not found", input.PredictionID)
	}
	cand := refs[0]

	now := time.Now().UTC()
	insertQuery := `INSERT INTO candidate_scientific_reviews_v1
		(snapshot_id, prediction_id, source_product_id, tic_id, sector, scientific_decision, review_status, reviewer, review_note, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`

	if err := r.client.Exec(ctx, insertQuery,
		input.SnapshotID, input.PredictionID, cand.SourceProductID,
		cand.TICID, cand.Sector, input.Decision, input.ReviewStatus,
		input.Reviewer, input.Note, now,
	); err != nil {
		return nil, fmt.Errorf("insert candidate review: %w", err)
	}

	return &entity.CandidateReview{
		SnapshotID:      input.SnapshotID,
		PredictionID:    input.PredictionID,
		SourceProductID: cand.SourceProductID,
		TICID:           cand.TICID,
		Sector:          cand.Sector,
		Decision:        input.Decision,
		ReviewStatus:    input.ReviewStatus,
		Reviewer:        input.Reviewer,
		Note:            input.Note,
		UpdatedAt:       now.Format("2006-01-02 15:04:05.000"),
	}, nil
}
