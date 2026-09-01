package observer

import (
	"encoding/json"
	"sync"
	"time"

	"github.com/nats-io/nats.go"
)

// IngestRuntimeEvent is the compact, ticket-scoped observation contract for
// the ingestion UI. It intentionally contains metadata only, never FITS data.
type IngestRuntimeEvent struct {
	TicketID             string    `json:"ticket_id"`
	JobID                string    `json:"job_id"`
	Status               string    `json:"status"`
	PlanningStage        string    `json:"planning_stage,omitempty"`
	PlanningCompleted    int       `json:"planning_completed,omitempty"`
	PlanningTotal        int       `json:"planning_total,omitempty"`
	PlanningProducts     int       `json:"planning_products,omitempty"`
	Error                string    `json:"error,omitempty"`
	ProductID            string    `json:"product_id,omitempty"`
	ProductKind          string    `json:"product_kind,omitempty"`
	WorkerID             int       `json:"worker_id,omitempty"`
	ProductBytes         int64     `json:"product_bytes,omitempty"`
	ProductExpectedBytes int64     `json:"product_expected_bytes,omitempty"`
	CompletedProducts    int64     `json:"completed_products,omitempty"`
	TotalProducts        int       `json:"total_products,omitempty"`
	CompletedBytes       int64     `json:"completed_bytes,omitempty"`
	ExpectedBytes        int64     `json:"expected_bytes,omitempty"`
	ActiveWorkers        int       `json:"active_workers,omitempty"`
	OccurredAt           time.Time `json:"occurred_at"`
}

// IngestRuntimeObserver only emits detailed runtime events while the API has
// an active SSE observation ticket. Tickets expire unless the API heartbeats.
type IngestRuntimeObserver struct {
	nc      *nats.Conn
	mu      sync.Mutex
	tickets map[string]time.Time
}

func NewIngestRuntimeObserver(url string) (*IngestRuntimeObserver, error) {
	nc, err := nats.Connect(url, nats.Name("aurora-ingester-observer"), nats.Timeout(5*time.Second))
	if err != nil {
		return nil, err
	}
	o := &IngestRuntimeObserver{nc: nc, tickets: make(map[string]time.Time)}
	if _, err := nc.Subscribe("aurora.v1.ingest.observe.>", o.observe); err != nil {
		nc.Close()
		return nil, err
	}
	if err := nc.FlushTimeout(5 * time.Second); err != nil {
		nc.Close()
		return nil, err
	}
	return o, nil
}

func (o *IngestRuntimeObserver) observe(msg *nats.Msg) {
	var payload struct {
		TicketID string `json:"ticket_id"`
	}
	if json.Unmarshal(msg.Data, &payload) != nil || payload.TicketID == "" {
		return
	}
	o.mu.Lock()
	defer o.mu.Unlock()
	if msg.Subject == "aurora.v1.ingest.observe.unregister" {
		delete(o.tickets, payload.TicketID)
		return
	}
	if msg.Subject == "aurora.v1.ingest.observe.register" {
		o.tickets[payload.TicketID] = time.Now().Add(45 * time.Second)
	}
}

func (o *IngestRuntimeObserver) Publish(event IngestRuntimeEvent) {
	if o == nil || o.nc == nil || !o.nc.IsConnected() {
		return
	}
	now := time.Now().UTC()
	if event.OccurredAt.IsZero() {
		event.OccurredAt = now
	}
	o.mu.Lock()
	tickets := make([]string, 0, len(o.tickets))
	for ticket, expiresAt := range o.tickets {
		if now.After(expiresAt) {
			delete(o.tickets, ticket)
			continue
		}
		tickets = append(tickets, ticket)
	}
	o.mu.Unlock()
	for _, ticket := range tickets {
		event.TicketID = ticket
		payload, err := json.Marshal(event)
		if err == nil {
			_ = o.nc.Publish("aurora.v1.ingest.runtime."+ticket, payload)
		}
	}
}

func (o *IngestRuntimeObserver) Close() error {
	if o != nil && o.nc != nil {
		o.nc.Close()
	}
	return nil
}
