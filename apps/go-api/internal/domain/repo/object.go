package repo

import (
	"context"
	"errors"
	"time"

	"go-api/internal/domain/entity"
)

var ErrObjectNotFound = errors.New("object not found")

type ObjectInfo struct {
	Key          string
	Size         int64
	ETag         string
	LastModified time.Time
	UserMetadata map[string]string
}

// ObjectMetadataRepository is an optional capability used by scientific
// inventory readers that need object-level evidence without downloading the
// artifact body.
type ObjectMetadataRepository interface {
	ListObjectsWithMetadata(context.Context, string) ([]ObjectInfo, error)
}

type CatalogObject struct {
	Tier         string
	ObjectKey    string
	SizeBytes    int64
	ETag         string
	Sector       int32
	TICID        int64
	ProductType  string
	LastModified time.Time
}

type LakehouseCatalogRepository interface {
	EnsureSchema(ctx context.Context) error
	UpsertObjects(ctx context.Context, objects []CatalogObject) error
	ListObjects(ctx context.Context, tier, prefix string, page, limit int) ([]CatalogObject, int64, int64, error)
	CountObjects(ctx context.Context, tier string) (int64, int64, error)
}

type ObjectRepository interface {
	Ping(context.Context) error
	ListObjects(context.Context, string) ([]ObjectInfo, error)
	GetObject(context.Context, string) ([]byte, error)
	PutObject(context.Context, string, []byte, string) error
	DeleteObject(context.Context, string) error
}

type IngestController interface {
	Start(context.Context, entity.IngestStartRequest) (*entity.IngestControlJob, error)
	Cancel(context.Context, string) (*entity.IngestControlJob, error)
}

type IngestRuntimeController interface {
	Current(context.Context) (*entity.IngestControlJob, error)
}

type WorkflowDispatcher interface {
	Dispatch(context.Context, string, []byte) error
}

type SilverEventStreamSnapshot struct {
	Messages  int64
	Bytes     int64
	Consumers int
	FirstAt   time.Time
	LastAt    time.Time
	BySubject map[string]int64
}

// SilverEventStreamObserver reads bounded JetStream metadata only. It does not
// consume or acknowledge downstream science events.
type SilverEventStreamObserver interface {
	ObserveSilverEventStream(context.Context) (SilverEventStreamSnapshot, error)
}

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

type BronzeConsumerObserver interface {
	ObserveBronzeConsumer(context.Context) (BronzeConsumerSnapshot, error)
}

type EventPublisher interface {
	Publish(context.Context, entity.WorkflowEvent) error
}
