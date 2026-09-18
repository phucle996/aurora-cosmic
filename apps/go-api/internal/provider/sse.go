package provider

import (
	"context"
	"sync"

	"go-api/internal/domain/entity"
)

// SSESubscription đại diện cho một kết nối đăng ký lắng nghe sự kiện qua SSE
type SSESubscription struct {
	Events <-chan entity.WorkflowEvent
	close  func()
}

// Close đóng kênh đăng ký và giải phóng tài nguyên
func (s *SSESubscription) Close() {
	if s != nil && s.close != nil {
		s.close()
	}
}

// SSEBroker là một In-Memory Event Broker thuần túy chịu trách nhiệm
// multiplexing và broadcast các sự kiện tới các subscriber SSE.
type SSEBroker struct {
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

// NewSSEBroker khởi tạo một thể hiện SSEBroker mới
func NewSSEBroker() *SSEBroker {
	return &SSEBroker{subscribers: make(map[uint64]subscriber)}
}

// Publish phát một sự kiện tới các subscriber phù hợp
func (b *SSEBroker) Publish(_ context.Context, event entity.WorkflowEvent) error {
	b.mu.Lock()
	defer b.mu.Unlock()

	if event.ID == "" {
		b.nextID++
		event.ID = formatID(b.nextID)
	}
	for _, sub := range b.subscribers {
		if sub.workflow != "" && sub.workflow != event.Workflow {
			continue
		}
		eventTicket := event.TicketID
		if eventTicket == "" {
			eventTicket = event.JobID
		}
		if sub.ticketID != "" && eventTicket != "" && sub.ticketID != eventTicket {
			continue
		}
		select {
		case sub.channel <- event:
		default:
			// SSE là kênh invalidation, subscriber chậm có thể bỏ qua thông báo trung gian
		}
	}
	return nil
}

// Subscribe đăng ký lắng nghe sự kiện theo workflow và ticketID
func (b *SSEBroker) Subscribe(ctx context.Context, workflow string, ticketIDs ...string) *SSESubscription {
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
	return &SSESubscription{Events: channel, close: closeSubscription}
}

func formatID(id uint64) string {
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
