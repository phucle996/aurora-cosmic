package repo

import "context"

type InferenceDispatcher interface {
	Dispatch(context.Context, string, []byte) error
}

// ModelPromotionBus carries ephemeral promotion telemetry and a request/reply
// runtime canary. Promotion is never committed when this bus is unavailable.
type ModelPromotionBus interface {
	PublishCore(context.Context, string, []byte) error
	RequestCore(context.Context, string, []byte) ([]byte, error)
}
