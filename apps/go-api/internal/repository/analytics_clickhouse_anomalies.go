package repository

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"go-api/internal/domain/entity"
	"go-api/internal/domain/repo"
)

func (r *AnalyticsClickHouse) ListAnomalies(ctx context.Context, sector int, snapshotID string, flaggedOnly bool, page entity.PageRequest) (entity.Page[entity.Anomaly], error) {
	query := "SELECT prediction_id, source_product_id, tic_id, sector, reconstruction_mse, decision_threshold, above_threshold, model_version, registered_model_id, gold_snapshot_id, runtime_validation_id, runtime_package_id, predicted_at FROM anomaly_predictions"
	conditions := make([]string, 0, 3)
	if sector > 0 {
		conditions = append(conditions, fmt.Sprintf("sector = %d", sector))
	}
	if snapshotID != "" {
		conditions = append(conditions, fmt.Sprintf("gold_snapshot_id = '%s'", escapeSQL(snapshotID)))
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
	query := fmt.Sprintf("SELECT prediction_id, source_product_id, tic_id, sector, reconstruction_mse, decision_threshold, above_threshold, model_version, registered_model_id, gold_snapshot_id, runtime_validation_id, runtime_package_id, predicted_at FROM anomaly_predictions WHERE prediction_id = '%s' AND gold_snapshot_id = '%s' LIMIT 1 FORMAT JSON", escapeSQL(predictionID), escapeSQL(snapshotID))
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
