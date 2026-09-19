package control

import (
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"strings"

	"github.com/nats-io/nats.go"
)

const (
	SubjectIngestStart   = "aurora.v1.ingest.control.start"
	SubjectIngestCancel  = "aurora.v1.ingest.control.cancel"
	SubjectIngestCurrent = "aurora.v1.ingest.control.current"
)

type NATSListener struct {
	nc   *nats.Conn
	subs []*nats.Subscription
	ctrl *Controller
	log  *slog.Logger
}

func NewNATSListener(nc *nats.Conn, ctrl *Controller, log *slog.Logger) (*NATSListener, error) {
	if nc == nil {
		return nil, fmt.Errorf("nats connection is required")
	}
	if ctrl == nil {
		return nil, fmt.Errorf("ingestion controller is required")
	}
	if log == nil {
		log = slog.Default()
	}

	return &NATSListener{
		nc:   nc,
		ctrl: ctrl,
		log:  log,
	}, nil
}

func (l *NATSListener) Start() error {
	subStart, err := l.nc.Subscribe(SubjectIngestStart, func(msg *nats.Msg) {
		var req StartRequest
		if err := json.Unmarshal(msg.Data, &req); err != nil {
			_ = respondError(msg, 400, "invalid start request")
			return
		}
		exec, err := l.ctrl.Start(req)
		if err != nil {
			if errors.Is(err, ErrAlreadyRunning) {
				_ = respondError(msg, 409, err.Error())
				return
			}
			_ = respondError(msg, 400, err.Error())
			return
		}
		data, _ := json.Marshal(exec)
		_ = msg.Respond(data)
	})
	if err != nil {
		return fmt.Errorf("subscribe %s: %w", SubjectIngestStart, err)
	}
	l.subs = append(l.subs, subStart)

	subCancel, err := l.nc.Subscribe(SubjectIngestCancel, func(msg *nats.Msg) {
		var req struct {
			TicketID string `json:"ticket_id"`
		}
		if err := json.Unmarshal(msg.Data, &req); err != nil || strings.TrimSpace(req.TicketID) == "" {
			_ = respondError(msg, 400, "ticket_id is required for cancel")
			return
		}
		ticketID := strings.TrimSpace(req.TicketID)
		exec, err := l.ctrl.Cancel(ticketID)
		if err != nil {
			if errors.Is(err, ErrTicketNotFound) {
				_ = respondError(msg, 404, err.Error())
				return
			}
			_ = respondError(msg, 500, err.Error())
			return
		}
		data, _ := json.Marshal(exec)
		_ = msg.Respond(data)
	})
	if err != nil {
		return fmt.Errorf("subscribe %s: %w", SubjectIngestCancel, err)
	}
	l.subs = append(l.subs, subCancel)

	subCurrent, err := l.nc.Subscribe(SubjectIngestCurrent, func(msg *nats.Msg) {
		exec := l.ctrl.Current()
		if exec == nil {
			_ = msg.Respond([]byte(`{"status":"not_observed"}`))
			return
		}
		data, _ := json.Marshal(exec)
		_ = msg.Respond(data)
	})
	if err != nil {
		return fmt.Errorf("subscribe %s: %w", SubjectIngestCurrent, err)
	}
	l.subs = append(l.subs, subCurrent)

	l.log.Info("NATS ingest control listener started", slog.String("subjects", "aurora.v1.ingest.control.*"))
	return nil
}

func (l *NATSListener) Close() error {
	for _, sub := range l.subs {
		_ = sub.Unsubscribe()
	}
	return nil
}

func respondError(msg *nats.Msg, code int, message string) error {
	payload, _ := json.Marshal(map[string]any{
		"error": message,
		"code":  code,
	})
	return msg.Respond(payload)
}
