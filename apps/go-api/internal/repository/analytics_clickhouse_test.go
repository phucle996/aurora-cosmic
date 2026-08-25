package repository

import (
	"context"
	"encoding/json"
	"go-api/infra/clickhouse"
	"go-api/internal/domain/entity"
	"testing"
)

func TestUnmarshalClickHouseTargetsJSON(t *testing.T) {
	rawJSON := `{
	"meta":
	[
		{"name": "tic_id", "type": "Int64"},
		{"name": "tess_mag", "type": "Float64"},
		{"name": "ra", "type": "Float64"},
		{"name": "dec", "type": "Float64"},
		{"name": "effective_t", "type": "Float64"},
		{"name": "surface_grav", "type": "Float64"},
		{"name": "radius", "type": "Float64"},
		{"name": "sector", "type": "Int32"},
		{"name": "matched_toi", "type": "Nullable(String)"},
		{"name": "disposition", "type": "LowCardinality(String)"},
		{"name": "lightcurve_points", "type": "Int64"},
		{"name": "lightcurve_time_span", "type": "Float64"},
		{"name": "has_lightcurve", "type": "UInt8"},
		{"name": "has_candidate", "type": "UInt8"},
		{"name": "candidate_prediction_id", "type": "String"},
		{"name": "candidate_score", "type": "Float64"},
		{"name": "candidate_above_threshold", "type": "UInt8"},
		{"name": "has_anomaly", "type": "UInt8"},
		{"name": "anomaly_prediction_id", "type": "String"},
		{"name": "anomaly_score", "type": "Float64"},
		{"name": "pipeline_status", "type": "String"}
	],
	"data":
	[
		{
			"tic_id": "318707089",
			"tess_mag": 10.5,
			"ra": 143.6,
			"dec": 17.76,
			"effective_t": 5778,
			"surface_grav": 4.43,
			"radius": 1.0,
			"sector": 42,
			"matched_toi": null,
			"disposition": "CANDIDATE",
			"lightcurve_points": "404",
			"lightcurve_time_span": 22.953,
			"has_lightcurve": 1,
			"has_candidate": 1,
			"candidate_prediction_id": "pred-1",
			"candidate_score": 0.999,
			"candidate_above_threshold": 1,
			"has_anomaly": 1,
			"anomaly_prediction_id": "pred-2",
			"anomaly_score": 0.05,
			"pipeline_status": "scored"
		}
	]
}`

	var response struct {
		Data []struct {
			TICID                   any     `json:"tic_id"`
			TessMag                 float64 `json:"tess_mag"`
			RA                      float64 `json:"ra"`
			Dec                     float64 `json:"dec"`
			EffectiveT              float64 `json:"effective_t"`
			SurfaceGrav             float64 `json:"surface_grav"`
			Radius                  float64 `json:"radius"`
			Sector                  int     `json:"sector"`
			TOI                     string  `json:"matched_toi"`
			Disposition             string  `json:"disposition"`
			LightcurvePoints        any     `json:"lightcurve_points"`
			LightcurveTimeSpan      float64 `json:"lightcurve_time_span"`
			HasLightcurve           uint8   `json:"has_lightcurve"`
			HasCandidate            uint8   `json:"has_candidate"`
			CandidatePredictionID   string  `json:"candidate_prediction_id"`
			CandidateScore          float64 `json:"candidate_score"`
			CandidateAboveThreshold any     `json:"candidate_above_threshold"`
			HasAnomaly              uint8   `json:"has_anomaly"`
			AnomalyPredictionID     string  `json:"anomaly_prediction_id"`
			AnomalyScore            float64 `json:"anomaly_score"`
			PipelineStatus          string  `json:"pipeline_status"`
		} `json:"data"`
	}

	err := json.Unmarshal([]byte(rawJSON), &response)
	if err != nil {
		t.Fatalf("Unmarshal error: %v", err)
	}
	ticID := toInt64(response.Data[0].TICID)
	if ticID != 318707089 {
		t.Fatalf("Expected TICID 318707089, got %d", ticID)
	}
	if response.Data[0].Sector != 42 {
		t.Fatalf("Expected Sector 42, got %d", response.Data[0].Sector)
	}
	if !toBool(response.Data[0].CandidateAboveThreshold) {
		t.Fatalf("Expected CandidateAboveThreshold true")
	}
	t.Logf("Successfully unmarshaled: TICID=%d, Sector=%d", ticID, response.Data[0].Sector)
}

func TestLiveClickHouseListTargets(t *testing.T) {
	client := clickhouse.NewClient("http://localhost:8123", "aurora", "aurora", "aurora-dev-password")
	if err := client.Ping(context.Background()); err != nil {
		t.Skipf("ClickHouse not reachable, skipping live test: %v", err)
	}

	repo := NewAnalyticsClickHouse(client)
	page, err := repo.ListTargets(context.Background(), entity.TargetQuery{
		Page: entity.PageRequest{Limit: 2},
	})
	if err != nil {
		t.Fatalf("Live ListTargets error: %v", err)
	}
	if len(page.Items) > 0 && page.Items[0].TICID == 0 {
		t.Fatalf("Expected non-zero TICID, got 0")
	}
	t.Logf("Got total=%d, items=%d, first TICID=%d", page.Count, len(page.Items), page.Items[0].TICID)
}
