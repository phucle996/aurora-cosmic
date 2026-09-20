package repository

import (
	"context"
	"fmt"
	"strings"

	"go-api/infra/clickhouse"
	"go-api/internal/domain/entity"
	"go-api/internal/domain/repo"
)

// DAGClickHouse implements the dedicated DAGRepository port for the DAG visualization workflow.
type DAGClickHouse struct {
	client *clickhouse.Client
}

// NewDAGClickHouse creates a new ClickHouse repository dedicated to DAG evidence queries.
func NewDAGClickHouse(client *clickhouse.Client) repo.DAGRepository {
	return &DAGClickHouse{client: client}
}

func (r *DAGClickHouse) GetRunEvidence(ctx context.Context, ticketID string) (*entity.DAGRunEvidence, error) {
	if r == nil || r.client == nil || r.client.Conn == nil {
		return nil, fmt.Errorf("dag repository clickhouse client is unavailable")
	}
	ticketID = strings.TrimSpace(ticketID)
	if ticketID == "" {
		return nil, nil
	}

	runQuery := `WITH latest_batches AS (
		SELECT run_id, batch_id, argMax(input_records, updated_at) AS input_records,
			argMax(candidate_rows, updated_at) AS candidate_rows,
			argMax(indexed_rows, updated_at) AS indexed_rows
		FROM pipeline_batches_v1 WHERE run_id = ?
		GROUP BY run_id, batch_id
	)
	SELECT runs.run_id AS run_id,
		argMax(runs.status, runs.updated_at) AS status,
		toString(min(runs.started_at)) AS started_at,
		coalesce(toString(argMax(runs.finished_at, runs.updated_at)), '') AS finished_at,
		toInt64(argMax(runs.max_batch_records, runs.updated_at)) AS max_batch_records,
		toInt64(argMax(runs.idle_flush_seconds, runs.updated_at)) AS idle_flush_seconds,
		toInt64(argMax(runs.pending_inputs, runs.updated_at)) AS pending_inputs,
		toInt64(countIf(latest_batches.batch_id != '')) AS completed_batches,
		toInt64(coalesce(sum(latest_batches.input_records), 0)) AS input_records,
		toInt64(coalesce(sum(latest_batches.candidate_rows), 0)) AS output_rows,
		toInt64(coalesce(sum(latest_batches.indexed_rows), 0)) AS indexed_rows,
		coalesce(argMax(runs.last_snapshot_id, runs.updated_at), '') AS last_snapshot_id,
		coalesce(argMax(runs.last_error, runs.updated_at), '') AS last_error
	FROM pipeline_runs_v1 AS runs
	LEFT JOIN latest_batches ON runs.run_id = latest_batches.run_id
	WHERE runs.run_id = ?
	GROUP BY runs.run_id
	LIMIT 1`

	var runs []entity.DAGRunEvidence
	if err := r.client.Select(ctx, &runs, runQuery, ticketID, ticketID); err != nil {
		return nil, fmt.Errorf("select run evidence: %w", err)
	}
	if len(runs) == 0 {
		return nil, nil
	}

	evidence := runs[0]

	compQuery := `SELECT component_id,
		argMax(status, occurred_at) AS status,
		toInt64(sum(input_records)) AS input_records,
		toInt64(sum(output_rows)) AS output_rows,
		toInt64(sum(indexed_rows)) AS indexed_rows
	FROM pipeline_component_events_v1
	WHERE run_id = ?
	GROUP BY component_id`

	var comps []entity.DAGComponentEvidence
	if err := r.client.Select(ctx, &comps, compQuery, ticketID); err == nil {
		evidence.Components = make(map[string]entity.DAGComponentEvidence, len(comps))
		for _, c := range comps {
			evidence.Components[c.ComponentID] = c
		}
	}

	return &evidence, nil
}
