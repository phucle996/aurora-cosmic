package store

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"time"
)

// CandidateRecord represents exoplanet candidate prediction records.
type CandidateRecord struct {
	PredictionID    string  `json:"prediction_id"`
	SourceProductID string  `json:"source_product_id"`
	TICID           int64   `json:"tic_id"`
	Sector          int     `json:"sector"`
	RawLogit        float64 `json:"raw_logit"`
	CandidateScore  float64 `json:"candidate_score"`
	Threshold       float64 `json:"decision_threshold"`
	AboveThreshold  bool    `json:"above_threshold"`
	ModelVersion    string  `json:"model_version"`
	RuntimePkgID    string  `json:"runtime_package_id"`
}

// AnomalyRecord represents astronomical anomaly detection records.
type AnomalyRecord struct {
	PredictionID      string  `json:"prediction_id"`
	SourceProductID   string  `json:"source_product_id"`
	TICID             int64   `json:"tic_id"`
	Sector            int     `json:"sector"`
	ReconstructionMSE float64 `json:"reconstruction_mse"`
	Threshold         float64 `json:"decision_threshold"`
	AboveThreshold    bool    `json:"above_threshold"`
	ModelVersion      string  `json:"model_version"`
	RuntimePkgID      string  `json:"runtime_package_id"`
}

// TargetRecord represents stellar target catalog records.
type TargetRecord struct {
	TICID       int64   `json:"tic_id"`
	TessMag     float64 `json:"tess_mag"`
	RA          float64 `json:"ra"`
	Dec         float64 `json:"dec"`
	EffectiveT  float64 `json:"effective_t"`
	SurfaceGrav float64 `json:"surface_grav"`
	Radius      float64 `json:"radius"`
	Sector      int     `json:"sector"`
	TOI         string  `json:"matched_toi,omitempty"`
	Disposition string  `json:"disposition,omitempty"`
}

// LightcurveData represents time-series flux points for UI rendering.
type LightcurveData struct {
	TICID int64     `json:"tic_id"`
	Time  []float64 `json:"time"`
	Flux  []float64 `json:"flux"`
}

type clickHouseJSONResponse[T any] struct {
	Data []T `json:"data"`
	Rows int `json:"rows"`
}

// ClickHouseStore queries analytical metadata stored in ClickHouse.
type ClickHouseStore struct {
	Endpoint string
	Database string
	Client   *http.Client
}

func NewClickHouseStore(endpoint, database string) *ClickHouseStore {
	if endpoint == "" {
		endpoint = "http://clickhouse:8123"
	}
	if database == "" {
		database = "aurora"
	}
	return &ClickHouseStore{
		Endpoint: endpoint,
		Database: database,
		Client:   &http.Client{Timeout: 10 * time.Second},
	}
}

// QueryCandidates fetches candidate prediction records filtered by sector from ClickHouse.
func (s *ClickHouseStore) QueryCandidates(ctx context.Context, sector int) ([]CandidateRecord, error) {
	query := "SELECT prediction_id, source_product_id, tic_id, sector, raw_logit, candidate_score, decision_threshold, above_threshold, model_version, runtime_package_id FROM candidate_predictions"
	if sector > 0 {
		query += fmt.Sprintf(" WHERE sector = %d", sector)
	}
	query += " ORDER BY candidate_score DESC LIMIT 1000 FORMAT JSON"

	body, err := s.executeSQL(ctx, query)
	if err != nil {
		return nil, err
	}

	var resp clickHouseJSONResponse[CandidateRecord]
	if err := json.Unmarshal(body, &resp); err != nil {
		return nil, fmt.Errorf("failed to parse ClickHouse JSON response: %w", err)
	}

	if resp.Data == nil {
		return []CandidateRecord{}, nil
	}
	return resp.Data, nil
}

// QueryAnomalies fetches anomaly detection records filtered by sector from ClickHouse.
func (s *ClickHouseStore) QueryAnomalies(ctx context.Context, sector int) ([]AnomalyRecord, error) {
	query := "SELECT prediction_id, source_product_id, tic_id, sector, reconstruction_mse, decision_threshold, above_threshold, model_version, runtime_package_id FROM anomaly_predictions"
	if sector > 0 {
		query += fmt.Sprintf(" WHERE sector = %d", sector)
	}
	query += " ORDER BY reconstruction_mse DESC LIMIT 1000 FORMAT JSON"

	body, err := s.executeSQL(ctx, query)
	if err != nil {
		return nil, err
	}

	var resp clickHouseJSONResponse[AnomalyRecord]
	if err := json.Unmarshal(body, &resp); err != nil {
		return nil, fmt.Errorf("failed to parse ClickHouse JSON response: %w", err)
	}

	if resp.Data == nil {
		return []AnomalyRecord{}, nil
	}
	return resp.Data, nil
}

// QueryTargets fetches stellar targets filtered by sector from ClickHouse.
func (s *ClickHouseStore) QueryTargets(ctx context.Context, sector int) ([]TargetRecord, error) {
	query := "SELECT tic_id, tess_mag, ra, dec, effective_t, surface_grav, radius, sector, matched_toi, disposition FROM targets"
	if sector > 0 {
		query += fmt.Sprintf(" WHERE sector = %d", sector)
	}
	query += " ORDER BY tic_id ASC LIMIT 1000 FORMAT JSON"

	body, err := s.executeSQL(ctx, query)
	if err != nil {
		return nil, err
	}

	var resp clickHouseJSONResponse[TargetRecord]
	if err := json.Unmarshal(body, &resp); err != nil {
		return nil, fmt.Errorf("failed to parse ClickHouse JSON response: %w", err)
	}

	if resp.Data == nil {
		return []TargetRecord{}, nil
	}
	return resp.Data, nil
}

// QueryLightcurve fetches time and normalized flux for a specific TIC from ClickHouse.
func (s *ClickHouseStore) QueryLightcurve(ctx context.Context, ticID int64) (*LightcurveData, error) {
	query := fmt.Sprintf("SELECT time, flux FROM lightcurves WHERE tic_id = %d ORDER BY time ASC LIMIT 5000 FORMAT JSON", ticID)
	body, err := s.executeSQL(ctx, query)
	if err != nil {
		return nil, err
	}

	type lcPoint struct {
		Time float64 `json:"time"`
		Flux float64 `json:"flux"`
	}

	var resp clickHouseJSONResponse[lcPoint]
	if err := json.Unmarshal(body, &resp); err != nil {
		return nil, fmt.Errorf("failed to parse ClickHouse lightcurve JSON response: %w", err)
	}

	lc := &LightcurveData{
		TICID: ticID,
		Time:  make([]float64, len(resp.Data)),
		Flux:  make([]float64, len(resp.Data)),
	}
	for i, pt := range resp.Data {
		lc.Time[i] = pt.Time
		lc.Flux[i] = pt.Flux
	}
	return lc, nil
}

func (s *ClickHouseStore) executeSQL(ctx context.Context, query string) ([]byte, error) {
	reqURL := fmt.Sprintf("%s/?database=%s&query=%s", s.Endpoint, url.QueryEscape(s.Database), url.QueryEscape(query))
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, reqURL, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to build ClickHouse request: %w", err)
	}

	resp, err := s.Client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("clickhouse connection failed: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("failed reading ClickHouse response body: %w", err)
	}

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("clickhouse returned HTTP %d: %s", resp.StatusCode, string(body))
	}

	return body, nil
}
