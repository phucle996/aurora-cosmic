package repository

import (
	"context"
	"fmt"
	"strings"

	"go-api/infra/clickhouse"
	"go-api/internal/domain/entity"
	"go-api/internal/domain/repo"
)

type AnomalyClickHouse struct {
	client *clickhouse.Client
}

func NewAnomalyClickHouse(client *clickhouse.Client) repo.AnomalyRepository {
	return &AnomalyClickHouse{client: client}
}

func (r *AnomalyClickHouse) ListAnomalies(ctx context.Context, sector int, snapshotID string, flaggedOnly bool, page entity.PageRequest) (entity.Page[entity.Anomaly], error) {
	rawQuery := `SELECT prediction_id, source_product_id, tic_id, sector, reconstruction_mse,
		decision_threshold, above_threshold, model_version, registered_model_id, gold_snapshot_id,
		runtime_validation_id, runtime_package_id, toString(predicted_at) AS predicted_at
		FROM anomaly_predictions`
	var conditions []string
	var args []any
	if sector > 0 {
		conditions = append(conditions, "sector = ?")
		args = append(args, sector)
	}
	if snapshotID != "" {
		conditions = append(conditions, "gold_snapshot_id = ?")
		args = append(args, snapshotID)
	}
	if flaggedOnly {
		conditions = append(conditions, "above_threshold = 1")
	}
	if len(conditions) > 0 {
		rawQuery += " WHERE " + strings.Join(conditions, " AND ")
	}
	rawQuery += " ORDER BY reconstruction_mse DESC LIMIT ? OFFSET ?"
	args = append(args, page.Limit, page.Offset)

	var items []entity.Anomaly
	if err := r.client.Select(ctx, &items, rawQuery, args...); err != nil {
		return entity.Page[entity.Anomaly]{}, err
	}

	return entity.Page[entity.Anomaly]{
		Items:   items,
		Count:   len(items),
		Limit:   page.Limit,
		Offset:  page.Offset,
		HasMore: len(items) == page.Limit,
	}, nil
}

func (r *AnomalyClickHouse) GetAnomaly(ctx context.Context, predictionID string, snapshotID string) (*entity.Anomaly, error) {
	query := `SELECT prediction_id, source_product_id, tic_id, sector, reconstruction_mse,
		decision_threshold, above_threshold, model_version, registered_model_id, gold_snapshot_id,
		runtime_validation_id, runtime_package_id, toString(predicted_at) AS predicted_at
		FROM anomaly_predictions WHERE prediction_id = ? AND gold_snapshot_id = ? LIMIT 1`

	var anomalies []entity.Anomaly
	if err := r.client.Select(ctx, &anomalies, query, predictionID, snapshotID); err != nil {
		return nil, err
	}
	if len(anomalies) == 0 {
		return nil, fmt.Errorf("%w: anomaly prediction %s", repo.ErrNotFound, predictionID)
	}
	return &anomalies[0], nil
}
