package app

import (
	"fmt"

	"go-api/internal/events"
	"go-api/internal/repository"
	"go-api/internal/service"
	"go-api/internal/transport/http/handler"
	"go-api/internal/transport/stream"
)

type Module struct {
	AnalyticsHandler     *handler.AnalyticsHandler
	ModelsHandler        *handler.ModelsHandler
	SystemHandler        *handler.SystemHandler
	MonitoringHandler    *handler.MonitoringHandler
	PreprocessingHandler *handler.PreprocessingHandler
	IngestHandler        *handler.IngestHandler
	EventsHandler        *handler.EventsHandler
	NATSStream           *stream.NATSStream
}

func NewModule(infra Infrastructure) (*Module, error) {
	if infra.ClickHouse == nil {
		return nil, fmt.Errorf("infrastructure ClickHouse client is nil")
	}
	if infra.MinIO == nil {
		return nil, fmt.Errorf("infrastructure MinIO client is nil")
	}
	if infra.PredictionMinIO == nil {
		return nil, fmt.Errorf("infrastructure prediction MinIO client is nil")
	}
	if infra.NATS == nil {
		return nil, fmt.Errorf("infrastructure NATS dispatcher is nil")
	}
	if infra.Prometheus == nil {
		return nil, fmt.Errorf("infrastructure Prometheus client is nil")
	}

	analyticsRepo := repository.NewAnalyticsClickHouse(infra.ClickHouse)
	if analyticsRepo == nil {
		return nil, fmt.Errorf("repository AnalyticsClickHouse is nil")
	}
	objectRepo := repository.NewObjectMinIO(infra.MinIO)
	if objectRepo == nil {
		return nil, fmt.Errorf("repository ObjectMinIO is nil")
	}
	predictionObjectRepo := repository.NewObjectMinIO(infra.PredictionMinIO)
	if predictionObjectRepo == nil {
		return nil, fmt.Errorf("repository prediction ObjectMinIO is nil")
	}
	eventBroker := events.NewBroker()

	analyticsService := service.NewAnalyticsService(analyticsRepo, predictionObjectRepo)
	if analyticsService == nil {
		return nil, fmt.Errorf("service AnalyticsService is nil")
	}
	modelsService := service.NewModelsService(objectRepo, infra.NATS)
	if modelsService == nil {
		return nil, fmt.Errorf("service ModelsService is nil")
	}
	inferenceService := service.NewInferenceService(objectRepo, infra.NATS)
	if inferenceService == nil {
		return nil, fmt.Errorf("service InferenceService is nil")
	}
	readinessService := service.NewReadinessService(infra.MinIO, analyticsRepo)
	if readinessService == nil {
		return nil, fmt.Errorf("service ReadinessService is nil")
	}
	monitoringService := service.NewMonitoringService(infra.Prometheus)
	if monitoringService == nil {
		return nil, fmt.Errorf("service MonitoringService is nil")
	}
	preprocessingService := service.NewPreprocessingServiceWithEventsAndObjects(infra.Prometheus, infra.NATS, eventBroker, objectRepo)
	if preprocessingService == nil {
		return nil, fmt.Errorf("service PreprocessingService is nil")
	}
	catalogRepo := repository.NewCatalogClickHouse(infra.ClickHouse)
	ingestService := service.NewIngestServiceWithCatalogAndEvents(objectRepo, catalogRepo, infra.Prometheus, infra.MinIO.Bucket, infra.Ingester, eventBroker)
	if ingestService == nil {
		return nil, fmt.Errorf("service IngestService is nil")
	}

	natsStream := stream.NewNATSStream(stream.StreamConfig{
		NATSURL:       infra.NATS.URL,
		Broker:        eventBroker,
		Preprocessing: preprocessingService,
		Ingest:        ingestService,
		Inference:     inferenceService,
		Models:        modelsService,
	})

	return &Module{
		AnalyticsHandler:     handler.NewAnalyticsHandler(analyticsService),
		ModelsHandler:        handler.NewModelsHandler(modelsService, inferenceService),
		SystemHandler:        handler.NewSystemHandler(readinessService),
		MonitoringHandler:    handler.NewMonitoringHandler(monitoringService),
		PreprocessingHandler: handler.NewPreprocessingHandler(preprocessingService),
		IngestHandler:        handler.NewIngestHandler(ingestService),
		EventsHandler:        handler.NewEventsHandler(eventBroker),
		NATSStream:           natsStream,
	}, nil
}
