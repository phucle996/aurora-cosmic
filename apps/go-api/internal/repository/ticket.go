package repository

import (
	"context"
	"crypto/rand"
	"fmt"
	"regexp"
	"strings"
	"time"

	"go-api/infra/clickhouse"
	"go-api/internal/domain/entity"
	"go-api/internal/domain/repo"
)

var factoryRunID = regexp.MustCompile(`^[A-Za-z0-9_-]{1,128}$`)

type TicketClickHouse struct {
	client *clickhouse.Client
}

func NewTicketClickHouse(client *clickhouse.Client) repo.TicketRepository {
	return &TicketClickHouse{client: client}
}

func factoryRunColumns() string {
	return `pipeline, run_id,
		argMax(runs.mode, runs.updated_at) AS mode,
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
		coalesce(argMax(runs.last_error, runs.updated_at), '') AS last_error,
		toString(max(runs.updated_at)) AS updated_at`
}

func (r *TicketClickHouse) ListRuns(ctx context.Context, pipeline string, limit int) ([]entity.PipelineRun, error) {
	if r == nil || r.client == nil || r.client.Conn == nil {
		return nil, fmt.Errorf("ticket repository client is unavailable")
	}
	if limit <= 0 || limit > 500 {
		limit = 100
	}
	where := ""
	var args []any
	if pipeline != "" {
		where = "WHERE runs.pipeline = ? "
		args = append(args, pipeline)
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
	ORDER BY updated_at DESC LIMIT ?`
	args = append(args, limit)

	var runs []entity.PipelineRun
	if err := r.client.Select(ctx, &runs, query, args...); err != nil {
		return nil, fmt.Errorf("list pipeline runs: %w", err)
	}
	return runs, nil
}

func (r *TicketClickHouse) Detail(ctx context.Context, runID string) (*entity.PipelineRunDetail, error) {
	if r == nil || r.client == nil || r.client.Conn == nil {
		return nil, fmt.Errorf("ticket repository client is unavailable")
	}
	if !factoryRunID.MatchString(runID) {
		return nil, fmt.Errorf("invalid run_id")
	}
	runQuery := `WITH latest_batches AS (
		SELECT run_id, batch_id, argMax(input_records, updated_at) AS input_records,
		argMax(candidate_rows, updated_at) AS candidate_rows,
		argMax(indexed_rows, updated_at) AS indexed_rows
		FROM pipeline_batches_v1 WHERE run_id = ? GROUP BY run_id, batch_id
	)
	SELECT ` + factoryRunColumns() + `
	FROM pipeline_runs_v1 AS runs
	LEFT JOIN latest_batches USING (run_id)
	WHERE runs.run_id = ?
	GROUP BY pipeline, run_id
	LIMIT 1`

	var runs []entity.PipelineRun
	if err := r.client.Select(ctx, &runs, runQuery, runID, runID); err != nil {
		return nil, fmt.Errorf("select pipeline run: %w", err)
	}
	if len(runs) == 0 {
		return nil, repo.ErrNotFound
	}
	selected := &runs[0]
	batchesQuery := `SELECT batch_id, argMax(mode, updated_at) AS mode,
		argMax(status, updated_at) AS status, toString(min(started_at)) AS started_at,
		coalesce(toString(argMax(completed_at, updated_at)), '') AS completed_at,
		toInt64(argMax(input_records, updated_at)) AS input_records,
		toInt64(argMax(candidate_rows, updated_at)) AS candidate_rows,
		toInt64(argMax(artifact_count, updated_at)) AS artifact_count,
		toInt64(argMax(indexed_rows, updated_at)) AS indexed_rows,
		coalesce(argMax(snapshot_id, updated_at), '') AS snapshot_id,
		coalesce(argMax(snapshot_fingerprint, updated_at), '') AS snapshot_fingerprint,
		coalesce(argMax(manifest_key, updated_at), '') AS manifest_key,
		coalesce(argMax(manifest_sha256, updated_at), '') AS manifest_sha256,
		coalesce(argMax(error, updated_at), '') AS error
		FROM pipeline_batches_v1 WHERE run_id = ?
		GROUP BY batch_id ORDER BY started_at ASC`

	var batches []entity.PipelineBatch
	if err := r.client.Select(ctx, &batches, batchesQuery, runID); err != nil {
		return nil, fmt.Errorf("select pipeline batches: %w", err)
	}

	componentsQuery := `SELECT component_id, status, toString(occurred_at) AS occurred_at,
		toInt64(input_records) AS input_records,
		toInt64(output_rows) AS output_rows,
		toInt64(indexed_rows) AS indexed_rows,
		coalesce(snapshot_id, '') AS snapshot_id,
		coalesce(error, '') AS error
		FROM pipeline_component_events_v1 WHERE run_id = ?
		ORDER BY occurred_at ASC`

	var components []entity.PipelineComponentEvent
	if err := r.client.Select(ctx, &components, componentsQuery, runID); err != nil {
		return nil, fmt.Errorf("select pipeline component events: %w", err)
	}

	return &entity.PipelineRunDetail{
		Run:        *selected,
		Batches:    batches,
		Components: components,
	}, nil
}

func (r *TicketClickHouse) ListTickets(ctx context.Context, limit int) ([]entity.RunnerTicket, error) {
	if r == nil || r.client == nil || r.client.Conn == nil {
		return nil, fmt.Errorf("ticket repository client is unavailable")
	}
	if limit <= 0 || limit > 200 {
		limit = 100
	}
	query := `WITH all_tickets AS (
		SELECT ticket_id, created_at, description, updated_at FROM factory_tickets_v1
		UNION ALL
		SELECT run_id AS ticket_id, started_at AS created_at, '' AS description, updated_at FROM pipeline_runs_v1
	)
	SELECT all_tickets.ticket_id AS ticket_id,
		toString(min(all_tickets.created_at)) AS created_at,
		argMax(all_tickets.description, all_tickets.updated_at) AS description,
		toString(max(all_tickets.updated_at)) AS updated_at
	FROM all_tickets
	GROUP BY all_tickets.ticket_id
	ORDER BY created_at DESC
	LIMIT ?`

	var tickets []entity.RunnerTicket
	if err := r.client.Select(ctx, &tickets, query, limit); err != nil {
		return nil, fmt.Errorf("query factory tickets: %w", err)
	}
	return tickets, nil
}

func (r *TicketClickHouse) CreateTicket(ctx context.Context, ticketID string, description string) (*entity.RunnerTicket, error) {
	if r == nil || r.client == nil || r.client.Conn == nil {
		return nil, fmt.Errorf("ticket repository client is unavailable")
	}
	ticketID = strings.TrimSpace(ticketID)
	if ticketID == "" {
		b := make([]byte, 2)
		if _, err := rand.Read(b); err != nil {
			return nil, fmt.Errorf("generate ticket ID: %w", err)
		}
		ticketID = fmt.Sprintf("RUN-%s-%X", time.Now().UTC().Format("20060102"), b)
	}
	if !factoryRunID.MatchString(ticketID) {
		return nil, fmt.Errorf("invalid ticket_id format")
	}

	now := time.Now().UTC()
	nowStr := now.Format("2006-01-02 15:04:05.000")

	query := "INSERT INTO factory_tickets_v1 (ticket_id, created_at, description, updated_at) VALUES (?, ?, ?, ?)"
	if err := r.client.Exec(ctx, query, ticketID, now, description, now); err != nil {
		return nil, fmt.Errorf("insert factory ticket: %w", err)
	}

	return &entity.RunnerTicket{
		TicketID:    ticketID,
		CreatedAt:   nowStr,
		Description: description,
		UpdatedAt:   nowStr,
	}, nil
}
