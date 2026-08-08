package http

import (
	"encoding/json"
	"net/http"
	"time"
)

// Router registers and manages all HTTP REST endpoints for the AURORA API Gateway.
type Router struct {
	mux *http.ServeMux
}

func NewRouter() *Router {
	mux := http.NewServeMux()
	r := &Router{mux: mux}
	r.registerRoutes()
	return r
}

func (r *Router) ServeHTTP(w http.ResponseWriter, req *http.Request) {
	// Enable CORS for dashboard frontend
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")

	if req.Method == http.MethodOptions {
		w.WriteHeader(http.StatusOK)
		return
	}

	r.mux.ServeHTTP(w, req)
}

func (r *Router) registerRoutes() {
	r.mux.HandleFunc("GET /healthz", handleHealthz)
	r.mux.HandleFunc("GET /api/v1/system", handleSystemHealth)
	r.mux.HandleFunc("GET /api/v1/targets", handleTargets)
	r.mux.HandleFunc("GET /api/v1/candidates", handleCandidates)
	r.mux.HandleFunc("GET /api/v1/anomalies", handleAnomalies)
	r.mux.HandleFunc("GET /api/v1/lightcurves", handleLightcurves)
}

func writeJSON(w http.ResponseWriter, status int, data any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(data)
}

func handleHealthz(w http.ResponseWriter, req *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"status":    "UP",
		"service":   "aurora-api",
		"timestamp": time.Now().UTC().Format(time.RFC3339),
	})
}
