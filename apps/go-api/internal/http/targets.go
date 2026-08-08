package http

import (
	"net/http"
	"strconv"
)

func (r *Router) handleTargets(w http.ResponseWriter, req *http.Request) {
	page, err := parsePage(req)
	if err != nil {
		writeBadRequest(w, err.Error())
		return
	}
	sectorFilter, err := parseSector(req)
	if err != nil {
		writeBadRequest(w, err.Error())
		return
	}

	if r.chStore == nil {
		writeServiceUnavailable(w)
		return
	}

	results, err := r.chStore.QueryTargets(req.Context(), sectorFilter, page)
	if err != nil {
		writeServiceUnavailable(w)
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"count":   results.Count,
		"targets": results.Items,
		"page":    results,
	})
}

func (r *Router) handleLightcurves(w http.ResponseWriter, req *http.Request) {
	page, err := parsePage(req)
	if err != nil {
		writeBadRequest(w, err.Error())
		return
	}
	ticStr := req.URL.Query().Get("tic_id")
	if ticStr == "" {
		writeBadRequest(w, "tic_id is required")
		return
	}
	ticID, err := strconv.ParseInt(ticStr, 10, 64)
	if err != nil || ticID < 1 {
		writeBadRequest(w, "tic_id must be a positive integer")
		return
	}

	if r.chStore == nil {
		writeServiceUnavailable(w)
		return
	}

	lightcurve, err := r.chStore.QueryLightcurve(req.Context(), ticID, page)
	if err != nil {
		writeServiceUnavailable(w)
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"tic_id": lightcurve.TICID,
		"time":   lightcurve.Time,
		"flux":   lightcurve.Flux,
		"page":   page,
	})
}
