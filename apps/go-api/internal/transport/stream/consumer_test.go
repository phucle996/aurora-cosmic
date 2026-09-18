package stream

import (
	"testing"
)

func TestStreamConsumerInitialization(t *testing.T) {
	consumer := New(Config{
		NATSURL: "nats://localhost:4222",
	})
	if consumer == nil {
		t.Fatal("expected non-nil StreamConsumer")
	}
}

func TestStreamConsumerRequiresConnOrURL(t *testing.T) {
	defer func() {
		if r := recover(); r == nil {
			t.Fatal("expected panic when neither Conn nor NATSURL is provided")
		}
	}()
	_ = New(Config{})
}
