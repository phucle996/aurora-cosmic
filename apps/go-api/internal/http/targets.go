package http

import (
	"net/http"
	"strconv"
)

func (r *Router) handleTargets(w http.ResponseWriter, req *http.Request) {
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

	results, err := r.chStore.QueryTargets(req.Context(), sectorFilter)
	if err != nil {
		writeServiceUnavailable(w)
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"count":   len(results),
		"targets": results,
	})
}

func (r *Router) handleLightcurves(w http.ResponseWriter, req *http.Request) {
	ticStr := req.URL.Query().Get("tic_id")
	ticID := int64(101)
	if ticStr != "" {
		val, err := strconv.ParseInt(ticStr, 10, 64)
		if err != nil || val < 1 {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "tic_id must be a positive integer"})
			return
		}
		ticID = val
	}

	if r.chStore == nil {
		writeServiceUnavailable(w)
		return
	}

	lightcurve, err := r.chStore.QueryLightcurve(req.Context(), ticID)
	if err != nil {
		writeServiceUnavailable(w)
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"tic_id": lightcurve.TICID,
		"time":   lightcurve.Time,
		"flux":   lightcurve.Flux,
	})
}
