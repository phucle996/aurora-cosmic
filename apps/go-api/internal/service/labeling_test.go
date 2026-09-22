package service

import (
	"context"
	"errors"
	"testing"

	"go-api/internal/domain/entity"
)

type mockLabelingRepo struct {
	snapshots []entity.LabelingSnapshotItem
	workspace *entity.LabelingCohortWorkspace
	detail    *entity.LabelingTargetDetail
	err       error
}

func (m *mockLabelingRepo) ListSnapshots(_ context.Context, _ int) ([]entity.LabelingSnapshotItem, error) {
	if m.err != nil {
		return nil, m.err
	}
	return m.snapshots, nil
}

func (m *mockLabelingRepo) GetCohortWorkspace(_ context.Context, _ []string, _ entity.PageRequest) (*entity.LabelingCohortWorkspace, error) {
	if m.err != nil {
		return nil, m.err
	}
	return m.workspace, nil
}

func (m *mockLabelingRepo) GetTargetEvidence(_ context.Context, _ string, _ string) (*entity.LabelingTargetDetail, error) {
	if m.err != nil {
		return nil, m.err
	}
	return m.detail, nil
}

func (m *mockLabelingRepo) SaveCohortLabel(_ context.Context, _ entity.SaveCohortLabelRequest) error {
	if m.err != nil {
		return m.err
	}
	return nil
}

func TestListSnapshots_Success(t *testing.T) {
	mockRepo := &mockLabelingRepo{
		snapshots: []entity.LabelingSnapshotItem{
			{
				SnapshotID:   "gold-v1-90ba082075c9",
				LastModified: "2026-09-19T23:55:27Z",
				SizeBytes:    16686,
				RowCount:     4,
			},
		},
	}

	svc := NewLabelingService(mockRepo)
	items, err := svc.ListSnapshots(context.Background(), 100)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if len(items) != 1 || items[0].SnapshotID != "gold-v1-90ba082075c9" {
		t.Fatalf("unexpected snapshots: %+v", items)
	}
}

func TestListSnapshots_RepoError(t *testing.T) {
	mockRepo := &mockLabelingRepo{
		err: errors.New("clickhouse down"),
	}

	svc := NewLabelingService(mockRepo)
	_, err := svc.ListSnapshots(context.Background(), 100)
	if err == nil {
		t.Fatalf("expected error, got nil")
	}
}

func TestGetCohortWorkspace_Success(t *testing.T) {
	score := 0.92
	above := true
	mockRepo := &mockLabelingRepo{
		workspace: &entity.LabelingCohortWorkspace{
			Disposition: &entity.LabelingCohortDisposition{
				TotalRows:      1500,
				PositiveRows:   120,
				NegativeRows:   1180,
				UnresolvedRows: 200,
			},
			Queue: entity.LabelingQueuePage{
				Items: []entity.LabelingQueueSummaryItem{
					{
						SnapshotID:      "gold-v1-s01",
						SourceProductID: "tess_s01_tic117516398",
						TICID:           117516398,
						Sector:          1,
						BLSPower:        15.4,
						TOIMatchStatus:  "MATCHED",
						CandidateScore:  &score,
						AboveThreshold:  &above,
					},
				},
				TotalCount: 200,
				Limit:      20,
				Offset:     0,
				HasMore:    true,
			},
		},
	}

	svc := NewLabelingService(mockRepo)

	workspace, err := svc.GetCohortWorkspace(context.Background(), []string{"gold-v1-s01"}, entity.PageRequest{Limit: 20, Offset: 0})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if workspace.Disposition == nil || workspace.Disposition.TotalRows != 1500 {
		t.Fatalf("unexpected disposition total_rows: %v", workspace.Disposition)
	}
	if len(workspace.Queue.Items) != 1 {
		t.Fatalf("expected 1 queue item, got %d", len(workspace.Queue.Items))
	}
	item := workspace.Queue.Items[0]
	if item.TICID != 117516398 || item.BLSPower != 15.4 || item.CandidateScore == nil || *item.CandidateScore != 0.92 {
		t.Fatalf("queue item fields not properly mapped: %+v", item)
	}
	if !workspace.Queue.HasMore {
		t.Fatalf("expected HasMore to be true")
	}
}

func TestGetCohortWorkspace_RepoError(t *testing.T) {
	mockRepo := &mockLabelingRepo{
		err: errors.New("clickhouse connection lost"),
	}

	svc := NewLabelingService(mockRepo)

	_, err := svc.GetCohortWorkspace(context.Background(), []string{"gold-v1-s01"}, entity.PageRequest{Limit: 20, Offset: 0})
	if err == nil {
		t.Fatalf("expected error from repo failure, got nil")
	}
}

func TestGetTargetEvidence_Success(t *testing.T) {
	score := 0.88
	above := true
	mockRepo := &mockLabelingRepo{
		detail: &entity.LabelingTargetDetail{
			SnapshotID:      "gold-v1-s01",
			SourceProductID: "p1",
			TICID:           12345,
			Sector:          1,
			TrainingLabel:   "UNRESOLVED",
			LabelSource:     "SYSTEM",
			BLSPower:        18.5,
			BLSAvailable:    true,
			CandidateScore:  &score,
			AboveThreshold:  &above,
		},
	}

	svc := NewLabelingService(mockRepo)
	detail, err := svc.GetTargetEvidence(context.Background(), "gold-v1-s01", "p1")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if detail.TICID != 12345 || detail.BLSPower != 18.5 || detail.CandidateScore == nil || *detail.CandidateScore != 0.88 {
		t.Fatalf("unexpected detail: %+v", detail)
	}
}

func TestGetTargetEvidence_RepoError(t *testing.T) {
	mockRepo := &mockLabelingRepo{
		err: errors.New("target not found"),
	}

	svc := NewLabelingService(mockRepo)
	_, err := svc.GetTargetEvidence(context.Background(), "gold-v1-s01", "p1")
	if err == nil {
		t.Fatalf("expected error from repo failure, got nil")
	}
}

func TestSaveCohortLabel(t *testing.T) {
	mockRepo := &mockLabelingRepo{}
	svc := NewLabelingService(mockRepo)

	err := svc.SaveCohortLabel(context.Background(), entity.SaveCohortLabelRequest{
		SnapshotID:      "gold-v1-s01",
		SourceProductID: "p1",
		TrainingLabel:   "POSITIVE",
		Confidence:      0.95,
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	mockRepo.err = errors.New("write failed")
	err = svc.SaveCohortLabel(context.Background(), entity.SaveCohortLabelRequest{
		SnapshotID:      "gold-v1-s01",
		SourceProductID: "p1",
		TrainingLabel:   "POSITIVE",
	})
	if err == nil {
		t.Fatalf("expected error, got nil")
	}
}
