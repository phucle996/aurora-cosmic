package handler

import "testing"

func TestObservationSubjectsKeepPresenceTrafficEphemeral(t *testing.T) {
	if got := observationSubject("ingest", "register"); got != "aurora.v1.ingest.observe.register" {
		t.Fatalf("ingest observer contract changed: %q", got)
	}
	if got := observationSubject("gold", "register"); got != "aurora.observe.gold.register" {
		t.Fatalf("gold presence must remain outside the durable Gold stream: %q", got)
	}
	if got := observationSubject("unknown", "register"); got != "" {
		t.Fatalf("unsupported workflow must not create a NATS subject: %q", got)
	}
}
