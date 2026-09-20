package repository

import (
	"testing"
)

func TestFactoryRunIDPattern(t *testing.T) {
	validIDs := []string{
		"RUN-20260920-ABCD",
		"RUN-20260920-1234",
		"ticket-123_valid",
		"TICKET_01",
	}
	for _, id := range validIDs {
		if !factoryRunID.MatchString(id) {
			t.Errorf("expected %q to be valid factory run id", id)
		}
	}

	invalidIDs := []string{
		"",
		"bad ID with spaces",
		"bad;injection",
		"bad'quote",
		"bad\"doublequote",
	}
	for _, id := range invalidIDs {
		if factoryRunID.MatchString(id) {
			t.Errorf("expected %q to be invalid factory run id", id)
		}
	}
}
