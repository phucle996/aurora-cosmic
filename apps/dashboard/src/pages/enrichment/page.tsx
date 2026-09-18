import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { JSX } from 'react';
import {
  AlertCircle,
  Check,
  Cpu,
  Database,
  FileInput,
  FileOutput,
  Gauge,
  Play,
  Sparkles,
  Square,
  Terminal,
  Timer,
  Wifi,
} from 'lucide-react';
import { Link } from 'react-router-dom';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import type { GoldControlOverview, GoldLiveEvent, GoldWorkerTelemetry } from '@/features/enrichment/types';
import { RunnerTicketBar } from '@/features/factory-history/components/RunnerTicketBar';
import { useRunnerTicket } from '@/features/factory-history/session';
import type { FactoryRunDetail } from '@/features/factory-history/types';
import { apiBase, apiFetch } from '@/lib/api';

const CONFIG_KEY = 'aurora.gold.console.config.v1';

type GoldConfig = { mode: 'stream' | 'batch'; maxBatchRecords: number; idleFlushSeconds: number };
type ConnectionState = 'connecting' | 'live' | 'reconnecting';
type EventRow = { id: string; worker: GoldWorkerTelemetry; observedAt: string };

const PIPELINE_STEPS = [
  { step: 1, label: '01 Intake', key: 'INTAKE' },
  { step: 2, label: '02 Pairing', key: 'PAIRING' },
  { step: 3, label: '03 Catalog', key: 'CATALOG' },
  { step: 4, label: '04 Materialize', key: 'MATERIALIZE' },
  { step: 5, label: '05 Commit', key: 'COMMIT' },
] as const;

const stateLabel: Record<string, string> = {
  IDLE: 'IDLE',
  RUNNING: 'RUNNING',
  DRAINING: 'DRAINING',
  FROZEN: 'FROZEN',
  CATALOG_SYNCING: 'CATALOG SYNC',
  WAITING_FOR_CATALOG_SYNC: 'CATALOG RETRY',
  WAITING_FOR_MODALITY: 'WAITING LC/TPF',
  READY: 'READY',
};

const actionLabel: Record<string, string> = {
  WAITING_FOR_BATCH: 'WAITING FOR BATCH',
  FROZEN: 'FROZEN BY OPERATOR',
  DEQUEUED_BATCH: 'CLAIMED BATCH',
  WAITING_FOR_RESUME: 'WAITING FOR RESUME',
  VERIFYING_PAIRING: 'VERIFYING PAIRING',
  SYNCING_CATALOGS: 'SYNCING TIC / TOI',
  MATERIALIZING_AND_INDEXING: 'MATERIALIZING + INDEXING',
  COMMITTING_SNAPSHOT: 'COMMITTING SNAPSHOT',
  SNAPSHOT_COMMITTED: 'SNAPSHOT COMMITTED',
  RETRYING_CATALOG_SYNC: 'CATALOG RETRY',
  FAILED_RETRY_SCHEDULED: 'FAILED · RETRY SCHEDULED',
  CANCELLED: 'KILLED / CANCELLED',
};

function loadLocalConfig(): GoldConfig {
  const fallback: GoldConfig = { mode: 'stream', maxBatchRecords: 500, idleFlushSeconds: 180 };
  try {
    const parsed = JSON.parse(window.localStorage.getItem(CONFIG_KEY) ?? 'null') as Partial<GoldConfig> | null;
    if (!parsed) return fallback;
    return {
      mode: parsed.mode === 'batch' ? 'batch' : 'stream',
      maxBatchRecords: Number(parsed.maxBatchRecords) || fallback.maxBatchRecords,
      idleFlushSeconds: Number(parsed.idleFlushSeconds) || fallback.idleFlushSeconds,
    };
  } catch {
    return fallback;
  }
}

function formatDate(value?: string): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('en-US');
}

function shortTime(value?: string): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleTimeString('en-US');
}

function statusVariant(status: string): 'default' | 'secondary' | 'destructive' | 'outline' {
  const s = status.toUpperCase();
  if (s === 'RUNNING' || s === 'READY' || s === 'MATERIALIZING' || s === 'COMMITTED') return 'default';
  if (s === 'FROZEN' || s === 'PAUSED' || s === 'DRAINING') return 'secondary';
  if (s === 'FAILED' || s === 'KILLED' || s === 'ERROR') return 'destructive';
  return 'outline';
}

function Stat({ icon: Icon, label, value, detail }: { icon: typeof Gauge; label: string; value: string; detail: string }): JSX.Element {
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

export default function EnrichmentPage(): JSX.Element {
  const { activeTicket } = useRunnerTicket();
  const initialConfig = useMemo(loadLocalConfig, []);
  const [overview, setOverview] = useState<GoldControlOverview | null>(null);
  const [runDetail, setRunDetail] = useState<FactoryRunDetail | null>(null);
  const [mode, setMode] = useState(initialConfig.mode);
  const [maxBatchRecords, setMaxBatchRecords] = useState(initialConfig.maxBatchRecords);
  const [idleFlushSeconds, setIdleFlushSeconds] = useState(initialConfig.idleFlushSeconds);
  const [liveWorkers, setLiveWorkers] = useState<Record<string, GoldWorkerTelemetry>>({});
  const [eventRows, setEventRows] = useState<EventRow[]>([]);
  const [connection, setConnection] = useState<ConnectionState>('connecting');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const latestOverview = useRef<GoldControlOverview | null>(null);
  const overviewRequestInFlight = useRef(false);
  const historyRequestInFlight = useRef(false);

  const loadOverview = useCallback(async (): Promise<GoldControlOverview | null> => {
    if (overviewRequestInFlight.current) return latestOverview.current;
    overviewRequestInFlight.current = true;
    try {
      const next = await apiFetch<GoldControlOverview>('/v1/gold/control');
      latestOverview.current = next;
      setOverview(next);
      setError(null);
      return next;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Gold control plane observation unavailable');
      return null;
    } finally {
      overviewRequestInFlight.current = false;
    }
  }, []);

  const loadHistory = useCallback(async (commandID?: string): Promise<void> => {
    if (!commandID) {
      setRunDetail(null);
      return;
    }
    if (historyRequestInFlight.current) return;
    historyRequestInFlight.current = true;
    setHistoryLoading(true);
    try {
      setRunDetail(await apiFetch<FactoryRunDetail>(`/v1/data-factory/runs/${encodeURIComponent(commandID)}`));
    } catch {
      setRunDetail(null);
    } finally {
      historyRequestInFlight.current = false;
      setHistoryLoading(false);
    }
  }, []);

  useEffect(() => {
    window.localStorage.setItem(CONFIG_KEY, JSON.stringify({ mode, maxBatchRecords, idleFlushSeconds }));
  }, [idleFlushSeconds, maxBatchRecords, mode]);

  useEffect(() => {
    void loadOverview();
    const stream = new EventSource(`${apiBase}/v1/events?workflow=gold&ticket=${encodeURIComponent(activeTicket)}`);
    stream.onopen = () => setConnection('live');
    stream.onerror = () => setConnection('reconnecting');
    stream.addEventListener('ready', () => setConnection('live'));
    stream.addEventListener('workflow', (rawEvent) => {
      try {
        const message = JSON.parse((rawEvent as MessageEvent<string>).data) as GoldLiveEvent;
        const payload = message.payload;
        if (payload?.runtime) {
          setOverview((current) => {
            if (!current) return current;
            const next = { ...current, runtime: payload.runtime };
            latestOverview.current = next;
            return next;
          });
        }
        if (payload?.worker) {
          const worker = payload.worker;
          setLiveWorkers((current) => ({ ...current, [worker.worker_id]: worker }));
          const eventID = `${worker.worker_id}:${worker.updated_at}:${worker.action}`;
          setEventRows((current) => current.some((row) => row.id === eventID)
            ? current
            : [{ id: eventID, worker, observedAt: payload.occurred_at ?? message.occurred_at ?? worker.updated_at }, ...current].slice(0, 80));
          if (worker.action === 'SNAPSHOT_COMMITTED') void loadHistory(worker.command_id);
        }
      } catch {
        // Malformed live messages never replace the durable runtime snapshot.
      }
    });
    return () => stream.close();
  }, [loadHistory, loadOverview, activeTicket]);

  useEffect(() => {
    void loadHistory(overview?.control.command_id);
  }, [loadHistory, overview?.control.command_id, overview?.runtime?.last_snapshot_id]);

  const start = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const next = await apiFetch<GoldControlOverview>('/v1/gold/control/start', {
        method: 'POST',
        body: JSON.stringify({ mode, max_batch_records: maxBatchRecords, idle_flush_seconds: idleFlushSeconds, ticket_id: activeTicket }),
      });
      latestOverview.current = next;
      setOverview(next);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Failed to launch Gold run');
    } finally {
      setBusy(false);
    }
  };

  const stop = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const next = await apiFetch<GoldControlOverview>('/v1/gold/control/stop', { method: 'POST' });
      latestOverview.current = next;
      setOverview(next);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Failed to freeze Gold Builder');
    } finally {
      setBusy(false);
    }
  };

  const runtime = overview?.runtime;
  const readiness = runtime?.readiness;
  const catalog = runtime?.catalog_sync;
  const isFrozen = overview?.control.mode === 'PAUSED';
  const runtimeState = runtime?.state ?? (isFrozen ? 'FROZEN' : 'IDLE');

  const workers = useMemo(() => {
    const merged = new Map<string, GoldWorkerTelemetry>();
    for (const worker of runtime?.workers ?? []) merged.set(worker.worker_id, worker);
    for (const worker of Object.values(liveWorkers)) merged.set(worker.worker_id, worker);
    return [...merged.values()].sort((left, right) => left.worker_id.localeCompare(right.worker_id));
  }, [liveWorkers, runtime?.workers]);
  const activeWorkers = workers.filter((worker) => worker.lifecycle !== 'KILLED').length;
  const latestBatches = [...(runDetail?.batches ?? [])].reverse().slice(0, 8);
  const observedRun = runDetail?.run;

  const pendingTotal = runtime?.pending_total ?? 0;
  const readyLightcurves = readiness?.ready_lightcurves ?? 0;
  const missingTpf = readiness?.missing_tpf ?? 0;
  const activeBuilds = runtime?.active_builds ?? 0;
  const lastSnapshotId = runtime?.last_snapshot_id;
  const totalInputObserved = pendingTotal + (observedRun?.input_records ? Number(observedRun.input_records) : 0);
  const completedInputRows = observedRun?.input_records ? Number(observedRun.input_records) : 0;
  const synthesisPercent = totalInputObserved > 0 ? Math.min(100, (completedInputRows / totalInputObserved) * 100) : (lastSnapshotId ? 100 : 0);

  return (
    <div className="space-y-5 pb-6">
      {/* Hero Banner with Blueprint Grid */}
      <section className="relative overflow-hidden border border-border/70 bg-card px-4 py-5 shadow-sm sm:px-6">
        <div className="pointer-events-none absolute inset-0 opacity-[0.18] [background-image:linear-gradient(to_right,var(--border)_1px,transparent_1px),linear-gradient(to_bottom,var(--border)_1px,transparent_1px)] [background-size:28px_28px]" />
        <div className="relative">
          <div className="mb-3 flex items-center gap-2 font-mono text-[10px] font-medium uppercase tracking-[0.18em] text-primary">
            <Sparkles className="size-4" aria-hidden="true" />
            Observatory / Gold Feature Synthesis & Enrichment Node
          </div>
          <h2 className="font-heading text-2xl font-semibold tracking-tight md:text-3xl">Data Enrichment</h2>
          <p className="mt-2 text-sm leading-6 text-muted-foreground xl:whitespace-nowrap">
            Synthesize Silver light curves, TPFs, and FFIs with TIC/TOI catalogs into analysis-ready Gold features and anomaly projections.
          </p>
        </div>
      </section>

      <RunnerTicketBar />

      {error && (
        <div className="flex items-start gap-3 border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
          <AlertCircle className="mt-0.5 size-4 shrink-0" />
          <div><p className="font-medium">Observation Link Interrupted</p><p className="mt-0.5 text-xs">{error}</p></div>
        </div>
      )}

      {/* Top 4 KPI Stat Strip */}
      <section aria-label="Enrichment summary" className="grid gap-px overflow-hidden border border-border/70 bg-border/70 sm:grid-cols-2 xl:grid-cols-4">
        <Stat icon={FileInput} label="Silver Pending Queue" value={`${pendingTotal.toLocaleString()} pending`} detail={`${readyLightcurves.toLocaleString()} paired · ${missingTpf} awaiting TPF`} />
        <Stat icon={FileOutput} label="Gold Materialized" value={lastSnapshotId ? 'Committed' : 'Awaiting Output'} detail={lastSnapshotId ? `Snapshot: ${lastSnapshotId.slice(0, 18)}…` : 'No snapshot recorded yet'} />
        <Stat icon={Database} label="Catalog Sync Readiness" value={catalog?.state ?? 'IDLE'} detail={`${catalog?.target_count ?? 0} TIC / TOI targets indexed`} />
        <Stat icon={Cpu} label="Worker Pool" value={`${activeWorkers} active slots`} detail={`${activeBuilds} builds in progress`} />
      </section>

      {/* Main 2-Column Section */}
      <section className="grid min-w-0 gap-5 xl:grid-cols-[minmax(0,1.45fr)_minmax(19rem,0.7fr)]">
        {/* Left Column: Telemetry & Flow */}
        <Card className="min-w-0 rounded-none border-border/80 shadow-none">
          <CardHeader className="border-b border-border/60 pb-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-primary">Live Synthesis / Runtime Telemetry</p>
                <CardTitle className="mt-1 text-lg">Gold Feature Assembly Sequence</CardTitle>
                <CardDescription>Track ingestion, modality pairing, stellar catalog resolution, and snapshot commits.</CardDescription>
              </div>
              <Badge variant={statusVariant(runtimeState)} className="w-fit rounded-none font-mono text-[10px]">{stateLabel[runtimeState] ?? runtimeState}</Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-5 p-4 sm:p-5">
            {/* Progress Hero */}
            <div className="border border-primary/25 bg-primary/[0.035] p-4 sm:p-5">
              <div className="mb-3 flex items-end justify-between gap-4">
                <div>
                  <p className="text-xs font-medium text-muted-foreground">Gold Feature Assembly Completion</p>
                  <p className="mt-1 font-mono text-3xl font-semibold tracking-tight tabular-nums sm:text-4xl">
                    {synthesisPercent.toFixed(synthesisPercent > 0 && synthesisPercent < 1 ? 1 : 0)}
                    <span className="text-lg text-muted-foreground">%</span>
                  </p>
                </div>
                <p className="text-right font-mono text-xs text-muted-foreground">
                  {readyLightcurves.toLocaleString()} paired eligible<br />
                  {pendingTotal.toLocaleString()} pending intake
                </p>
              </div>
              <Progress value={synthesisPercent} className="h-2" />
            </div>

            {/* Worker Field Array */}
            <div>
              <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-medium">Worker Field Array</p>
                  <p className="text-xs text-muted-foreground">Real-time execution footsteps per worker slot across intake, pairing, catalog, materialize, and commit.</p>
                </div>
                <span className="font-mono text-xs text-muted-foreground">{workers.length} spawned</span>
              </div>
              {workers.length === 0 ? (
                <div className="border border-dashed border-border/70 px-3 py-5 text-center text-xs text-muted-foreground">
                  No active Gold synthesis workers observed.
                </div>
              ) : (
                <div className="space-y-2.5">
                  {workers.map((worker) => {
                    const isKilled = worker.lifecycle === 'KILLED';
                    const isProcessing = /MATERIALIZING|SYNCING|COMMITTING|DEQUEUED|VERIFYING/.test(worker.action);
                    const isFailed = /FAILED|RETRY/.test(worker.action);
                    const currentStep = worker.step_index ?? 0;
                    const isCommitted = worker.action === 'SNAPSHOT_COMMITTED';

                    return (
                      <div key={worker.worker_id} className="border border-border/70 bg-background/50 p-3 sm:p-3.5">
                        <div className="grid gap-2 sm:grid-cols-[7.5rem_minmax(0,1fr)_8rem] sm:items-center sm:gap-4">
                          <div className="flex items-center gap-2">
                            <span className={`size-2 rounded-full ${isKilled ? 'bg-rose-500' : isFailed ? 'bg-amber-500' : isProcessing ? 'animate-pulse bg-primary' : 'bg-emerald-500'}`} />
                            <span className="font-mono text-xs font-semibold text-foreground">{worker.worker_id}</span>
                          </div>
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <p className="truncate font-mono text-[11px] font-medium text-foreground" title={worker.action}>
                                {actionLabel[worker.action] ?? worker.action}
                              </p>
                              {worker.step_name && worker.step_name !== 'IDLE' && (
                                <Badge variant="outline" className="h-4 rounded-none px-1 font-mono text-[9px] uppercase text-primary border-primary/40">
                                  {worker.step_name}
                                </Badge>
                              )}
                            </div>
                            <p className="mt-0.5 truncate font-mono text-[10px] text-muted-foreground" title={worker.detail}>
                              {worker.detail || `${worker.input_count.toLocaleString()} inputs claimed`}
                            </p>
                          </div>
                          <div className="sm:text-right">
                            <Badge variant={isKilled ? 'destructive' : isProcessing ? 'default' : 'outline'} className="rounded-none font-mono text-[9px] uppercase">
                              {worker.lifecycle}
                            </Badge>
                            <p className="mt-1 font-mono text-[9px] text-muted-foreground">{shortTime(worker.updated_at)}</p>
                          </div>
                        </div>

                        {/* 5-Step Footstep Pipeline Stepper */}
                        <div className="mt-3 grid grid-cols-5 gap-1.5 border-t border-border/50 pt-2.5">
                          {PIPELINE_STEPS.map((s) => {
                            const isDone = isCommitted || s.step < currentStep;
                            const isActive = !isCommitted && currentStep === s.step;
                            return (
                              <div
                                key={s.key}
                                className={`flex items-center justify-between gap-1 border px-2 py-1.5 font-mono text-[10px] transition-colors ${
                                  isDone
                                    ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-400 font-medium'
                                    : isActive
                                    ? isFailed
                                      ? 'border-amber-500/70 bg-amber-500/15 text-amber-300 font-semibold'
                                      : 'border-primary bg-primary/10 text-primary font-semibold shadow-[inset_0_1px_0_hsl(var(--primary))]'
                                    : 'border-border/40 bg-background/30 text-muted-foreground/50'
                                }`}
                              >
                                <span className="truncate">{s.label}</span>
                                {isDone ? (
                                  <Check className="size-3 shrink-0 text-emerald-400" />
                                ) : isActive ? (
                                  <span className={`size-1.5 shrink-0 rounded-full ${isFailed ? 'bg-amber-400' : 'animate-ping bg-primary'}`} />
                                ) : null}
                              </div>
                            );
                          })}
                        </div>

                        {/* Worker telemetry details footer */}
                        <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 border-t border-border/40 pt-2 font-mono text-[9px] text-muted-foreground">
                          <span>{worker.input_count.toLocaleString()} inputs processed</span>
                          {worker.snapshot_id && (
                            <span className="text-primary truncate max-w-[200px]" title={worker.snapshot_id}>
                              Snapshot: {worker.snapshot_id.slice(0, 18)}…
                            </span>
                          )}
                          <span>Command: {worker.command_id || 'untracked'}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Timers Footer */}
            <div className="grid gap-3 border-t border-border/60 pt-4 sm:grid-cols-2">
              <div className="flex gap-2 text-xs text-muted-foreground">
                <Timer className="size-4 shrink-0 text-primary" />
                <span>Next Flush <b className="ml-1 font-mono font-medium text-foreground">{formatDate(runtime?.next_flush_at)}</b></span>
              </div>
              <div className="flex gap-2 text-xs text-muted-foreground">
                <Wifi className="size-4 shrink-0 text-primary" />
                <span>{connection === 'live' ? 'Live synthesis feed connected' : 'Reconnecting to telemetry…'}</span>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Right Column: Control Panel */}
        <Card className="h-fit rounded-none border-border/80 shadow-none">
          <CardHeader className="border-b border-border/60 pb-4">
            <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-primary">Control Protocol / Run Lifecycle</p>
            <CardTitle className="mt-1 text-lg">Configure Enrichment</CardTitle>
            <CardDescription>Select batching parameters, coalescing mode, and flush intervals.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5 p-4 sm:p-5">
            {/* Mode Select */}
            <label htmlFor="enrichment-mode" className="block space-y-2 text-xs font-medium text-muted-foreground">
              <span className="flex items-center justify-between">
                <span>Processing Mode</span>
                <span className="font-mono text-[10px] font-normal">STREAM / BATCH</span>
              </span>
              <select
                id="enrichment-mode"
                value={mode}
                onChange={(event) => setMode(event.target.value as 'stream' | 'batch')}
                disabled={busy || !isFrozen}
                className="h-10 w-full rounded-none border border-input bg-background px-3 font-mono text-xs text-foreground outline-none focus:border-ring focus:ring-1 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
              >
                <option value="stream">STREAM · coalesce Silver stream</option>
                <option value="batch">BATCH · drain available backlog</option>
              </select>
            </label>

            {/* Max Batch Records */}
            <label htmlFor="enrichment-batch" className="block space-y-2 text-xs font-medium text-muted-foreground">
              <span className="flex items-center justify-between">
                <span>Max LC / Batch</span>
                <span className="font-mono text-[10px] font-normal">100—5000</span>
              </span>
              <select
                id="enrichment-batch"
                value={String(maxBatchRecords)}
                onChange={(event) => setMaxBatchRecords(Number(event.target.value))}
                disabled={busy || !isFrozen}
                className="h-10 w-full rounded-none border border-input bg-background px-3 font-mono text-xs text-foreground outline-none focus:border-ring focus:ring-1 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
              >
                {[100, 250, 500, 1000, 2500, 5000].map((val) => (
                  <option key={val} value={String(val)}>{val.toLocaleString()} records</option>
                ))}
              </select>
            </label>

            {/* Idle Flush Window */}
            {mode === 'stream' && (
              <label htmlFor="enrichment-flush" className="block space-y-2 text-xs font-medium text-muted-foreground">
                <span className="flex items-center justify-between">
                  <span>Idle Flush Window</span>
                  <span className="font-mono text-[10px] font-normal">TIMED TRIGGER</span>
                </span>
                <select
                  id="enrichment-flush"
                  value={String(idleFlushSeconds)}
                  onChange={(event) => setIdleFlushSeconds(Number(event.target.value))}
                  disabled={busy || !isFrozen}
                  className="h-10 w-full rounded-none border border-input bg-background px-3 font-mono text-xs text-foreground outline-none focus:border-ring focus:ring-1 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {[[60, '1 minute'], [120, '2 minutes'], [180, '3 minutes'], [300, '5 minutes'], [600, '10 minutes'], [900, '15 minutes']].map(([val, label]) => (
                    <option key={val} value={String(val)}>{label}</option>
                  ))}
                </select>
              </label>
            )}

            {/* Execution Contract Callout */}
            <div className="border-y border-border/60 py-3 text-xs text-muted-foreground">
              <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-primary">Execution Contract</p>
              <p className="mt-1.5 leading-5">
                Atomic snapshot commits. Gold outputs are materialized only after cross-modality pairing and TIC/TOI stellar metadata resolution.
              </p>
            </div>

            {/* Action Buttons */}
            {isFrozen ? (
              <Button onClick={start} disabled={busy} className="w-full rounded-none gap-2 font-mono text-xs uppercase">
                <Play className="size-3.5 fill-current" />
                {busy ? 'Starting Run…' : 'Launch Gold Run'}
              </Button>
            ) : (
              <Button onClick={stop} disabled={busy} variant="destructive" className="w-full rounded-none gap-2 font-mono text-xs uppercase">
                <Square className="size-3.5 fill-current" />
                {busy ? 'Requesting Freeze…' : 'Freeze & Drain Run'}
              </Button>
            )}

            {/* Metadata KV */}
            <div className="space-y-2 border-t border-border/60 pt-4 text-xs">
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground">Command ID</span>
                <span className="min-w-0 truncate font-mono text-foreground" title={overview?.control.command_id}>
                  {overview?.control.command_id || 'not-issued'}
                </span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground">Active Run</span>
                <span className="min-w-0 truncate font-mono text-foreground" title={runtime?.command_id}>
                  {runtime?.command_id || 'not-observed'}
                </span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground">State</span>
                <Badge variant={statusVariant(runtimeState)} className="rounded-none font-mono text-[10px]">
                  {stateLabel[runtimeState] ?? runtimeState}
                </Badge>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground">Mode</span>
                <span className="font-mono uppercase text-foreground">{mode}</span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground">Last Signal</span>
                <span className="font-mono text-[10px] text-foreground">{formatDate(runtime?.updated_at)}</span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground">Runner Ticket</span>
                <span className="min-w-0 truncate font-mono text-[10px] text-muted-foreground" title={activeTicket}>
                  {activeTicket}
                </span>
              </div>
            </div>
          </CardContent>
        </Card>
      </section>

      {/* Terminal Activity Log */}
      <Card className="rounded-none border-border/80 shadow-none">
        <CardHeader className="border-b border-border/70 pb-3">
          <div className="flex items-end justify-between">
            <div>
              <CardTitle className="flex items-center gap-2 text-sm">
                <Terminal className="size-4 text-primary" />
                Synthesis Activity Stream
              </CardTitle>
              <CardDescription>Live timeline of worker lifecycle, batch dequeues, catalog syncs, and snapshot commits.</CardDescription>
            </div>
            <span className="font-mono text-[10px] text-muted-foreground">{eventRows.length} events</span>
          </div>
        </CardHeader>
        <CardContent className="max-h-80 overflow-auto bg-slate-950 p-0 text-slate-200">
          {eventRows.length === 0 ? (
            <p className="p-4 font-mono text-[11px] text-slate-500">$ awaiting worker telemetry stream…</p>
          ) : (
            eventRows.map((row) => (
              <div key={row.id} className="grid gap-1 border-b border-slate-800 px-3 py-2 font-mono text-[10px] sm:grid-cols-[90px_90px_100px_minmax(0,1fr)]">
                <span className="text-slate-500">{shortTime(row.observedAt)}</span>
                <span className="text-cyan-400 font-medium">{row.worker.worker_id}</span>
                <span className={row.worker.lifecycle === 'KILLED' ? 'text-rose-400' : 'text-emerald-400 font-semibold'}>
                  {row.worker.lifecycle}
                </span>
                <span>
                  <strong className="font-medium text-slate-100">{actionLabel[row.worker.action] ?? row.worker.action}</strong>
                  {row.worker.detail && <span className="ml-2 text-slate-400">{row.worker.detail}</span>}
                </span>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      {/* Materialized Gold Snapshots Table */}
      <Card className="rounded-none border-border/80 shadow-none">
        <CardHeader className="border-b border-border/70 pb-3">
          <div className="flex items-end justify-between">
            <div>
              <CardTitle className="flex items-center gap-2 text-sm">
                <Database className="size-4 text-primary" />
                Materialized Gold Datasets & Snapshots
              </CardTitle>
              <CardDescription>Committed snapshots recorded in the durable ClickHouse ledger.</CardDescription>
            </div>
            {historyLoading ? (
              <Badge variant="secondary" className="rounded-none font-mono text-[10px]">Reading ledger…</Badge>
            ) : observedRun?.status ? (
              <Badge variant="secondary" className="rounded-none font-mono text-[10px]">{observedRun.status}</Badge>
            ) : null}
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {latestBatches.length === 0 ? (
            <div className="p-8 text-center text-xs text-muted-foreground font-mono">
              No Gold batches committed for this control run yet.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-sm">
                <thead className="border-b bg-muted/30 text-left font-mono text-[9px] uppercase text-muted-foreground">
                  <tr>
                    <th className="p-3">Snapshot Identifier</th>
                    <th className="p-3 text-right">Silver Inputs</th>
                    <th className="p-3 text-right">Candidate Rows</th>
                    <th className="p-3 text-right">Indexed Rows</th>
                    <th className="p-3">Committed Timestamp</th>
                  </tr>
                </thead>
                <tbody>
                  {latestBatches.map((batch) => (
                    <tr key={batch.batch_id} className="border-b border-border/60 last:border-0 hover:bg-muted/10 transition-colors">
                      <td className="p-3">
                        <Link to={`/gold/snapshots/${encodeURIComponent(batch.snapshot_id ?? batch.batch_id)}`} className="font-mono text-xs text-primary hover:underline">
                          {batch.snapshot_id ?? batch.batch_id}
                        </Link>
                      </td>
                      <td className="p-3 text-right font-mono tabular-nums">{batch.input_records.toLocaleString()}</td>
                      <td className="p-3 text-right font-mono tabular-nums">{batch.candidate_rows.toLocaleString()}</td>
                      <td className="p-3 text-right font-mono tabular-nums">{batch.indexed_rows.toLocaleString()}</td>
                      <td className="p-3 text-xs text-muted-foreground font-mono">{formatDate(batch.completed_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
