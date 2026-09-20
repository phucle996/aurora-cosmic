/**
 * @file page.tsx
 * @description Composition root for the Runner Tickets execution & governance dashboard.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { JSX } from 'react';
import { AlertCircle } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';

import { apiBase, apiFetch } from '@/lib/api';
import { useRunnerTicket } from '@/lib/session';
import { RunnerTicketInspector } from './components/RunnerTicketInspector';
import { TicketHeroBanner } from './components/TicketHeroBanner';
import { TicketListCard } from './components/TicketListCard';
import { TicketSummaryStrip } from './components/TicketSummaryStrip';
import type { PipelineRun, TicketRecord } from './types';
import { normalizedStatus, parseTime } from './utils';

const FACTORY_RUN_HISTORY_LIMIT = 100;

export default function RunnerTicketsPage(): JSX.Element {
  const { createNewTicket, tickets, loadTickets } = useRunnerTicket();
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedRunID = searchParams.get('run_id') ?? '';
  const [runs, setRuns] = useState<PipelineRun[]>([]);
  const [query, setQuery] = useState('');
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(true);
  const refreshTimer = useRef<number | undefined>(undefined);

  const selectRun = useCallback(
    (runID: string, replace = false): void => {
      const next = new URLSearchParams(searchParams);
      if (runID) next.set('run_id', runID);
      else next.delete('run_id');
      setSearchParams(next, { replace });
    },
    [searchParams, setSearchParams],
  );

  const loadRuns = useCallback(async (showLoading = true): Promise<PipelineRun[]> => {
    if (showLoading) setLoading(true);
    try {
      const response = await apiFetch<{ items: PipelineRun[] }>(
        `/v1/data-factory/runs?limit=${FACTORY_RUN_HISTORY_LIMIT}`,
      );
      const items = response.items ?? [];
      setRuns(items);
      setError(undefined);
      return items;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Failed to load Data Factory run history');
      return [];
    } finally {
      if (showLoading) setLoading(false);
    }
  }, []);

  // Aggregate ClickHouse tickets and observed stage runs
  const ticketRecords = useMemo<TicketRecord[]>(() => {
    const map = new Map<string, PipelineRun[]>();
    for (const run of runs) {
      if (!run.run_id) continue;
      const list = map.get(run.run_id) ?? [];
      list.push(run);
      map.set(run.run_id, list);
    }

    const allTicketIds = new Set<string>();
    for (const t of tickets) {
      if (t.ticket_id) allTicketIds.add(t.ticket_id);
    }
    for (const runId of map.keys()) {
      allTicketIds.add(runId);
    }

    const records: TicketRecord[] = [];
    for (const tid of allTicketIds) {
      const ticketRuns = map.get(tid) ?? [];
      const chTicket = tickets.find((t) => t.ticket_id === tid);

      const ingestRun = ticketRuns.find(
        (r) => r.pipeline.toLowerCase().includes('ingest') || r.pipeline.toLowerCase().includes('bronze'),
      );
      const goldRun = ticketRuns.find(
        (r) =>
          r.pipeline.toLowerCase().includes('gold') ||
          r.pipeline.toLowerCase().includes('enrich') ||
          r.pipeline.toLowerCase().includes('silver_to_gold'),
      );
      const silverRun = ticketRuns.find(
        (r) =>
          (r.pipeline.toLowerCase().includes('preprocess') || r.pipeline.toLowerCase().includes('silver')) &&
          !r.pipeline.toLowerCase().includes('gold') &&
          !r.pipeline.toLowerCase().includes('silver_to_gold'),
      );

      const primaryRun = goldRun ?? silverRun ?? ingestRun ?? ticketRuns[0];

      let overallStatus = 'idle';
      if (ticketRuns.some((r) => ['running', 'draining', 'catalog_syncing'].includes(normalizedStatus(r.status)))) {
        overallStatus = 'running';
      } else if (ticketRuns.some((r) => ['failed', 'error'].includes(normalizedStatus(r.status)))) {
        overallStatus = 'failed';
      } else if (ticketRuns.length > 0 && ticketRuns.every((r) => normalizedStatus(r.status) === 'completed')) {
        overallStatus = 'completed';
      }

      const overallMode = primaryRun?.mode || 'STREAM';
      const startedAt =
        chTicket?.created_at ??
        ticketRuns.map((r) => r.started_at).filter(Boolean).sort()[0] ??
        primaryRun?.started_at;
      const updatedAt =
        chTicket?.updated_at ??
        ticketRuns.map((r) => r.updated_at).filter(Boolean).sort().reverse()[0] ??
        primaryRun?.updated_at;
      const finishedAt = primaryRun?.finished_at;

      records.push({
        ticket_id: tid,
        runs: ticketRuns,
        primaryRun,
        mode: overallMode,
        status: overallStatus,
        started_at: startedAt,
        finished_at: finishedAt,
        updated_at: updatedAt,
        last_snapshot_id: primaryRun?.last_snapshot_id,
        last_error: ticketRuns.find((r) => r.last_error)?.last_error,
        hasIngest: Boolean(ingestRun),
        hasSilver: Boolean(silverRun),
        hasGold: Boolean(goldRun),
        ingestRun,
        silverRun,
        goldRun,
      });
    }

    records.sort((a, b) => {
      const timeA = parseTime(a.started_at ?? a.updated_at)?.getTime() ?? 0;
      const timeB = parseTime(b.started_at ?? b.updated_at)?.getTime() ?? 0;
      return timeB - timeA;
    });

    return records;
  }, [runs, tickets]);

  // Initial mount load: fetch runs once. If no ticket in URL, select the latest.
  useEffect(() => {
    void (async () => {
      const items = await loadRuns();
      const currentParam = new URLSearchParams(window.location.search).get('run_id');
      if (!currentParam && items[0]?.run_id) {
        selectRun(items[0].run_id, true);
      }
    })();
  }, [loadRuns, selectRun]);

  // Live updates via SSE: keeps EventSource connection stable across ticket selections
  useEffect(() => {
    const scheduleRefresh = (): void => {
      if (refreshTimer.current) window.clearTimeout(refreshTimer.current);
      refreshTimer.current = window.setTimeout(() => {
        void loadRuns(false);
        void loadTickets();
      }, 500);
    };
    const events = new EventSource(`${apiBase}/v1/events?topic=gold`);
    events.addEventListener('workflow', scheduleRefresh);
    return () => {
      events.close();
      if (refreshTimer.current) window.clearTimeout(refreshTimer.current);
    };
  }, [loadRuns, loadTickets]);

  const handleCreateNew = () => {
    const created = createNewTicket();
    selectRun(created, false);
    void loadTickets();
    void loadRuns(false);
  };

  const filteredTickets = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return ticketRecords;
    return ticketRecords.filter((t) => {
      return [t.ticket_id, t.last_snapshot_id, t.started_at].some((v) => v?.toLowerCase().includes(needle));
    });
  }, [ticketRecords, query]);

  const selectedTicket =
    ticketRecords.find((t) => t.ticket_id === selectedRunID) ??
    (selectedRunID
      ? {
        ticket_id: selectedRunID,
        runs: [],
        mode: 'STREAM',
        status: 'idle',
        hasIngest: false,
        hasSilver: false,
        hasGold: false,
      }
      : undefined);

  const completedTicketsCount = useMemo(() => {
    return ticketRecords.filter((r) => normalizedStatus(r.status) === 'completed').length;
  }, [ticketRecords]);

  const totalStageRuns = useMemo(() => {
    return runs.length;
  }, [runs]);

  const executionHealth = useMemo(() => {
    const completed = runs.filter((r) => normalizedStatus(r.status) === 'completed').length;
    const failed = runs.filter((r) => ['failed', 'error'].includes(normalizedStatus(r.status))).length;
    if (runs.length === 0) return '100%';
    return `${Math.round((completed / (completed + failed || 1)) * 100)}%`;
  }, [runs]);

  return (
    <div className="space-y-5">
      {/* Hero Banner with Blueprint Grid */}
      <TicketHeroBanner onCreateNew={handleCreateNew} />

      {/* Top 4 KPI Stat Strip */}
      <TicketSummaryStrip
        totalTickets={ticketRecords.length}
        completedCount={completedTicketsCount}
        totalRuns={totalStageRuns}
        executionHealth={executionHealth}
      />

      {error ? (
        <div className="flex items-center gap-2 border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          <AlertCircle className="size-4" />
          {error}
        </div>
      ) : null}

      <div className="grid min-w-0 gap-4 2xl:grid-cols-[minmax(0,1.35fr)_minmax(380px,0.65fr)]">
        {/* Ticket List Table */}
        <TicketListCard
          tickets={filteredTickets}
          totalTicketsCount={ticketRecords.length}
          selectedRunID={selectedRunID}
          searchQuery={query}
          onSearchChange={setQuery}
          onSelectTicket={(ticketId) => selectRun(ticketId)}
          loading={loading}
        />

        {/* Right Inspector: Clean Execution History */}
        <RunnerTicketInspector
          ticket={selectedTicket}
          loading={loading}
        />
      </div>
    </div>
  );
}
