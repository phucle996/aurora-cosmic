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

	"github.com/parquet-go/parquet-go"
	"go-api/internal/domain/entity"
	"go-api/internal/domain/repo"
	domainService "go-api/internal/domain/service"

	"github.com/google/uuid"
)

const (
	goldControlKey       = "control/gold-builder.json"
	goldRuntimeStatusKey = "control/gold-builder/status.json"
	defaultGoldIdleFlush = 180
	defaultGoldBatchSize = 5000
	maxGoldBatchSize     = 5000
	maxGoldPreviewRows   = 50
	maxGoldPreviewBytes  = 64 << 20
	maxGoldLineageInputs = 100
)

type GoldControlService struct {
	objects   repo.ObjectRepository
	publisher repo.EventPublisher
}

func NewGoldControlService(objects repo.ObjectRepository, publisher repo.EventPublisher) domainService.GoldControl {
	return &GoldControlService{objects: objects, publisher: publisher}
}

func defaultGoldControl() entity.GoldControlState {
	return entity.GoldControlState{
		SchemaVersion:    1,
		Mode:             "PAUSED",
		MaxBatchRecords:  defaultGoldBatchSize,
		IdleFlushSeconds: defaultGoldIdleFlush,
	}
}

func (s *GoldControlService) Query(ctx context.Context) (*entity.GoldControlOverview, error) {
	if s == nil || s.objects == nil {
		return nil, fmt.Errorf("gold control is unavailable")
	}
	control, err := s.readControl(ctx)
	if err != nil {
		return nil, err
	}
	overview := &entity.GoldControlOverview{Control: control}
	data, err := s.objects.GetObject(ctx, goldRuntimeStatusKey)
	if err == nil && len(data) > 0 {
		var runtime entity.GoldRuntimeStatus
		if err := json.Unmarshal(data, &runtime); err != nil {
			return nil, fmt.Errorf("decode Gold runtime status: %w", err)
		}
		overview.Runtime = &runtime
	} else if err != nil && !errors.Is(err, repo.ErrObjectNotFound) {
		return nil, fmt.Errorf("read Gold runtime status: %w", err)
	}
	return overview, nil
}

func (s *GoldControlService) Start(ctx context.Context, request entity.GoldControlStartRequest) (*entity.GoldControlOverview, error) {
	if s == nil || s.objects == nil {
		return nil, fmt.Errorf("gold control is unavailable")
	}
	mode := strings.ToUpper(strings.TrimSpace(request.Mode))
	if mode == "" {
		mode = "STREAM"
	}
	if mode != "STREAM" && mode != "BATCH" {
		return nil, fmt.Errorf("gold mode must be stream or batch")
	}
	idleFlush := request.IdleFlushSeconds
	if idleFlush == 0 {
		idleFlush = defaultGoldIdleFlush
	}
	if idleFlush < 60 || idleFlush > 900 {
		return nil, fmt.Errorf("idle_flush_seconds must be between 60 and 900")
	}
	maxBatchRecords := request.MaxBatchRecords
	if maxBatchRecords == 0 {
		maxBatchRecords = defaultGoldBatchSize
	}
	if maxBatchRecords < 1 || maxBatchRecords > maxGoldBatchSize {
		return nil, fmt.Errorf("max_batch_records must be between 1 and %d", maxGoldBatchSize)
	}
	control := entity.GoldControlState{
		SchemaVersion:    1,
		Mode:             mode,
		MaxBatchRecords:  maxBatchRecords,
		IdleFlushSeconds: float64(idleFlush),
		CommandID:        "gold-control-" + uuid.NewString()[:8],
		UpdatedAt:        time.Now().UTC(),
		RequestedBy:      "dashboard",
	}
	if err := s.writeControl(ctx, control); err != nil {
		return nil, err
	}
	return s.publishAndQuery(ctx, control, "armed")
}

func (s *GoldControlService) Stop(ctx context.Context) (*entity.GoldControlOverview, error) {
	if s == nil || s.objects == nil {
		return nil, fmt.Errorf("gold control is unavailable")
	}
	previous, err := s.readControl(ctx)
	if err != nil {
		return nil, err
	}
	control := entity.GoldControlState{
		SchemaVersion:    1,
		Mode:             "PAUSED",
		MaxBatchRecords:  previous.MaxBatchRecords,
		IdleFlushSeconds: previous.IdleFlushSeconds,
		// Pausing belongs to the active run; preserving its ID lets the Gold
		// Builder close one durable history record instead of inventing a run.
		CommandID:   previous.CommandID,
		UpdatedAt:   time.Now().UTC(),
		RequestedBy: "dashboard",
	}
	if err := s.writeControl(ctx, control); err != nil {
		return nil, err
	}
	return s.publishAndQuery(ctx, control, "pause_requested")
}

// ResolveLineage checks immutable, committed Gold manifests.  It deliberately
// does not use the global Silver count: a Silver object belonging to another
// target is not evidence that this target reached Gold.
func (s *GoldControlService) ResolveLineage(ctx context.Context, inputs []entity.GoldLineageLookup) ([]entity.GoldLineageResolution, error) {
	if s == nil || s.objects == nil {
		return nil, fmt.Errorf("gold explorer is unavailable")
	}
	if len(inputs) > maxGoldLineageInputs {
		return nil, fmt.Errorf("at most %d Gold lineage inputs are allowed", maxGoldLineageInputs)
	}

	resolutions := make([]entity.GoldLineageResolution, len(inputs))
	bySource := make(map[string][]int)
	bySilverKey := make(map[string][]int)
	for index, input := range inputs {
		input.SourceProductID = strings.TrimSpace(input.SourceProductID)
		input.SilverObjectKey = strings.TrimSpace(input.SilverObjectKey)
		resolutions[index] = entity.GoldLineageResolution{
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
		return nil, fmt.Errorf("list Gold snapshot manifests: %w", err)
	}
	for _, object := range objects {
		if !strings.HasPrefix(object.Key, "gold/snapshots/") || !strings.HasSuffix(object.Key, "/manifest.json") {
			continue
		}
		data, err := s.objects.GetObject(ctx, object.Key)
		if err != nil {
			return nil, fmt.Errorf("read Gold snapshot manifest %s: %w", object.Key, err)
		}
		var snapshot entity.GoldSnapshotDetail
		if err := json.Unmarshal(data, &snapshot); err != nil {
			return nil, fmt.Errorf("decode Gold snapshot manifest %s: %w", object.Key, err)
		}
		if snapshot.Status != "COMMITTED" || snapshot.SnapshotID == "" || len(snapshot.Artifacts) == 0 || !isResearchReady(snapshot) {
			continue
		}
		datasets := committedGoldDatasets(snapshot.Artifacts)
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

// isResearchReady excludes immutable LC-only legacy snapshots from lineage
// resolution. They are still browsable by ID, but are not evidence that an
// input completed the current multimodal Gold contract.
func isResearchReady(snapshot entity.GoldSnapshotDetail) bool {
	return snapshot.CompletenessContract.Policy == "research-ready-target-pair-v4"
}

func committedGoldDatasets(artifacts []entity.GoldArtifact) []string {
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

func (s *GoldControlService) Snapshot(ctx context.Context, snapshotID string) (*entity.GoldSnapshotDetail, error) {
	if s == nil || s.objects == nil {
		return nil, fmt.Errorf("gold explorer is unavailable")
	}
	snapshotID = strings.TrimSpace(snapshotID)
	if !strings.HasPrefix(snapshotID, "gold-v1-") || strings.Contains(snapshotID, "/") {
		return nil, fmt.Errorf("invalid Gold snapshot id")
	}
	data, err := s.objects.GetObject(ctx, "gold/snapshots/"+snapshotID+"/manifest.json")
	if err != nil {
		if errors.Is(err, repo.ErrObjectNotFound) {
			return nil, fmt.Errorf("Gold snapshot %s was not found", snapshotID)
		}
		return nil, fmt.Errorf("read Gold snapshot manifest: %w", err)
	}
	var snapshot entity.GoldSnapshotDetail
	if err := json.Unmarshal(data, &snapshot); err != nil {
		return nil, fmt.Errorf("decode Gold snapshot manifest: %w", err)
	}
	if snapshot.SnapshotID != snapshotID {
		return nil, fmt.Errorf("Gold manifest snapshot id does not match requested id")
	}
	if snapshot.FeatureVersions == nil {
		snapshot.FeatureVersions = map[string]string{}
	}
	if snapshot.DatasetRowCounts == nil {
		snapshot.DatasetRowCounts = map[string]int{}
	}
	return &snapshot, nil
}

func (s *GoldControlService) ListSnapshots(ctx context.Context, limit int) ([]entity.GoldSnapshotSummary, error) {
	if s == nil || s.objects == nil {
		return nil, fmt.Errorf("gold explorer is unavailable")
	}
	if limit <= 0 || limit > 200 {
		limit = 100
	}
	objects, err := s.objects.ListObjects(ctx, "gold/snapshots/")
	if err != nil {
		return nil, fmt.Errorf("list Gold manifests: %w", err)
	}
	manifests := make([]repo.ObjectInfo, 0, len(objects))
	for _, object := range objects {
		if strings.HasPrefix(object.Key, "gold/snapshots/gold-v1-") && strings.HasSuffix(object.Key, "/manifest.json") {
			manifests = append(manifests, object)
		}
	}
	sort.Slice(manifests, func(i, j int) bool { return manifests[i].LastModified.After(manifests[j].LastModified) })
	if len(manifests) > limit {
		manifests = manifests[:limit]
	}
	summaries := make([]entity.GoldSnapshotSummary, 0, len(manifests))
	for _, manifest := range manifests {
		data, readErr := s.objects.GetObject(ctx, manifest.Key)
		if readErr != nil {
			return nil, fmt.Errorf("read Gold manifest %s: %w", manifest.Key, readErr)
		}
		var snapshot entity.GoldSnapshotDetail
		if decodeErr := json.Unmarshal(data, &snapshot); decodeErr != nil {
			return nil, fmt.Errorf("decode Gold manifest %s: %w", manifest.Key, decodeErr)
		}
		if snapshot.SnapshotID == "" {
			return nil, fmt.Errorf("Gold manifest %s does not declare a snapshot id", manifest.Key)
		}
		var sizeBytes int64
		for _, artifact := range snapshot.Artifacts {
			sizeBytes += artifact.SizeBytes
		}
		summaries = append(summaries, entity.GoldSnapshotSummary{
			SnapshotID: snapshot.SnapshotID, ManifestKey: manifest.Key, SizeBytes: sizeBytes,
			LastModified: manifest.LastModified.UTC().Format(time.RFC3339), CreatedAt: snapshot.CreatedAt, Status: snapshot.Status,
		})
	}
	return summaries, nil
}

func (s *GoldControlService) Artifact(ctx context.Context, snapshotID, dataset string, sector int, query entity.GoldArtifactPreviewQuery) (*entity.GoldArtifactDetail, error) {
	snapshot, err := s.Snapshot(ctx, snapshotID)
	if err != nil {
		return nil, err
	}
	dataset = strings.TrimSpace(dataset)
	if dataset == "" || strings.Contains(dataset, "/") || sector < 1 {
		return nil, fmt.Errorf("invalid Gold artifact reference")
	}
	if query.Limit <= 0 {
		query.Limit = 25
	}
	if query.Limit > maxGoldPreviewRows {
		query.Limit = maxGoldPreviewRows
	}
	if query.Offset < 0 {
		return nil, fmt.Errorf("preview offset must be non-negative")
	}
	var artifact *entity.GoldArtifact
	for index := range snapshot.Artifacts {
		candidate := &snapshot.Artifacts[index]
		if candidate.Dataset == dataset && candidate.Sector == sector {
			artifact = candidate
			break
		}
	}
	if artifact == nil {
		return nil, fmt.Errorf("Gold artifact %s sector %d was not found", dataset, sector)
	}
	if artifact.SizeBytes > maxGoldPreviewBytes {
		return nil, fmt.Errorf("Gold artifact is too large for preview")
	}
	data, err := s.objects.GetObject(ctx, artifact.ObjectKey)
	if err != nil {
		return nil, fmt.Errorf("read Gold Parquet artifact: %w", err)
	}
	if len(data) > maxGoldPreviewBytes {
		return nil, fmt.Errorf("Gold artifact is too large for preview")
	}
	file, err := parquet.OpenFile(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		return nil, fmt.Errorf("open Gold Parquet artifact: %w", err)
	}
	schema := goldParquetSchema(file)
	if query.FilterColumn != "" && !goldSchemaHasColumn(schema, query.FilterColumn) {
		return nil, fmt.Errorf("unknown Parquet filter column %q", query.FilterColumn)
	}
	preview, matchedRows, err := goldParquetPreview(data, file, query)
	if err != nil {
		return nil, err
	}
	return &entity.GoldArtifactDetail{
		SnapshotID:    snapshot.SnapshotID,
		Artifact:      *artifact,
		Schema:        schema,
		Preview:       preview,
		PreviewOffset: query.Offset,
		PreviewLimit:  query.Limit,
		MatchedRows:   matchedRows,
	}, nil
}

func goldParquetSchema(file *parquet.File) []entity.GoldParquetColumn {
	schema := file.Schema()
	columns := make([]entity.GoldParquetColumn, 0, len(schema.Columns()))
	for _, path := range schema.Columns() {
		leaf, ok := schema.Lookup(path...)
		if !ok {
			continue
		}
		columns = append(columns, entity.GoldParquetColumn{
			Name:     path[len(path)-1],
			Path:     strings.Join(path, "."),
			Type:     leaf.Node.Type().String(),
			Nullable: leaf.Node.Optional(),
			Repeated: leaf.Node.Repeated(),
		})
	}
	return columns
}

func goldSchemaHasColumn(schema []entity.GoldParquetColumn, column string) bool {
	for _, candidate := range schema {
		if candidate.Path == column {
			return true
		}
	}
	return false
}

func goldParquetPreview(data []byte, file *parquet.File, query entity.GoldArtifactPreviewQuery) ([]map[string]any, int, error) {
	reader := parquet.NewReader(bytes.NewReader(data))
	defer reader.Close()
	columns := file.Schema().Columns()
	preview := make([]map[string]any, 0, query.Limit)
	matchedRows := 0
	rows := make([]parquet.Row, 256)
	for {
		n, err := reader.ReadRows(rows)
		if err != nil && !errors.Is(err, io.EOF) {
			return nil, 0, fmt.Errorf("read Gold Parquet preview: %w", err)
		}
		for _, row := range rows[:n] {
			record := goldParquetRecord(row, columns)
			if !goldPreviewMatches(record, query) {
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

func goldParquetRecord(row parquet.Row, columns [][]string) map[string]any {
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

func goldPreviewMatches(record map[string]any, query entity.GoldArtifactPreviewQuery) bool {
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

func (s *GoldControlService) readControl(ctx context.Context) (entity.GoldControlState, error) {
	data, err := s.objects.GetObject(ctx, goldControlKey)
	if err != nil {
		if errors.Is(err, repo.ErrObjectNotFound) {
			return defaultGoldControl(), nil
		}
		return entity.GoldControlState{}, fmt.Errorf("read Gold control: %w", err)
	}
	var control entity.GoldControlState
	if err := json.Unmarshal(data, &control); err != nil {
		return entity.GoldControlState{}, fmt.Errorf("decode Gold control: %w", err)
	}
	control.Mode = strings.ToUpper(strings.TrimSpace(control.Mode))
	if control.Mode != "PAUSED" && control.Mode != "STREAM" && control.Mode != "BATCH" {
		return entity.GoldControlState{}, fmt.Errorf("Gold control has unsupported mode %q", control.Mode)
	}
	if control.IdleFlushSeconds < 60 || control.IdleFlushSeconds > 900 {
		control.IdleFlushSeconds = defaultGoldIdleFlush
	}
	if control.MaxBatchRecords < 1 || control.MaxBatchRecords > maxGoldBatchSize {
		control.MaxBatchRecords = defaultGoldBatchSize
	}
	return control, nil
}

func (s *GoldControlService) writeControl(ctx context.Context, control entity.GoldControlState) error {
	data, err := json.Marshal(control)
	if err != nil {
		return fmt.Errorf("encode Gold control: %w", err)
	}
	if err := s.objects.PutObject(ctx, goldControlKey, data, "application/json"); err != nil {
		return fmt.Errorf("write Gold control: %w", err)
	}
	return nil
}

func (s *GoldControlService) publishAndQuery(ctx context.Context, control entity.GoldControlState, status string) (*entity.GoldControlOverview, error) {
	if s.publisher != nil {
		payload, _ := json.Marshal(control)
		_ = s.publisher.Publish(ctx, entity.WorkflowEvent{
			Type:       "workflow",
			Workflow:   "gold",
			Status:     status,
			JobID:      control.CommandID,
			OccurredAt: control.UpdatedAt,
			Payload:    payload,
		})
	}
	return s.Query(ctx)
}
