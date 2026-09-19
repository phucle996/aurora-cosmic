import { useEffect, useRef, useState } from 'react';
import type { JSX } from 'react';
import {
  AlertCircle,
  Cpu,
  FileInput,
  FileOutput,
  Gauge,
  Play,
  Square,
  Timer,
  Wifi,
  Workflow,
  Zap,
} from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { apiBase, apiFetch } from '@/lib/api';

import { normalizePreprocessingGraph, type PreprocessingGraph, type PreprocessingJob } from '@/pages/pipeline-dag/types';
import { useRunnerTicket } from '@/lib/session';

function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '—';
  if (value < 1024) return `${value} B`;
  if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 ** 3) return `${(value / 1024 ** 2).toFixed(1)} MB`;
  return `${(value / 1024 ** 3).toFixed(2)} GB`;
}

function formatDate(value?: string): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? value : date.toLocaleString('en-US');
}

function statusVariant(status: string): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (status === 'completed') return 'default';
  if (status === 'failed') return 'destructive';
  if (status === 'running' || status === 'accepted' || status === 'cancelling') return 'secondary';
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

export default function PreprocessingPage(): JSX.Element {
  const { activeTicket, setActiveTicket, tickets } = useRunnerTicket();
  // Operational state for the Bronze → Silver worker.
  const [graph, setGraph] = useState<PreprocessingGraph | null>(null);
  const [startMode, setStartMode] = useState<'stream' | 'batch'>('stream');
  const [workerCount, setWorkerCount] = useState(4);
  const [preprocessingJob, setPreprocessingJob] = useState<PreprocessingJob | null>(null);
  const [startBusy, setStartBusy] = useState(false);
  const [stopBusy, setStopBusy] = useState(false);
  const [observationError, setObservationError] = useState<string | null>(null);
  const refreshTimer = useRef<number | null>(null);

  // Load Graph & Subscribe to SSE Events
  useEffect(() => {
    let mounted = true;
    const loadGraph = () => {
      apiFetch<PreprocessingGraph>('/v1/dag/graph')
        .then((next) => {
          if (mounted) {
            const normalized = normalizePreprocessingGraph(next);
            setGraph(normalized);
            if (normalized.run?.ticket_id) setPreprocessingJob(normalized.run);
            setObservationError(null);
          }
        })
        .catch((error: unknown) => {
          if (mounted) {
            setObservationError(error instanceof Error ? error.message : 'Observation unavailable');
          }
        });
    };

    loadGraph();
    const eventSource = new EventSource(`${apiBase}/v1/events?topic=${encodeURIComponent(`preprocessing:${activeTicket}`)}&topic=preprocessing`);
    eventSource.addEventListener('workflow', (event) => {
      const message = event as MessageEvent<string>;
      try {
        const update = JSON.parse(message.data) as { payload?: PreprocessingJob; status?: string };
        if (update.payload?.ticket_id) setPreprocessingJob(update.payload);
      } catch {
        // Fallback on graph polling
      }
      if (refreshTimer.current === null) {
        refreshTimer.current = window.setTimeout(() => {
          refreshTimer.current = null;
          loadGraph();
        }, 300);
      }
    });

    const timer = window.setInterval(loadGraph, 12_000);
    return () => {
      mounted = false;
      window.clearInterval(timer);
      if (refreshTimer.current !== null) window.clearTimeout(refreshTimer.current);
      eventSource.close();
    };
  }, [activeTicket]);

  const activeRun = graph?.run ?? preprocessingJob;
  const isRunning = activeRun?.status === 'running' || activeRun?.status === 'accepted';
  const bronzeInventoryReady = graph?.progress?.bronze_observed ?? false;

  const startPreprocessing = async (): Promise<void> => {
    setStartBusy(true);
    setObservationError(null);
    try {
      const job = await apiFetch<PreprocessingJob>('/v1/preprocessing/tickets', {
        method: 'POST',
        body: JSON.stringify({ mode: startMode, worker_count: workerCount, ticket_id: activeTicket }),
      });
      setPreprocessingJob(job);
    } catch (error) {
      setObservationError(error instanceof Error ? error.message : 'Failed to start preprocessing run');
    } finally {
      setStartBusy(false);
    }
  };

  const stopPreprocessing = async (): Promise<void> => {
    if (!activeRun?.ticket_id) return;
    setStopBusy(true);
    setObservationError(null);
    try {
      const job = await apiFetch<PreprocessingJob>(
        `/v1/preprocessing/tickets/${encodeURIComponent(activeRun.ticket_id)}/stop`,
        {
          method: 'POST',
        }
      );
      setPreprocessingJob(job);
      setGraph((curr) => (curr ? { ...curr, run: job } : curr));
    } catch (error) {
      setObservationError(error instanceof Error ? error.message : 'Failed to stop preprocessing run');
    } finally {
      setStopBusy(false);
    }
  };

  const activeStatusValue = (activeRun?.status || graph?.status || '').toLowerCase();
  const activeStatus = activeStatusValue === 'not_observed' ? undefined : activeStatusValue;
  const runtimeWorkers = (graph?.runtime?.workers ?? []).filter((worker) => worker.state !== 'stopped');
  const desiredWorkers = graph?.runtime?.desired_workers ?? activeRun?.worker_count ?? workerCount;
  const completedItems = graph?.progress?.checkpoint_completed ?? 0;
  const totalItems = graph?.progress?.checkpoint_total || graph?.progress?.bronze_total || 0;
  const completionPercent = totalItems > 0 ? Math.min(100, completedItems / totalItems * 100) : 0;

  return (
    <div className="space-y-5 pb-6">
      <section className="relative overflow-hidden border border-border/70 bg-card px-4 py-5 shadow-sm sm:px-6">
        <div className="pointer-events-none absolute inset-0 opacity-[0.18] [background-image:linear-gradient(to_right,var(--border)_1px,transparent_1px),linear-gradient(to_bottom,var(--border)_1px,transparent_1px)] [background-size:28px_28px]" />
        <div className="relative">
          <div className="mb-3 flex items-center gap-2 font-mono text-[10px] font-medium uppercase tracking-[0.18em] text-primary">
            <Workflow className="size-4" aria-hidden="true" />
            Data Factory / Preprocessing
          </div>
          <h2 className="font-heading text-2xl font-semibold tracking-tight md:text-3xl">Bronze to Silver Transformation</h2>
          <p className="mt-2 text-sm leading-6 text-muted-foreground xl:whitespace-nowrap">
            Normalize Bronze FITS into Silver Parquet using high-performance Rust workers with durable checkpoints, lineage tracking, and real-time telemetry.
          </p>
        </div>
      </section>

      {observationError && (
        <div className="flex items-start gap-3 border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
          <AlertCircle className="mt-0.5 size-4 shrink-0" />
          <div><p className="font-medium">Observation Link Interrupted</p><p className="mt-0.5 text-xs">{observationError}</p></div>
        </div>
      )}

      <section aria-label="Preprocessing summary" className="grid gap-px overflow-hidden border border-border/70 bg-border/70 sm:grid-cols-2 xl:grid-cols-4">
        <Stat icon={FileInput} label="Bronze Inventory" value={bronzeInventoryReady ? `${(graph?.progress?.bronze_pending ?? 0).toLocaleString()} pending` : 'Scanning'} detail={`${(graph?.progress?.bronze_total ?? 0).toLocaleString()} FITS · ${formatBytes(graph?.progress?.bronze_bytes ?? 0)}`} />
        <Stat icon={FileOutput} label="Silver Materialized" value={`${(graph?.progress?.silver_total ?? 0).toLocaleString()} Parquet`} detail={formatBytes(graph?.progress?.silver_bytes ?? 0)} />
        <Stat icon={Zap} label="Runtime Throughput" value={`${(graph?.runtime?.throughput ?? 0).toFixed(2)} files/s`} detail={`${graph?.runtime?.completed ?? 0} completed · ${graph?.runtime?.failed ?? 0} failed`} />
        <Stat icon={Cpu} label="Rust Worker Pool" value={`${graph?.runtime?.actual_workers ?? 0} / ${desiredWorkers}`} detail={`${graph?.runtime?.processing ?? 0} processing now`} />
      </section>

      <section className="grid min-w-0 gap-5 xl:grid-cols-[minmax(0,1.45fr)_minmax(19rem,0.7fr)]">
        <Card className="min-w-0 rounded-none border-border/80 shadow-none">
          <CardHeader className="border-b border-border/60 pb-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-primary">Live Transformation / Runtime Telemetry</p>
                <CardTitle className="mt-1 text-lg">Silver Transformation Runtime</CardTitle>
                <CardDescription>Track transformation progress and active worker execution state.</CardDescription>
              </div>
              {activeStatus && <Badge variant={statusVariant(activeStatus)} className="w-fit rounded-none font-mono">{activeStatus}</Badge>}
            </div>
          </CardHeader>
          <CardContent className="space-y-5 p-4 sm:p-5">
            <div className="border border-primary/25 bg-primary/[0.035] p-4 sm:p-5">
              <div className="mb-3 flex items-end justify-between gap-4">
                <div>
                  <p className="text-xs font-medium text-muted-foreground">Checkpoint Completion</p>
                  <p className="mt-1 font-mono text-3xl font-semibold tracking-tight tabular-nums sm:text-4xl">
                    {completionPercent.toFixed(completionPercent > 0 && completionPercent < 1 ? 1 : 0)}
                    <span className="text-lg text-muted-foreground">%</span>
                  </p>
                </div>
                <p className="text-right font-mono text-xs text-muted-foreground">
                  {completedItems.toLocaleString()} committed<br />
                  {totalItems.toLocaleString()} observed
                </p>
              </div>
              <Progress value={completionPercent} className="h-2" />
            </div>

            <div>
              <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-medium">Worker Operations</p>
                  <p className="text-xs text-muted-foreground">Real-time execution state, current object, and stage for each Rust worker.</p>
                </div>
                <span className="font-mono text-xs text-muted-foreground">{runtimeWorkers.length} spawned</span>
              </div>
              {runtimeWorkers.length === 0 ? (
                <div className="border border-dashed border-border/70 px-4 py-8 text-center text-xs text-muted-foreground">
                  No active transformation workers observed. Launch a transformation run to observe worker execution.
                </div>
              ) : (
                <div className="space-y-2.5">
                  {runtimeWorkers.map((worker) => {
                    const processing = worker.state === 'processing';
                    const failed = worker.state === 'failed';
                    return (
                      <div key={worker.worker_id} className="border border-border/70 bg-background/50 p-3.5">
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                          <div className="flex items-start gap-2.5 min-w-0">
                            <span className={`mt-1 size-2 shrink-0 rounded-full ${failed ? 'bg-destructive' : processing ? 'animate-pulse bg-primary' : 'bg-emerald-500'}`} />
                            <div className="min-w-0 space-y-1">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="font-mono text-xs font-semibold text-foreground">{worker.worker_id}</span>
                                {worker.stage && (
                                  <Badge variant="outline" className="rounded-none font-mono text-[9px] uppercase tracking-wider text-primary border-primary/40 bg-primary/10">
                                    Stage: {worker.stage}
                                  </Badge>
                                )}
                                {worker.product_kind && (
                                  <Badge variant="secondary" className="rounded-none font-mono text-[9px] uppercase">
                                    {worker.product_kind}
                                  </Badge>
                                )}
                              </div>
                              <p className="truncate font-mono text-xs text-muted-foreground" title={worker.object_key}>
                                {worker.object_key ? (
                                  <>Processing: <span className="text-foreground">{worker.object_key}</span></>
                                ) : (
                                  <span className="italic">Worker idle · awaiting incoming object</span>
                                )}
                              </p>
                            </div>
                          </div>

                          <div className="flex sm:flex-col items-center sm:items-end justify-between gap-1 shrink-0">
                            <Badge variant={failed ? 'destructive' : processing ? 'default' : 'outline'} className="rounded-none font-mono text-[9px] uppercase">
                              {worker.state}
                            </Badge>
                            <span className="font-mono text-[10px] text-muted-foreground">
                              {worker.last_duration_ms ? `${worker.last_duration_ms} ms` : 'awaiting duration'}
                            </span>
                          </div>
                        </div>

                        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-border/50 pt-2 font-mono text-[10px] text-muted-foreground">
                          <span>Progress: <b className="font-medium text-foreground">{worker.completed}</b> completed · <b className="font-medium text-foreground">{worker.failed}</b> failed</span>
                          <span>Signal: {formatDate(worker.updated_at)}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="grid gap-3 border-t border-border/60 pt-4 sm:grid-cols-2">
              <div className="flex gap-2 text-xs text-muted-foreground">
                <Timer className="size-4 shrink-0 text-primary" />
                <span>Started <b className="ml-1 font-mono font-medium text-foreground">{formatDate(activeRun?.started_at)}</b></span>
              </div>
              <div className="flex gap-2 text-xs text-muted-foreground">
                <Wifi className="size-4 shrink-0 text-primary" />
                <span>{graph?.runtime?.observed_at ? 'Live worker activity available' : 'Awaiting worker activity'}</span>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="h-fit rounded-none border-border/80 shadow-none">
          <CardHeader className="border-b border-border/60 pb-4">
            <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-primary">Control Protocol / New Run</p>
            <CardTitle className="mt-1 text-lg">Configure Transformation</CardTitle>
            <CardDescription>Select processing mode and Rust worker pool concurrency.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5 p-4 sm:p-5">
            <label htmlFor="runner-ticket-select" className="block space-y-2 text-xs font-medium text-muted-foreground">
              <span className="flex items-center justify-between">
                <span>Runner Ticket</span>
                <span className="font-mono text-[10px] font-normal">EXECUTION SCOPE</span>
              </span>
              <select
                id="runner-ticket-select"
                value={activeTicket}
                onChange={(e) => setActiveTicket(e.target.value)}
                disabled={isRunning}
                className="h-10 w-full rounded-none border border-input bg-background px-3 font-mono text-xs text-foreground outline-none focus:border-ring focus:ring-1 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
              >
                {tickets.length > 0 ? (
                  tickets.map((t) => (
                    <option key={t.ticket_id} value={t.ticket_id}>
                      {t.ticket_id} {t.description ? `(${t.description})` : ''}
                    </option>
                  ))
                ) : activeTicket ? (
                  <option value={activeTicket}>{activeTicket}</option>
                ) : (
                  <option value="">No runner ticket available</option>
                )}
              </select>
            </label>

            <label htmlFor="preprocessing-mode" className="block space-y-2 text-xs font-medium text-muted-foreground">
              <span className="flex items-center justify-between">
                <span>Processing Mode</span>
                <span className="font-mono text-[10px] font-normal">STREAM / BATCH</span>
              </span>
              <select
                id="preprocessing-mode"
                value={startMode}
                onChange={(event) => setStartMode(event.target.value as 'stream' | 'batch')}
                disabled={isRunning}
                className="h-10 w-full rounded-none border border-input bg-background px-3 font-mono text-xs text-foreground outline-none focus:border-ring focus:ring-1 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
              >
                <option value="stream">STREAM · process new inputs</option>
                <option value="batch">BATCH · process available inputs</option>
              </select>
            </label>
            <label htmlFor="preprocessing-workers" className="block space-y-2 text-xs font-medium text-muted-foreground">
              <span className="flex items-center justify-between">
                <span>Rust Workers</span>
                <span className="font-mono text-[10px] font-normal">01—64</span>
              </span>
              <input
                id="preprocessing-workers"
                type="number"
                min={1}
                max={64}
                value={workerCount}
                onChange={(event) => setWorkerCount(Math.max(1, Math.min(64, Number(event.target.value) || 1)))}
                disabled={isRunning}
                className="h-10 w-full rounded-none border border-input bg-background px-3 font-mono text-sm text-foreground outline-none focus:border-ring focus:ring-1 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
              />
            </label>
            {isRunning ? (
              <Button onClick={stopPreprocessing} disabled={stopBusy} variant="destructive" className="w-full rounded-none gap-2">
                <Square className="size-3.5 fill-current" />
                {stopBusy ? 'Stopping…' : 'Stop Preprocessing Run'}
              </Button>
            ) : (
              <Button onClick={startPreprocessing} disabled={startBusy} className="w-full rounded-none gap-2">
                <Play className="size-3.5 fill-current" />
                {startBusy ? 'Starting…' : 'Launch Preprocessing Run'}
              </Button>
            )}
            <div className="space-y-2 border-t border-border/60 pt-4 text-xs">
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground">State</span>
                {activeStatus ? <Badge variant={statusVariant(activeStatus)} className="rounded-none font-mono text-[10px]">{activeStatus}</Badge> : <span className="font-mono text-muted-foreground">—</span>}
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground">Mode</span>
                <span className="font-mono uppercase text-foreground">{activeRun?.mode || startMode}</span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground">Last Signal</span>
                <span className="font-mono text-[10px] text-foreground">{formatDate(activeRun?.updated_at || graph?.observed_at)}</span>
              </div>
            </div>
          </CardContent>
        </Card>
      </section>

    </div>
  );
}
