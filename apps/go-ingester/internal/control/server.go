package control

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/http"
	"strings"
	"time"
)

type Server struct {
	addr   string
	jobs   *JobManager
	server *http.Server
}

func NewServer(addr string, jobs *JobManager) *Server {
	return &Server{addr: addr, jobs: jobs}
}

func (s *Server) Start() error {
	if s.jobs == nil {
		return fmt.Errorf("ingestion job manager is required")
	}
	mux := http.NewServeMux()
	mux.HandleFunc("/healthz", s.health)
	mux.HandleFunc("/api/v1/ingest/jobs", s.jobsHandler)
	mux.HandleFunc("/api/v1/ingest/jobs/", s.jobActionHandler)

	listener, err := net.Listen("tcp", s.addr)
	if err != nil {
		return fmt.Errorf("ingest control listen %s: %w", s.addr, err)
	}
	s.server = &http.Server{Addr: s.addr, Handler: mux, ReadHeaderTimeout: 5 * time.Second}
	go func() { _ = s.server.Serve(listener) }()
	return nil
}

func (s *Server) Shutdown(ctx context.Context) error {
	if s.server == nil {
		return nil
	}
	return s.server.Shutdown(ctx)
}

func (s *Server) health(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	_, _ = w.Write([]byte("ok\n"))
}

func (s *Server) jobsHandler(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		job := s.jobs.Current()
		if job == nil {
			writeJSON(w, http.StatusOK, map[string]string{"status": "not_observed"})
			return
		}
		writeJSON(w, http.StatusOK, job)
	case http.MethodPost:
		var request StartRequest
		decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 32<<10))
		decoder.DisallowUnknownFields()
		if err := decoder.Decode(&request); err != nil {
			writeError(w, http.StatusBadRequest, "invalid request")
			return
		}
		job, err := s.jobs.Start(request)
		if err != nil {
			if errors.Is(err, ErrJobAlreadyRunning) {
				writeError(w, http.StatusConflict, err.Error())
				return
			}
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		writeJSON(w, http.StatusAccepted, job)
	default:
		w.Header().Set("Allow", "GET, POST")
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

func (s *Server) jobActionHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.Header().Set("Allow", "POST")
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	path := strings.TrimPrefix(r.URL.Path, "/api/v1/ingest/jobs/")
	if !strings.HasSuffix(path, "/cancel") {
		writeError(w, http.StatusNotFound, "unsupported action")
		return
	}
	jobID := strings.Trim(strings.TrimSuffix(path, "/cancel"), "/")
	job, err := s.jobs.Cancel(jobID)
	if err != nil {
		if errors.Is(err, ErrJobNotFound) {
			writeError(w, http.StatusNotFound, err.Error())
			return
		}
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusAccepted, job)
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}

func writeError(w http.ResponseWriter, status int, message string) {
	writeJSON(w, status, map[string]string{"error": message})
}
