import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { JSX } from 'react';
import { Activity, AlertCircle, CheckCircle2, Clock3, Database, Play, Radio, RefreshCw, Square, Waves } from 'lucide-react';
import { Link } from 'react-router-dom';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { apiBase, apiFetch } from '@/lib/api';

import type { GoldControlOverview } from './types';
import type { FactoryRunDetail } from '../data-factory/history-types';

const stateLabel: Record<string, string> = {
  IDLE: 'Idle',
  RUNNING: 'Running',
  DRAINING: 'Draining',
  FROZEN: 'Frozen',
  CATALOG_SYNCING: 'Đang đồng bộ catalog',
  WAITING_FOR_CATALOG_SYNC: 'Chờ catalog xác thực',
  WAITING_FOR_TPF: 'Chờ TPF',
  READY: 'Sẵn sàng đúc Gold',
};

function formatTime(value?: string): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString('vi-VN');
}

function formatAge(value?: string): string {
  if (!value) return 'Chưa có worker report';
  const milliseconds = Date.now() - new Date(value).getTime();
  if (!Number.isFinite(milliseconds) || milliseconds < 0) return 'Vừa cập nhật';
  const seconds = Math.floor(milliseconds / 1000);
  if (seconds < 5) return 'Vừa cập nhật';
  if (seconds < 60) return `${seconds}s trước`;
  return `${Math.floor(seconds / 60)} phút trước`;
}

export default function EnrichmentPage(): JSX.Element {
  const [overview, setOverview] = useState<GoldControlOverview | null>(null);
  const [runDetail, setRunDetail] = useState<FactoryRunDetail | null>(null);
  const [mode, setMode] = useState<'stream' | 'batch'>('stream');
  const [maxBatchRecords, setMaxBatchRecords] = useState(500);
  const [idleFlushSeconds, setIdleFlushSeconds] = useState(180);
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingDelta, setPendingDelta] = useState<number | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const latestOverview = useRef<GoldControlOverview | null>(null);
  const overviewRequestInFlight = useRef(false);
  const historyRequestInFlight = useRef(false);

  const loadOverview = useCallback(async (manual = false): Promise<GoldControlOverview | null> => {
    if (overviewRequestInFlight.current) return latestOverview.current;
    overviewRequestInFlight.current = true;
    if (manual) setRefreshing(true);
    try {
      const next = await apiFetch<GoldControlOverview>('/v1/gold/control');
      const previousPending = latestOverview.current?.runtime?.pending_total;
      if (typeof previousPending === 'number' && typeof next.runtime?.pending_total === 'number') {
        setPendingDelta(next.runtime.pending_total - previousPending);
      }
      latestOverview.current = next;
      setOverview(next);
      if (next.control.mode === 'STREAM' || next.control.mode === 'BATCH') {
        setMode(next.control.mode.toLowerCase() as 'stream' | 'batch');
        setMaxBatchRecords(next.control.max_batch_records);
        setIdleFlushSeconds(Math.round(next.control.idle_flush_seconds));
      }
      setError(null);
      return next;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Không tải được trạng thái Gold');
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
      const detail = await apiFetch<FactoryRunDetail>(`/v1/data-factory/runs/${encodeURIComponent(commandID)}`);
      setRunDetail(detail);
    } catch {
      // History is durable but asynchronous. Keep live runtime visible without
      // pretending an uncommitted batch has a finished timeline.
      setRunDetail(null);
    } finally {
      historyRequestInFlight.current = false;
      setHistoryLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadOverview();
    const stream = new EventSource(`${apiBase}/v1/events?workflow=gold`);
    let debounceTimer: number | undefined;
    const refresh = () => {
      window.clearTimeout(debounceTimer);
      debounceTimer = window.setTimeout(() => void loadOverview(), 400);
    };
    stream.addEventListener('workflow', refresh);
    // The control record is a tiny object-store read. History is loaded in a
    // separate effect below, so live updates never wait for ClickHouse.
    const timer = window.setInterval(() => void loadOverview(), 5_000);
    return () => {
      stream.close();
      window.clearInterval(timer);
      window.clearTimeout(debounceTimer);
    };
  }, [loadOverview]);

  useEffect(() => {
    void loadHistory(overview?.control.command_id);
  }, [loadHistory, overview?.control.command_id, overview?.runtime?.last_snapshot_id]);

  const start = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const next = await apiFetch<GoldControlOverview>('/v1/gold/control/start', {
        method: 'POST',
        body: JSON.stringify({ mode, max_batch_records: maxBatchRecords, idle_flush_seconds: idleFlushSeconds }),
      });
      latestOverview.current = next;
      setOverview(next);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Không thể bắt đầu làm giàu dữ liệu');
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
      setError(cause instanceof Error ? cause.message : 'Không thể dừng Gold Builder');
    } finally {
      setBusy(false);
    }
  };

  const runtime = overview?.runtime;
  const isFrozen = overview?.control.mode === 'PAUSED';
  const runtimeState = runtime?.state ?? (isFrozen ? 'FROZEN' : 'IDLE');
  const readiness = runtime?.readiness;
  const catalogSync = runtime?.catalog_sync;
  const controlModeLabel = isFrozen ? 'FROZEN' : overview?.control.mode === 'BATCH' ? 'BACKLOG' : 'STREAM';
  const latestBatches = [...(runDetail?.batches ?? [])].reverse().slice(0, 6);
  const observedRun = runDetail?.run;
  const workerReportAge = formatAge(runtime?.updated_at);
  const workerReportStale = Boolean(runtime?.updated_at) && Date.now() - new Date(runtime?.updated_at ?? '').getTime() > 15_000;
  const executionStages = useMemo(() => buildExecutionStages({
    isFrozen,
    runtimeState,
    pendingTotal: runtime?.pending_total ?? 0,
    pendingDelta,
    readiness,
    catalogSync,
    activeBuilds: runtime?.active_builds ?? 0,
    lastSnapshotID: runtime?.last_snapshot_id,
    indexedRows: observedRun?.indexed_rows ?? 0,
  }), [catalogSync, isFrozen, observedRun?.indexed_rows, pendingDelta, readiness, runtime?.active_builds, runtime?.last_snapshot_id, runtime?.pending_total, runtimeState]);

  const refresh = async (): Promise<void> => {
    const next = await loadOverview(true);
    await loadHistory(next?.control.command_id);
  };

  return (
    <div className="space-y-6">
      <div>
        <div>
          <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
            <Waves className="size-4 text-primary" /> Silver → Gold control plane
          </div>
          <h2 className="font-heading text-2xl font-semibold tracking-tight md:text-3xl">Làm giàu dữ liệu</h2>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            Điều khiển Gold Builder. Stream chỉ bắt đầu gom khi Silver đầu tiên đã được nhận; không tạo snapshot Gold rỗng.
          </p>
        </div>
      </div>

      {error && <div className="flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive"><AlertCircle className="size-4" />{error}</div>}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Card><CardHeader className="pb-2"><CardDescription>Trạng thái runtime</CardDescription><CardTitle className="flex items-center gap-2 text-base"><Radio className="size-4 text-primary" />{stateLabel[runtimeState] ?? runtimeState}</CardTitle></CardHeader><CardContent><Badge variant={isFrozen ? 'secondary' : 'default'}>{controlModeLabel}</Badge></CardContent></Card>
        <Card><CardHeader className="pb-2"><CardDescription>Light curve đang chờ</CardDescription><CardTitle className="text-2xl">{runtime?.pending_total ?? 0}</CardTitle></CardHeader><CardContent className="text-xs text-muted-foreground">{readiness ? `TPF context ${readiness.tpf_contexts}` : 'Worker chưa xuất readiness telemetry'}</CardContent></Card>
        <Card><CardHeader className="pb-2"><CardDescription>Flush kế tiếp</CardDescription><CardTitle className="flex items-center gap-2 text-sm"><Clock3 className="size-4 text-amber-500" />{formatTime(runtime?.next_flush_at)}</CardTitle></CardHeader><CardContent className="text-xs text-muted-foreground">Idle window: {Math.round(overview?.control.idle_flush_seconds ?? idleFlushSeconds)} giây</CardContent></Card>
        <Card><CardHeader className="pb-2"><CardDescription>Gold snapshot gần nhất</CardDescription><CardTitle className="flex items-center gap-2 text-sm"><Database className="size-4 text-emerald-500" />{runtime?.last_snapshot_id ? <Link className="font-mono text-primary hover:underline" to={`/gold/snapshots/${encodeURIComponent(runtime.last_snapshot_id)}`}>{runtime.last_snapshot_id}</Link> : 'Chưa có'}</CardTitle></CardHeader><CardContent className="text-xs text-muted-foreground">Active builds: {runtime?.active_builds ?? 0}</CardContent></Card>
      </div>

      {runtime && readiness && (
        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-base">Điều kiện Gold research-ready</CardTitle><CardDescription>Gold đọc ingest checkpoint để ghép đúng một TPF với mỗi light curve, rồi chỉ đồng bộ TIC/TOI cho batch đã đủ dữ liệu. Hai catalog được pin thành snapshot bất biến trước khi đúc Gold.</CardDescription></CardHeader>
          <CardContent className="grid gap-3 text-sm sm:grid-cols-2 xl:grid-cols-4">
            <ReadinessMetric label="Catalog evidence" value={catalogSync?.state === 'READY' ? (catalogSync.cache_hit ? 'Đã xác thực (cache)' : 'Đã xác thực') : catalogSync?.state === 'SYNCING' ? 'Đang đồng bộ' : catalogSync?.state === 'RETRYING' ? 'Sẽ thử lại' : 'Theo batch, on-demand'} ready={catalogSync?.state === 'READY'} />
            <ReadinessMetric label="Phạm vi catalog batch" value={catalogSync?.target_count ? `${catalogSync.target_count.toLocaleString()} TIC · ${catalogSync.tic_records.toLocaleString()} TIC row · ${catalogSync.toi_records.toLocaleString()} TOI row` : 'Chưa có batch sẵn sàng'} ready={catalogSync?.state === 'READY'} />
            <ReadinessMetric label="LC đủ điều kiện" value={`${(readiness?.ready_lightcurves ?? 0).toLocaleString()} LC`} ready={(readiness?.ready_lightcurves ?? 0) > 0} />
            <ReadinessMetric label="LC còn thiếu TPF" value={`${(readiness?.missing_tpf ?? 0).toLocaleString()} LC`} ready={(readiness?.waiting_lightcurves ?? 0) === 0} />
            <p className="sm:col-span-2 xl:col-span-4 text-xs text-muted-foreground">Contract ingest: {(readiness?.contracted_lightcurves ?? 0).toLocaleString()} LC được đối chiếu theo manifest · {(readiness?.uncontracted_lightcurves ?? 0).toLocaleString()} LC chưa có manifest lưu vết nên dùng ghép cặp theo sample/sector. {catalogSync?.error ? `Catalog: ${catalogSync.error}` : 'Không có catalog global được suy diễn.'}</p>
          </CardContent>
        </Card>
      )}

      {runtime && !readiness && <div className="rounded-md border border-dashed border-border p-3 text-xs text-muted-foreground">Worker đang chạy chưa xuất readiness telemetry. Không suy đoán trạng thái TPF hoặc catalog từ số pending cũ.</div>}

      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-base">Điều khiển Gold Builder</CardTitle><CardDescription>Chọn giới hạn trước khi bắt đầu. Các giá trị được lưu bền vững và worker đọc trực tiếp từ control plane.</CardDescription></CardHeader>
        <CardContent className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            <label className="grid gap-1.5 text-xs font-medium text-foreground"><span>Chế độ</span><select value={mode} onChange={(event) => setMode(event.target.value as 'stream' | 'batch')} disabled={busy || !isFrozen} className="h-9 rounded-md border border-border bg-background px-3 text-xs font-medium"><option value="stream">Stream mode</option><option value="batch">Backlog batch mode</option></select></label>
            <label className="grid gap-1.5 text-xs font-medium text-foreground"><span>Số bản ghi tối đa / batch</span><select value={maxBatchRecords} onChange={(event) => setMaxBatchRecords(Number(event.target.value))} disabled={busy || !isFrozen} className="h-9 rounded-md border border-border bg-background px-3 text-xs font-medium"><option value={100}>100 bản ghi</option><option value={250}>250 bản ghi</option><option value={500}>500 bản ghi</option><option value={1000}>1,000 bản ghi</option><option value={2500}>2,500 bản ghi</option><option value={5000}>5,000 bản ghi</option></select></label>
            {mode === 'stream' && <label className="grid gap-1.5 text-xs font-medium text-foreground"><span>Thời gian batch tối đa</span><select value={idleFlushSeconds} onChange={(event) => setIdleFlushSeconds(Number(event.target.value))} disabled={busy || !isFrozen} className="h-9 rounded-md border border-border bg-background px-3 text-xs font-medium"><option value={60}>1 phút</option><option value={120}>2 phút</option><option value={180}>3 phút</option><option value={300}>5 phút</option><option value={600}>10 phút</option><option value={900}>15 phút</option></select></label>}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {isFrozen ? <Button size="sm" onClick={start} disabled={busy} className="gap-1.5"><Play className="size-3.5 fill-current" />{busy ? 'Đang khởi động...' : mode === 'stream' ? 'Bắt đầu stream' : 'Chạy backlog'}</Button> : <Button size="sm" onClick={stop} disabled={busy} className="gap-1.5 bg-red-600 text-white hover:bg-red-700"><Square className="size-3.5 fill-current" />{busy ? 'Đang đóng băng...' : 'Đóng băng & xả dở'}</Button>}
            <Button variant="outline" size="sm" onClick={() => void refresh()} disabled={busy || refreshing} className="gap-1.5"><RefreshCw className={`size-3.5 ${refreshing ? 'animate-spin' : ''}`} />Đồng bộ trạng thái</Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base"><Activity className="size-4 text-primary" />Quan sát Gold Builder</CardTitle>
          <CardDescription>Chỉ hiển thị trạng thái worker đã báo về. Không có thanh tiến độ, hoạt ảnh hay batch được suy diễn.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className={`flex items-center gap-2 rounded-md border px-3 py-2 text-xs ${workerReportStale ? 'border-amber-500/40 bg-amber-500/5 text-amber-600 dark:text-amber-400' : 'border-emerald-500/35 bg-emerald-500/5 text-emerald-600 dark:text-emerald-400'}`}>
            <Radio className="size-3.5" />
            <span className="font-medium">{workerReportStale ? 'Worker chưa báo telemetry mới' : 'Worker telemetry đã xác nhận'}</span>
            <span className="ml-auto tabular-nums">{workerReportAge}</span>
          </div>

          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
            {executionStages.map((stage) => <ExecutionStage key={stage.title} {...stage} />)}
          </div>

          <div className="grid gap-3 rounded-lg border border-border/70 bg-muted/20 p-3 text-sm md:grid-cols-3">
            <div><p className="text-xs text-muted-foreground">Run quan sát</p><p className="mt-1 font-mono text-xs text-primary">{observedRun?.run_id ?? overview?.control.command_id ?? 'Chưa có run'}</p></div>
            <div><p className="text-xs text-muted-foreground">Worker report thật</p><p className="mt-1 font-medium">{formatTime(runtime?.updated_at)}</p></div>
            <div><p className="text-xs text-muted-foreground">Snapshot gần nhất</p><p className="mt-1 truncate font-mono text-xs">{runtime?.last_snapshot_id ?? observedRun?.last_snapshot_id ?? '—'}</p></div>
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between gap-3"><div><p className="text-sm font-medium">Snapshot Gold vừa materialize</p><p className="text-xs text-muted-foreground">Sáu batch gần nhất trong durable run ledger.</p></div>{historyLoading ? <Badge variant="secondary">Đang đọc history</Badge> : observedRun?.status && <Badge variant="secondary">{observedRun.status}</Badge>}</div>
            {latestBatches.length === 0 ? <div className="rounded-md border border-dashed border-border p-5 text-center text-sm text-muted-foreground">Chưa có batch Gold nào được ClickHouse ghi nhận cho run này.</div> : <div className="overflow-x-auto rounded-md border border-border"><table className="w-full min-w-[720px] text-sm"><thead className="border-b bg-muted/30 text-left text-xs text-muted-foreground"><tr><th className="p-3">Snapshot</th><th className="p-3 text-right">Silver in</th><th className="p-3 text-right">Gold rows</th><th className="p-3 text-right">Indexed</th><th className="p-3">Committed</th></tr></thead><tbody>{latestBatches.map((batch) => <tr key={batch.batch_id} className="border-b border-border/60 last:border-0"><td className="p-3"><Link to={`/gold/snapshots/${encodeURIComponent(batch.snapshot_id ?? batch.batch_id)}`} className="font-mono text-xs text-primary hover:underline">{batch.snapshot_id ?? batch.batch_id}</Link></td><td className="p-3 text-right tabular-nums">{batch.input_records.toLocaleString()}</td><td className="p-3 text-right tabular-nums">{batch.candidate_rows.toLocaleString()}</td><td className="p-3 text-right tabular-nums">{batch.indexed_rows.toLocaleString()}</td><td className="p-3 text-xs text-muted-foreground">{formatTime(batch.completed_at)}</td></tr>)}</tbody></table></div>}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

type ExecutionTone = 'idle' | 'running' | 'ready' | 'blocked';

type ExecutionStageProps = {
  title: string;
  value: string;
  detail: string;
  tone: ExecutionTone;
};

function buildExecutionStages({ isFrozen, runtimeState, pendingTotal, pendingDelta, readiness, catalogSync, activeBuilds, lastSnapshotID, indexedRows }: {
  isFrozen: boolean;
  runtimeState: string;
  pendingTotal: number;
  pendingDelta: number | null;
  readiness: NonNullable<GoldControlOverview['runtime']>['readiness'] | undefined;
  catalogSync: NonNullable<GoldControlOverview['runtime']>['catalog_sync'] | undefined;
  activeBuilds: number;
  lastSnapshotID?: string;
  indexedRows: number;
}): ExecutionStageProps[] {
  const stopped = isFrozen || runtimeState === 'FROZEN';
  const delta = pendingDelta === null || pendingDelta === 0 ? 'không đổi từ lần report trước' : pendingDelta < 0 ? `${Math.abs(pendingDelta).toLocaleString()} đã rời hàng chờ` : `+${pendingDelta.toLocaleString()} mới vào hàng chờ`;
  const pairing = stopped
    ? { value: 'Chưa đánh giá', detail: 'Worker chỉ kiểm tra ghép LC/TPF khi batch bắt đầu.', tone: 'idle' as const }
    : (readiness?.missing_tpf ?? 0) > 0
      ? { value: `${readiness!.missing_tpf.toLocaleString()} thiếu TPF`, detail: `${readiness?.waiting_lightcurves?.toLocaleString() ?? 0} LC đang bị chặn thật.`, tone: 'blocked' as const }
      : { value: `${readiness?.ready_lightcurves?.toLocaleString() ?? 0} LC sẵn sàng`, detail: `${readiness?.tpf_contexts?.toLocaleString() ?? 0} TPF context đã quan sát.`, tone: 'ready' as const };
  const catalogs = catalogSync?.state === 'SYNCING'
    ? { value: 'Đang đồng bộ', detail: `${catalogSync.target_count.toLocaleString()} TIC trong batch hiện tại.`, tone: 'running' as const }
    : catalogSync?.state === 'READY'
      ? { value: `${catalogSync.target_count.toLocaleString()} TIC đã pin`, detail: `TIC ${catalogSync.tic_records.toLocaleString()} · TOI ${catalogSync.toi_records.toLocaleString()}.`, tone: 'ready' as const }
      : { value: 'Chờ batch', detail: 'Catalog chỉ tải khi LC/TPF của batch đã đủ.', tone: 'idle' as const };
  const materialize = activeBuilds > 0
    ? { value: `${activeBuilds} batch đang build`, detail: 'Gold files và ClickHouse đang được materialize.', tone: 'running' as const }
    : stopped
      ? { value: 'Đã đóng băng', detail: 'Không có batch nào được bắt đầu khi control đang PAUSED.', tone: 'idle' as const }
      : { value: 'Chưa có build active', detail: 'Không suy diễn build chỉ từ số bản ghi đang chờ.', tone: 'idle' as const };
  return [
    { title: '1. Silver queue', value: `${pendingTotal.toLocaleString()} LC chờ`, detail: delta, tone: stopped ? 'idle' : pendingTotal > 0 ? 'running' : 'idle' },
    { title: '2. Ghép LC + TPF', ...pairing },
    { title: '3. TIC / TOI evidence', ...catalogs },
    { title: '4. Materialize Gold', ...materialize },
    { title: '5. Commit & index', value: lastSnapshotID ? 'Đã có snapshot' : 'Chưa commit', detail: lastSnapshotID ? `${indexedRows.toLocaleString()} row index trong run hiện tại.` : 'Sẽ chỉ xuất hiện sau khi batch commit hoàn tất.', tone: lastSnapshotID ? 'ready' : 'idle' },
  ];
}

function ExecutionStage({ title, value, detail, tone }: ExecutionStageProps): JSX.Element {
  const style = {
    idle: 'border-border bg-card',
    running: 'border-primary/50 bg-primary/5',
    ready: 'border-emerald-500/35 bg-emerald-500/5',
    blocked: 'border-amber-500/40 bg-amber-500/5',
  }[tone];
  const label = { idle: 'Chờ', running: 'Đang hoạt động', ready: 'Đã xác thực', blocked: 'Đang chặn' }[tone];
  return <div className={`min-h-36 rounded-lg border p-4 ${style}`}><div className="flex items-start justify-between gap-2"><p className="text-xs font-medium text-muted-foreground">{title}</p>{tone === 'ready' ? <CheckCircle2 className="size-4 text-emerald-500" /> : <Badge variant={tone === 'blocked' ? 'destructive' : tone === 'running' ? 'default' : 'secondary'} className="px-1.5 py-0 text-[10px]">{label}</Badge>}</div><p className="mt-4 text-base font-semibold tabular-nums">{value}</p><p className="mt-2 text-xs leading-relaxed text-muted-foreground">{detail}</p></div>;
}

function ReadinessMetric({ label, value, ready }: { label: string; value: string; ready: boolean | undefined }): JSX.Element {
  return <div className={`rounded-md border p-3 ${ready ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-amber-500/30 bg-amber-500/5'}`}><p className="text-xs text-muted-foreground">{label}</p><p className={`mt-1 font-medium ${ready ? 'text-emerald-500' : 'text-amber-500'}`}>{value}</p></div>;
}
