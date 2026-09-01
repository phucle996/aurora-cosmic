import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent, JSX } from 'react';
import {
  Activity,
  AlertCircle,
  Cpu,
  DownloadCloud,
  Files,
  Gauge,
  HardDrive,
  Play,
  Search,
  Square,
  Timer,
  Wifi,
} from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { apiBase, apiFetch } from '@/lib/api';

type IngestProduct = {
  id: string;
  kind: string;
  object_key: string;
  state: string;
  size_bytes: number;
  expected_size_bytes: number;
  attempts: number;
  last_error?: string;
  updated_at: string;
};

type IngestKindSummary = { planned: number; completed: number; downloading: number; failed: number };

type IngestStatus = {
  observed: boolean;
  source: string;
  run_id?: string;
  control_job_id?: string;
  status: string;
  error?: string;
  manifest_path?: string;
  started_at?: string;
  updated_at?: string;
  total_products: number;
  completed_products: number;
  downloading: number;
  failed_products: number;
  expected_bytes: number;
  completed_bytes: number;
  products_per_second: number;
  bytes_per_second: number;
  queue_depth: number;
  inflight_products: number;
  observed_at: string;
  products?: IngestProduct[];
  products_truncated?: boolean;
  product_kinds?: Record<string, IngestKindSummary>;
  catalog_progress?: { state: string; stage: string; tic_rows: number; toi_rows: number; completed: number; total: number; tic_snapshot_id?: string; toi_snapshot_id?: string; error?: string };
  manifest_progress?: {
    state: string;
    stage: string;
    completed: number;
    total: number;
    stage_completed?: number;
    stage_total?: number;
    discovered_products: number;
    paired_samples: number;
    selected_samples: number;
    priority_samples: number;
    catalog_snapshots?: Record<string, string>;
    error?: string;
    updated_at?: string;
  };
};

type IngestControlJob = {
  job_id: string;
  status: string;
  sector?: number;
  concurrency?: number;
  manifest_path?: string;
  started_at: string;
  updated_at: string;
  error?: string;
};

type PlanningSignal = {
  stage?: string;
  completed?: number;
  total?: number;
  products?: number;
  occurredAt?: string;
};

type WorkerSignal = {
  workerId: number;
  productId: string;
  productKind?: string;
  bytesRead: number;
  expectedBytes: number;
  occurredAt?: string;
};

const SECTOR_STORAGE_KEY = 'aurora.ingest.sector';
const CONCURRENCY_STORAGE_KEY = 'aurora.ingest.concurrency';

function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '—';
  if (value < 1024) return `${value} B`;
  if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 ** 3) return `${(value / 1024 ** 2).toFixed(1)} MB`;
  return `${(value / 1024 ** 3).toFixed(2)} GB`;
}

function formatTransferBytes(value: number): string {
  return value === 0 ? '0 B' : formatBytes(value);
}

function formatRate(value: number, unit: string): string {
  return value > 0 ? `${formatBytes(value)}/${unit}` : '—';
}

function formatDate(value?: string): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? value : date.toLocaleString();
}

function statusVariant(status: string): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (status === 'completed' || status === 'published') return 'default';
  if (status === 'failed' || status === 'completed_with_failures') return 'destructive';
  if (status === 'running' || status === 'planning' || status === 'downloading' || status === 'draining') return 'secondary';
  return 'outline';
}

function Stat({ icon: Icon, label, value, detail }: { icon: typeof Gauge; label: string; value: string; detail: string }): JSX.Element {
  return (
    <div className="min-w-0 border border-border/70 bg-background/45 p-3.5">
      <div className="flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.13em] text-muted-foreground">
        <Icon className="size-4 text-primary" />
        {label}
      </div>
      <p className="mt-2 truncate font-mono text-lg font-semibold tabular-nums text-foreground sm:text-xl">{value}</p>
      <p className="mt-1 truncate text-[11px] text-muted-foreground" title={detail}>{detail}</p>
    </div>
  );
}

export default function IngestSection(): JSX.Element {
  const [status, setStatus] = useState<IngestStatus | null>(null);
  const [, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [controlJob, setControlJob] = useState<IngestControlJob | null>(null);
  const [sector, setSector] = useState(() => {
    if (typeof window === 'undefined') return '1';
    const savedSector = window.localStorage.getItem(SECTOR_STORAGE_KEY);
    const value = Number(savedSector);
    return Number.isInteger(value) && value >= 1 && value <= 100 ? String(value) : '1';
  });
  const [concurrency, setConcurrency] = useState(() => {
    if (typeof window === 'undefined') return '8';
    const savedConcurrency = window.localStorage.getItem(CONCURRENCY_STORAGE_KEY);
    const value = Number(savedConcurrency);
    return Number.isInteger(value) && value >= 1 && value <= 32 ? String(value) : '8';
  });
  const [controlBusy, setControlBusy] = useState(false);
  const [planningSignal, setPlanningSignal] = useState<PlanningSignal | null>(null);
  const [workerSignals, setWorkerSignals] = useState<Record<number, WorkerSignal>>({});
  const [productFilter, setProductFilter] = useState<'all' | 'completed' | 'downloading' | 'failed'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const loadInFlight = useRef<Promise<void> | null>(null);

  const load = useCallback(() => {
    if (loadInFlight.current) return loadInFlight.current;
    const request = (async () => {
      setError(null);
      try {
        const nextStatus = await apiFetch<IngestStatus>('/v1/ingest/status?products_limit=100');
        setStatus(nextStatus);
      } catch (requestError) {
        setError(requestError instanceof Error ? requestError.message : 'Không thể tải trạng thái ingest');
      } finally {
        setLoading(false);
        loadInFlight.current = null;
      }
    })();
    loadInFlight.current = request;
    return request;
  }, []);

  useEffect(() => {
    void load();

    const ticket = window.crypto?.randomUUID?.() ?? `ingest-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const eventSource = new EventSource(`${apiBase}/v1/events?workflow=ingest&ticket=${encodeURIComponent(ticket)}`);
    eventSource.addEventListener('ready', () => {
      void load();
    });
    eventSource.addEventListener('workflow', (event) => {
      let consumedRuntimeProgress = false;
      try {
        const message = JSON.parse((event as MessageEvent<string>).data) as {
          status?: string;
          occurred_at?: string;
          payload?: {
            status?: string;
            planning_stage?: string;
            planning_completed?: number;
            planning_total?: number;
            planning_products?: number;
            worker_id?: number;
            product_id?: string;
            product_kind?: string;
            product_bytes?: number;
            product_expected_bytes?: number;
            occurred_at?: string;
          };
        };
        const runtimeStatus = message.payload?.status ?? message.status;
        if (runtimeStatus === 'planning') {
          const signal = {
            stage: message.payload?.planning_stage,
            completed: message.payload?.planning_completed,
            total: message.payload?.planning_total,
            products: message.payload?.planning_products,
            occurredAt: message.payload?.occurred_at ?? message.occurred_at,
          };
          setPlanningSignal(signal);
          if (signal.stage === 'DISCOVERING_MAST_TARGETS' || signal.stage === 'RESOLVING_MAST_PRODUCTS') {
            consumedRuntimeProgress = true;
            setStatus((current) => current?.manifest_progress ? {
              ...current,
              observed: true,
              status: 'planning',
              observed_at: signal.occurredAt ?? current.observed_at,
              manifest_progress: {
                ...current.manifest_progress,
                state: 'RUNNING',
                stage: signal.stage!,
                stage_completed: signal.completed ?? 0,
                stage_total: signal.total ?? 0,
                discovered_products: signal.products ?? current.manifest_progress.discovered_products,
                updated_at: signal.occurredAt ?? current.manifest_progress.updated_at,
              },
            } : current);
          }
        }
        if (runtimeStatus === 'transfer' && message.payload?.worker_id && message.payload.product_id) {
          const workerId = message.payload.worker_id;
          setWorkerSignals((current) => ({
            ...current,
            [workerId]: {
              workerId,
              productId: message.payload!.product_id!,
              productKind: message.payload?.product_kind,
              bytesRead: Math.max(0, message.payload?.product_bytes ?? 0),
              expectedBytes: Math.max(0, message.payload?.product_expected_bytes ?? 0),
              occurredAt: message.payload?.occurred_at ?? message.occurred_at,
            },
          }));
          consumedRuntimeProgress = true;
        }
        if (runtimeStatus === 'transfer_complete' && message.payload?.worker_id) {
          const workerId = message.payload.worker_id;
          setWorkerSignals((current) => {
            const next = { ...current };
            delete next[workerId];
            return next;
          });
          consumedRuntimeProgress = true;
        }
      } catch {
        // Unknown events fall back to an authoritative snapshot below.
      }
      if (!consumedRuntimeProgress) {
        void load();
      }
    });

    return () => {
      eventSource.close();
    };
  }, [load]);

  useEffect(() => {
    window.localStorage.setItem(SECTOR_STORAGE_KEY, sector);
  }, [sector]);

  useEffect(() => {
    window.localStorage.setItem(CONCURRENCY_STORAGE_KEY, concurrency);
  }, [concurrency]);

  const reportedStatus = status?.status ?? controlJob?.status;

  const isIngesting = useMemo(() => {
    const s = (reportedStatus ?? '').toLowerCase();
    return (
      s === 'running' ||
      s === 'planning' ||
      s === 'downloading' ||
      s === 'draining' ||
      s === 'cancelling' ||
      (status?.downloading ?? 0) > 0 ||
      (status?.inflight_products ?? 0) > 0
    );
  }, [reportedStatus, status?.downloading, status?.inflight_products]);

  const activeJobId = status?.control_job_id || status?.run_id || controlJob?.job_id || 'active';
  const isDraining = (reportedStatus ?? '').toLowerCase() === 'draining';

  useEffect(() => {
    if (!isIngesting) setWorkerSignals({});
  }, [isIngesting]);

  const handleStart = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setControlBusy(true);
    setError(null);
    setWorkerSignals({});
    try {
      const job = await apiFetch<IngestControlJob>('/v1/ingest/jobs', {
        method: 'POST',
        body: JSON.stringify({ sector: Number(sector), concurrency: Number(concurrency) }),
      });
      setControlJob(job);
      await load();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Không thể khởi động ingestion job');
    } finally {
      setControlBusy(false);
    }
  };

  const handleCancel = async (): Promise<void> => {
    setControlBusy(true);
    setError(null);
    try {
      const jobId = activeJobId;
      const job = await apiFetch<IngestControlJob>(`/v1/ingest/jobs/${encodeURIComponent(jobId)}/cancel`, { method: 'POST' });
      setControlJob(job);
      await load();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Không thể dừng ingestion job');
    } finally {
      setControlBusy(false);
    }
  };

  const percent = useMemo(() => {
    if (!status?.total_products) return 0;
    return Math.min(100, Math.round((status.completed_products / status.total_products) * 100));
  }, [status?.completed_products, status?.total_products]);

  const productKinds = useMemo(() => [
    ['LIGHT_CURVE', 'Light curves'],
    ['TARGET_PIXEL', 'TPF'],
  ].map(([key, label]) => ({ key, label, summary: status?.product_kinds?.[key] })), [status?.product_kinds]);

  const filteredProducts = useMemo(() => {
    const products = status?.products ?? [];
    return products.filter((p) => {
      if (productFilter === 'completed' && p.state !== 'completed' && p.state !== 'published') return false;
      if (productFilter === 'downloading' && p.state !== 'downloading' && p.state !== 'running') return false;
      if (productFilter === 'failed' && p.state !== 'failed') return false;
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase();
        return p.id.toLowerCase().includes(query) || p.object_key.toLowerCase().includes(query) || p.kind.toLowerCase().includes(query);
      }
      return true;
    });
  }, [status?.products, productFilter, searchQuery]);

  const downloadingProducts = useMemo(
    () => (status?.products ?? []).filter((product) => product.state === 'downloading' || product.state === 'running'),
    [status?.products],
  );
  const signaledWorkerCount = Object.keys(workerSignals).length;
  // Snapshot state covers the connection bootstrap; SSE signals then provide
  // stable worker ownership and live bytes without polling.
  const spawnedWorkerCount = Math.max(0, Math.round(status?.downloading ?? 0), signaledWorkerCount);

  const activeStatus = reportedStatus?.toLowerCase() === 'not_observed' ? undefined : reportedStatus;
  const manifestDiscoveryActive = activeStatus === 'planning' && (status?.manifest_progress?.stage === 'DISCOVERING_MAST_PRODUCTS' || status?.manifest_progress?.stage === 'DISCOVERING_MAST_TARGETS' || status?.manifest_progress?.stage === 'RESOLVING_MAST_PRODUCTS');
  const manifestStageCompleted = status?.manifest_progress?.stage_completed ?? planningSignal?.completed ?? 0;
  const manifestStageTotal = status?.manifest_progress?.stage_total ?? planningSignal?.total ?? 0;
  const manifestProgressPercent = manifestDiscoveryActive && manifestStageTotal > 0
    ? manifestStageCompleted / manifestStageTotal * 100
    : status?.manifest_progress?.total
      ? status.manifest_progress.completed / status.manifest_progress.total * 100
      : 0;

  return (
    <div className="space-y-5 pb-6">
      <section className="relative overflow-hidden border border-border/70 bg-card px-4 py-5 shadow-sm sm:px-6">
        <div className="pointer-events-none absolute inset-0 opacity-[0.18] [background-image:linear-gradient(to_right,var(--border)_1px,transparent_1px),linear-gradient(to_bottom,var(--border)_1px,transparent_1px)] [background-size:28px_28px]" />
        <div className="relative flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <div className="mb-3 flex items-center gap-2 font-mono text-[10px] font-medium uppercase tracking-[0.18em] text-primary">
              <DownloadCloud className="size-4" aria-hidden="true" />
              Observatory / MAST acquisition node
            </div>
            <h2 className="font-heading text-2xl font-semibold tracking-tight md:text-3xl">Ingestion Control Plane</h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground xl:whitespace-nowrap">
              Điều phối dữ liệu trắc quang FITS từ NASA MAST vào Bronze lakehouse, với checkpoint bền vững và telemetry thời gian thực.
            </p>
          </div>
        </div>
      </section>

      {error && <div className="flex items-start gap-3 border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive"><AlertCircle className="mt-0.5 size-4 shrink-0" /><div><p className="font-medium">Observation link interrupted</p><p className="mt-0.5 text-xs">{error}</p></div></div>}

      <section aria-label="Run summary" className="grid gap-px overflow-hidden border border-border/70 bg-border/70 sm:grid-cols-2 xl:grid-cols-4">
        <Stat icon={Files} label="Products observed" value={`${status?.completed_products ?? 0} / ${status?.total_products ?? 0}`} detail={`${percent}% acquisition complete`} />
        <Stat icon={HardDrive} label="Bronze footprint" value={formatBytes(status?.completed_bytes ?? 0)} detail={`Expected ${formatBytes(status?.expected_bytes ?? 0)}`} />
        <Stat icon={Activity} label="Transfer rate" value={`${(status?.products_per_second ?? 0).toFixed(1)} files/s`} detail={formatRate(status?.bytes_per_second ?? 0, 's')} />
        <Stat icon={Cpu} label="Active workers" value={String(spawnedWorkerCount)} detail={`${status?.queue_depth ?? 0} queued · ${status?.failed_products ?? 0} failed`} />
      </section>

      <section className="grid min-w-0 gap-5 xl:grid-cols-[minmax(0,1.45fr)_minmax(19rem,0.7fr)]">
        <Card className="min-w-0 rounded-none border-border/80 shadow-none"><CardHeader className="border-b border-border/60 pb-4"><div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div><p className="font-mono text-[10px] uppercase tracking-[0.14em] text-primary">Live acquisition / run telemetry</p><CardTitle className="mt-1 text-lg">Bronze capture sequence</CardTitle><CardDescription>Checkpoint-backed execution state; không có số liệu mô phỏng trên trình duyệt.</CardDescription></div>{activeStatus && <Badge variant={statusVariant(activeStatus)} className="w-fit rounded-none font-mono">{activeStatus}</Badge>}</div></CardHeader><CardContent className="space-y-5 p-4 sm:p-5">
          <div className="border border-primary/25 bg-primary/[0.035] p-4 sm:p-5"><div className="mb-3 flex items-end justify-between gap-4"><div><p className="text-xs font-medium text-muted-foreground">Acquisition completion</p><p className="mt-1 font-mono text-3xl font-semibold tracking-tight tabular-nums sm:text-4xl">{percent}<span className="text-lg text-muted-foreground">%</span></p></div><p className="text-right font-mono text-xs text-muted-foreground">{status?.completed_products ?? 0} received<br />{status?.total_products ?? 0} planned</p></div><Progress value={percent} className="h-2" /></div>
          <div className="grid gap-3 sm:grid-cols-2"><div className="border-l-2 border-primary bg-muted/20 p-3"><p className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">Run identifier</p><p className="mt-1 break-all font-mono text-xs text-foreground">{activeJobId}</p></div><div className="border-l-2 border-emerald-500 bg-muted/20 p-3"><p className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">Last checkpoint</p><p className="mt-1 font-mono text-xs text-foreground">{formatDate(status?.updated_at ?? status?.observed_at)}</p></div></div>
          <div>
            <div className="mb-3 flex items-center justify-between gap-3">
              <div><p className="text-sm font-medium">Worker field array</p><p className="text-xs text-muted-foreground">Chỉ hiển thị worker đang thực sự xử lý sản phẩm trong runtime.</p></div>
              <span className="font-mono text-xs text-muted-foreground">{spawnedWorkerCount} spawned</span>
            </div>
            {spawnedWorkerCount === 0 ? (
              <div className="border border-dashed border-border/70 px-3 py-5 text-center text-xs text-muted-foreground">Chưa có worker nào đang tải dữ liệu.</div>
            ) : (
              <div className="space-y-2">
                {Array.from({ length: spawnedWorkerCount }, (_, index) => {
                  const workerId = index + 1;
                  const signal = workerSignals[workerId];
                  const product = downloadingProducts[index];
                  const productId = signal?.productId ?? product?.id;
                  const bytesRead = signal?.bytesRead ?? product?.size_bytes ?? 0;
                  const expectedBytes = signal?.expectedBytes ?? product?.expected_size_bytes ?? 0;
                  const downloadPercent = expectedBytes > 0
                    ? Math.min(100, Math.max(0, Math.round((bytesRead / expectedBytes) * 100)))
                    : 0;
                  return (
                    <div key={`worker-${workerId}`} className="border border-border/70 bg-background/50 px-3 py-3">
                      <div className="grid gap-2 sm:grid-cols-[5.5rem_minmax(0,1fr)_5rem] sm:items-center sm:gap-4">
                        <div className="flex items-center gap-2">
                          <span className="size-2 rounded-full bg-primary animate-pulse" />
                          <span className="font-mono text-xs text-foreground">WORKER-{String(workerId).padStart(2, '0')}</span>
                        </div>
                        <div className="min-w-0">
                          <p className="truncate font-mono text-[11px] text-foreground" title={productId}>{productId ?? 'Awaiting product telemetry'}</p>
                          <div className="mt-2 flex items-center gap-3"><Progress value={downloadPercent} className="h-1.5 flex-1" /><span className="font-mono text-[11px] text-muted-foreground">{productId ? `${downloadPercent}%` : '—'}</span></div>
                        </div>
                        <p className="font-mono text-[10px] text-muted-foreground sm:text-right">{productId ? `${formatTransferBytes(bytesRead)} / ${formatBytes(expectedBytes)}` : 'DOWNLOADING'}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
          <div className="grid gap-3 border-t border-border/60 pt-4 sm:grid-cols-2"><div className="flex gap-2 text-xs text-muted-foreground"><Timer className="size-4 shrink-0 text-primary" /><span>Started <b className="ml-1 font-mono font-medium text-foreground">{formatDate(status?.started_at)}</b></span></div><div className="flex gap-2 text-xs text-muted-foreground"><Wifi className="size-4 shrink-0 text-primary" /><span>{status?.observed ? 'Live download activity available' : 'Awaiting download activity'}</span></div></div>
          {status?.manifest_path && <div className="flex flex-col gap-1 border border-border/70 bg-muted/15 p-3 text-xs sm:flex-row sm:items-center sm:justify-between"><span className="shrink-0 text-muted-foreground">Manifest checkpoint</span><span className="min-w-0 truncate font-mono text-foreground" title={status.manifest_path}>{status.manifest_path}</span></div>}
        </CardContent></Card>

        <Card className="rounded-none border-border/80 shadow-none">
          <CardHeader className="border-b border-border/60 pb-4">
            <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-primary">Control protocol / new run</p>
            <CardTitle className="mt-1 text-lg">Configure acquisition</CardTitle>
            <CardDescription>Thiết lập phạm vi khảo sát và số worker tải song song.</CardDescription>
          </CardHeader>
          <CardContent className="p-4 sm:p-5">
            <form className="space-y-5" onSubmit={handleStart}>
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-1">
                <label htmlFor="sector-input" className="space-y-2 text-xs font-medium text-muted-foreground">
                  <span className="flex items-center justify-between"><span>TESS sector</span><span className="font-mono text-[10px] font-normal">01—100</span></span>
                  <Input id="sector-input" type="number" min="1" max="100" value={sector} onChange={(e) => setSector(e.target.value)} placeholder="1" disabled={controlBusy || isIngesting} className="font-mono" />
                </label>
                <label htmlFor="concurrency-input" className="space-y-2 text-xs font-medium text-muted-foreground">
                  <span className="flex items-center justify-between"><span>Download workers</span><span className="font-mono text-[10px] font-normal">01—32</span></span>
                  <Input id="concurrency-input" type="number" min="1" max="32" value={concurrency} onChange={(e) => setConcurrency(e.target.value)} placeholder="8" disabled={controlBusy || isIngesting} className="font-mono" />
                </label>
              </div>
              <div className="border-y border-border/60 py-3 text-xs text-muted-foreground"><p className="font-mono text-[10px] uppercase tracking-[0.12em] text-primary">Safety envelope</p><p className="mt-1.5 leading-5">Single-flight, checkpointed run. Bronze budget và retry state được kiểm soát bởi ingester.</p></div>
              {activeStatus === 'planning' && (status?.catalog_progress || status?.manifest_progress) && <div className="space-y-3 border-y border-border/60 py-3">
                <div className="flex items-center justify-between gap-3"><p className="font-mono text-[10px] uppercase tracking-[0.12em] text-primary">Planning progress</p><Badge variant="secondary" className="rounded-none font-mono text-[10px]">planning</Badge></div>
                {status?.catalog_progress && <div className="space-y-1.5"><div className="flex items-center justify-between gap-3 text-xs"><span className="font-medium text-foreground">Catalog sync · TIC + TOI</span><span className="font-mono text-muted-foreground">{status.catalog_progress.completed}/{status.catalog_progress.total}</span></div><Progress value={status.catalog_progress.total > 0 ? status.catalog_progress.completed / status.catalog_progress.total * 100 : 0} className="h-1.5" /><p className="truncate font-mono text-[10px] text-muted-foreground" title={status.catalog_progress.stage}>{status.catalog_progress.stage} · TOI {status.catalog_progress.toi_rows.toLocaleString()} · TIC {status.catalog_progress.tic_rows.toLocaleString()}</p>{status.catalog_progress.error && <p className="text-[10px] text-destructive">{status.catalog_progress.error}</p>}</div>}
                {status?.manifest_progress && <div className="space-y-1.5"><div className="flex items-center justify-between gap-3 text-xs"><span className="font-medium text-foreground">Research manifest</span><span className="font-mono text-muted-foreground">{manifestDiscoveryActive && manifestStageTotal > 0 ? `${manifestStageCompleted.toLocaleString()}/${manifestStageTotal.toLocaleString()}` : `${status.manifest_progress.completed}/${status.manifest_progress.total}`}</span></div><Progress value={manifestProgressPercent} className="h-1.5" /><p className="truncate font-mono text-[10px] text-muted-foreground" title={status.manifest_progress.stage}>{status.manifest_progress.stage} · {manifestDiscoveryActive ? `${status.manifest_progress.discovered_products.toLocaleString()} products resolved` : `${status.manifest_progress.selected_samples.toLocaleString()} selected targets`}</p>{manifestDiscoveryActive && <p className="flex items-center gap-1.5 text-[10px] text-muted-foreground"><span className="relative flex size-2"><span className="absolute inline-flex size-2 animate-ping rounded-full bg-primary/70" /><span className="relative inline-flex size-2 rounded-full bg-primary" /></span>MAST query active{planningSignal?.occurredAt ? ` · updated ${formatDate(planningSignal.occurredAt)}` : ''}</p>}{status.manifest_progress.error && <p className="text-[10px] text-destructive">{status.manifest_progress.error}</p>}</div>}
              </div>}
              {isIngesting ? <Button type="button" variant="destructive" className="w-full gap-2" onClick={handleCancel} disabled={controlBusy || isDraining}><Square className="size-4 fill-current" />{isDraining ? 'Đang hoàn tất file hiện tại…' : controlBusy ? 'Đang gửi lệnh dừng...' : 'Dừng acquisition run'}</Button> : <Button type="submit" className="w-full gap-2" disabled={controlBusy}><Play className="size-4 fill-current" />{controlBusy ? 'Đang khởi động...' : 'Launch ingestion run'}</Button>}
              {isDraining && <p className="text-xs leading-5 text-muted-foreground">Đã ngừng nhận file mới. Worker đang hoàn tất và checkpoint các file hiện tại trước khi dừng.</p>}
            </form>
            {activeStatus && <div className="mt-4 grid gap-2 border-t border-border/60 pt-4 text-xs"><div className="flex items-center justify-between gap-3"><span className="text-muted-foreground">Control job</span><span className="max-w-[190px] truncate font-mono text-foreground" title={activeJobId}>{activeJobId}</span></div><div className="flex items-center justify-between"><span className="text-muted-foreground">State</span><Badge variant={statusVariant(activeStatus)}>{activeStatus}</Badge></div></div>}
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-3 md:grid-cols-2"><div className="border border-border/70 bg-card p-4"><p className="font-mono text-[10px] uppercase tracking-[0.14em] text-primary">Sample composition</p><div className="mt-3 grid gap-2 sm:grid-cols-2">{productKinds.map(({ key, label, summary }) => <div key={key} className="border-l-2 border-primary/60 bg-muted/20 px-3 py-2.5"><div className="flex justify-between gap-2 text-xs"><span className="font-medium text-foreground">{label}</span><span className="font-mono text-muted-foreground">{summary?.completed ?? 0}/{summary?.planned ?? 0}</span></div><p className="mt-1 text-[11px] text-muted-foreground">{summary?.downloading ?? 0} active · {summary?.failed ?? 0} failed</p></div>)}</div></div><div className="border border-border/70 bg-card p-4"><p className="font-mono text-[10px] uppercase tracking-[0.14em] text-primary">Acquisition conditions</p><div className="mt-3 grid grid-cols-2 gap-3 text-xs"><div><p className="text-muted-foreground">Source archive</p><p className="mt-1 font-mono text-foreground">{status?.source || 'NASA MAST'}</p></div><div><p className="text-muted-foreground">Checkpoint status</p><p className="mt-1 font-mono text-foreground">{status?.observed ? 'OBSERVED' : 'AWAITING SIGNAL'}</p></div></div></div></section>

      <Card className="overflow-hidden rounded-none border-border/80 shadow-none"><CardHeader className="border-b border-border/60 p-4 sm:p-5"><div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between"><div><p className="font-mono text-[10px] uppercase tracking-[0.14em] text-primary">Evidence ledger / current run</p><CardTitle className="mt-1 text-lg">FITS product observations</CardTitle><CardDescription>Trạng thái checkpoint của từng sản phẩm mục tiêu, có thể lọc theo pha thực thi.</CardDescription></div><div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center"><div className="relative min-w-0 flex-1 sm:w-64"><Search className="absolute left-2.5 top-2.5 size-3.5 text-muted-foreground" /><Input placeholder="Tìm TIC ID hoặc object key..." className="h-8 w-full pl-8 text-xs" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} /></div><div className="flex flex-wrap gap-1 border border-border/60 bg-muted/20 p-1 text-xs">{([['all', `All ${status?.products?.length ?? 0}`], ['completed', 'Complete'], ['downloading', 'Active'], ['failed', 'Failed']] as const).map(([filter, label]) => <button key={filter} type="button" className={`rounded-sm px-2.5 py-1.5 transition-colors ${productFilter === filter ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-background hover:text-foreground'}`} onClick={() => setProductFilter(filter)}>{label}</button>)}</div></div></div></CardHeader><CardContent className="p-0"><div className="overflow-x-auto"><Table className="min-w-[760px]"><TableHeader><TableRow className="hover:bg-transparent"><TableHead className="min-w-[320px] pl-5 font-mono text-[10px] uppercase tracking-wider">Product / FITS file</TableHead><TableHead>Kind</TableHead><TableHead>State</TableHead><TableHead className="text-right">Size</TableHead><TableHead className="text-center">Attempts</TableHead><TableHead className="pr-5 text-right">Observed at</TableHead></TableRow></TableHeader><TableBody>{filteredProducts.length === 0 ? <TableRow><TableCell colSpan={6} className="h-32 text-center text-sm text-muted-foreground">{status?.products?.length === 0 ? 'Chưa có product observation. Khởi chạy run để bắt đầu thu nhận dữ liệu.' : 'Không tìm thấy sản phẩm phù hợp với bộ lọc.'}</TableCell></TableRow> : filteredProducts.slice(0, 50).map((product) => { const ticMatch = product.id.match(/-(\d{8,16})-/); const ticNum = ticMatch ? ticMatch[1].replace(/^0+/, '') : null; return <TableRow key={product.id} className="hover:bg-muted/35"><TableCell className="pl-5 font-mono text-xs"><div className="flex min-w-0 items-center gap-2">{ticNum && <Badge variant="outline" className="shrink-0 rounded-none border-primary/25 bg-primary/10 font-mono text-[10px] text-primary">TIC {ticNum}</Badge>}<span className="truncate" title={product.id}>{product.id}</span></div></TableCell><TableCell><Badge variant="outline" className="rounded-none font-mono text-[10px]">{product.kind}</Badge></TableCell><TableCell><Badge variant={statusVariant(product.state)} className="rounded-none font-mono text-[10px]">{product.state}</Badge>{product.last_error && <p className="mt-1 max-w-[180px] truncate text-[10px] text-destructive" title={product.last_error}>{product.last_error}</p>}</TableCell><TableCell className="text-right font-mono text-xs">{product.size_bytes > 0 || product.expected_size_bytes > 0 ? formatBytes(product.size_bytes > 0 ? product.size_bytes : product.expected_size_bytes) : '—'}</TableCell><TableCell className="text-center font-mono text-xs">{product.attempts}</TableCell><TableCell className="pr-5 text-right font-mono text-xs text-muted-foreground">{formatDate(product.updated_at)}</TableCell></TableRow>; })}</TableBody></Table></div>{filteredProducts.length > 50 && <p className="border-t border-border/60 px-4 py-3 text-center text-xs text-muted-foreground">Đang hiển thị 50 trên tổng số {filteredProducts.length} products quan sát được.</p>}</CardContent></Card>
    </div>
  );
}
