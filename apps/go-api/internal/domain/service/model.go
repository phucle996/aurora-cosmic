package service

import (
	"context"

	"go-api/internal/domain/entity"
)

// Model defines the service contract for Model domain workflows.
type Model interface {
	TrainingPreflight(ctx context.Context, snapshotIDs []string) (*entity.TrainingPreflight, error)
	ListTrainingSnapshots(ctx context.Context, limit int) ([]entity.ModelTrainingSnapshot, error)
	StartTraining(ctx context.Context, spec entity.StartTrainingSpec) (*entity.TrainingResult, error)
	ControlTraining(ctx context.Context, spec entity.TrainingControlSpec) (*entity.TrainingControlResult, error)
	GetActiveTraining(ctx context.Context, ticketID string) (*entity.TrainingActiveState, error)
	ObserveTrainingProgress(ctx context.Context, event map[string]any) error
	ObserveTrainingLog(ctx context.Context, ticketID string, entry entity.TrainingLogEntry) error
	ListModels(ctx context.Context, task string) ([]entity.Model, error)
	GetModelEvaluation(ctx context.Context, runtimePackageID string) (*entity.ModelEvaluation, error)
	GetModelEvolution(ctx context.Context, runtimePackageID string) (*entity.ModelEvolutionEvidence, error)
	ListInferenceJobs(ctx context.Context, task, modelID, runtimePackageID string) ([]entity.InferenceJob, error)
	RetryInferenceJob(ctx context.Context, jobID string) (*entity.InferenceJobRetryResult, error)
	ReconcileChampionInference(ctx context.Context) (int, error)
}
