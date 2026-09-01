package entity

import "time"

type WorkflowEvent struct {
	ID         string
	Type       string
	Workflow   string
	Status     string
	JobID      string
	TicketID   string
	OccurredAt time.Time
	Payload    []byte
}
