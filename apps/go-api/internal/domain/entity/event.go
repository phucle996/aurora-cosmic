package entity

import (
	"encoding/json"
	"time"
)

// WorkflowEvent is the small, stable event contract exposed by the API SSE
// stream. Payloads are opaque JSON so each workflow can carry its control job
// without coupling the event transport to a concrete workflow model.
type WorkflowEvent struct {
	ID         string          `json:"id"`
	Type       string          `json:"type"`
	Workflow   string          `json:"workflow"`
	Status     string          `json:"status"`
	JobID      string          `json:"job_id,omitempty"`
	OccurredAt time.Time       `json:"occurred_at"`
	Payload    json.RawMessage `json:"payload,omitempty"`
}
