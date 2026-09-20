package repository

import (
	"context"
	"testing"

	"go-api/infra/clickhouse"
	"go-api/internal/domain/entity"
)

func TestLiveClickHouseListSnapshots(t *testing.T) {
	client, err := clickhouse.NewClient("127.0.0.1:9004", "aurora", "aurora", "aurora-dev-password")
	if err != nil || client.Ping(context.Background()) != nil {
		t.Skipf("ClickHouse TCP not reachable, skipping live test: %v", err)
	}

	repo := NewLabelingClickHouse(client)
	snapshots, err := repo.ListSnapshots(context.Background(), 100)
	if err != nil {
		t.Fatalf("Live ListSnapshots error: %v", err)
	}

	if len(snapshots) == 0 {
		t.Fatalf("expected at least 1 snapshot in live ClickHouse")
	}

	t.Logf("Found %d snapshots, first: ID=%s, LastModified=%s, RowCount=%d",
		len(snapshots),
		snapshots[0].SnapshotID,
		snapshots[0].LastModified,
		snapshots[0].RowCount,
	)

	if snapshots[0].SnapshotID != "gold-v1-90ba082075c9" {
		t.Errorf("expected gold-v1-90ba082075c9, got %s", snapshots[0].SnapshotID)
	}
}

func TestLiveClickHouseGetCohortWorkspace(t *testing.T) {
	client, err := clickhouse.NewClient("127.0.0.1:9004", "aurora", "aurora", "aurora-dev-password")
	if err != nil || client.Ping(context.Background()) != nil {
		t.Skipf("ClickHouse TCP not reachable, skipping live test: %v", err)
	}

	repo := NewLabelingClickHouse(client)
	workspace, err := repo.GetCohortWorkspace(context.Background(), []string{"gold-v1-90ba082075c9"}, entity.PageRequest{
		Limit:  20,
		Offset: 0,
	})
	if err != nil {
		t.Fatalf("Live GetCohortWorkspace error: %v", err)
	}

	if workspace == nil {
		t.Fatalf("expected non-nil workspace")
	}

	if workspace.Disposition == nil {
		t.Fatalf("expected non-nil disposition")
	}

	t.Logf("Disposition total_rows=%d, positive_rows=%d, negative_rows=%d, queue total_count=%d, items=%d",
		workspace.Disposition.TotalRows,
		workspace.Disposition.PositiveRows,
		workspace.Disposition.NegativeRows,
		workspace.Queue.TotalCount,
		len(workspace.Queue.Items),
	)

	if workspace.Disposition.TotalRows != 4 {
		t.Errorf("expected 4 total rows in cohort, got %d", workspace.Disposition.TotalRows)
	}
}
