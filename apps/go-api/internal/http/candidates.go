package http

import (
	"net/http"
	"strconv"
)

func (r *Router) handleCandidates(w http.ResponseWriter, req *http.Request) {
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

	results, err := r.chStore.QueryCandidates(req.Context(), sectorFilter)
	if err != nil {
		writeServiceUnavailable(w)
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"task":       "candidate_vetting",
		"count":      len(results),
		"candidates": results,
	})
}
