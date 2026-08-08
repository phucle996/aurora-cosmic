package service

import (
	"context"
	"go-api/internal/domain/entity"
)

type Inference interface {
	ListJobs(context.Context, string, string) ([]entity.InferenceJob, error)
	RetryJob(context.Context, string) (entity.InferenceJobManifest, map[string]any, error)
}
