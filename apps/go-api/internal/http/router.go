package http

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"time"

	"go-api/internal/store"
)

// Router registers and manages all HTTP REST endpoints for the AURORA API Gateway.
type Router struct {
	mux           *http.ServeMux
	chStore       store.AnalyticsStore
	minioStore    store.ObjectStore
	allowedOrigin string
}

func NewRouter(chStore store.AnalyticsStore, minioStore store.ObjectStore, allowedOrigin string) *Router {
	mux := http.NewServeMux()
	r := &Router{
		mux:           mux,
		chStore:       chStore,
		minioStore:    minioStore,
		allowedOrigin: allowedOrigin,
	}
	r.registerRoutes()
	return r
}

func (r *Router) ServeHTTP(w http.ResponseWriter, req *http.Request) {
	if req.Header.Get("Origin") == r.allowedOrigin {
		w.Header().Set("Access-Control-Allow-Origin", r.allowedOrigin)
		w.Header().Set("Vary", "Origin")
		w.Header().Set("Access-Control-Allow-Methods", "GET, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
	}

	if req.Method == http.MethodOptions {
		w.WriteHeader(http.StatusOK)
		return
	}

	r.mux.ServeHTTP(w, req)
}

func (r *Router) registerRoutes() {
	r.mux.HandleFunc("GET /healthz", handleHealthz)
	r.mux.HandleFunc("GET /readyz", r.handleReady)
	r.mux.HandleFunc("GET /api/v1/system", r.handleSystemHealth)
	r.mux.HandleFunc("GET /api/v1/targets", r.handleTargets)
	r.mux.HandleFunc("GET /api/v1/candidates", r.handleCandidates)
	r.mux.HandleFunc("GET /api/v1/anomalies", r.handleAnomalies)
	r.mux.HandleFunc("GET /api/v1/lightcurves", r.handleLightcurves)
}

func writeJSON(w http.ResponseWriter, status int, data any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(data)
}

func writeServiceUnavailable(w http.ResponseWriter) {
	writeJSON(w, http.StatusServiceUnavailable, map[string]string{
		"error": "analytical data store is unavailable",
	})
}

func writeBadRequest(w http.ResponseWriter, message string) {
	writeJSON(w, http.StatusBadRequest, map[string]string{"error": message})
}

func (r *Router) dependencyStatus(req *http.Request) (map[string]string, bool) {
	ctx, cancel := context.WithTimeout(req.Context(), 2*time.Second)
	defer cancel()
	status := map[string]string{"storage_minio": "DOWN", "query_engine": "DOWN", "ml_inference": "NOT_CHECKED"}
	ready := true
	if r.minioStore != nil {
		if err := r.minioStore.Ping(ctx); err == nil {
			status["storage_minio"] = "UP"
		} else {
			slog.Default().Warn("MinIO readiness check failed", slog.Any("error", err))
			ready = false
		}
	} else {
		ready = false
	}
	if r.chStore != nil {
		if err := r.chStore.Ping(ctx); err == nil {
			status["query_engine"] = "UP"
		} else {
			slog.Default().Warn("ClickHouse readiness check failed", slog.Any("error", err))
			ready = false
		}
	} else {
		ready = false
	}
	return status, ready
}

func (r *Router) handleReady(w http.ResponseWriter, req *http.Request) {
	status, ready := r.dependencyStatus(req)
	code := http.StatusOK
	state := "READY"
	if !ready {
		code = http.StatusServiceUnavailable
		state = "NOT_READY"
	}
	writeJSON(w, code, map[string]any{"status": state, "service": "aurora-api", "subsystems": status})
}

func handleHealthz(w http.ResponseWriter, req *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"status":    "UP",
		"service":   "aurora-api",
		"timestamp": time.Now().UTC().Format(time.RFC3339),
	})
}
