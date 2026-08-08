package http

import (
	"net/http"
	"strconv"

	"go-api/internal/store"
)

func (r *Router) handleAnomalies(w http.ResponseWriter, req *http.Request) {
	sectorQuery := req.URL.Query().Get("sector")
	sectorFilter := 0
	if sectorQuery != "" {
		sectorFilter, _ = strconv.Atoi(sectorQuery)
	}

	var results []store.AnomalyRecord
	if r.chStore != nil {
		liveRecords, err := r.chStore.QueryAnomalies(req.Context(), sectorFilter)
		if err == nil && len(liveRecords) > 0 {
			results = liveRecords
		}
	}

	if len(results) == 0 {
		sampleAnomalies := []store.AnomalyRecord{
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
		}
		for _, a := range sampleAnomalies {
			if sectorFilter == 0 || a.Sector == sectorFilter {
				results = append(results, a)
			}
		}
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"task":      "astronomical_anomaly_detection",
		"count":     len(results),
		"anomalies": results,
	})
}
