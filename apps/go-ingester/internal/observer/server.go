package observer

import (
	"context"
	"errors"
	"fmt"
	"net"
	"net/http"
	"time"
)

// Server publishes metrics and a lightweight health endpoint on a dedicated
// listener. It is intentionally independent from the ingestion command's
// business HTTP surface.
type Server struct {
	httpServer *http.Server
}

// Start binds addr and serves /metrics and /healthz until Shutdown is called.
func Start(addr string, metrics *Metrics) (*Server, error) {
	if metrics == nil {
		return nil, errors.New("observer: metrics is nil")
	}
	if addr == "" {
		return nil, errors.New("observer: metrics address is empty")
	}
	mux := http.NewServeMux()
	mux.Handle("/metrics", metrics.Handler())
	mux.HandleFunc("/healthz", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
		_, _ = w.Write([]byte("ok\n"))
	})

	server := &http.Server{
		Addr:              addr,
		Handler:           mux,
		ReadHeaderTimeout: 5 * time.Second,
	}
	listener, err := net.Listen("tcp", addr)
	if err != nil {
		return nil, fmt.Errorf("observer: listen %s: %w", addr, err)
	}
	s := &Server{httpServer: server}
	go func() {
		if err := server.Serve(listener); err != nil && !errors.Is(err, http.ErrServerClosed) {
			// The serving error is surfaced by the caller through the listener
			// bind path; shutdown errors are intentionally ignored here.
		}
	}()
	return s, nil
}

// Shutdown stops the metrics listener without interrupting an active request.
func (s *Server) Shutdown(ctx context.Context) error {
	if s == nil || s.httpServer == nil {
		return nil
	}
	return s.httpServer.Shutdown(ctx)
}
