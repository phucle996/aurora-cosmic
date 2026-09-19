package app

import (
	"fmt"

	"go-api/internal/provider"
	"go-api/internal/repository"
	"go-api/internal/service"
	"go-api/internal/transport/http/handler"
	"go-api/internal/transport/pubsub"
	"go-api/internal/transport/stream"
)

type Module struct {
	TargetHandler         *handler.TargetHandler
	CandidateHandler      *handler.CandidateHandler
	AnomalyHandler        *handler.AnomalyHandler
	ModelsHandler         *handler.ModelsHandler
	SystemHandler         *handler.SystemHandler
	MonitoringHandler     *handler.MonitoringHandler
	DAGAggregationHandler *handler.DAGAggregationHandler
	PreprocessingHandler  *handler.PreprocessingHandler
	GoldControlHandler    *handler.GoldControlHandler
	TicketHandler         *handler.TicketHandler
	IngestHandler         *handler.IngestHandler
	LakehouseHandler      *handler.LakehouseHandler
	EventsHandler         *handler.EventsHandler
	NATSPubSub            *pubsub.NATSPubSub
	NATSStream            *stream.StreamConsumer
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
		return nil, fmt.Errorf("infrastructure NATS client is nil")
	}
	if infra.Prometheus == nil {
		return nil, fmt.Errorf("infrastructure Prometheus client is nil")
	}

	targetRepo := repository.NewTargetClickHouse(infra.ClickHouse)
	candidateRepo := repository.NewCandidateClickHouse(infra.ClickHouse)
	anomalyRepo := repository.NewAnomalyClickHouse(infra.ClickHouse)
	trainingRepo := repository.NewTrainingClickHouse(infra.ClickHouse)
	objectRepo := provider.NewObjectStorage(infra.MinIO)
	if objectRepo == nil {
		return nil, fmt.Errorf("provider ObjectStorage is nil")
	}
	predictionObjectRepo := provider.NewObjectStorage(infra.PredictionMinIO)
	if predictionObjectRepo == nil {
		return nil, fmt.Errorf("provider prediction ObjectStorage is nil")
	}
	eventBroker := provider.NewSSEBroker()
	predictionProjectionRepo := repository.NewPredictionProjectionClickHouse(infra.ClickHouse)
	predictionProjector := service.NewPredictionProjectorService(
		predictionObjectRepo,
		predictionProjectionRepo,
		infra.PredictionMinIO.Bucket,
	)

	targetService := service.NewTargetService(targetRepo)
	if targetService == nil {
		return nil, fmt.Errorf("service TargetService is nil")
	}
	candidateService := service.NewCandidateService(candidateRepo)
	if candidateService == nil {
		return nil, fmt.Errorf("service CandidateService is nil")
	}
	anomalyService := service.NewAnomalyService(anomalyRepo, predictionObjectRepo)
	if anomalyService == nil {
		return nil, fmt.Errorf("service AnomalyService is nil")
	}
	modelsService := service.NewModelsService(objectRepo, infra.NATS, trainingRepo)
	if modelsService == nil {
		return nil, fmt.Errorf("service ModelsService is nil")
	}
	inferenceService := service.NewInferenceServiceWithResults(objectRepo, predictionObjectRepo, infra.NATS, infra.MinIO.Bucket)
	if inferenceService == nil {
		return nil, fmt.Errorf("service InferenceService is nil")
	}
	readinessService := service.NewReadinessService(objectRepo, infra.ClickHouse, infra.NATS)
	if readinessService == nil {
		return nil, fmt.Errorf("service ReadinessService is nil")
	}
	prometheusQuerier := provider.NewPrometheusQueryBase(infra.Prometheus)
	monitoringService := service.NewMonitoringService(prometheusQuerier)
	if monitoringService == nil {
		return nil, fmt.Errorf("service MonitoringService is nil")
	}
	preprocessingService := service.NewPreprocessingService(infra.NATS, eventBroker, objectRepo)
	if preprocessingService == nil {
		return nil, fmt.Errorf("service PreprocessingService is nil")
	}
	goldControlService := service.NewGoldControlService(objectRepo, eventBroker)
	if goldControlService == nil {
		return nil, fmt.Errorf("service GoldControlService is nil")
	}
	ticketRepository := repository.NewTicketClickHouse(infra.ClickHouse, objectRepo)
	ticketService := service.NewTicketService(ticketRepository)
	ingestService := service.NewIngestService(objectRepo, infra.MinIO.Bucket, infra.NATS, eventBroker)
	if ingestService == nil {
		return nil, fmt.Errorf("service IngestService is nil")
	}
	lakehouseService := service.NewLakehouseService(objectRepo, infra.MinIO.Bucket)
	if lakehouseService == nil {
		return nil, fmt.Errorf("service LakehouseService is nil")
	}

	dagAggregationService := service.NewDAGAggregationService(preprocessingService, prometheusQuerier, objectRepo)

	natsPubSub := pubsub.New(pubsub.Config{
		NATSURL:           infra.NATS.URL,
		Broker:            eventBroker,
		DAGAggregation:    dagAggregationService,
		ChampionInference: inferenceService,
	})

	natsStream := stream.New(stream.Config{
		NATSURL:             infra.NATS.URL,
		PredictionProjector: predictionProjector,
	})

	return &Module{
		TargetHandler:         handler.NewTargetHandler(targetService),
		CandidateHandler:      handler.NewCandidateHandler(candidateService),
		AnomalyHandler:        handler.NewAnomalyHandler(anomalyService),
		ModelsHandler:         handler.NewModelsHandler(modelsService, inferenceService),
		SystemHandler:         handler.NewSystemHandler(readinessService),
		MonitoringHandler:     handler.NewMonitoringHandler(monitoringService),
		DAGAggregationHandler: handler.NewDAGAggregationHandler(dagAggregationService),
		PreprocessingHandler:  handler.NewPreprocessingHandler(preprocessingService),
		GoldControlHandler:    handler.NewGoldControlHandler(goldControlService),
		TicketHandler:         handler.NewTicketHandler(ticketService),
		IngestHandler:         handler.NewIngestHandler(ingestService),
		LakehouseHandler:      handler.NewLakehouseHandler(lakehouseService),
		EventsHandler:         handler.NewEventsHandler(eventBroker, infra.NATS),
		NATSPubSub:            natsPubSub,
		NATSStream:            natsStream,
	}, nil
}
