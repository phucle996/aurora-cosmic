package repository

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

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
	literals := make([]string, 0, len(ids))
	for _, id := range ids {
		literals = append(literals, "'"+strings.ReplaceAll(id, "'", "''")+"'")
	}
	body, err := r.client.Query(ctx, fmt.Sprintf(
		"SELECT prediction_id FROM %s WHERE prediction_id IN (%s) FORMAT JSON",
		table,
		strings.Join(literals, ","),
	))
	if err != nil {
		return nil, err
	}
	var response struct {
		Data []struct {
			PredictionID string `json:"prediction_id"`
		} `json:"data"`
	}
	if err := json.Unmarshal(body, &response); err != nil {
		return nil, fmt.Errorf("decode existing prediction IDs: %w", err)
	}
	for _, row := range response.Data {
		existing[row.PredictionID] = struct{}{}
	}
	return existing, nil
}

func insertJSONEachRow[T any](ctx context.Context, client *clickhouse.Client, table string, rows []T) error {
	if len(rows) == 0 {
		return nil
	}
	var payload strings.Builder
	payload.WriteString("INSERT INTO ")
	payload.WriteString(table)
	payload.WriteString(" FORMAT JSONEachRow\n")
	for _, row := range rows {
		encoded, err := json.Marshal(row)
		if err != nil {
			return fmt.Errorf("encode %s projection row: %w", table, err)
		}
		payload.Write(encoded)
		payload.WriteByte('\n')
	}
	return client.Exec(ctx, payload.String())
}

func (r *PredictionProjectionClickHouse) InsertCandidatePredictions(ctx context.Context, rows []entity.CandidatePredictionProjection) error {
	return insertJSONEachRow(ctx, r.client, "candidate_predictions", rows)
}

func (r *PredictionProjectionClickHouse) InsertAnomalyPredictions(ctx context.Context, rows []entity.AnomalyPredictionProjection) error {
	return insertJSONEachRow(ctx, r.client, "anomaly_predictions", rows)
}
