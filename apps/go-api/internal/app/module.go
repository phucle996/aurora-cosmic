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

// Module encapsulates all application capabilities, workflow handlers, and event consumers.
type Module struct {
	TargetHandler            *handler.TargetHandler
	CandidateHandler         *handler.CandidateHandler
	AnomalyHandler           *handler.AnomalyHandler
	ModelsHandler            *handler.ModelsHandler
	ModelNewHandler          *handler.ModelNewHandler
	LabelingHandler          *handler.LabelingHandler
	SystemHandler            *handler.SystemHandler
	MonitoringHandler        *handler.MonitoringHandler
	DAGAggregationHandler    *handler.DAGAggregationHandler
	PreprocessingHandler     *handler.PreprocessingHandler
	EnrichmentControlHandler *handler.EnrichmentControlHandler
	LineageHandler           *handler.LineageHandler
	TicketHandler            *handler.TicketHandler
	IngestHandler            *handler.IngestHandler
	LakehouseHandler         *handler.LakehouseHandler
	EventsHandler            *handler.EventsHandler
	NATSPubSub               *pubsub.NATSPubSub
	NATSStream               *stream.StreamConsumer
}

// NewModule initializes and wires all domain workflows (Repository -> Service -> Handler)
// organized strictly by workflow/domain boundary.
func NewModule(infra Infrastructure) (*Module, error) {
	// =========================================================================
	// 0. Infrastructure Verification
	// =========================================================================
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

	// =========================================================================
	// 1. Shared Foundation Providers (Object Storage, SSE Broker, Prometheus)
	// =========================================================================
	objectRepo := provider.NewObjectStorage(infra.MinIO)
	if objectRepo == nil {
		return nil, fmt.Errorf("provider ObjectStorage is nil")
	}

	predictionObjectRepo := provider.NewObjectStorage(infra.PredictionMinIO)
	if predictionObjectRepo == nil {
		return nil, fmt.Errorf("provider prediction ObjectStorage is nil")
	}

	eventBroker := provider.NewSSEBroker()
	if eventBroker == nil {
		return nil, fmt.Errorf("provider EventBroker is nil")
	}

	prometheusQuerier := provider.NewPrometheusQueryBase(infra.Prometheus)
	if prometheusQuerier == nil {
		return nil, fmt.Errorf("provider PrometheusQuerier is nil")
	}

	// =========================================================================
	// 2. System Readiness & Health Branch
	// =========================================================================
	readinessService := service.NewReadinessService(objectRepo, infra.ClickHouse, infra.NATS)
	if readinessService == nil {
		return nil, fmt.Errorf("service ReadinessService is nil")
	}
	systemHandler := handler.NewSystemHandler(readinessService)
	if systemHandler == nil {
		return nil, fmt.Errorf("handler SystemHandler is nil")
	}

	// =========================================================================
	// 3. Telemetry & Component Monitoring Branch
	// =========================================================================
	monitoringService := service.NewMonitoringService(prometheusQuerier)
	if monitoringService == nil {
		return nil, fmt.Errorf("service MonitoringService is nil")
	}
	monitoringHandler := handler.NewMonitoringHandler(monitoringService)
	if monitoringHandler == nil {
		return nil, fmt.Errorf("handler MonitoringHandler is nil")
	}

	// =========================================================================
	// 4. Target Workflow Branch (TIC Catalog, Observations, Lightcurves)
	// =========================================================================
	targetRepo := repository.NewTargetClickHouse(infra.ClickHouse)
	if targetRepo == nil {
		return nil, fmt.Errorf("repository TargetClickHouse is nil")
	}
	targetService := service.NewTargetService(targetRepo)
	if targetService == nil {
		return nil, fmt.Errorf("service TargetService is nil")
	}
	targetHandler := handler.NewTargetHandler(targetService)
	if targetHandler == nil {
		return nil, fmt.Errorf("handler TargetHandler is nil")
	}

	// =========================================================================
	// 5. Candidate Workflow Branch (Vetted Transit Candidates)
	// =========================================================================
	candidateRepo := repository.NewCandidateClickHouse(infra.ClickHouse)
	if candidateRepo == nil {
		return nil, fmt.Errorf("repository CandidateClickHouse is nil")
	}
	candidateService := service.NewCandidateService(candidateRepo)
	if candidateService == nil {
		return nil, fmt.Errorf("service CandidateService is nil")
	}
	candidateHandler := handler.NewCandidateHandler(candidateService)
	if candidateHandler == nil {
		return nil, fmt.Errorf("handler CandidateHandler is nil")
	}

	// =========================================================================
	// 6. Anomaly Workflow Branch (Unsupervised Deep Learning Outliers)
	// =========================================================================
	anomalyRepo := repository.NewAnomalyClickHouse(infra.ClickHouse)
	if anomalyRepo == nil {
		return nil, fmt.Errorf("repository AnomalyClickHouse is nil")
	}
	anomalyService := service.NewAnomalyService(anomalyRepo, predictionObjectRepo)
	if anomalyService == nil {
		return nil, fmt.Errorf("service AnomalyService is nil")
	}
	anomalyHandler := handler.NewAnomalyHandler(anomalyService)
	if anomalyHandler == nil {
		return nil, fmt.Errorf("handler AnomalyHandler is nil")
	}

	// =========================================================================
	// 7. ML Models, Training & Inference Branch
	// =========================================================================
	trainingRepo := repository.NewTrainingClickHouse(infra.ClickHouse)
	if trainingRepo == nil {
		return nil, fmt.Errorf("repository TrainingClickHouse is nil")
	}
	modelsService := service.NewModelsService(objectRepo, infra.NATS, trainingRepo)
	if modelsService == nil {
		return nil, fmt.Errorf("service ModelsService is nil")
	}
	inferenceService := service.NewInferenceServiceWithResults(objectRepo, predictionObjectRepo, infra.NATS, infra.MinIO.Bucket)
	if inferenceService == nil {
		return nil, fmt.Errorf("service InferenceService is nil")
	}
	modelsHandler := handler.NewModelsHandler(modelsService, inferenceService)
	if modelsHandler == nil {
		return nil, fmt.Errorf("handler ModelsHandler is nil")
	}

	modelNewRepo := repository.NewModelNewClickHouse(infra.ClickHouse)
	if modelNewRepo == nil {
		return nil, fmt.Errorf("repository ModelNewClickHouse is nil")
	}
	modelNewService := service.NewModelNewService(objectRepo, infra.NATS, modelNewRepo)
	if modelNewService == nil {
		return nil, fmt.Errorf("service ModelNewService is nil")
	}
	modelNewHandler := handler.NewModelNewHandler(modelNewService)
	if modelNewHandler == nil {
		return nil, fmt.Errorf("handler ModelNewHandler is nil")
	}

	predictionProjectionRepo := repository.NewPredictionProjectionClickHouse(infra.ClickHouse)
	if predictionProjectionRepo == nil {
		return nil, fmt.Errorf("repository PredictionProjectionClickHouse is nil")
	}
	predictionProjector := service.NewPredictionProjectorService(
		predictionObjectRepo,
		predictionProjectionRepo,
		infra.PredictionMinIO.Bucket,
	)

	// =========================================================================
	// 7b. Labeling Studio Branch (Human-in-the-loop Scientific Supervision)
	// =========================================================================
	labelingRepo := repository.NewLabelingClickHouse(infra.ClickHouse)
	if labelingRepo == nil {
		return nil, fmt.Errorf("repository LabelingClickHouse is nil")
	}
	labelingService := service.NewLabelingService(labelingRepo)
	if labelingService == nil {
		return nil, fmt.Errorf("service LabelingService is nil")
	}
	labelingHandler := handler.NewLabelingHandler(labelingService)
	if labelingHandler == nil {
		return nil, fmt.Errorf("handler LabelingHandler is nil")
	}

	// =========================================================================
	// 8. Raw Data Ingest Workflow Branch
	// =========================================================================
	ingestService := service.NewIngestService(objectRepo, infra.MinIO.Bucket, infra.NATS, eventBroker)
	if ingestService == nil {
		return nil, fmt.Errorf("service IngestService is nil")
	}
	ingestHandler := handler.NewIngestHandler(ingestService)
	if ingestHandler == nil {
		return nil, fmt.Errorf("handler IngestHandler is nil")
	}

	// =========================================================================
	// 9. Lakehouse Object Storage Exploration Branch
	// =========================================================================
	lakehouseService := service.NewLakehouseService(objectRepo, infra.MinIO.Bucket)
	if lakehouseService == nil {
		return nil, fmt.Errorf("service LakehouseService is nil")
	}
	lakehouseHandler := handler.NewLakehouseHandler(lakehouseService)
	if lakehouseHandler == nil {
		return nil, fmt.Errorf("handler LakehouseHandler is nil")
	}

	// =========================================================================
	// 10. Data Factory & Runner Tickets Branch
	// =========================================================================
	ticketRepository := repository.NewTicketClickHouse(infra.ClickHouse)
	if ticketRepository == nil {
		return nil, fmt.Errorf("repository TicketClickHouse is nil")
	}
	ticketService := service.NewTicketService(ticketRepository)
	if ticketService == nil {
		return nil, fmt.Errorf("service TicketService is nil")
	}
	ticketHandler := handler.NewTicketHandler(ticketService)
	if ticketHandler == nil {
		return nil, fmt.Errorf("handler TicketHandler is nil")
	}

	// =========================================================================
	// 11. Preprocessing Workflow Branch
	// =========================================================================
	preprocessingService := service.NewPreprocessingService(infra.NATS, eventBroker, objectRepo)
	if preprocessingService == nil {
		return nil, fmt.Errorf("service PreprocessingService is nil")
	}
	preprocessingHandler := handler.NewPreprocessingHandler(preprocessingService)
	if preprocessingHandler == nil {
		return nil, fmt.Errorf("handler PreprocessingHandler is nil")
	}

	// =========================================================================
	// 12. Enrichment Control Workflow Branch
	// =========================================================================
	enrichmentControlService := service.NewEnrichmentControlService(objectRepo, eventBroker)
	if enrichmentControlService == nil {
		return nil, fmt.Errorf("service EnrichmentControlService is nil")
	}
	enrichmentControlHandler := handler.NewEnrichmentControlHandler(enrichmentControlService)
	if enrichmentControlHandler == nil {
		return nil, fmt.Errorf("handler EnrichmentControlHandler is nil")
	}

	// =========================================================================
	// 13. Lineage Provenance Workflow Branch
	// =========================================================================
	lineageRepo := repository.NewLineageClickHouse(infra.ClickHouse)
	if lineageRepo == nil {
		return nil, fmt.Errorf("repository LineageClickHouse is nil")
	}
	lineageService := service.NewLineageService(lineageRepo, objectRepo)
	if lineageService == nil {
		return nil, fmt.Errorf("service LineageService is nil")
	}
	lineageHandler := handler.NewLineageHandler(lineageService)
	if lineageHandler == nil {
		return nil, fmt.Errorf("handler LineageHandler is nil")
	}

	// =========================================================================
	// 14. DAG Aggregation Branch (Autonomous DAG Workflow)
	// =========================================================================
	dagRepo := repository.NewDAGClickHouse(infra.ClickHouse)
	if dagRepo == nil {
		return nil, fmt.Errorf("repository DAGClickHouse is nil")
	}
	dagAggregationService := service.NewDAGAggregationService(dagRepo, prometheusQuerier, objectRepo, preprocessingService)
	if dagAggregationService == nil {
		return nil, fmt.Errorf("service DAGAggregationService is nil")
	}
	dagAggregationHandler := handler.NewDAGAggregationHandler(dagAggregationService)
	if dagAggregationHandler == nil {
		return nil, fmt.Errorf("handler DAGAggregationHandler is nil")
	}

	// =========================================================================
	// 15. Realtime Events & NATS Consumers Branch
	// =========================================================================
	eventsHandler := handler.NewEventsHandler(eventBroker, infra.NATS)
	if eventsHandler == nil {
		return nil, fmt.Errorf("handler EventsHandler is nil")
	}

	natsPubSub := pubsub.New(pubsub.Config{
		NATSURL:           infra.NATS.URL,
		Broker:            eventBroker,
		DAGAggregation:    dagAggregationService,
		ChampionInference: inferenceService,
		ModelNew:          modelNewService,
	})

	natsStream := stream.New(stream.Config{
		NATSURL:             infra.NATS.URL,
		PredictionProjector: predictionProjector,
	})

	// =========================================================================
	// 16. Module Struct Assembly
	// =========================================================================
	m := &Module{
		TargetHandler:            targetHandler,
		CandidateHandler:         candidateHandler,
		AnomalyHandler:           anomalyHandler,
		ModelsHandler:            modelsHandler,
		ModelNewHandler:          modelNewHandler,
		LabelingHandler:          labelingHandler,
		SystemHandler:            systemHandler,
		MonitoringHandler:        monitoringHandler,
		DAGAggregationHandler:    dagAggregationHandler,
		PreprocessingHandler:     preprocessingHandler,
		EnrichmentControlHandler: enrichmentControlHandler,
		LineageHandler:           lineageHandler,
		TicketHandler:            ticketHandler,
		IngestHandler:            ingestHandler,
		LakehouseHandler:         lakehouseHandler,
		EventsHandler:            eventsHandler,
		NATSPubSub:               natsPubSub,
		NATSStream:               natsStream,
	}

	return m, nil
}
