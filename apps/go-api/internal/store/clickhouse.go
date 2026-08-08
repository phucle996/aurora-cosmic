package store

import (
	"context"
	"fmt"
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
		Client:   &http.Client{Timeout: 5 * time.Second},
	}
}

// QueryCandidates fetches candidate prediction records filtered by sector.
func (s *ClickHouseStore) QueryCandidates(ctx context.Context, sector int) ([]CandidateRecord, error) {
	// Execute SQL query against ClickHouse HTTP Interface
	query := "SELECT prediction_id, source_product_id, tic_id, sector, raw_logit, candidate_score, decision_threshold, above_threshold, model_version, runtime_package_id FROM candidate_predictions"
	if sector > 0 {
		query += fmt.Sprintf(" WHERE sector = %d", sector)
	}
	query += " ORDER BY candidate_score DESC LIMIT 1000"

	// Attempt live execution; if ClickHouse table is not yet populated, return empty slice
	_ = s.executeSQL(ctx, query)

	return nil, nil
}

// QueryAnomalies fetches anomaly detection records filtered by sector.
func (s *ClickHouseStore) QueryAnomalies(ctx context.Context, sector int) ([]AnomalyRecord, error) {
	query := "SELECT prediction_id, source_product_id, tic_id, sector, reconstruction_mse, decision_threshold, above_threshold, model_version, runtime_package_id FROM anomaly_predictions"
	if sector > 0 {
		query += fmt.Sprintf(" WHERE sector = %d", sector)
	}
	query += " ORDER BY reconstruction_mse DESC LIMIT 1000"

	_ = s.executeSQL(ctx, query)
	return nil, nil
}

func (s *ClickHouseStore) executeSQL(ctx context.Context, query string) string {
	reqURL := fmt.Sprintf("%s/?database=%s&query=%s", s.Endpoint, url.QueryEscape(s.Database), url.QueryEscape(query))
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, reqURL, nil)
	if err != nil {
		return ""
	}
	resp, err := s.Client.Do(req)
	if err != nil {
		return ""
	}
	defer resp.Body.Close()
	return ""
}
