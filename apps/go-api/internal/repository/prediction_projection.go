package repository

import (
	"context"
	"fmt"
	"time"

	"go-api/infra/clickhouse"
	"go-api/internal/domain/entity"
)

type PredictionProjectionClickHouse struct {
	client *clickhouse.Client
}

func NewPredictionProjectionClickHouse(client *clickhouse.Client) *PredictionProjectionClickHouse {
	return &PredictionProjectionClickHouse{client: client}
}

func predictionTable(task string) (string, error) {
	switch task {
	case "candidate_vetting":
		return "candidate_predictions", nil
	case "astronomical_anomaly_detection":
		return "anomaly_predictions", nil
	default:
		return "", fmt.Errorf("unsupported prediction task %q", task)
	}
}

func (r *PredictionProjectionClickHouse) ExistingPredictionIDs(ctx context.Context, task string, ids []string) (map[string]struct{}, error) {
	existing := make(map[string]struct{})
	if len(ids) == 0 {
		return existing, nil
	}
	table, err := predictionTable(task)
	if err != nil {
		return nil, err
	}
	var existingIDs []string
	query := fmt.Sprintf("SELECT prediction_id FROM %s WHERE prediction_id IN (?)", table)
	if err := r.client.Select(ctx, &existingIDs, query, ids); err != nil {
		return nil, fmt.Errorf("select existing prediction IDs: %w", err)
	}
	for _, id := range existingIDs {
		existing[id] = struct{}{}
	}
	return existing, nil
}

func (r *PredictionProjectionClickHouse) InsertCandidatePredictions(ctx context.Context, rows []entity.CandidatePredictionProjection) error {
	if len(rows) == 0 {
		return nil
	}
	batch, err := r.client.PrepareBatch(ctx, `INSERT INTO candidate_predictions (
		prediction_id, source_product_id, tic_id, sector, raw_logit,
		candidate_score, decision_threshold, above_threshold, model_version,
		registered_model_id, gold_snapshot_id, runtime_validation_id,
		runtime_package_id, predicted_at
	)`)
	if err != nil {
		return fmt.Errorf("prepare candidate_predictions batch: %w", err)
	}
	for _, row := range rows {
		predictedAt, _ := time.Parse("2006-01-02 15:04:05", row.PredictedAt)
		if err := batch.Append(
			row.PredictionID,
			row.SourceProductID,
			row.TICID,
			int32(row.Sector),
			row.RawLogit,
			row.CandidateScore,
			row.DecisionThreshold,
			row.AboveThreshold,
			row.ModelVersion,
			row.RegisteredModelID,
			row.GoldSnapshotID,
			row.RuntimeValidation,
			row.RuntimePackageID,
			predictedAt,
		); err != nil {
			return fmt.Errorf("append to candidate_predictions batch: %w", err)
		}
	}
	if err := batch.Send(); err != nil {
		return fmt.Errorf("send candidate_predictions batch: %w", err)
	}
	return nil
}

func (r *PredictionProjectionClickHouse) InsertAnomalyPredictions(ctx context.Context, rows []entity.AnomalyPredictionProjection) error {
	if len(rows) == 0 {
		return nil
	}
	batch, err := r.client.PrepareBatch(ctx, `INSERT INTO anomaly_predictions (
		prediction_id, source_product_id, tic_id, sector, reconstruction_mse,
		decision_threshold, above_threshold, model_version, registered_model_id,
		gold_snapshot_id, runtime_validation_id, runtime_package_id, predicted_at
	)`)
	if err != nil {
		return fmt.Errorf("prepare anomaly_predictions batch: %w", err)
	}
	for _, row := range rows {
		predictedAt, _ := time.Parse("2006-01-02 15:04:05", row.PredictedAt)
		if err := batch.Append(
			row.PredictionID,
			row.SourceProductID,
			row.TICID,
			int32(row.Sector),
			row.ReconstructionMSE,
			row.DecisionThreshold,
			row.AboveThreshold,
			row.ModelVersion,
			row.RegisteredModelID,
			row.GoldSnapshotID,
			row.RuntimeValidation,
			row.RuntimePackageID,
			predictedAt,
		); err != nil {
			return fmt.Errorf("append to anomaly_predictions batch: %w", err)
		}
	}
	if err := batch.Send(); err != nil {
		return fmt.Errorf("send anomaly_predictions batch: %w", err)
	}
	return nil
}
