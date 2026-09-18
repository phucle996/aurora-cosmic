import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { JSX } from 'react';
import {
  Activity,
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  Clock3,
  ExternalLink,
  GitBranch,
  Layers,
  LoaderCircle,
  Plus,
  Search,
  Ticket,
} from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useRunnerTicket } from '@/features/factory-history/session';
import type { FactoryComponentEvent, FactoryRun, FactoryRunDetail } from '@/features/factory-history/types';
import { apiBase, apiFetch } from '@/lib/api';

type StatusFilter = 'all' | 'active' | 'completed' | 'attention' | 'stopped';

const FACTORY_RUN_HISTORY_LIMIT = 100;

export interface TicketRecord {
  ticket_id: string;
  runs: FactoryRun[];
  primaryRun?: FactoryRun;
  mode: string;
  status: string;
  started_at?: string;
  finished_at?: string;
  updated_at?: string;
  last_snapshot_id?: string;
  last_error?: string;
  hasIngest: boolean;
  hasSilver: boolean;
  hasGold: boolean;
  ingestRun?: FactoryRun;
  silverRun?: FactoryRun;
  goldRun?: FactoryRun;
}

function parseTime(value?: string): Date | undefined {
  if (!value) return undefined;
  const parsed = new Date(value.includes('T') ? value : `${value.replace(' ', 'T')}Z`);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

function displayTime(value?: string): string {
  return parseTime(value)?.toLocaleString('en-US') ?? value ?? '—';
}

function elapsed(start?: string, end?: string): string {
  const from = parseTime(start)?.getTime();
  const to = parseTime(end)?.getTime();
  if (from === undefined || to === undefined || to < from) return '—';
  const seconds = (to - from) / 1000;
  if (seconds < 60) return `${seconds.toFixed(seconds < 10 ? 1 : 0)}s`;
  if (seconds < 3600) return `${(seconds / 60).toFixed(1)}m`;
  return `${(seconds / 3600).toFixed(1)}h`;
}

function normalizedStatus(value?: string): string {
  return (value ?? 'not_observed').trim().toLowerCase();
}

function statusVariant(status: string): 'default' | 'secondary' | 'destructive' | 'outline' {
  const state = normalizedStatus(status);
  if (state === 'completed' || state === 'ready') return 'default';
  if (state === 'failed' || state === 'error') return 'destructive';
  if (state === 'running' || state === 'draining' || state === 'catalog_syncing') return 'secondary';
  return 'outline';
}

function statusMatches(ticket: TicketRecord, filter: StatusFilter): boolean {
  const status = normalizedStatus(ticket.status);
  if (filter === 'all') return true;
  if (filter === 'active') return ['running', 'draining', 'catalog_syncing', 'active'].includes(status);
  if (filter === 'completed') return status === 'completed';
  if (filter === 'attention') return status === 'failed' || status === 'error' || Boolean(ticket.last_error);
  return ['stopped', 'frozen', 'canceled', 'cancelled', 'idle'].includes(status);
}

export default function RunHistoryPage(): JSX.Element {
  const { activeTicket, setActiveTicket, createNewTicket, recentTickets } = useRunnerTicket();
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedRunID = searchParams.get('run_id') ?? '';
  const [runs, setRuns] = useState<FactoryRun[]>([]);
  const [detail, setDetail] = useState<FactoryRunDetail>();
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [modeFilter, setModeFilter] = useState('all');
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const refreshTimer = useRef<number>();

  const selectRun = useCallback((runID: string, replace = false): void => {
    const next = new URLSearchParams(searchParams);
    if (runID) next.set('run_id', runID);
    else next.delete('run_id');
    setSearchParams(next, { replace });
  }, [searchParams, setSearchParams]);

  const loadRuns = useCallback(async (showLoading = true): Promise<FactoryRun[]> => {
    if (showLoading) setLoading(true);
    try {
      const response = await apiFetch<{ items: FactoryRun[] }>(
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

  const loadDetail = useCallback(async (runID: string, showLoading = true): Promise<void> => {
    if (!runID) {
      setDetail(undefined);
      return;
    }
    if (showLoading) setDetailLoading(true);
    try {
      const data = await apiFetch<FactoryRunDetail>(`/v1/data-factory/runs/${encodeURIComponent(runID)}`);
      setDetail(data);
    } catch {
      // Fresh tickets not yet in ClickHouse return 404 cleanly
      setDetail(undefined);
    } finally {
      if (showLoading) setDetailLoading(false);
    }
  }, []);

  // Aggregate runs and recentTickets into distinct Runner Tickets
  const ticketRecords = useMemo<TicketRecord[]>(() => {
    const map = new Map<string, FactoryRun[]>();
    for (const run of runs) {
      if (!run.run_id) continue;
      const list = map.get(run.run_id) ?? [];
      list.push(run);
      map.set(run.run_id, list);
    }

    const allTicketIds = new Set<string>();
    if (activeTicket) allTicketIds.add(activeTicket);
    for (const t of recentTickets) {
      if (t) allTicketIds.add(t);
    }
    for (const runId of map.keys()) {
      allTicketIds.add(runId);
    }

    const records: TicketRecord[] = [];
    for (const tid of allTicketIds) {
      const ticketRuns = map.get(tid) ?? [];
      
      const ingestRun = ticketRuns.find((r) => r.pipeline.toLowerCase().includes('ingest'));
      const silverRun = ticketRuns.find((r) => 
        r.pipeline.toLowerCase().includes('preprocess') || r.pipeline.toLowerCase().includes('silver')
      );
      const goldRun = ticketRuns.find((r) => 
        r.pipeline.toLowerCase().includes('gold') || r.pipeline.toLowerCase().includes('enrich') || r.pipeline.toLowerCase() === 'silver_to_gold'
      );

      const primaryRun = goldRun ?? silverRun ?? ingestRun ?? ticketRuns[0];

      let overallStatus = 'idle';
      if (ticketRuns.some((r) => ['running', 'draining', 'catalog_syncing'].includes(normalizedStatus(r.status)))) {
        overallStatus = 'running';
      } else if (ticketRuns.some((r) => ['failed', 'error'].includes(normalizedStatus(r.status)))) {
        overallStatus = 'failed';
      } else if (ticketRuns.length > 0 && ticketRuns.every((r) => normalizedStatus(r.status) === 'completed')) {
        overallStatus = 'completed';
      } else if (tid === activeTicket && ticketRuns.length === 0) {
        overallStatus = 'active';
      }

      const overallMode = primaryRun?.mode || 'STREAM';
      const startedAt = ticketRuns.map((r) => r.started_at).filter(Boolean).sort()[0] ?? primaryRun?.started_at;
      const updatedAt = ticketRuns.map((r) => r.updated_at).filter(Boolean).sort().reverse()[0] ?? primaryRun?.updated_at;
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
      if (a.ticket_id === activeTicket) return -1;
      if (b.ticket_id === activeTicket) return 1;
      const timeA = parseTime(a.updated_at ?? a.started_at)?.getTime() ?? 0;
      const timeB = parseTime(b.updated_at ?? b.started_at)?.getTime() ?? 0;
      return timeB - timeA;
    });

    return records;
  }, [runs, recentTickets, activeTicket]);

  useEffect(() => {
    void (async () => {
      const items = await loadRuns();
      if (!selectedRunID) {
        if (activeTicket) {
          selectRun(activeTicket, true);
        } else if (items[0]) {
          selectRun(items[0].run_id, true);
        }
      }
    })();
  }, [loadRuns, selectRun, selectedRunID, activeTicket]);

  useEffect(() => {
    void loadDetail(selectedRunID);
  }, [loadDetail, selectedRunID]);

  useEffect(() => {
    const scheduleRefresh = (): void => {
      if (refreshTimer.current) window.clearTimeout(refreshTimer.current);
      refreshTimer.current = window.setTimeout(() => {
        void loadRuns(false);
        if (selectedRunID) void loadDetail(selectedRunID, false);
      }, 350);
    };
    const events = new EventSource(`${apiBase}/v1/events?workflow=gold`);
    events.addEventListener('workflow', scheduleRefresh);
    return () => {
      events.close();
      if (refreshTimer.current) window.clearTimeout(refreshTimer.current);
    };
  }, [loadDetail, loadRuns, selectedRunID]);

  const handleCreateNew = () => {
    const created = createNewTicket();
    selectRun(created, false);
    void loadRuns(false);
  };

  const filteredTickets = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return ticketRecords.filter((t) => {
      if (!statusMatches(t, statusFilter)) return false;
      if (modeFilter !== 'all' && t.mode.toLowerCase() !== modeFilter) return false;
      if (!needle) return true;
      return [t.ticket_id, t.last_snapshot_id, t.status, t.mode].some((v) => v?.toLowerCase().includes(needle));
    });
  }, [ticketRecords, query, statusFilter, modeFilter]);

  const selectedTicket = ticketRecords.find((t) => t.ticket_id === selectedRunID) ?? (selectedRunID ? {
    ticket_id: selectedRunID,
    runs: [],
    mode: 'STREAM',
    status: selectedRunID === activeTicket ? 'active' : 'idle',
    hasIngest: false,
    hasSilver: false,
    hasGold: false,
  } : undefined);

  const selectedDetail = detail?.run.run_id === selectedRunID ? detail : undefined;

  const activeTicketsCount = useMemo(() => {
    return ticketRecords.filter((r) => ['running', 'draining', 'catalog_syncing', 'active'].includes(normalizedStatus(r.status))).length;
  }, [ticketRecords]);

  const completedTicketsCount = useMemo(() => {
    return ticketRecords.filter((r) => normalizedStatus(r.status) === 'completed').length;
  }, [ticketRecords]);

  const activeTicketRecord = useMemo(() => {
    return ticketRecords.find((r) => r.ticket_id === activeTicket);
  }, [ticketRecords, activeTicket]);

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
      <section className="relative overflow-hidden border border-border/70 bg-card px-4 py-5 shadow-sm sm:px-6">
        <div className="pointer-events-none absolute inset-0 opacity-[0.18] [background-image:linear-gradient(to_right,var(--border)_1px,transparent_1px),linear-gradient(to_bottom,var(--border)_1px,transparent_1px)] [background-size:28px_28px]" />
        <div className="relative">
          <div className="mb-3 flex items-center gap-2 font-mono text-[10px] font-medium uppercase tracking-[0.18em] text-primary">
            <Ticket className="size-4" aria-hidden="true" />
            Data Factory / Execution & Governance Node
          </div>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="font-heading text-2xl font-semibold tracking-tight md:text-3xl">Runner Tickets</h2>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                Track ticket-scoped stage execution history across Bronze Ingest, Silver Preprocessing, and Gold Enrichment.
              </p>
            </div>
            <Button
              size="sm"
              className="h-9 w-fit rounded-none font-mono text-xs uppercase gap-1.5"
              onClick={handleCreateNew}
              title="Create a new runner ticket"
            >
              <Plus className="size-3.5" />
              New Ticket
            </Button>
          </div>
        </div>
      </section>

      {/* Top 4 KPI Stat Strip */}
      <section aria-label="Tickets summary" className="grid gap-px overflow-hidden border border-border/70 bg-border/70 sm:grid-cols-2 xl:grid-cols-4">
        <Stat
          icon={Ticket}
          label="Total Tickets"
          value={`${ticketRecords.length} tickets`}
          detail={`${activeTicketsCount} active · ${completedTicketsCount} completed`}
        />
        <Stat
          icon={Activity}
          label="Active Ticket"
          value={activeTicket || 'None'}
          detail={activeTicketRecord ? `${activeTicketRecord.status.toUpperCase()} · ${activeTicketRecord.mode.toUpperCase()}` : 'Ready for pipeline run'}
        />
        <Stat
          icon={Layers}
          label="Executed Stages"
          value={`${totalStageRuns} runs`}
          detail="Ingest, Preprocessing & Enrichment transitions"
        />
        <Stat
          icon={CheckCircle2}
          label="Execution Health"
          value={executionHealth}
          detail={`${completedTicketsCount} tickets completed without errors`}
        />
      </section>

      {error ? (
        <div className="flex items-center gap-2 border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          <AlertCircle className="size-4" />
          {error}
        </div>
      ) : null}

      <div className="grid min-w-0 gap-4 2xl:grid-cols-[minmax(0,1.35fr)_minmax(380px,0.65fr)]">
        {/* Ticket List Table */}
        <Card className="min-w-0 rounded-none border-border/80 shadow-none">
          <CardHeader className="gap-3 border-b border-border/70 p-4">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <CardTitle className="text-sm">Ticket List</CardTitle>
                <CardDescription>Select a runner ticket to inspect stage execution history.</CardDescription>
              </div>
              <span className="font-mono text-[10px] text-muted-foreground">
                {filteredTickets.length} / {ticketRecords.length} tickets
              </span>
            </div>
            <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_150px_140px]">
              <label className="relative">
                <span className="sr-only">Search ticket</span>
                <Search className="absolute left-2.5 top-2.5 size-3.5 text-muted-foreground" />
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search ticket ID or snapshot…"
                  className="h-9 w-full rounded-none border border-input bg-background pl-8 pr-3 text-xs outline-none focus:border-ring"
                />
              </label>
              <label>
                <span className="sr-only">Run status</span>
                <select
                  value={statusFilter}
                  onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}
                  className="h-9 w-full rounded-none border border-input bg-background px-2 font-mono text-[10px] uppercase outline-none focus:border-ring"
                >
                  <option value="all">All states</option>
                  <option value="active">Active / Running</option>
                  <option value="completed">Completed</option>
                  <option value="attention">Attention</option>
                  <option value="stopped">Stopped / Idle</option>
                </select>
              </label>
              <label>
                <span className="sr-only">Run mode</span>
                <select
                  value={modeFilter}
                  onChange={(event) => setModeFilter(event.target.value)}
                  className="h-9 w-full rounded-none border border-input bg-background px-2 font-mono text-[10px] uppercase outline-none focus:border-ring"
                >
                  <option value="all">All modes</option>
                  <option value="stream">Stream</option>
                  <option value="batch">Batch</option>
                </select>
              </label>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {loading && ticketRecords.length === 0 ? (
              <LoadingState label="Loading runner tickets…" />
            ) : filteredTickets.length === 0 ? (
              <div className="flex min-h-72 flex-col items-center justify-center gap-2 p-8 text-center">
                <Clock3 className="size-6 text-muted-foreground/60" />
                <p className="text-sm font-medium">No matching runner tickets</p>
                <p className="max-w-md text-xs text-muted-foreground">Runner tickets will appear after pipeline activity is recorded or created.</p>
              </div>
            ) : (
              <div className="max-h-[620px] overflow-auto">
                <table className="w-full min-w-[780px] text-sm">
                  <thead className="sticky top-0 z-10 border-b bg-card text-left font-mono text-[9px] uppercase tracking-[0.1em] text-muted-foreground">
                    <tr>
                      <th className="p-3 pl-4">Runner Ticket</th>
                      <th className="p-3">Stages Executed</th>
                      <th className="p-3">Mode</th>
                      <th className="p-3">Status</th>
                      <th className="p-3 text-right">Started / Duration</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredTickets.map((ticket) => (
                      <TicketRow
                        key={ticket.ticket_id}
                        ticket={ticket}
                        isActive={ticket.ticket_id === activeTicket}
                        selected={ticket.ticket_id === selectedRunID}
                        onSelect={() => selectRun(ticket.ticket_id)}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Right Inspector: Clean Stage Run History */}
        <RunInspector
          ticket={selectedTicket}
          detail={selectedDetail}
          loading={detailLoading}
          activeTicket={activeTicket}
          onAttachTicket={setActiveTicket}
        />
      </div>
    </div>
  );
}

function Stat({ icon: Icon, label, value, detail }: { icon: typeof Ticket; label: string; value: string; detail: string }): JSX.Element {
  return (
    <div className="min-w-0 border border-border/70 bg-background/45 p-3.5">
      <div className="flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.13em] text-primary">
        <Icon className="size-4 text-primary" />
        {label}
      </div>
      <p className="mt-2 truncate font-mono text-lg font-semibold tabular-nums text-foreground sm:text-xl">{value}</p>
      <p className="mt-1 truncate text-[11px] text-muted-foreground" title={detail}>{detail}</p>
    </div>
  );
}

function TicketRow({
  ticket,
  selected,
  isActive,
  onSelect,
}: {
  ticket: TicketRecord;
  selected: boolean;
  isActive: boolean;
  onSelect: () => void;
}): JSX.Element {
  return (
    <tr
      onClick={onSelect}
      className={`cursor-pointer border-b border-border/60 transition-colors last:border-0 ${
        selected ? 'bg-primary/10 shadow-[inset_2px_0_0_hsl(var(--primary))]' : 'hover:bg-muted/30'
      }`}
    >
      <td className="p-3 pl-4">
        <div className="flex items-center gap-2">
          <p className="max-w-56 truncate font-mono text-xs font-medium text-primary" title={ticket.ticket_id}>
            {ticket.ticket_id}
          </p>
          {isActive && (
            <Badge variant="outline" className="shrink-0 rounded-none border-primary/40 bg-primary/10 text-[8px] text-primary">
              ACTIVE
            </Badge>
          )}
        </div>
        <p className="mt-1 max-w-56 truncate font-mono text-[9px] text-muted-foreground" title={ticket.last_snapshot_id}>
          {ticket.last_snapshot_id || (ticket.runs.length > 0 ? 'execution recorded' : 'fresh ticket')}
        </p>
      </td>
      <td className="p-3">
        <div className="flex items-center gap-1.5">
          <StageBadge label="01 Ingest" active={ticket.hasIngest} />
          <StageBadge label="02 Silver" active={ticket.hasSilver} />
          <StageBadge label="03 Gold" active={ticket.hasGold} />
        </div>
      </td>
      <td className="p-3 font-mono text-[10px] uppercase text-muted-foreground">
        {ticket.mode}
      </td>
      <td className="p-3">
        <Badge variant={statusVariant(ticket.status)} className="rounded-none font-mono text-[9px] uppercase">
          {ticket.status}
        </Badge>
      </td>
      <td className="p-3 text-right">
        <p className="text-xs">{displayTime(ticket.started_at)}</p>
        <p className="mt-0.5 font-mono text-[9px] text-muted-foreground">
          {ticket.started_at ? elapsed(ticket.started_at, ticket.finished_at ?? ticket.updated_at) : '—'}
        </p>
      </td>
    </tr>
  );
}

function StageBadge({ label, active }: { label: string; active: boolean }): JSX.Element {
  if (active) {
    return (
      <span className="inline-flex items-center gap-1 border border-primary/40 bg-primary/10 px-1.5 py-0.5 font-mono text-[8px] font-medium uppercase text-primary">
        <span className="size-1 rounded-full bg-primary" />
        {label}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center border border-border/40 bg-muted/20 px-1.5 py-0.5 font-mono text-[8px] uppercase text-muted-foreground/50">
      {label}
    </span>
  );
}

function RunInspector({
  ticket,
  detail,
  loading,
  activeTicket,
  onAttachTicket,
}: {
  ticket?: TicketRecord;
  detail?: FactoryRunDetail;
  loading: boolean;
  activeTicket: string;
  onAttachTicket: (ticket: string) => void;
}): JSX.Element {
  if (!ticket) {
    return (
      <Card className="rounded-none border-border/80 shadow-none">
        <CardContent className="flex min-h-[500px] flex-col items-center justify-center gap-2 p-8 text-center">
          <GitBranch className="size-7 text-muted-foreground/50" />
          <p className="text-sm font-medium">Select a runner ticket to inspect</p>
          <p className="text-xs text-muted-foreground">Stage execution history will load here.</p>
        </CardContent>
      </Card>
    );
  }

  const isAttached = activeTicket === ticket.ticket_id;

  // Resolve Stage 01: Ingest
  const ingestComp = detail?.components?.find((c) => {
    const id = c.component_id.toUpperCase();
    return id.includes('INGEST') || id.includes('DOWNLOAD') || id.includes('FITS');
  });
  const ingestRun = ticket.ingestRun;
  const ingestExecuted = Boolean(ingestRun || ingestComp || ticket.hasIngest);
  const ingestStatus = ingestRun ? ingestRun.status : ingestComp ? ingestComp.status : ingestExecuted ? 'completed' : 'NOT RUN';
  const ingestMode = ingestRun?.mode ?? (ingestExecuted ? 'STREAM' : undefined);
  const ingestStarted = ingestRun?.started_at ?? ingestComp?.occurred_at;
  const ingestDuration = ingestRun ? elapsed(ingestRun.started_at, ingestRun.finished_at ?? ingestRun.updated_at) : undefined;

  // Resolve Stage 02: Preprocessing (Silver)
  const silverComp = detail?.components?.find((c) => {
    const id = c.component_id.toUpperCase();
    return id.includes('NORMALIZ') || id.includes('SILVER') || id.includes('CALIBRAT') || id.includes('PREPROCESS');
  });
  const silverRun = ticket.silverRun;
  const silverExecuted = Boolean(silverRun || silverComp || ticket.hasSilver);
  const silverStatus = silverRun ? silverRun.status : silverComp ? silverComp.status : silverExecuted ? 'completed' : 'NOT RUN';
  const silverMode = silverRun?.mode ?? (silverExecuted ? 'STREAM' : undefined);
  const silverStarted = silverRun?.started_at ?? silverComp?.occurred_at;
  const silverDuration = silverRun ? elapsed(silverRun.started_at, silverRun.finished_at ?? silverRun.updated_at) : undefined;

  // Resolve Stage 03: Data Enrichment (Gold)
  const goldComp = detail?.components?.find((c) => {
    const id = c.component_id.toUpperCase();
    return id.includes('GOLD') || id.includes('ENRICH') || id.includes('SYNTHESIS') || id.includes('COMMIT');
  });
  const goldRun = ticket.goldRun;
  const goldExecuted = Boolean(goldRun || goldComp || ticket.hasGold || detail?.run);
  const goldStatus = goldRun ? goldRun.status : goldComp ? goldComp.status : detail?.run ? detail.run.status : goldExecuted ? 'completed' : 'NOT RUN';
  const goldMode = goldRun?.mode ?? detail?.run?.mode ?? (goldExecuted ? 'STREAM' : undefined);
  const goldStarted = goldRun?.started_at ?? goldComp?.occurred_at ?? detail?.run?.started_at;
  const goldDuration = (goldRun ?? detail?.run) ? elapsed((goldRun ?? detail?.run)?.started_at, (goldRun ?? detail?.run)?.finished_at ?? (goldRun ?? detail?.run)?.updated_at) : undefined;
  const goldSnapshot = goldRun?.last_snapshot_id || goldComp?.snapshot_id || detail?.run?.last_snapshot_id || ticket.last_snapshot_id;

  const componentEvents = detail?.components ?? [];

  return (
    <Card className="min-w-0 rounded-none border-border/80 shadow-none">
      <CardHeader className="border-b border-border/70 p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="font-mono text-[9px] uppercase tracking-[0.12em] text-primary">Runner Ticket Inspection</p>
            <CardTitle className="mt-1 truncate font-mono text-sm" title={ticket.ticket_id}>
              {ticket.ticket_id}
            </CardTitle>
          </div>
          <div className="flex items-center gap-1.5">
            {isAttached && (
              <Badge variant="outline" className="rounded-none border-primary/50 bg-primary/10 font-mono text-[8px] text-primary">
                ACTIVE TICKET
              </Badge>
            )}
            <Badge variant={statusVariant(ticket.status)} className="shrink-0 rounded-none font-mono text-[9px] uppercase">
              {ticket.status}
            </Badge>
          </div>
        </div>

        {/* Overview Row */}
        <div className="grid grid-cols-2 gap-2 border-y border-border/60 py-2.5 text-[11px]">
          <div>
            <span className="text-muted-foreground">Started: </span>
            <span className="font-mono text-[10px]">{displayTime(ticket.started_at)}</span>
          </div>
          <div>
            <span className="text-muted-foreground">Duration: </span>
            <span className="font-mono text-[10px]">
              {ticket.started_at ? elapsed(ticket.started_at, ticket.finished_at ?? ticket.updated_at) : '—'}
            </span>
          </div>
          <div className="col-span-2">
            <span className="text-muted-foreground">Snapshot: </span>
            <span className="font-mono text-[10px] text-foreground">{ticket.last_snapshot_id || 'no committed snapshot'}</span>
          </div>
          {ticket.last_error ? (
            <div className="col-span-2 border-l-2 border-destructive bg-destructive/10 px-2 py-1.5 text-[10px] text-destructive">
              {ticket.last_error}
            </div>
          ) : null}
        </div>

        {/* Action Buttons */}
        <div className="flex gap-2 pt-1">
          <Button
            size="sm"
            variant={isAttached ? 'secondary' : 'default'}
            className="h-8 flex-1 rounded-none font-mono text-[9px] uppercase"
            onClick={() => onAttachTicket(ticket.ticket_id)}
            disabled={isAttached}
          >
            {isAttached ? '✓ Active Ticket' : 'Select As Active Ticket'}
          </Button>
          <Button asChild size="sm" variant="outline" className="h-8 flex-1 rounded-none font-mono text-[9px] uppercase">
            <Link to={`/data-factory/pipeline?run_id=${encodeURIComponent(ticket.ticket_id)}`}>
              Inspect in DAG
              <ArrowRight className="ml-1 size-3.5" />
            </Link>
          </Button>
        </div>
      </CardHeader>

      <CardContent className="space-y-4 p-4">
        {loading && !detail ? (
          <LoadingState label="Loading stage run evidence…" />
        ) : (
          <>
            <div>
              <p className="font-mono text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                Stage Execution History
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Execution status, timing, and pipeline modes for this runner ticket.
              </p>
            </div>

            {/* Stage Timeline */}
            <div className="space-y-3">
              {/* Stage 01: Ingest */}
              <StageHistoryCard
                stageNumber="01"
                stageName="Ingest"
                layerSubtitle="Bronze Layer / Raw Data Ingestion"
                executed={ingestExecuted}
                status={ingestStatus}
                mode={ingestMode}
                startedAt={ingestStarted}
                duration={ingestDuration}
                actionUrl="/ingest"
                actionText="Go to Ingest"
              />

              {/* Stage 02: Preprocessing */}
              <StageHistoryCard
                stageNumber="02"
                stageName="Preprocessing"
                layerSubtitle="Silver Layer / Lightcurve Calibration"
                executed={silverExecuted}
                status={silverStatus}
                mode={silverMode}
                startedAt={silverStarted}
                duration={silverDuration}
                actionUrl="/data-factory/preprocessing"
                actionText="Go to Preprocess"
              />

              {/* Stage 03: Data Enrichment */}
              <StageHistoryCard
                stageNumber="03"
                stageName="Data Enrichment"
                layerSubtitle="Gold Layer / Candidate Synthesis & Commit"
                executed={goldExecuted}
                status={goldStatus}
                mode={goldMode}
                startedAt={goldStarted}
                duration={goldDuration}
                snapshotId={goldSnapshot}
                actionUrl="/data-factory/enrichment"
                actionText="Go to Enrichment"
              />
            </div>

            {/* Component Event Trace (if recorded) */}
            {componentEvents.length > 0 && (
              <div className="mt-4 border-t border-border/60 pt-3">
                <div className="mb-2 flex items-center justify-between">
                  <span className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground">
                    Observed Transitions ({componentEvents.length})
                  </span>
                </div>
                <div className="max-h-48 space-y-1.5 overflow-auto">
                  {componentEvents.map((evt, idx) => (
                    <div
                      key={`${evt.component_id}-${idx}`}
                      className="flex items-center justify-between border border-border/50 bg-background/50 px-2.5 py-1.5 text-xs font-mono"
                    >
                      <div className="flex items-center gap-2">
                        <span className="size-1.5 rounded-full bg-primary" />
                        <span className="text-[10px] font-medium">{evt.component_id}</span>
                      </div>
                      <div className="flex items-center gap-2 text-[9px] text-muted-foreground">
                        <span>{displayTime(evt.occurred_at)}</span>
                        <Badge variant={statusVariant(evt.status)} className="rounded-none text-[8px] uppercase">
                          {evt.status}
                        </Badge>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function StageHistoryCard({
  stageNumber,
  stageName,
  layerSubtitle,
  executed,
  status,
  mode,
  startedAt,
  duration,
  snapshotId,
  actionUrl,
  actionText,
}: {
  stageNumber: string;
  stageName: string;
  layerSubtitle: string;
  executed: boolean;
  status: string;
  mode?: string;
  startedAt?: string;
  duration?: string;
  snapshotId?: string;
  actionUrl: string;
  actionText: string;
}): JSX.Element {
  return (
    <div
      className={`border p-3 transition-colors ${
        executed
          ? 'border-border/80 bg-card'
          : 'border-dashed border-border/50 bg-muted/10'
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-start gap-2.5">
          <span
            className={`mt-0.5 flex size-5 shrink-0 items-center justify-center font-mono text-[10px] font-semibold ${
              executed
                ? 'border border-primary/50 bg-primary/10 text-primary'
                : 'border border-border/60 bg-muted text-muted-foreground'
            }`}
          >
            {stageNumber}
          </span>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-mono text-xs font-semibold text-foreground">{stageName}</span>
              {mode && (
                <Badge variant="outline" className="rounded-none font-mono text-[8px] uppercase">
                  {mode}
                </Badge>
              )}
            </div>
            <p className="text-[10px] text-muted-foreground">{layerSubtitle}</p>
          </div>
        </div>
        <Badge
          variant={executed ? statusVariant(status) : 'outline'}
          className="shrink-0 rounded-none font-mono text-[8px] uppercase"
        >
          {executed ? status : 'Not executed yet'}
        </Badge>
      </div>

      <div className="mt-2.5 flex items-center justify-between border-t border-border/40 pt-2 text-[10px]">
        <div className="font-mono text-muted-foreground">
          {executed ? (
            <span>
              {displayTime(startedAt)}
              {duration ? ` · ${duration}` : ''}
            </span>
          ) : (
            <span className="text-muted-foreground/60">Stage has not run under this ticket</span>
          )}
          {snapshotId && (
            <p className="mt-0.5 truncate text-[9px] text-primary" title={snapshotId}>
              Snapshot: {snapshotId}
            </p>
          )}
        </div>
        <Link
          to={actionUrl}
          className="inline-flex shrink-0 items-center gap-1 font-mono text-[9px] uppercase text-primary hover:underline"
        >
          {actionText}
          <ExternalLink className="size-2.5" />
        </Link>
      </div>
    </div>
  );
}

function LoadingState({ label }: { label: string }): JSX.Element {
  return (
    <div className="flex min-h-72 items-center justify-center gap-2 text-xs text-muted-foreground">
      <LoaderCircle className="size-4 animate-spin text-primary" />
      {label}
    </div>
  );
}
