package http

import (
	"net/http"
	"strconv"
)

type AnomalyResponse struct {
	PredictionID    string  `json:"prediction_id"`
	SourceProductID string  `json:"source_product_id"`
	TICID           int64   `json:"tic_id"`
	Sector          int     `json:"sector"`
	ReconstructionMSE float64 `json:"reconstruction_mse"`
	Threshold       float64 `json:"decision_threshold"`
	AboveThreshold  bool    `json:"above_threshold"`
	ModelVersion    string  `json:"model_version"`
	RuntimePkgID    string  `json:"runtime_package_id"`
}

func handleAnomalies(w http.ResponseWriter, req *http.Request) {
	sectorQuery := req.URL.Query().Get("sector")
	sectorFilter := 0
	if sectorQuery != "" {
		sectorFilter, _ = strconv.Atoi(sectorQuery)
	}

	sampleAnomalies := []AnomalyResponse{
		{
			PredictionID:      "pred-anom-v1-999s10",
			SourceProductID:   "tess20191234_s0010_0000000999_lc",
			TICID:             999,
			Sector:            10,
			ReconstructionMSE: 0.284,
			Threshold:         0.08,
			AboveThreshold:    true,
			ModelVersion:      "anomaly-lightcurve-autoencoder-v1",
			RuntimePkgID:      "run-anom-pkg-v1",
		},
		{
			PredictionID:      "pred-anom-v1-888s11",
			SourceProductID:   "tess20191235_s0011_0000000888_lc",
			TICID:             888,
			Sector:            11,
			ReconstructionMSE: 0.152,
			Threshold:         0.08,
			AboveThreshold:    true,
			ModelVersion:      "anomaly-lightcurve-autoencoder-v1",
			RuntimePkgID:      "run-anom-pkg-v1",
		},
		{
			PredictionID:      "pred-anom-v1-101s10",
			SourceProductID:   "tess20191234_s0010_0000000101_lc",
			TICID:             101,
			Sector:            10,
			ReconstructionMSE: 0.009,
			Threshold:         0.08,
			AboveThreshold:    false,
			ModelVersion:      "anomaly-lightcurve-autoencoder-v1",
			RuntimePkgID:      "run-anom-pkg-v1",
		},
	}

	var results []AnomalyResponse
	for _, a := range sampleAnomalies {
		if sectorFilter == 0 || a.Sector == sectorFilter {
			results = append(results, a)
		}
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"task":      "astronomical_anomaly_detection",
		"count":     len(results),
		"anomalies": results,
	})
}
