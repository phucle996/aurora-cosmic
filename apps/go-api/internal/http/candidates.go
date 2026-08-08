package http

import (
	"net/http"
	"strconv"
)

type CandidateResponse struct {
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

func handleCandidates(w http.ResponseWriter, req *http.Request) {
	sectorQuery := req.URL.Query().Get("sector")
	sectorFilter := 0
	if sectorQuery != "" {
		sectorFilter, _ = strconv.Atoi(sectorQuery)
	}

	// Mock/Gold backed query result for UI & E2E verification
	sampleCandidates := []CandidateResponse{
		{
			PredictionID:    "pred-cand-v1-101s10",
			SourceProductID: "tess20191234_s0010_0000000101_tp",
			TICID:           101,
			Sector:          10,
			RawLogit:        2.35,
			CandidateScore:  0.9129,
			Threshold:       0.45,
			AboveThreshold:  true,
			ModelVersion:    "candidate-tabular-mlp-v1",
			RuntimePkgID:    "run-cand-pkg-v1",
		},
		{
			PredictionID:    "pred-cand-v1-103s11",
			SourceProductID: "tess20191235_s0011_0000000103_tp",
			TICID:           103,
			Sector:          11,
			RawLogit:        1.85,
			CandidateScore:  0.8641,
			Threshold:       0.45,
			AboveThreshold:  true,
			ModelVersion:    "candidate-tabular-mlp-v1",
			RuntimePkgID:    "run-cand-pkg-v1",
		},
		{
			PredictionID:    "pred-cand-v1-102s10",
			SourceProductID: "tess20191234_s0010_0000000102_tp",
			TICID:           102,
			Sector:          10,
			RawLogit:        -3.40,
			CandidateScore:  0.0323,
			Threshold:       0.45,
			AboveThreshold:  false,
			ModelVersion:    "candidate-tabular-mlp-v1",
			RuntimePkgID:    "run-cand-pkg-v1",
		},
	}

	var results []CandidateResponse
	for _, c := range sampleCandidates {
		if sectorFilter == 0 || c.Sector == sectorFilter {
			results = append(results, c)
		}
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"task":       "candidate_vetting",
		"count":      len(results),
		"candidates": results,
	})
}
