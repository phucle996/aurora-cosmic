package http

import (
	"net/http"
	"strconv"
)

func (r *Router) handleAnomalies(w http.ResponseWriter, req *http.Request) {
	sectorQuery := req.URL.Query().Get("sector")
	sectorFilter := 0
	if sectorQuery != "" {
		var err error
		sectorFilter, err = strconv.Atoi(sectorQuery)
		if err != nil || sectorFilter < 1 {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "sector must be a positive integer"})
			return
		}
	}

	if r.chStore == nil {
		writeServiceUnavailable(w)
		return
	}

	results, err := r.chStore.QueryAnomalies(req.Context(), sectorFilter)
	if err != nil {
		writeServiceUnavailable(w)
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"task":      "astronomical_anomaly_detection",
		"count":     len(results),
		"anomalies": results,
	})
}
