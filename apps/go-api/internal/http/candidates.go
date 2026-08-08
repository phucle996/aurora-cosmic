package http

import "net/http"

func (r *Router) handleCandidates(w http.ResponseWriter, req *http.Request) {
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
	snapshotID, err := parseSnapshotID(req, true)
	if err != nil {
		writeBadRequest(w, err.Error())
		return
	}
	if r.chStore == nil {
		writeServiceUnavailable(w)
		return
	}

	results, err := r.chStore.QueryCandidates(req.Context(), sectorFilter, snapshotID, page)
	if err != nil {
		writeServiceUnavailable(w)
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"task":        "candidate_vetting",
		"count":       results.Count,
		"candidates":  results.Items,
		"page":        results,
		"snapshot_id": snapshotID,
	})
}
