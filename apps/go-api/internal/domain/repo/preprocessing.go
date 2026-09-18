package repo

import (
	"context"
	"time"
)

// WorkflowDispatcher định nghĩa port điều khiển tác vụ tiền xử lý qua message bus
type WorkflowDispatcher interface {
	Dispatch(context.Context, string, []byte) error
}

// SilverEventStreamSnapshot snapshot trạng thái stream JetStream AURORA_SILVER
type SilverEventStreamSnapshot struct {
	Messages  int64
	Bytes     int64
	Consumers int
	FirstAt   time.Time
	LastAt    time.Time
	BySubject map[string]int64
}

// SilverEventStreamObserver giám sát metadata của JetStream stream AURORA_SILVER
type SilverEventStreamObserver interface {
	ObserveSilverEventStream(context.Context) (SilverEventStreamSnapshot, error)
}

// BronzeConsumerSnapshot snapshot trạng thái ACK/Pending của consumer Bronze
type BronzeConsumerSnapshot struct {
	StreamMessages       int64
	StreamBytes          int64
	ConsumerName         string
	DeliveredConsumerSeq int64
	DeliveredStreamSeq   int64
	AckFloorConsumerSeq  int64
	AckFloorStreamSeq    int64
	AckPending           int
	Pending              int64
	CurrentRedelivered   int
	Waiting              int
	LastDeliveredAt      time.Time
	LastAckAt            time.Time
}

// BronzeConsumerObserver giám sát trạng thái ACK của durable Bronze consumer
type BronzeConsumerObserver interface {
	ObserveBronzeConsumer(context.Context) (BronzeConsumerSnapshot, error)
}
