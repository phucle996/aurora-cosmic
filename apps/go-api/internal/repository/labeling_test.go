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

	if snapshots[0].SnapshotID == "" {
		t.Errorf("expected non-empty snapshot ID")
	}
}

func TestLiveClickHouseGetCohortWorkspaceAndSaveLabel(t *testing.T) {
	client, err := clickhouse.NewClient("127.0.0.1:9004", "aurora", "aurora", "aurora-dev-password")
	if err != nil || client.Ping(context.Background()) != nil {
		t.Skipf("ClickHouse TCP not reachable, skipping live test: %v", err)
	}

	repo := NewLabelingClickHouse(client)
	snapshots, err := repo.ListSnapshots(context.Background(), 5)
	if err != nil || len(snapshots) == 0 {
		t.Skipf("no snapshots found for live test: %v", err)
	}

	snapID := snapshots[0].SnapshotID
	workspace, err := repo.GetCohortWorkspace(context.Background(), []string{snapID}, entity.PageRequest{
		Limit:  20,
		Offset: 0,
	})
	if err != nil {
		t.Fatalf("Live GetCohortWorkspace error: %v", err)
	}

	if workspace == nil || workspace.Disposition == nil {
		t.Fatalf("expected non-nil workspace & disposition")
	}

	t.Logf("Snapshot %s: Disposition total_rows=%d, queue total_count=%d, items=%d",
		snapID,
		workspace.Disposition.TotalRows,
		workspace.Queue.TotalCount,
		len(workspace.Queue.Items),
	)

	if len(workspace.Queue.Items) > 0 {
		item := workspace.Queue.Items[0]
		saveErr := repo.SaveCohortLabel(context.Background(), entity.SaveCohortLabelRequest{
			SnapshotID:      item.SnapshotID,
			SourceProductID: item.SourceProductID,
			TrainingLabel:   "POSITIVE",
			ReviewReason:    "live test positive adjudication",
			Confidence:      0.95,
		})
		if saveErr != nil {
			t.Fatalf("Live SaveCohortLabel error: %v", saveErr)
		}
	}
}
