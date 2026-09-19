package repo

import (
	"time"
)

// SilverEventStreamSnapshot snapshot trạng thái stream JetStream AURORA_SILVER
type SilverEventStreamSnapshot struct {
	Messages  int64
	Bytes     int64
	Consumers int
	FirstAt   time.Time
	LastAt    time.Time
	BySubject map[string]int64
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
