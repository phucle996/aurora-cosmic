package service

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"sort"
	"strings"
	"time"

	"go-api/internal/domain/entity"
	domainService "go-api/internal/domain/service"
	"go-api/internal/provider"

	"github.com/parquet-go/parquet-go"
)

const (
	enrichmentControlKey       = "control/gold-builder.json"
	enrichmentRuntimeStatusKey = "control/gold-builder/status.json"
	minEnrichmentIdleFlush     = 60
	maxEnrichmentIdleFlush     = 900
	maxEnrichmentBatchSize     = 5000
	maxEnrichmentPreviewRows   = 50
	maxEnrichmentPreviewBytes  = 64 << 20
	maxEnrichmentLineageInputs = 100
)

type EnrichmentControlService struct {
	objects   provider.ObjectStorage
	publisher provider.EventPublisher
}

func NewEnrichmentControlService(objects provider.ObjectStorage, publisher provider.EventPublisher) domainService.EnrichmentControl {
	return &EnrichmentControlService{objects: objects, publisher: publisher}
}

func initialEnrichmentControl() entity.EnrichmentControlState {
	return entity.EnrichmentControlState{
		SchemaVersion: 1,
		Mode:          "PAUSED",
	}
}

// GetControlOverview aggregates the complete status of the enrichment/gold builder subsystem:
// 1. Desired Operator Control State (from control/gold-builder.json): mode (STREAM/BATCH/PAUSED),
//    configured limits (max_batch_records, idle_flush_seconds), and active ticket ID.
// 2. Observed Worker Runtime Telemetry (from control/gold-builder/status.json): current worker state,
//    individual worker slot progress (7 steps pipeline), readiness gates (contracted vs missing TPF),
//    and catalog synchronization status (TIC/TOI cache hits, snapshot IDs).
func (s *EnrichmentControlService) GetControlOverview(ctx context.Context) (*entity.EnrichmentControlOverview, error) {
	control, err := s.readControl(ctx)
	if err != nil {
		return nil, err
	}
	overview := &entity.EnrichmentControlOverview{Control: control}
	data, err := s.objects.GetObject(ctx, enrichmentRuntimeStatusKey)
	if err == nil && len(data) > 0 {
		var runtime entity.EnrichmentRuntimeStatus
		if err := json.Unmarshal(data, &runtime); err != nil {
			return nil, fmt.Errorf("decode enrichment runtime status: %w", err)
		}
		overview.Runtime = &runtime
	} else if err != nil && !errors.Is(err, provider.ErrObjectNotFound) {
		return nil, fmt.Errorf("read enrichment runtime status: %w", err)
	}
	return overview, nil
}

func (s *EnrichmentControlService) Start(ctx context.Context, request entity.EnrichmentControlStartRequest) (*entity.EnrichmentCommandResult, error) {
	control := entity.EnrichmentControlState{
		SchemaVersion:    1,
		Mode:             request.Mode,
		MaxBatchRecords:  request.MaxBatchRecords,
		IdleFlushSeconds: float64(request.IdleFlushSeconds),
		TicketID:         request.TicketID,
		UpdatedAt:        time.Now().UTC(),
	}
	data, err := json.Marshal(control)
	if err != nil {
		return nil, fmt.Errorf("encode enrichment control: %w", err)
	}
	if err := s.objects.PutObject(ctx, enrichmentControlKey, data, "application/json"); err != nil {
		return nil, fmt.Errorf("write enrichment control: %w", err)
	}
	if s.publisher != nil {
		topic := "gold:" + request.TicketID
		eventData, _ := json.Marshal(map[string]any{
			"type":        "workflow",
			"topic":       topic,
			"workflow":    "enrichment",
			"status":      "armed",
			"ticket_id":   request.TicketID,
			"occurred_at": control.UpdatedAt,
			"payload":     control,
		})
		_ = s.publisher.Publish(ctx, topic, provider.Event{
			Type:  "workflow",
			Topic: topic,
			Data:  eventData,
		})
	}
	return &entity.EnrichmentCommandResult{
		TicketID: request.TicketID,
		Status:   "armed",
	}, nil
}

func (s *EnrichmentControlService) Stop(ctx context.Context) (*entity.EnrichmentCommandResult, error) {
	previous, err := s.readControl(ctx)
	if err != nil {
		return nil, err
	}
	control := entity.EnrichmentControlState{
		SchemaVersion:    1,
		Mode:             "PAUSED",
		MaxBatchRecords:  previous.MaxBatchRecords,
		IdleFlushSeconds: previous.IdleFlushSeconds,
		TicketID:         previous.TicketID,
		UpdatedAt:        time.Now().UTC(),
	}
	data, err := json.Marshal(control)
	if err != nil {
		return nil, fmt.Errorf("encode enrichment control: %w", err)
	}
	if err := s.objects.PutObject(ctx, enrichmentControlKey, data, "application/json"); err != nil {
		return nil, fmt.Errorf("write enrichment control: %w", err)
	}
	if s.publisher != nil {
		topic := "gold"
		if control.TicketID != "" {
			topic = "gold:" + control.TicketID
		}
		eventData, _ := json.Marshal(map[string]any{
			"type":        "workflow",
			"topic":       topic,
			"workflow":    "enrichment",
			"status":      "pause_requested",
			"ticket_id":   control.TicketID,
			"occurred_at": control.UpdatedAt,
			"payload":     control,
		})
		_ = s.publisher.Publish(ctx, topic, provider.Event{
			Type:  "workflow",
			Topic: topic,
			Data:  eventData,
		})
	}
	return &entity.EnrichmentCommandResult{
		TicketID: control.TicketID,
		Status:   "pause_requested",
	}, nil
}

// ResolveLineage checks immutable, committed Gold/Enrichment manifests.
func (s *EnrichmentControlService) ResolveLineage(ctx context.Context, inputs []entity.EnrichmentLineageLookup) ([]entity.EnrichmentLineageResolution, error) {
	if len(inputs) > maxEnrichmentLineageInputs {
		return nil, fmt.Errorf("at most %d enrichment lineage inputs are allowed", maxEnrichmentLineageInputs)
	}

	resolutions := make([]entity.EnrichmentLineageResolution, len(inputs))
	bySource := make(map[string][]int)
	bySilverKey := make(map[string][]int)
	for index, input := range inputs {
		input.SourceProductID = strings.TrimSpace(input.SourceProductID)
		input.SilverObjectKey = strings.TrimSpace(input.SilverObjectKey)
		resolutions[index] = entity.EnrichmentLineageResolution{
			SourceProductID: input.SourceProductID,
			SilverObjectKey: input.SilverObjectKey,
			Status:          "PENDING",
		}
		if input.SourceProductID != "" {
			bySource[input.SourceProductID] = append(bySource[input.SourceProductID], index)
		}
		if input.SilverObjectKey != "" {
			bySilverKey[input.SilverObjectKey] = append(bySilverKey[input.SilverObjectKey], index)
		}
	}
	if len(inputs) == 0 {
		return resolutions, nil
	}

	objects, err := s.objects.ListObjects(ctx, "gold/snapshots/")
	if err != nil {
		return nil, fmt.Errorf("list snapshot manifests: %w", err)
	}
	for _, object := range objects {
		if !strings.HasPrefix(object.Key, "gold/snapshots/") || !strings.HasSuffix(object.Key, "/manifest.json") {
			continue
		}
		data, err := s.objects.GetObject(ctx, object.Key)
		if err != nil {
			return nil, fmt.Errorf("read snapshot manifest %s: %w", object.Key, err)
		}
		var snapshot entity.EnrichmentSnapshotDetail
		if err := json.Unmarshal(data, &snapshot); err != nil {
			return nil, fmt.Errorf("decode snapshot manifest %s: %w", object.Key, err)
		}
		if snapshot.Status != "COMMITTED" || snapshot.SnapshotID == "" || len(snapshot.Artifacts) == 0 || !isEnrichmentResearchReady(snapshot) {
			continue
		}
		datasets := committedEnrichmentDatasets(snapshot.Artifacts)
		if len(datasets) == 0 {
			continue
		}
		for _, input := range snapshot.Inputs {
			matched := append([]int(nil), bySource[input.SourceProductID]...)
			matched = append(matched, bySilverKey[input.SilverObjectKey]...)
			for _, index := range matched {
				if resolutions[index].Status == "EXTRACTED" {
					continue
				}
				resolutions[index].Status = "EXTRACTED"
				resolutions[index].SnapshotID = snapshot.SnapshotID
				resolutions[index].Datasets = datasets
			}
		}
	}
	return resolutions, nil
}

func isEnrichmentResearchReady(snapshot entity.EnrichmentSnapshotDetail) bool {
	return snapshot.CompletenessContract.Policy == "research-ready-target-pair-v4"
}

func committedEnrichmentDatasets(artifacts []entity.EnrichmentArtifact) []string {
	seen := make(map[string]struct{})
	datasets := make([]string, 0, len(artifacts))
	for _, artifact := range artifacts {
		if artifact.Dataset == "" || artifact.RowCount <= 0 {
			continue
		}
		if _, exists := seen[artifact.Dataset]; exists {
			continue
		}
		seen[artifact.Dataset] = struct{}{}
		datasets = append(datasets, artifact.Dataset)
	}
	return datasets
}

func (s *EnrichmentControlService) Snapshot(ctx context.Context, snapshotID string) (*entity.EnrichmentSnapshotDetail, error) {
	snapshotID = strings.TrimSpace(snapshotID)
	if !strings.HasPrefix(snapshotID, "gold-v1-") || strings.Contains(snapshotID, "/") {
		return nil, fmt.Errorf("invalid snapshot id")
	}
	data, err := s.objects.GetObject(ctx, "gold/snapshots/"+snapshotID+"/manifest.json")
	if err != nil {
		if errors.Is(err, provider.ErrObjectNotFound) {
			return nil, fmt.Errorf("snapshot %s was not found", snapshotID)
		}
		return nil, fmt.Errorf("read snapshot manifest: %w", err)
	}
	var snapshot entity.EnrichmentSnapshotDetail
	if err := json.Unmarshal(data, &snapshot); err != nil {
		return nil, fmt.Errorf("decode snapshot manifest: %w", err)
	}
	if snapshot.SnapshotID != snapshotID {
		return nil, fmt.Errorf("manifest snapshot id does not match requested id")
	}
	if snapshot.FeatureVersions == nil {
		snapshot.FeatureVersions = map[string]string{}
	}
	if snapshot.DatasetRowCounts == nil {
		snapshot.DatasetRowCounts = map[string]int{}
	}
	return &snapshot, nil
}

func (s *EnrichmentControlService) ListSnapshots(ctx context.Context, limit int) ([]entity.EnrichmentSnapshotSummary, error) {
	if limit <= 0 || limit > 200 {
		limit = 100
	}
	objects, err := s.objects.ListObjects(ctx, "gold/snapshots/")
	if err != nil {
		return nil, fmt.Errorf("list manifests: %w", err)
	}
	manifests := make([]provider.ObjectInfo, 0, len(objects))
	for _, object := range objects {
		if strings.HasPrefix(object.Key, "gold/snapshots/gold-v1-") && strings.HasSuffix(object.Key, "/manifest.json") {
			manifests = append(manifests, object)
		}
	}
	sort.Slice(manifests, func(i, j int) bool { return manifests[i].LastModified.After(manifests[j].LastModified) })
	if len(manifests) > limit {
		manifests = manifests[:limit]
	}
	summaries := make([]entity.EnrichmentSnapshotSummary, 0, len(manifests))
	for _, manifest := range manifests {
		data, readErr := s.objects.GetObject(ctx, manifest.Key)
		if readErr != nil {
			return nil, fmt.Errorf("read manifest %s: %w", manifest.Key, readErr)
		}
		var snapshot entity.EnrichmentSnapshotDetail
		if decodeErr := json.Unmarshal(data, &snapshot); decodeErr != nil {
			return nil, fmt.Errorf("decode manifest %s: %w", manifest.Key, decodeErr)
		}
		if snapshot.SnapshotID == "" {
			return nil, fmt.Errorf("manifest %s does not declare a snapshot id", manifest.Key)
		}
		var sizeBytes int64
		for _, artifact := range snapshot.Artifacts {
			sizeBytes += artifact.SizeBytes
		}
		summaries = append(summaries, entity.EnrichmentSnapshotSummary{
			SnapshotID: snapshot.SnapshotID, ManifestKey: manifest.Key, SizeBytes: sizeBytes,
			LastModified: manifest.LastModified.UTC().Format(time.RFC3339), CreatedAt: snapshot.CreatedAt, Status: snapshot.Status,
		})
	}
	return summaries, nil
}

func (s *EnrichmentControlService) Artifact(ctx context.Context, snapshotID, dataset string, sector int, query entity.EnrichmentArtifactPreviewQuery) (*entity.EnrichmentArtifactDetail, error) {
	snapshot, err := s.Snapshot(ctx, snapshotID)
	if err != nil {
		return nil, err
	}
	dataset = strings.TrimSpace(dataset)
	if dataset == "" || strings.Contains(dataset, "/") || sector < 1 {
		return nil, fmt.Errorf("invalid artifact reference")
	}
	if query.Limit <= 0 {
		query.Limit = 25
	}
	if query.Limit > maxEnrichmentPreviewRows {
		query.Limit = maxEnrichmentPreviewRows
	}
	if query.Offset < 0 {
		return nil, fmt.Errorf("preview offset must be non-negative")
	}
	var artifact *entity.EnrichmentArtifact
	for index := range snapshot.Artifacts {
		candidate := &snapshot.Artifacts[index]
		if candidate.Dataset == dataset && candidate.Sector == sector {
			artifact = candidate
			break
		}
	}
	if artifact == nil {
		return nil, fmt.Errorf("artifact %s sector %d was not found", dataset, sector)
	}
	if artifact.SizeBytes > maxEnrichmentPreviewBytes {
		return nil, fmt.Errorf("artifact is too large for preview")
	}
	data, err := s.objects.GetObject(ctx, artifact.ObjectKey)
	if err != nil {
		return nil, fmt.Errorf("read Parquet artifact: %w", err)
	}
	if len(data) > maxEnrichmentPreviewBytes {
		return nil, fmt.Errorf("artifact is too large for preview")
	}
	file, err := parquet.OpenFile(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		return nil, fmt.Errorf("open Parquet artifact: %w", err)
	}
	schema := enrichmentParquetSchema(file)
	if query.FilterColumn != "" && !enrichmentSchemaHasColumn(schema, query.FilterColumn) {
		return nil, fmt.Errorf("unknown Parquet filter column %q", query.FilterColumn)
	}
	preview, matchedRows, err := enrichmentParquetPreview(data, file, query)
	if err != nil {
		return nil, err
	}
	return &entity.EnrichmentArtifactDetail{
		SnapshotID:    snapshot.SnapshotID,
		Artifact:      *artifact,
		Schema:        schema,
		Preview:       preview,
		PreviewOffset: query.Offset,
		PreviewLimit:  query.Limit,
		MatchedRows:   matchedRows,
	}, nil
}

func enrichmentParquetSchema(file *parquet.File) []entity.EnrichmentParquetColumn {
	schema := file.Schema()
	columns := make([]entity.EnrichmentParquetColumn, 0, len(schema.Columns()))
	for _, path := range schema.Columns() {
		leaf, ok := schema.Lookup(path...)
		if !ok {
			continue
		}
		columns = append(columns, entity.EnrichmentParquetColumn{
			Name:     path[len(path)-1],
			Path:     strings.Join(path, "."),
			Type:     leaf.Node.Type().String(),
			Nullable: leaf.Node.Optional(),
			Repeated: leaf.Node.Repeated(),
		})
	}
	return columns
}

func enrichmentSchemaHasColumn(schema []entity.EnrichmentParquetColumn, column string) bool {
	for _, candidate := range schema {
		if candidate.Path == column {
			return true
		}
	}
	return false
}

func enrichmentParquetPreview(data []byte, file *parquet.File, query entity.EnrichmentArtifactPreviewQuery) ([]map[string]any, int, error) {
	reader := parquet.NewReader(bytes.NewReader(data))
	defer reader.Close()
	columns := file.Schema().Columns()
	preview := make([]map[string]any, 0, query.Limit)
	matchedRows := 0
	rows := make([]parquet.Row, 256)
	for {
		n, err := reader.ReadRows(rows)
		if err != nil && !errors.Is(err, io.EOF) {
			return nil, 0, fmt.Errorf("read Parquet preview: %w", err)
		}
		for _, row := range rows[:n] {
			record := enrichmentParquetRecord(row, columns)
			if !enrichmentPreviewMatches(record, query) {
				continue
			}
			if matchedRows >= query.Offset && len(preview) < query.Limit {
				preview = append(preview, record)
			}
			matchedRows++
		}
		if errors.Is(err, io.EOF) {
			break
		}
	}
	return preview, matchedRows, nil
}

func enrichmentParquetRecord(row parquet.Row, columns [][]string) map[string]any {
	record := make(map[string]any)
	row.Range(func(columnIndex int, values []parquet.Value) bool {
		if columnIndex < 0 || columnIndex >= len(columns) {
			return true
		}
		name := strings.Join(columns[columnIndex], ".")
		if len(values) == 1 {
			record[name] = parquetPreviewValue(values[0])
		} else {
			items := make([]any, len(values))
			for index, value := range values {
				items[index] = parquetPreviewValue(value)
			}
			record[name] = items
		}
		return true
	})
	return record
}

func enrichmentPreviewMatches(record map[string]any, query entity.EnrichmentArtifactPreviewQuery) bool {
	if query.FilterColumn != "" && !strings.Contains(strings.ToLower(fmt.Sprint(record[query.FilterColumn])), strings.ToLower(query.FilterValue)) {
		return false
	}
	if query.Search == "" {
		return true
	}
	needle := strings.ToLower(query.Search)
	for _, value := range record {
		if strings.Contains(strings.ToLower(fmt.Sprint(value)), needle) {
			return true
		}
	}
	return false
}

func parquetPreviewValue(value parquet.Value) any {
	if value.IsNull() {
		return nil
	}
	switch value.Kind() {
	case parquet.Boolean:
		return value.Boolean()
	case parquet.Int32:
		return value.Int32()
	case parquet.Int64:
		return value.Int64()
	case parquet.Float:
		return value.Float()
	case parquet.Double:
		return value.Double()
	case parquet.ByteArray, parquet.FixedLenByteArray:
		return string(value.ByteArray())
	default:
		return value.String()
	}
}

func (s *EnrichmentControlService) readControl(ctx context.Context) (entity.EnrichmentControlState, error) {
	data, err := s.objects.GetObject(ctx, enrichmentControlKey)
	if err != nil {
		if errors.Is(err, provider.ErrObjectNotFound) {
			return initialEnrichmentControl(), nil
		}
		return entity.EnrichmentControlState{}, fmt.Errorf("read enrichment control: %w", err)
	}
	var control entity.EnrichmentControlState
	if err := json.Unmarshal(data, &control); err != nil {
		return entity.EnrichmentControlState{}, fmt.Errorf("decode enrichment control: %w", err)
	}
	control.Mode = strings.ToUpper(strings.TrimSpace(control.Mode))
	if control.Mode != "PAUSED" && control.Mode != "STREAM" && control.Mode != "BATCH" {
		return entity.EnrichmentControlState{}, fmt.Errorf("enrichment control has unsupported mode %q", control.Mode)
	}
	if control.IdleFlushSeconds != 0 && (control.IdleFlushSeconds < minEnrichmentIdleFlush || control.IdleFlushSeconds > maxEnrichmentIdleFlush) {
		return entity.EnrichmentControlState{}, fmt.Errorf("enrichment control has invalid idle_flush_seconds %v: must be between %d and %d", control.IdleFlushSeconds, minEnrichmentIdleFlush, maxEnrichmentIdleFlush)
	}
	if control.MaxBatchRecords != 0 && (control.MaxBatchRecords < 1 || control.MaxBatchRecords > maxEnrichmentBatchSize) {
		return entity.EnrichmentControlState{}, fmt.Errorf("enrichment control has invalid max_batch_records %d: must be between 1 and %d", control.MaxBatchRecords, maxEnrichmentBatchSize)
	}
	if control.Mode != "PAUSED" {
		if control.IdleFlushSeconds < minEnrichmentIdleFlush || control.IdleFlushSeconds > maxEnrichmentIdleFlush {
			return entity.EnrichmentControlState{}, fmt.Errorf("running enrichment control requires valid idle_flush_seconds between %d and %d", minEnrichmentIdleFlush, maxEnrichmentIdleFlush)
		}
		if control.MaxBatchRecords < 1 || control.MaxBatchRecords > maxEnrichmentBatchSize {
			return entity.EnrichmentControlState{}, fmt.Errorf("running enrichment control requires valid max_batch_records between 1 and %d", maxEnrichmentBatchSize)
		}
	}
	return control, nil
}

