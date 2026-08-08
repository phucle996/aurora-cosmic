package repository

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"go-api/infra/clickhouse"
	"go-api/internal/domain/entity"
	"go-api/internal/domain/repo"
)

type AnalyticsClickHouse struct{ client *clickhouse.Client }

func NewAnalyticsClickHouse(client *clickhouse.Client) repo.AnalyticsRepository {
	return &AnalyticsClickHouse{client: client}
}

func (r *AnalyticsClickHouse) Ping(ctx context.Context) error { return r.client.Ping(ctx) }

func (r *AnalyticsClickHouse) ListCandidates(ctx context.Context, sector int, snapshotID string, page entity.PageRequest) (entity.Page[entity.Candidate], error) {
	query := "SELECT prediction_id, source_product_id, tic_id, sector, raw_logit, candidate_score, decision_threshold, above_threshold, model_version, registered_model_id, gold_snapshot_id, runtime_validation_id, runtime_package_id FROM candidate_predictions"
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
			TICID           int64   `json:"tic_id"`
			Sector          int     `json:"sector"`
			RawLogit        float64 `json:"raw_logit"`
			CandidateScore  float64 `json:"candidate_score"`
			Threshold       float64 `json:"decision_threshold"`
			AboveThreshold  bool    `json:"above_threshold"`
			ModelVersion    string  `json:"model_version"`
			RegisteredModel string  `json:"registered_model_id"`
			SnapshotID      string  `json:"gold_snapshot_id"`
			ValidationID    string  `json:"runtime_validation_id"`
			RuntimePkgID    string  `json:"runtime_package_id"`
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
			TICID:           row.TICID,
			Sector:          row.Sector,
			RawLogit:        row.RawLogit,
			CandidateScore:  row.CandidateScore,
			Threshold:       row.Threshold,
			AboveThreshold:  row.AboveThreshold,
			ModelVersion:    row.ModelVersion,
			RegisteredModel: row.RegisteredModel,
			SnapshotID:      row.SnapshotID,
			ValidationID:    row.ValidationID,
			RuntimePkgID:    row.RuntimePkgID,
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

func (r *AnalyticsClickHouse) ListAnomalies(ctx context.Context, sector int, snapshotID string, page entity.PageRequest) (entity.Page[entity.Anomaly], error) {
	query := "SELECT prediction_id, source_product_id, tic_id, sector, reconstruction_mse, decision_threshold, above_threshold, model_version, registered_model_id, gold_snapshot_id, runtime_validation_id, runtime_package_id FROM anomaly_predictions"
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
	query += fmt.Sprintf(" ORDER BY reconstruction_mse DESC LIMIT %d OFFSET %d FORMAT JSON", page.Limit, page.Offset)

	body, err := r.client.Query(ctx, query)
	if err != nil {
		return entity.Page[entity.Anomaly]{}, err
	}
	var response struct {
		Data []struct {
			PredictionID      string  `json:"prediction_id"`
			SourceProductID   string  `json:"source_product_id"`
			TICID             int64   `json:"tic_id"`
			Sector            int     `json:"sector"`
			ReconstructionMSE float64 `json:"reconstruction_mse"`
			Threshold         float64 `json:"decision_threshold"`
			AboveThreshold    bool    `json:"above_threshold"`
			ModelVersion      string  `json:"model_version"`
			RegisteredModel   string  `json:"registered_model_id"`
			SnapshotID        string  `json:"gold_snapshot_id"`
			ValidationID      string  `json:"runtime_validation_id"`
			RuntimePkgID      string  `json:"runtime_package_id"`
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
			TICID:             row.TICID,
			Sector:            row.Sector,
			ReconstructionMSE: row.ReconstructionMSE,
			Threshold:         row.Threshold,
			AboveThreshold:    row.AboveThreshold,
			ModelVersion:      row.ModelVersion,
			RegisteredModel:   row.RegisteredModel,
			SnapshotID:        row.SnapshotID,
			ValidationID:      row.ValidationID,
			RuntimePkgID:      row.RuntimePkgID,
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

func (r *AnalyticsClickHouse) ListTargets(ctx context.Context, sector int, page entity.PageRequest) (entity.Page[entity.Target], error) {
	query := "SELECT tic_id, tess_mag, ra, dec, effective_t, surface_grav, radius, sector, matched_toi, disposition FROM targets"
	if sector > 0 {
		query += fmt.Sprintf(" WHERE sector = %d", sector)
	}
	query += fmt.Sprintf(" ORDER BY tic_id ASC LIMIT %d OFFSET %d FORMAT JSON", page.Limit, page.Offset)

	body, err := r.client.Query(ctx, query)
	if err != nil {
		return entity.Page[entity.Target]{}, err
	}
	var response struct {
		Data []struct {
			TICID       int64   `json:"tic_id"`
			TessMag     float64 `json:"tess_mag"`
			RA          float64 `json:"ra"`
			Dec         float64 `json:"dec"`
			EffectiveT  float64 `json:"effective_t"`
			SurfaceGrav float64 `json:"surface_grav"`
			Radius      float64 `json:"radius"`
			Sector      int     `json:"sector"`
			TOI         string  `json:"matched_toi"`
			Disposition string  `json:"disposition"`
		} `json:"data"`
	}
	if err := json.Unmarshal(body, &response); err != nil {
		return entity.Page[entity.Target]{}, fmt.Errorf("parse targets: %w", err)
	}

	items := make([]entity.Target, len(response.Data))
	for i, row := range response.Data {
		items[i] = entity.Target{
			TICID:       row.TICID,
			TessMag:     row.TessMag,
			RA:          row.RA,
			Dec:         row.Dec,
			EffectiveT:  row.EffectiveT,
			SurfaceGrav: row.SurfaceGrav,
			Radius:      row.Radius,
			Sector:      row.Sector,
			TOI:         row.TOI,
			Disposition: row.Disposition,
		}
	}
	return entity.Page[entity.Target]{
		Items:   items,
		Count:   len(items),
		Limit:   page.Limit,
		Offset:  page.Offset,
		HasMore: len(items) == page.Limit,
	}, nil
}

func (r *AnalyticsClickHouse) GetLightcurve(ctx context.Context, ticID int64, page entity.PageRequest) (*entity.Lightcurve, error) {
	query := fmt.Sprintf("SELECT time, flux FROM lightcurves WHERE tic_id = %d ORDER BY time ASC LIMIT %d OFFSET %d FORMAT JSON", ticID, page.Limit, page.Offset)
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
	result := &entity.Lightcurve{TICID: ticID, Time: make([]float64, len(response.Data)), Flux: make([]float64, len(response.Data))}
	for i, point := range response.Data {
		result.Time[i], result.Flux[i] = point.Time, point.Flux
	}
	return result, nil
}
