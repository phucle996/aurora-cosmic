package observer

import (
	"context"
	"errors"
	"fmt"
	"net"
	"net/http"
	"time"
)

// Server publishes /metrics and a lightweight /healthz on a dedicated
// listener, separate from the public API listener.
type Server struct {
	httpServer *http.Server
}

// Start binds the observer address before returning, making configuration and
// port conflicts visible during application startup.
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
		ReadTimeout:       10 * time.Second,
		WriteTimeout:      10 * time.Second,
		IdleTimeout:       30 * time.Second,
	}
	listener, err := net.Listen("tcp", addr)
	if err != nil {
		return nil, fmt.Errorf("observer: listen %s: %w", addr, err)
	}
	s := &Server{httpServer: server}
	go func() {
		if err := server.Serve(listener); err != nil && !errors.Is(err, http.ErrServerClosed) {
			// The listener bind error is returned synchronously above. Runtime
			// serving errors are intentionally isolated from the API process.
		}
	}()
	return s, nil
}

// Shutdown stops the observer without interrupting an active scrape.
func (s *Server) Shutdown(ctx context.Context) error {
	if s == nil || s.httpServer == nil {
		return nil
	}
	return s.httpServer.Shutdown(ctx)
}
