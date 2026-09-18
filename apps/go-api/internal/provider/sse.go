package provider

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"sync"
)

// Event represents a generic event transmitted over Server-Sent Events (SSE).
// All fields must be explicitly provided - no silent fallbacks.
type Event struct {
	ID    string          `json:"id,omitempty"`
	Type  string          `json:"type"`  // SSE event name (e.g. "workflow", "message")
	Topic string          `json:"topic"` // Topic this event was published to (e.g. "obj:123", "ingest:ticket-456")
	Data  json.RawMessage `json:"data"`  // JSON payload to stream to the client
}

// SSESubscription represents an active SSE subscription channel.
type SSESubscription struct {
	Events <-chan Event
	close  func()
}

// Close closes the subscription channel and frees resources.
func (s *SSESubscription) Close() {
	if s != nil && s.close != nil {
		s.close()
	}
}

// EventPublisher defines the generic interface to publish events to a topic.
type EventPublisher interface {
	Publish(ctx context.Context, topic string, event Event) error
}

// SSEBroker is a generic in-memory event broker that routes events
// to SSE subscribers by topic without hardcoded service or domain models.
type SSEBroker struct {
	mu          sync.Mutex
	nextID      uint64
	nextSubID   uint64
	subscribers map[uint64]*sseSubscriber
}

type sseSubscriber struct {
	id     uint64
	topics map[string]struct{}
	ch     chan Event
}

// NewSSEBroker initializes a new generic SSEBroker instance.
func NewSSEBroker() *SSEBroker {
	return &SSEBroker{
		subscribers: make(map[uint64]*sseSubscriber),
	}
}

// Publish broadcasts an event to subscribers whose registered topics match.
// If inputs are invalid, it immediately returns an error without fallback.
func (b *SSEBroker) Publish(_ context.Context, topic string, event Event) error {
	topic = strings.TrimSpace(topic)
	if topic == "" {
		return errors.New("sse: topic is required")
	}
	if event.Topic == "" {
		return errors.New("sse: event.Topic is required")
	}
	if event.Topic != topic {
		return fmt.Errorf("sse: topic mismatch (param: %q, event: %q)", topic, event.Topic)
	}
	if strings.TrimSpace(event.Type) == "" {
		return errors.New("sse: event.Type is required")
	}
	if len(event.Data) == 0 {
		return errors.New("sse: event.Data is required")
	}

	b.mu.Lock()
	defer b.mu.Unlock()

	if event.ID == "" {
		b.nextID++
		event.ID = strconv.FormatUint(b.nextID, 10)
	}

	var root string
	if idx := strings.IndexByte(topic, ':'); idx != -1 {
		root = topic[:idx]
	}

	for _, sub := range b.subscribers {
		matched := false
		if _, ok := sub.topics[topic]; ok {
			matched = true
		} else if _, ok := sub.topics["*"]; ok {
			matched = true
		} else if root != "" {
			if _, ok := sub.topics[root]; ok {
				matched = true
			}
		}

		if matched {
			select {
			case sub.ch <- event:
			default:
				// Invalidation stream: drop intermediate message for slow client
			}
		}
	}

	return nil
}

// Subscribe registers a subscriber for one or more topics.
// Requires at least one non-empty topic. If invalid, returns error without fallback.
func (b *SSEBroker) Subscribe(ctx context.Context, topics ...string) (*SSESubscription, error) {
	if len(topics) == 0 {
		return nil, errors.New("sse: at least one topic is required")
	}

	subTopics := make(map[string]struct{})
	for _, t := range topics {
		t = strings.TrimSpace(t)
		if t != "" {
			subTopics[t] = struct{}{}
		}
	}
	if len(subTopics) == 0 {
		return nil, errors.New("sse: valid topic is required")
	}

	b.mu.Lock()
	b.nextSubID++
	id := b.nextSubID
	ch := make(chan Event, 16)

	b.subscribers[id] = &sseSubscriber{
		id:     id,
		topics: subTopics,
		ch:     ch,
	}
	b.mu.Unlock()

	var once sync.Once
	closeSub := func() {
		once.Do(func() {
			b.mu.Lock()
			if sub, ok := b.subscribers[id]; ok {
				delete(b.subscribers, id)
				close(sub.ch)
			}
			b.mu.Unlock()
		})
	}

	go func() {
		<-ctx.Done()
		closeSub()
	}()

	return &SSESubscription{
		Events: ch,
		close:  closeSub,
	}, nil
}
