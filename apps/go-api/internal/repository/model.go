package repository

import (
	"context"
	"fmt"

	"go-api/infra/clickhouse"
	"go-api/internal/domain/entity"
	"go-api/internal/domain/repo"
)

// Fixed scientific threshold policies for Candidate Model training preflight
const (
	preflightExperimentalMinimumPositiveTargets int64 = 60
	preflightExperimentalMinimumNegativeTargets int64 = 60
	preflightProductionCandidateMinPositive     int64 = 100
	preflightProductionCandidateMinNegative     int64 = 100
	preflightNegativeDiversityTarget            int64 = 300
)

// ModelClickHouse implements repo.ModelRepository for Model domain workflows.
type ModelClickHouse struct {
	client *clickhouse.Client
}

// NewModelClickHouse initializes a new ModelClickHouse repository instance.
func NewModelClickHouse(client *clickhouse.Client) repo.ModelRepository {
	return &ModelClickHouse{client: client}
}

// TrainingPreflight executes a CTE-first analytical query across Candidate Gold snapshots
// in ClickHouse to verify supervised label coverage, class balance, and independent target diversity.
func (r *ModelClickHouse) TrainingPreflight(ctx context.Context, snapshotIDs []string) (*entity.TrainingPreflight, error) {
	preflight := &entity.TrainingPreflight{
		SnapshotIDs:                        append([]string(nil), snapshotIDs...),
		Tier:                               "BLOCKED",
		ExperimentalMinimumPositiveTargets: preflightExperimentalMinimumPositiveTargets,
		ExperimentalMinimumNegativeTargets: preflightExperimentalMinimumNegativeTargets,
		ProductionCandidateMinimumPositiveTargets: preflightProductionCandidateMinPositive,
		ProductionCandidateMinimumNegativeTargets: preflightProductionCandidateMinNegative,
		NegativeDiversityTarget:                   preflightNegativeDiversityTarget,
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

	row := r.client.QueryRow(ctx, query, snapshotIDs)
	if err := row.Scan(
		&preflight.TotalRows,
		&preflight.PositiveRows,
		&preflight.NegativeRows,
		&preflight.UnresolvedRows,
		&preflight.PositiveTargets,
		&preflight.NegativeTargets,
	); err != nil {
		return preflight, nil
	}

	// Apply Preflight Policy Gates
	if preflight.TotalRows == 0 {
		return preflight, nil
	}

	if preflight.PositiveTargets < preflightExperimentalMinimumPositiveTargets || preflight.NegativeTargets < preflightExperimentalMinimumNegativeTargets {
		return preflight, nil
	}

	preflight.Tier = "EXPERIMENTAL"
	if preflight.PositiveTargets >= preflightProductionCandidateMinPositive && preflight.NegativeTargets >= preflightProductionCandidateMinNegative {
		preflight.Tier = "PRODUCTION_CANDIDATE"
	}

	return preflight, nil
}

// ListTrainingSnapshots retrieves the latest indexed Gold snapshots with candidate cohort counts from ClickHouse.
func (r *ModelClickHouse) ListTrainingSnapshots(ctx context.Context, limit int) ([]entity.ModelTrainingSnapshot, error) {
	query := `WITH cohort_counts AS (
		SELECT
			snapshot_id,
			toInt64(count()) AS candidate_rows
		FROM candidate_training_cohort_v1 FINAL
		GROUP BY snapshot_id
	)
	SELECT
		s.snapshot_id AS snapshot_id,
		s.manifest_key AS manifest_key,
		formatDateTime(s.indexed_at, '%Y-%m-%dT%H:%i:%sZ') AS last_modified,
		toInt64(ifNull(o.size_bytes, 0)) AS size_bytes,
		toInt64(ifNull(c.candidate_rows, 0)) AS candidate_count
	FROM aurora.gold_snapshots_v1 AS s
	LEFT JOIN cohort_counts AS c ON c.snapshot_id = s.snapshot_id
	LEFT JOIN aurora.lakehouse_objects AS o ON o.object_key = s.manifest_key
	WHERE s.index_status = 'READY'
	ORDER BY s.indexed_at DESC
	LIMIT ?`

	var items []entity.ModelTrainingSnapshot
	if err := r.client.Select(ctx, &items, query, limit); err != nil {
		return nil, fmt.Errorf("list training snapshots: %w", err)
	}
	if items == nil {
		items = []entity.ModelTrainingSnapshot{}
	}
	for i := range items {
		items[i].Key = items[i].ManifestKey
	}
	return items, nil
}
