import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { JSX } from 'react';
import {
  Activity,
  AlertCircle,
  CheckCircle2,
  Clock3,
  Database,
  Play,
  Radio,
  RefreshCw,
  Square,
  Terminal,
  Waves,
  Zap,
} from 'lucide-react';
import { Link } from 'react-router-dom';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import type { GoldControlOverview, GoldLiveEvent, GoldWorkerTelemetry } from '@/features/enrichment/types';
import type { FactoryRunDetail } from '@/features/factory-history/types';
import { apiBase, apiFetch } from '@/lib/api';

const CONFIG_KEY = 'aurora.gold.console.config.v1';
const consoleCard = 'rounded-none border-border/80 shadow-none';

type GoldConfig = { mode: 'stream' | 'batch'; maxBatchRecords: number; idleFlushSeconds: number };
type ConnectionState = 'connecting' | 'live' | 'reconnecting';
type EventRow = { id: string; worker: GoldWorkerTelemetry; observedAt: string };

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

function newTicket(): string {
  return `gold-${window.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`}`;
}

function formatTime(value?: string): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString('vi-VN');
}

function shortTime(value?: string): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleTimeString('vi-VN');
}

function toneForWorker(worker: GoldWorkerTelemetry): string {
  if (worker.lifecycle === 'KILLED') return 'border-rose-500/50 bg-rose-500/5 text-rose-600';
  if (/FAILED|RETRY/.test(worker.action)) return 'border-amber-500/50 bg-amber-500/5 text-amber-600';
  if (/MATERIALIZING|SYNCING|COMMITTING|DEQUEUED/.test(worker.action)) return 'border-primary/50 bg-primary/5 text-primary';
  return 'border-border/80 bg-background text-muted-foreground';
}

export default function EnrichmentPage(): JSX.Element {
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
  const [refreshing, setRefreshing] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [observerTicket] = useState(newTicket);
  const latestOverview = useRef<GoldControlOverview | null>(null);
  const overviewRequestInFlight = useRef(false);
  const historyRequestInFlight = useRef(false);

  const loadOverview = useCallback(async (manual = false): Promise<GoldControlOverview | null> => {
    if (overviewRequestInFlight.current) return latestOverview.current;
    overviewRequestInFlight.current = true;
    if (manual) setRefreshing(true);
    try {
      const next = await apiFetch<GoldControlOverview>('/v1/gold/control');
      latestOverview.current = next;
      setOverview(next);
      setError(null);
      return next;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Không tải được Gold control plane');
      return null;
    } finally {
      overviewRequestInFlight.current = false;
      if (manual) setRefreshing(false);
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
    const stream = new EventSource(`${apiBase}/v1/events?workflow=gold&ticket=${encodeURIComponent(observerTicket)}`);
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
  }, [loadHistory, loadOverview, observerTicket]);

  useEffect(() => {
    void loadHistory(overview?.control.command_id);
  }, [loadHistory, overview?.control.command_id, overview?.runtime?.last_snapshot_id]);

  const start = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const next = await apiFetch<GoldControlOverview>('/v1/gold/control/start', {
        method: 'POST',
        body: JSON.stringify({ mode, max_batch_records: maxBatchRecords, idle_flush_seconds: idleFlushSeconds, ticket_id: observerTicket }),
      });
      latestOverview.current = next;
      setOverview(next);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Không thể khởi chạy Gold run');
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
      setError(cause instanceof Error ? cause.message : 'Không thể đóng băng Gold Builder');
    } finally {
      setBusy(false);
    }
  };

  const refresh = async (): Promise<void> => {
    const next = await loadOverview(true);
    await loadHistory(next?.control.command_id);
  };

  const runtime = overview?.runtime;
  const readiness = runtime?.readiness;
  const catalog = runtime?.catalog_sync;
  const isFrozen = overview?.control.mode === 'PAUSED';
  const runtimeState = runtime?.state ?? (isFrozen ? 'FROZEN' : 'IDLE');
  const commandAcknowledged = Boolean(overview?.control.command_id) && runtime?.command_id === overview?.control.command_id;
  const workers = useMemo(() => {
    const merged = new Map<string, GoldWorkerTelemetry>();
    for (const worker of runtime?.workers ?? []) merged.set(worker.worker_id, worker);
    for (const worker of Object.values(liveWorkers)) merged.set(worker.worker_id, worker);
    return [...merged.values()].sort((left, right) => left.worker_id.localeCompare(right.worker_id));
  }, [liveWorkers, runtime?.workers]);
  const activeWorkers = workers.filter((worker) => worker.lifecycle !== 'KILLED').length;
  const latestBatches = [...(runDetail?.batches ?? [])].reverse().slice(0, 8);
  const observedRun = runDetail?.run;
  const stages = [
    { label: '01 / SILVER INTAKE', value: `${runtime?.pending_total ?? 0} LC queued`, detail: `${runtime?.pending_by_kind?.TARGET_PIXEL ?? 0} TPF events pending`, active: (runtime?.pending_total ?? 0) > 0 },
    { label: '02 / PAIR LC + TPF', value: `${readiness?.ready_lightcurves ?? 0} eligible`, detail: `${readiness?.missing_tpf ?? 0} missing TPF`, active: (readiness?.ready_lightcurves ?? 0) > 0 },
    { label: '03 / TIC + TOI', value: catalog?.state ?? 'IDLE', detail: `${catalog?.target_count ?? 0} batch targets`, active: catalog?.state === 'SYNCING' },
    { label: '04 / MATERIALIZE', value: `${runtime?.active_builds ?? 0} active builds`, detail: `${activeWorkers} worker slots alive`, active: (runtime?.active_builds ?? 0) > 0 },
    { label: '05 / COMMIT', value: runtime?.last_snapshot_id ? 'COMMITTED' : 'NO SNAPSHOT', detail: runtime?.last_snapshot_id ?? 'Awaiting first Gold output', active: Boolean(runtime?.last_snapshot_id) },
  ];

  return (
    <div className="space-y-5">
      <Card className={consoleCard}>
        <CardHeader className="border-b border-border/70 pb-4">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
            <div className="min-w-0">
              <p className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.14em] text-primary"><Waves className="size-3.5" />Silver → Gold research console</p>
              <CardTitle className="mt-1 text-xl">Làm giàu dữ liệu</CardTitle>
              <CardDescription className="mt-1">Quan sát trạng thái run, worker lifecycle, dữ liệu đầu vào và Gold output.</CardDescription>
            </div>
            <div className="flex flex-wrap items-center gap-2 font-mono text-[10px] uppercase">
              <Badge variant="outline" className="rounded-none">{stateLabel[runtimeState] ?? runtimeState}</Badge>
              {overview?.control.command_id ? <Badge variant={commandAcknowledged ? 'default' : 'secondary'} className="rounded-none">{commandAcknowledged ? 'worker ack' : 'ack pending'}</Badge> : null}
              <Badge variant={connection === 'live' ? 'default' : 'secondary'} className="rounded-none"><Radio className="mr-1 size-3" />{connection === 'live' ? 'Live updates' : 'Reconnecting'}</Badge>
              <span className="max-w-[22rem] truncate border border-border/70 bg-muted/20 px-2.5 py-1.5 normal-case" title={observerTicket}>trace / {observerTicket}</span>
              <Button variant="outline" size="sm" onClick={() => void refresh()} disabled={refreshing} className="h-8 rounded-none font-mono text-[9px] uppercase"><RefreshCw className={`size-3 ${refreshing ? 'animate-spin' : ''}`} />Sync status</Button>
            </div>
          </div>
        </CardHeader>
      </Card>

      {error ? <div className="flex items-center gap-2 border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive"><AlertCircle className="size-4" />{error}</div> : null}

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-5">
          <Card className={consoleCard}>
            <CardHeader className="border-b border-border/70 pb-3"><CardTitle className="font-mono text-[10px] uppercase tracking-[0.14em] text-primary">Data process / execution rail</CardTitle><CardDescription>Mỗi node phản ánh dữ liệu và trạng thái worker đã báo; không dựng progress giả.</CardDescription></CardHeader>
            <CardContent className="grid gap-px bg-border/60 p-0 sm:grid-cols-2 xl:grid-cols-5">{stages.map((stage) => <ProcessNode key={stage.label} {...stage} />)}</CardContent>
          </Card>

          <Card className={consoleCard}>
            <CardHeader className="border-b border-border/70 pb-3"><div className="flex items-end justify-between gap-3"><div><CardTitle className="flex items-center gap-2 text-sm"><Activity className="size-4 text-primary" />Worker telemetry</CardTitle><CardDescription>Theo dõi worker được tạo, hành vi hiện tại và thời điểm kết thúc.</CardDescription></div><span className="font-mono text-[10px] text-muted-foreground">{workers.length.toString().padStart(2, '0')} slots</span></div></CardHeader>
            <CardContent className="space-y-2 p-3">{workers.length === 0 ? <div className="border border-dashed border-border/70 p-6 text-center text-xs text-muted-foreground">Đang chờ worker bắt đầu hoạt động.</div> : workers.map((worker) => <WorkerRow key={worker.worker_id} worker={worker} />)}</CardContent>
          </Card>
        </div>

        <Card className={`${consoleCard} h-fit`}>
          <CardHeader className="border-b border-border/70 pb-3"><CardTitle className="flex items-center gap-2 text-sm"><Zap className="size-4 text-primary" />Operator intervention</CardTitle><CardDescription>Điều chỉnh cách gom batch và thời điểm materialize Gold output.</CardDescription></CardHeader>
          <CardContent className="space-y-4 p-4">
            <div className="space-y-3">
              <ConsoleSelect label="Execution mode" value={mode} disabled={busy || !isFrozen} onChange={(value) => setMode(value as 'stream' | 'batch')} options={[['stream', 'STREAM · coalesce Silver'], ['batch', 'BATCH · drain backlog']]} />
              <ConsoleSelect label="Maximum LC / batch" value={String(maxBatchRecords)} disabled={busy || !isFrozen} onChange={(value) => setMaxBatchRecords(Number(value))} options={[100, 250, 500, 1000, 2500, 5000].map((value) => [String(value), value.toLocaleString()])} />
              {mode === 'stream' ? <ConsoleSelect label="Idle flush window" value={String(idleFlushSeconds)} disabled={busy || !isFrozen} onChange={(value) => setIdleFlushSeconds(Number(value))} options={[[60, '1 minute'], [120, '2 minutes'], [180, '3 minutes'], [300, '5 minutes'], [600, '10 minutes'], [900, '15 minutes']].map(([value, label]) => [String(value), String(label)])} /> : null}
            </div>
            <div className="border border-border/70 bg-muted/20 p-3 font-mono text-[10px]"><KeyValue label="Run ID" value={overview?.control.command_id ?? 'not-issued'} /><KeyValue label="Active run" value={runtime?.command_id ?? 'not-observed'} /><KeyValue label="Next flush" value={formatTime(runtime?.next_flush_at)} /><KeyValue label="Last update" value={formatTime(runtime?.updated_at)} /></div>
            {isFrozen ? <Button onClick={start} disabled={busy} className="w-full rounded-none font-mono text-[10px] uppercase"><Play className="size-3.5 fill-current" />{busy ? 'Starting run…' : 'Launch Gold run'}</Button> : <Button onClick={stop} disabled={busy} className="w-full rounded-none bg-rose-600 font-mono text-[10px] uppercase text-white hover:bg-rose-700"><Square className="size-3.5 fill-current" />{busy ? 'Requesting freeze…' : 'Freeze and drain'}</Button>}
            <p className="text-[11px] leading-relaxed text-muted-foreground">Freeze không kill batch đang commit. Worker chuyển sang FROZEN sau khi xả công việc đã nhận; KILLED chỉ xuất hiện khi worker task thực sự thoát.</p>
          </CardContent>
        </Card>
      </div>

      <Card className={consoleCard}>
        <CardHeader className="border-b border-border/70 pb-3"><div className="flex items-end justify-between"><div><CardTitle className="flex items-center gap-2 text-sm"><Terminal className="size-4 text-primary" />Worker activity log</CardTitle><CardDescription>Dòng thời gian spawn, xử lý, hoàn tất và dừng của từng worker trong run.</CardDescription></div><span className="font-mono text-[10px] text-muted-foreground">{eventRows.length} events</span></div></CardHeader>
        <CardContent className="max-h-80 overflow-auto bg-slate-950 p-0 text-slate-200">{eventRows.length === 0 ? <p className="p-4 font-mono text-[11px] text-slate-500">$ waiting for worker activity…</p> : eventRows.map((row) => <div key={row.id} className="grid gap-1 border-b border-slate-800 px-3 py-2 font-mono text-[10px] sm:grid-cols-[90px_80px_90px_minmax(0,1fr)]"><span className="text-slate-500">{shortTime(row.observedAt)}</span><span className="text-cyan-400">{row.worker.worker_id}</span><span className={row.worker.lifecycle === 'KILLED' ? 'text-rose-400' : 'text-emerald-400'}>{row.worker.lifecycle}</span><span><strong className="font-medium text-slate-100">{actionLabel[row.worker.action] ?? row.worker.action}</strong><span className="ml-2 text-slate-500">{row.worker.detail}</span></span></div>)}</CardContent>
      </Card>

      <Card className={consoleCard}>
        <CardHeader className="border-b border-border/70 pb-3"><div className="flex items-end justify-between"><div><CardTitle className="flex items-center gap-2 text-sm"><Database className="size-4 text-primary" />Materialized Gold data</CardTitle><CardDescription>Snapshot đã commit trong durable run ledger, không phải số liệu suy diễn từ object count.</CardDescription></div>{historyLoading ? <Badge variant="secondary" className="rounded-none">reading ledger</Badge> : observedRun?.status ? <Badge variant="secondary" className="rounded-none">{observedRun.status}</Badge> : null}</div></CardHeader>
        <CardContent className="p-0">{latestBatches.length === 0 ? <div className="p-8 text-center text-xs text-muted-foreground">Chưa có Gold batch được ghi nhận cho control job này.</div> : <div className="overflow-x-auto"><table className="w-full min-w-[760px] text-sm"><thead className="border-b bg-muted/30 text-left font-mono text-[9px] uppercase text-muted-foreground"><tr><th className="p-3">Snapshot</th><th className="p-3 text-right">Silver input</th><th className="p-3 text-right">Gold rows</th><th className="p-3 text-right">Indexed</th><th className="p-3">Committed at</th></tr></thead><tbody>{latestBatches.map((batch) => <tr key={batch.batch_id} className="border-b border-border/60 last:border-0"><td className="p-3"><Link to={`/gold/snapshots/${encodeURIComponent(batch.snapshot_id ?? batch.batch_id)}`} className="font-mono text-xs text-primary hover:underline">{batch.snapshot_id ?? batch.batch_id}</Link></td><td className="p-3 text-right tabular-nums">{batch.input_records.toLocaleString()}</td><td className="p-3 text-right tabular-nums">{batch.candidate_rows.toLocaleString()}</td><td className="p-3 text-right tabular-nums">{batch.indexed_rows.toLocaleString()}</td><td className="p-3 text-xs text-muted-foreground">{formatTime(batch.completed_at)}</td></tr>)}</tbody></table></div>}</CardContent>
      </Card>
    </div>
  );
}

function ProcessNode({ label, value, detail, active }: { label: string; value: string; detail: string; active: boolean }): JSX.Element {
  return <div className={`min-h-32 bg-background p-3 ${active ? 'shadow-[inset_0_2px_0_hsl(var(--primary))]' : ''}`}><div className="flex items-center justify-between gap-2"><p className="font-mono text-[9px] tracking-[0.1em] text-muted-foreground">{label}</p>{active ? <CheckCircle2 className="size-3.5 text-primary" /> : <Clock3 className="size-3.5 text-muted-foreground/50" />}</div><p className="mt-5 font-mono text-sm font-medium">{value}</p><p className="mt-2 break-words text-[11px] leading-relaxed text-muted-foreground">{detail}</p></div>;
}

function WorkerRow({ worker }: { worker: GoldWorkerTelemetry }): JSX.Element {
  return <div className={`grid min-w-0 items-center gap-2 border px-3 py-2.5 md:grid-cols-[90px_90px_minmax(170px,1fr)_100px_110px] ${toneForWorker(worker)}`}><div className="flex items-center gap-2"><span className={`size-2 rounded-full ${worker.lifecycle === 'KILLED' ? 'bg-rose-500' : 'bg-primary'}`} /><span className="font-mono text-[10px] font-semibold">{worker.worker_id}</span></div><Badge variant="outline" className="w-fit rounded-none font-mono text-[9px]">{worker.lifecycle}</Badge><div className="min-w-0"><p className="truncate font-mono text-[10px] font-medium text-foreground" title={worker.action}>{actionLabel[worker.action] ?? worker.action}</p><p className="truncate text-[10px] text-muted-foreground" title={worker.detail}>{worker.detail || 'No action detail'}</p></div><p className="font-mono text-[10px] text-foreground">{worker.input_count.toLocaleString()} inputs</p><p className="truncate text-right font-mono text-[9px] text-muted-foreground" title={worker.updated_at}>{shortTime(worker.updated_at)}</p></div>;
}

function ConsoleSelect({ label, value, options, disabled, onChange }: { label: string; value: string; options: string[][]; disabled: boolean; onChange: (value: string) => void }): JSX.Element {
  return <label className="grid gap-1.5"><span className="font-mono text-[9px] uppercase tracking-[0.1em] text-muted-foreground">{label}</span><select value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)} className="h-9 rounded-none border border-input bg-background px-3 font-mono text-[10px] uppercase outline-none focus:border-ring disabled:cursor-not-allowed disabled:opacity-50">{options.map(([optionValue, optionLabel]) => <option key={optionValue} value={optionValue}>{optionLabel}</option>)}</select></label>;
}

function KeyValue({ label, value }: { label: string; value: string }): JSX.Element {
  return <div className="flex min-w-0 items-center justify-between gap-3 border-b border-border/60 py-1.5 last:border-0"><span className="shrink-0 text-muted-foreground">{label}</span><span className="truncate text-right text-foreground" title={value}>{value}</span></div>;
}
