package store

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
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
	ModelVersion    string  `json:"model_version,omitempty"`
	RegisteredModel string  `json:"registered_model_id,omitempty"`
	SnapshotID      string  `json:"gold_snapshot_id,omitempty"`
	ValidationID    string  `json:"runtime_validation_id,omitempty"`
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
	ModelVersion      string  `json:"model_version,omitempty"`
	RegisteredModel   string  `json:"registered_model_id,omitempty"`
	SnapshotID        string  `json:"gold_snapshot_id,omitempty"`
	ValidationID      string  `json:"runtime_validation_id,omitempty"`
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

type PageRequest struct {
	Limit  int
	Offset int
}

type Page[T any] struct {
	Items   []T  `json:"items"`
	Count   int  `json:"count"`
	Limit   int  `json:"limit"`
	Offset  int  `json:"offset"`
	HasMore bool `json:"has_more"`
}

// AnalyticsStore is the query boundary consumed by HTTP handlers. Keeping
// this interface here prevents the transport layer from depending on a
// concrete database client and makes in-memory contract tests straightforward.
type AnalyticsStore interface {
	Ping(context.Context) error
	QueryCandidates(context.Context, int, string, PageRequest) (Page[CandidateRecord], error)
	QueryAnomalies(context.Context, int, string, PageRequest) (Page[AnomalyRecord], error)
	QueryTargets(context.Context, int, PageRequest) (Page[TargetRecord], error)
	QueryLightcurve(context.Context, int64, PageRequest) (*LightcurveData, error)
}

// ClickHouseStore queries analytical metadata stored in ClickHouse.
type ClickHouseStore struct {
	Endpoint string
	Database string
	Username string
	Password string
	Client   *http.Client
}

// SetCredentials configures ClickHouse HTTP basic authentication without
// exposing credentials in query strings or logs.
func (s *ClickHouseStore) SetCredentials(username, password string) {
	s.Username = username
	s.Password = password
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

func (s *ClickHouseStore) Ping(ctx context.Context) error {
	_, err := s.executeSQL(ctx, "SELECT 1 FORMAT JSON")
	return err
}

// QueryCandidates fetches candidate prediction records filtered by sector from ClickHouse.
func (s *ClickHouseStore) QueryCandidates(ctx context.Context, sector int, snapshotID string, page PageRequest) (Page[CandidateRecord], error) {
	query := "SELECT prediction_id, source_product_id, tic_id, sector, raw_logit, candidate_score, decision_threshold, above_threshold, model_version, registered_model_id, gold_snapshot_id, runtime_validation_id, runtime_package_id FROM candidate_predictions"
	where := make([]string, 0, 2)
	if sector > 0 {
		where = append(where, fmt.Sprintf("sector = %d", sector))
	}
	if snapshotID != "" {
		where = append(where, fmt.Sprintf("gold_snapshot_id = '%s'", escapeSQLString(snapshotID)))
	}
	query += whereClause(where) + fmt.Sprintf(" ORDER BY candidate_score DESC LIMIT %d OFFSET %d FORMAT JSON", page.Limit, page.Offset)

	body, err := s.executeSQL(ctx, query)
	if err != nil {
		return Page[CandidateRecord]{}, err
	}

	var resp clickHouseJSONResponse[CandidateRecord]
	if err := json.Unmarshal(body, &resp); err != nil {
		return Page[CandidateRecord]{}, fmt.Errorf("failed to parse ClickHouse JSON response: %w", err)
	}
	return pageResult(resp.Data, page), nil
}

// QueryAnomalies fetches anomaly detection records filtered by sector from ClickHouse.
func (s *ClickHouseStore) QueryAnomalies(ctx context.Context, sector int, snapshotID string, page PageRequest) (Page[AnomalyRecord], error) {
	query := "SELECT prediction_id, source_product_id, tic_id, sector, reconstruction_mse, decision_threshold, above_threshold, model_version, registered_model_id, gold_snapshot_id, runtime_validation_id, runtime_package_id FROM anomaly_predictions"
	where := make([]string, 0, 2)
	if sector > 0 {
		where = append(where, fmt.Sprintf("sector = %d", sector))
	}
	if snapshotID != "" {
		where = append(where, fmt.Sprintf("gold_snapshot_id = '%s'", escapeSQLString(snapshotID)))
	}
	query += whereClause(where) + fmt.Sprintf(" ORDER BY reconstruction_mse DESC LIMIT %d OFFSET %d FORMAT JSON", page.Limit, page.Offset)

	body, err := s.executeSQL(ctx, query)
	if err != nil {
		return Page[AnomalyRecord]{}, err
	}

	var resp clickHouseJSONResponse[AnomalyRecord]
	if err := json.Unmarshal(body, &resp); err != nil {
		return Page[AnomalyRecord]{}, fmt.Errorf("failed to parse ClickHouse JSON response: %w", err)
	}
	return pageResult(resp.Data, page), nil
}

// QueryTargets fetches stellar targets filtered by sector from ClickHouse.
func (s *ClickHouseStore) QueryTargets(ctx context.Context, sector int, page PageRequest) (Page[TargetRecord], error) {
	query := "SELECT tic_id, tess_mag, ra, dec, effective_t, surface_grav, radius, sector, matched_toi, disposition FROM targets"
	where := make([]string, 0, 1)
	if sector > 0 {
		where = append(where, fmt.Sprintf("sector = %d", sector))
	}
	query += whereClause(where) + fmt.Sprintf(" ORDER BY tic_id ASC LIMIT %d OFFSET %d FORMAT JSON", page.Limit, page.Offset)

	body, err := s.executeSQL(ctx, query)
	if err != nil {
		return Page[TargetRecord]{}, err
	}

	var resp clickHouseJSONResponse[TargetRecord]
	if err := json.Unmarshal(body, &resp); err != nil {
		return Page[TargetRecord]{}, fmt.Errorf("failed to parse ClickHouse JSON response: %w", err)
	}
	return pageResult(resp.Data, page), nil
}

// QueryLightcurve fetches time and normalized flux for a specific TIC from ClickHouse.
func (s *ClickHouseStore) QueryLightcurve(ctx context.Context, ticID int64, page PageRequest) (*LightcurveData, error) {
	query := fmt.Sprintf("SELECT time, flux FROM lightcurves WHERE tic_id = %d ORDER BY time ASC LIMIT %d OFFSET %d FORMAT JSON", ticID, page.Limit, page.Offset)
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

func pageResult[T any](items []T, page PageRequest) Page[T] {
	if items == nil {
		items = []T{}
	}
	return Page[T]{Items: items, Count: len(items), Limit: page.Limit, Offset: page.Offset, HasMore: len(items) == page.Limit}
}

func whereClause(conditions []string) string {
	if len(conditions) == 0 {
		return ""
	}
	return " WHERE " + strings.Join(conditions, " AND ")
}

func escapeSQLString(value string) string {
	return strings.ReplaceAll(value, "'", "''")
}

func (s *ClickHouseStore) executeSQL(ctx context.Context, query string) ([]byte, error) {
	reqURL := fmt.Sprintf("%s/?database=%s&query=%s", s.Endpoint, url.QueryEscape(s.Database), url.QueryEscape(query))
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, reqURL, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to build ClickHouse request: %w", err)
	}
	if s.Username != "" {
		req.SetBasicAuth(s.Username, s.Password)
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
