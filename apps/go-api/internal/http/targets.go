package http

import (
	"net/http"
	"strconv"
)

type TargetRecord struct {
	TICID        int64   `json:"tic_id"`
	TessMag      float64 `json:"tess_mag"`
	RA           float64 `json:"ra"`
	Dec          float64 `json:"dec"`
	EffectiveT   float64 `json:"effective_t"`
	SurfaceGrav  float64 `json:"surface_grav"`
	Radius       float64 `json:"radius"`
	Sector       int     `json:"sector"`
	TOI          string  `json:"matched_toi,omitempty"`
	Disposition  string  `json:"disposition,omitempty"`
}

func handleTargets(w http.ResponseWriter, req *http.Request) {
	sectorQuery := req.URL.Query().Get("sector")
	sectorFilter := 0
	if sectorQuery != "" {
		sectorFilter, _ = strconv.Atoi(sectorQuery)
	}

	targets := []TargetRecord{
		{
			TICID:       101,
			TessMag:     10.45,
			RA:          125.432,
			Dec:         -32.145,
			EffectiveT:  5800.0,
			SurfaceGrav: 4.45,
			Radius:      1.02,
			Sector:      10,
			TOI:         "TOI-101.01",
			Disposition: "CONFIRMED",
		},
		{
			TICID:       102,
			TessMag:     12.10,
			RA:          125.981,
			Dec:         -32.890,
			EffectiveT:  4200.0,
			SurfaceGrav: 4.60,
			Radius:      0.75,
			Sector:      10,
			Disposition: "FALSE_POSITIVE",
		},
		{
			TICID:       103,
			TessMag:     9.80,
			RA:          126.115,
			Dec:         -31.905,
			EffectiveT:  6100.0,
			SurfaceGrav: 4.30,
			Radius:      1.18,
			Sector:      11,
			TOI:         "TOI-103.01",
			Disposition: "CANDIDATE",
		},
	}

	var results []TargetRecord
	for _, t := range targets {
		if sectorFilter == 0 || t.Sector == sectorFilter {
			results = append(results, t)
		}
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"count":   len(results),
		"targets": results,
	})
}

func handleLightcurves(w http.ResponseWriter, req *http.Request) {
	ticStr := req.URL.Query().Get("tic_id")
	ticID := int64(101)
	if ticStr != "" {
		if val, err := strconv.ParseInt(ticStr, 10, 64); err == nil {
			ticID = val
		}
	}

	// Generate sample transit lightcurve flux points for visual plotting
	var times []float64
	var fluxes []float64
	for i := 0; i < 100; i++ {
		t := float64(i) * 0.1
		f := 1.0
		// Dip between t=4.5 and t=5.5
		if t >= 4.5 && t <= 5.5 {
			f = 0.985
		}
		times = append(times, t)
		fluxes = append(fluxes, f)
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"tic_id": ticID,
		"time":   times,
		"flux":   fluxes,
	})
}
