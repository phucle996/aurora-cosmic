package service

import (
	"context"
	"testing"

	"go-api/internal/domain/entity"
)

type mockTicketRepo struct {
	runs        []entity.PipelineRun
	runDetail   *entity.PipelineRunDetail
	tickets     []entity.RunnerTicket
	created     *entity.RunnerTicket
	lastPipe    string
	lastLimit   int
	lastRunID   string
	lastCreated struct {
		ticketID string
		desc     string
	}
}

func (m *mockTicketRepo) ListRuns(_ context.Context, pipeline string, limit int) ([]entity.PipelineRun, error) {
	m.lastPipe = pipeline
	m.lastLimit = limit
	return m.runs, nil
}

func (m *mockTicketRepo) Detail(_ context.Context, runID string) (*entity.PipelineRunDetail, error) {
	m.lastRunID = runID
	return m.runDetail, nil
}

func (m *mockTicketRepo) ListTickets(_ context.Context, limit int) ([]entity.RunnerTicket, error) {
	m.lastLimit = limit
	return m.tickets, nil
}

func (m *mockTicketRepo) CreateTicket(_ context.Context, ticketID string, description string) (*entity.RunnerTicket, error) {
	m.lastCreated.ticketID = ticketID
	m.lastCreated.desc = description
	return m.created, nil
}

func TestTicketServiceDelegatesDirectlyToRepository(t *testing.T) {
	repo := &mockTicketRepo{
		runs:      []entity.PipelineRun{{RunID: "RUN-1"}},
		runDetail: &entity.PipelineRunDetail{Run: entity.PipelineRun{RunID: "RUN-1"}},
		tickets:   []entity.RunnerTicket{{TicketID: "TICK-1"}},
		created:   &entity.RunnerTicket{TicketID: "TICK-2", Description: "New test ticket"},
	}

	svc := NewTicketService(repo)
	ctx := context.Background()

	// ListRuns
	runs, err := svc.ListRuns(ctx, "gold", 42)
	if err != nil || len(runs) != 1 || repo.lastPipe != "gold" || repo.lastLimit != 42 {
		t.Fatalf("ListRuns delegation failed: runs=%+v, pipe=%s, limit=%d, err=%v", runs, repo.lastPipe, repo.lastLimit, err)
	}

	// Detail
	run, err := svc.Detail(ctx, "RUN-1")
	if err != nil || run == nil || run.Run.RunID != "RUN-1" || repo.lastRunID != "RUN-1" {
		t.Fatalf("Detail delegation failed: run=%+v, err=%v", run, err)
	}

	// ListTickets
	tickets, err := svc.ListTickets(ctx, 80)
	if err != nil || len(tickets) != 1 || tickets[0].TicketID != "TICK-1" || repo.lastLimit != 80 {
		t.Fatalf("ListTickets delegation failed: tickets=%+v, limit=%d, err=%v", tickets, repo.lastLimit, err)
	}

	// CreateTicket
	created, err := svc.CreateTicket(ctx, "TICK-2", "New test ticket")
	if err != nil || created == nil || created.TicketID != "TICK-2" || repo.lastCreated.ticketID != "TICK-2" {
		t.Fatalf("CreateTicket delegation failed: created=%+v, err=%v", created, err)
	}
}
