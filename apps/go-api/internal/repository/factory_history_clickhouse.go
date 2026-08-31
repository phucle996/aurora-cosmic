package repository

import (
	"context"
	"encoding/json"
	"fmt"
	"regexp"
	"strconv"
	"strings"

	"go-api/infra/clickhouse"
	"go-api/internal/domain/entity"
	"go-api/internal/domain/repo"
)

var factoryRunID = regexp.MustCompile(`^[A-Za-z0-9_-]{1,128}$`)

type FactoryHistoryClickHouse struct{ client *clickhouse.Client }

func NewFactoryHistoryClickHouse(client *clickhouse.Client) repo.FactoryHistoryRepository {
	return &FactoryHistoryClickHouse{client: client}
}

func decodeFactoryRows[T any](payload []byte) ([]T, error) {
	var response struct {
		Data []json.RawMessage `json:"data"`
	}
	if err := json.Unmarshal(payload, &response); err != nil {
		return nil, fmt.Errorf("decode factory history: %w", err)
	}

	rows := make([]T, 0, len(response.Data))
	for _, rawRow := range response.Data {
		normalized, err := normalizeFactoryNumericFields(rawRow)
		if err != nil {
			return nil, fmt.Errorf("decode factory history: %w", err)
		}
		var row T
		if err := json.Unmarshal(normalized, &row); err != nil {
			return nil, fmt.Errorf("decode factory history: %w", err)
		}
		rows = append(rows, row)
	}
	return rows, nil
}

// ClickHouse's JSON format quotes 64-bit integers by default.  The API keeps
// these counts as JSON numbers for the dashboard, so normalize only the
// history metric fields before unmarshalling into the domain types.
func normalizeFactoryNumericFields(rawRow json.RawMessage) ([]byte, error) {
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(rawRow, &fields); err != nil {
		return nil, fmt.Errorf("decode history row: %w", err)
	}
	for _, field := range []string{
		"max_batch_records", "idle_flush_seconds", "pending_inputs",
		"completed_batches", "input_records", "output_rows", "indexed_rows",
		"candidate_rows", "artifact_count",
	} {
		rawValue, exists := fields[field]
		if !exists || len(rawValue) == 0 || rawValue[0] != '"' {
			continue
		}
		var quoted string
		if err := json.Unmarshal(rawValue, &quoted); err != nil {
			return nil, fmt.Errorf("decode %s: %w", field, err)
		}
		value, err := strconv.ParseInt(quoted, 10, 64)
		if err != nil {
			return nil, fmt.Errorf("decode %s: %w", field, err)
		}
		fields[field] = json.RawMessage(strconv.FormatInt(value, 10))
	}
	return json.Marshal(fields)
}

func factoryRunColumns() string {
	return `pipeline, run_id,
		argMax(runs.mode, runs.updated_at) AS mode, argMax(runs.status, runs.updated_at) AS status,
		toString(min(runs.started_at)) AS started_at,
		toString(argMax(runs.finished_at, runs.updated_at)) AS finished_at,
		argMax(runs.max_batch_records, runs.updated_at) AS max_batch_records,
		argMax(runs.idle_flush_seconds, runs.updated_at) AS idle_flush_seconds,
		argMax(runs.pending_inputs, runs.updated_at) AS pending_inputs,
		countIf(latest_batches.batch_id != '') AS completed_batches,
		coalesce(sum(latest_batches.input_records), 0) AS input_records,
		coalesce(sum(latest_batches.candidate_rows), 0) AS output_rows,
		coalesce(sum(latest_batches.indexed_rows), 0) AS indexed_rows,
		argMax(runs.last_snapshot_id, runs.updated_at) AS last_snapshot_id,
		argMax(runs.last_error, runs.updated_at) AS last_error,
		toString(max(runs.updated_at)) AS updated_at`
}

func (r *FactoryHistoryClickHouse) ListRuns(ctx context.Context, pipeline string, limit int) ([]entity.FactoryRun, error) {
	if r == nil || r.client == nil {
		return nil, fmt.Errorf("factory history client is unavailable")
	}
	where := ""
	if pipeline != "" {
		where = "WHERE runs.pipeline = '" + pipeline + "'"
	}
	query := `WITH latest_batches AS (
		SELECT run_id, batch_id, argMax(input_records, updated_at) AS input_records,
		argMax(candidate_rows, updated_at) AS candidate_rows,
		argMax(indexed_rows, updated_at) AS indexed_rows
		FROM pipeline_batches_v1 GROUP BY run_id, batch_id
	)
	SELECT ` + factoryRunColumns() + `
	FROM pipeline_runs_v1 AS runs
	LEFT JOIN latest_batches USING (run_id)
	` + where + `
	GROUP BY pipeline, run_id
	ORDER BY updated_at DESC LIMIT ` + fmt.Sprintf("%d", limit) + ` FORMAT JSON`
	payload, err := r.client.Query(ctx, query)
	if err != nil {
		return nil, err
	}
	return decodeFactoryRows[entity.FactoryRun](payload)
}

func (r *FactoryHistoryClickHouse) GetRun(ctx context.Context, runID string) (*entity.FactoryRunDetail, error) {
	if r == nil || r.client == nil {
		return nil, fmt.Errorf("factory history client is unavailable")
	}
	if !factoryRunID.MatchString(runID) {
		return nil, fmt.Errorf("invalid run_id")
	}
	runs, err := r.ListRuns(ctx, "", 100)
	if err != nil {
		return nil, err
	}
	var selected *entity.FactoryRun
	for index := range runs {
		if runs[index].RunID == runID {
			selected = &runs[index]
			break
		}
	}
	if selected == nil {
		return nil, repo.ErrNotFound
	}
	query := `SELECT batch_id, argMax(mode, updated_at) AS mode,
		argMax(status, updated_at) AS status, toString(min(started_at)) AS started_at,
		toString(argMax(completed_at, updated_at)) AS completed_at,
		argMax(input_records, updated_at) AS input_records,
		argMax(candidate_rows, updated_at) AS candidate_rows,
		argMax(artifact_count, updated_at) AS artifact_count,
		argMax(indexed_rows, updated_at) AS indexed_rows,
		argMax(snapshot_id, updated_at) AS snapshot_id,
		argMax(snapshot_fingerprint, updated_at) AS snapshot_fingerprint,
		argMax(manifest_key, updated_at) AS manifest_key,
		argMax(manifest_sha256, updated_at) AS manifest_sha256,
		argMax(error, updated_at) AS error
		FROM pipeline_batches_v1 WHERE run_id = '` + strings.ReplaceAll(runID, "'", "") + `'
		GROUP BY batch_id ORDER BY started_at ASC FORMAT JSON`
	payload, err := r.client.Query(ctx, query)
	if err != nil {
		return nil, err
	}
	batches, err := decodeFactoryRows[entity.FactoryBatch](payload)
	if err != nil {
		return nil, err
	}
	componentsQuery := `SELECT component_id, status, toString(occurred_at) AS occurred_at,
		input_records, output_rows, indexed_rows, snapshot_id, error
		FROM pipeline_component_events_v1 WHERE run_id = '` + strings.ReplaceAll(runID, "'", "") + `'
		ORDER BY occurred_at ASC FORMAT JSON`
	payload, err = r.client.Query(ctx, componentsQuery)
	if err != nil {
		return nil, err
	}
	components, err := decodeFactoryRows[entity.FactoryComponentEvent](payload)
	if err != nil {
		return nil, err
	}
	return &entity.FactoryRunDetail{Run: *selected, Batches: batches, Components: components}, nil
}
