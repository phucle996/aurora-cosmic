package events

import (
	"context"
	"sync"

	"go-api/internal/domain/entity"
)

type Subscription struct {
	Events <-chan entity.WorkflowEvent
	close  func()
}

func (s *Subscription) Close() {
	if s != nil && s.close != nil {
		s.close()
	}
}

type Broker struct {
	mu          sync.Mutex
	nextID      uint64
	nextSubID   uint64
	subscribers map[uint64]subscriber
}

type subscriber struct {
	workflow string
	ticketID string
	channel  chan entity.WorkflowEvent
}

func NewBroker() *Broker {
	return &Broker{subscribers: make(map[uint64]subscriber)}
}

func (b *Broker) Publish(_ context.Context, event entity.WorkflowEvent) error {
	if b == nil {
		return nil
	}
	b.mu.Lock()
	if event.ID == "" {
		b.nextID++
		event.ID = formatID(b.nextID)
	}
	for _, sub := range b.subscribers {
		if sub.workflow != "" && sub.workflow != event.Workflow {
			continue
		}
		if sub.ticketID != "" && sub.ticketID != event.TicketID {
			continue
		}
		select {
		case sub.channel <- event:
		default:
			// SSE is an invalidation channel. A slow browser can safely miss an
			// intermediate notification because it refetches authoritative state.
		}
	}
	b.mu.Unlock()
	return nil
}

func (b *Broker) Subscribe(ctx context.Context, workflow string, ticketIDs ...string) *Subscription {
	if b == nil {
		return &Subscription{Events: make(chan entity.WorkflowEvent)}
	}
	b.mu.Lock()
	b.nextSubID++
	id := b.nextSubID
	channel := make(chan entity.WorkflowEvent, 16)
	ticketID := ""
	if len(ticketIDs) > 0 {
		ticketID = ticketIDs[0]
	}
	b.subscribers[id] = subscriber{workflow: workflow, ticketID: ticketID, channel: channel}
	b.mu.Unlock()

	closeSubscription := func() {
		b.mu.Lock()
		if sub, ok := b.subscribers[id]; ok {
			delete(b.subscribers, id)
			close(sub.channel)
		}
		b.mu.Unlock()
	}
	go func() {
		<-ctx.Done()
		closeSubscription()
	}()
	return &Subscription{Events: channel, close: closeSubscription}
}

func formatID(id uint64) string {
	// IDs only need to be monotonic within one API process for Last-Event-ID
	// debugging; event payloads remain authoritative and replay is not implied.
	const digits = "0123456789"
	if id == 0 {
		return "0"
	}
	var buffer [20]byte
	index := len(buffer)
	for id > 0 {
		index--
		buffer[index] = digits[id%10]
		id /= 10
	}
	return string(buffer[index:])
}
