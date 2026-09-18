package service

import (
	"context"
	"testing"

	"go-api/internal/domain/entity"
)

type mockTicketRepo struct {
	runs        []entity.FactoryRun
	runDetail   *entity.FactoryRunDetail
	tickets     []entity.FactoryTicket
	created     *entity.FactoryTicket
	lastPipe    string
	lastLimit   int
	lastRunID   string
	lastCreated struct {
		ticketID string
		desc     string
	}
}

func (m *mockTicketRepo) ListRuns(_ context.Context, pipeline string, limit int) ([]entity.FactoryRun, error) {
	m.lastPipe = pipeline
	m.lastLimit = limit
	return m.runs, nil
}

func (m *mockTicketRepo) GetRun(_ context.Context, runID string) (*entity.FactoryRunDetail, error) {
	m.lastRunID = runID
	return m.runDetail, nil
}

func (m *mockTicketRepo) ListTickets(_ context.Context, limit int) ([]entity.FactoryTicket, error) {
	m.lastLimit = limit
	return m.tickets, nil
}

func (m *mockTicketRepo) CreateTicket(_ context.Context, ticketID string, description string) (*entity.FactoryTicket, error) {
	m.lastCreated.ticketID = ticketID
	m.lastCreated.desc = description
	return m.created, nil
}

func TestTicketServiceDelegatesDirectlyToRepository(t *testing.T) {
	repo := &mockTicketRepo{
		runs:      []entity.FactoryRun{{RunID: "RUN-1"}},
		runDetail: &entity.FactoryRunDetail{Run: entity.FactoryRun{RunID: "RUN-1"}},
		tickets:   []entity.FactoryTicket{{TicketID: "TICK-1"}},
		created:   &entity.FactoryTicket{TicketID: "TICK-2", Description: "New test ticket"},
	}

	svc := NewTicketService(repo)
	ctx := context.Background()

	// ListRuns
	runs, err := svc.ListRuns(ctx, "gold", 42)
	if err != nil || len(runs) != 1 || repo.lastPipe != "gold" || repo.lastLimit != 42 {
		t.Fatalf("ListRuns delegation failed: runs=%+v, pipe=%s, limit=%d, err=%v", runs, repo.lastPipe, repo.lastLimit, err)
	}

	// GetRun
	run, err := svc.GetRun(ctx, "RUN-1")
	if err != nil || run.Run.RunID != "RUN-1" || repo.lastRunID != "RUN-1" {
		t.Fatalf("GetRun delegation failed: run=%+v, err=%v", run, err)
	}

	// ListTickets
	tickets, err := svc.ListTickets(ctx, 80)
	if err != nil || len(tickets) != 1 || repo.lastLimit != 80 {
		t.Fatalf("ListTickets delegation failed: tickets=%+v, limit=%d, err=%v", tickets, repo.lastLimit, err)
	}

	// CreateTicket
	created, err := svc.CreateTicket(ctx, "TICK-2", "New test ticket")
	if err != nil || created.TicketID != "TICK-2" || repo.lastCreated.ticketID != "TICK-2" || repo.lastCreated.desc != "New test ticket" {
		t.Fatalf("CreateTicket delegation failed: created=%+v, err=%v", created, err)
	}
}
