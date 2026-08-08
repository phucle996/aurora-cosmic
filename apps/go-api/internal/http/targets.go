package http

import (
	"net/http"
	"strconv"

	"go-api/internal/store"
)

func (r *Router) handleTargets(w http.ResponseWriter, req *http.Request) {
	sectorQuery := req.URL.Query().Get("sector")
	sectorFilter := 0
	if sectorQuery != "" {
		sectorFilter, _ = strconv.Atoi(sectorQuery)
	}

	targets := []store.TargetRecord{
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

	var results []store.TargetRecord
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

func (r *Router) handleLightcurves(w http.ResponseWriter, req *http.Request) {
	ticStr := req.URL.Query().Get("tic_id")
	ticID := int64(101)
	if ticStr != "" {
		if val, err := strconv.ParseInt(ticStr, 10, 64); err == nil {
			ticID = val
		}
	}

	// Generate transit lightcurve points
	var times []float64
	var fluxes []float64
	for i := 0; i < 100; i++ {
		t := float64(i) * 0.1
		f := 1.0
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
