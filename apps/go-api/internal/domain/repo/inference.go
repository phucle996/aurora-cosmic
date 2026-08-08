package repo

import "context"

type InferenceDispatcher interface {
	Dispatch(context.Context, string, []byte) error
}
