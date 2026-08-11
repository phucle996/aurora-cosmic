import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent, JSX } from 'react';
import {
  AlertCircle,
  Database,
  DownloadCloud,
  Files,
  Gauge,
  HardDrive,
  ChevronLeft,
  ChevronRight,
  RefreshCw,
  Square,
  Play,
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
};

type StorageObject = { key: string; size_bytes: number; etag?: string; last_modified: string };
type StorageListing = { bucket: string; prefix: string; page: number; page_size: number; total: number; total_bytes: number; truncated: boolean; objects: StorageObject[] };
type IngestControlJob = { job_id: string; status: string; sector?: number; concurrency?: number; manifest_path?: string; started_at: string; updated_at: string; error?: string };

const prefixes = ['bronze/', 'silver/', 'gold/', 'checkpoints/'];

function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '—';
  if (value < 1024) return `${value} B`;
  if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 ** 3) return `${(value / 1024 ** 2).toFixed(1)} MB`;
  return `${(value / 1024 ** 3).toFixed(2)} GB`;
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
  if (status === 'running' || status === 'downloading') return 'secondary';
  return 'outline';
}

function Stat({ icon: Icon, label, value, detail }: { icon: typeof Gauge; label: string; value: string; detail: string }): JSX.Element {
  return <div className="border border-border/60 bg-muted/15 p-4"><div className="flex items-center gap-2 text-xs text-muted-foreground"><Icon className="size-4 text-primary" />{label}</div><p className="mt-2 font-mono text-xl font-semibold tabular-nums">{value}</p><p className="mt-1 text-xs text-muted-foreground">{detail}</p></div>;
}

export default function IngestStorageSection(): JSX.Element {
  const [status, setStatus] = useState<IngestStatus | null>(null);
  const [storage, setStorage] = useState<StorageListing | null>(null);
  const [prefix, setPrefix] = useState('bronze/');
  const [customPrefix, setCustomPrefix] = useState('bronze/');
  const [storagePage, setStoragePage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [controlJob, setControlJob] = useState<IngestControlJob | null>(null);
  const [sector, setSector] = useState('42');
  const [concurrency, setConcurrency] = useState('8');
  const [controlBusy, setControlBusy] = useState(false);
  const loadInFlight = useRef<Promise<void> | null>(null);
  const storageRef = useRef<StorageListing | null>(null);
  const lastStorageRefresh = useRef(0);
  const configuredWorkers = Math.max(1, controlJob?.concurrency ?? (Number(concurrency) || 1));

  const storagePageSize = 50;
  const load = useCallback((forceStorage = false) => {
    if (loadInFlight.current) return loadInFlight.current;
    const request = (async () => {
      setError(null);
      setLoading(true);
      try {
        const cachedStorage = storageRef.current;
        const refreshStorage = forceStorage || !cachedStorage || cachedStorage.prefix !== prefix || cachedStorage.page !== storagePage || Date.now() - lastStorageRefresh.current >= 15_000;
        const storageRequest: Promise<StorageListing> = refreshStorage
          ? apiFetch<StorageListing>(`/v1/storage?prefix=${encodeURIComponent(prefix)}&page=${storagePage}&limit=${storagePageSize}`)
          : Promise.resolve(cachedStorage);
        const [nextStatus, nextStorage] = await Promise.all([
          apiFetch<IngestStatus>('/v1/ingest/status?products_limit=100'),
          storageRequest,
        ]);
        setStatus(nextStatus);
        // The control job lives on the API/ingester, not in browser state.
        // Hydrate it from the authoritative status response so a page refresh
        // cannot expose a second Start button while a run is still active.
        const controlJobID = nextStatus.control_job_id;
        if (controlJobID) {
          setControlJob((previous) => ({
            job_id: controlJobID,
            status: nextStatus.status,
            manifest_path: nextStatus.manifest_path,
            started_at: nextStatus.started_at ?? previous?.started_at ?? new Date().toISOString(),
            updated_at: nextStatus.updated_at ?? previous?.updated_at ?? new Date().toISOString(),
            concurrency: previous?.job_id === controlJobID ? previous.concurrency : undefined,
            error: nextStatus.error,
          }));
        } else if (nextStatus.status !== 'running' && nextStatus.status !== 'cancelling') {
          setControlJob((previous) => (previous && (previous.status === 'running' || previous.status === 'cancelling') ? null : previous));
        }
        if (refreshStorage) {
          storageRef.current = nextStorage;
          lastStorageRefresh.current = Date.now();
          setStorage(nextStorage);
        }
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : 'Không thể tải trạng thái ingest/storage');
      } finally {
        setLoading(false);
      }
    })();
    loadInFlight.current = request;
    void request.finally(() => {
      if (loadInFlight.current === request) loadInFlight.current = null;
    });
    return request;
  }, [prefix, storagePage]);

  useEffect(() => {
    void load(true);
    const eventSource = new EventSource(`${apiBase}/v1/events?workflow=ingest`);
    eventSource.addEventListener('workflow', (event) => {
      try {
        const update = JSON.parse((event as MessageEvent<string>).data) as { payload?: IngestControlJob };
        if (update.payload?.job_id) setControlJob(update.payload);
      } catch {
        // The next authoritative status request will recover from malformed data.
      }
      void load(true);
    });
    const timer = window.setInterval(() => void load(), 5_000);
    return () => { window.clearInterval(timer); eventSource.close(); };
  }, [load]);

  const progress = useMemo(() => {
    if (!status || status.total_products <= 0) return 0;
    return Math.min(100, (status.completed_products / status.total_products) * 100);
  }, [status]);

  function selectPrefix(next: string): void {
    setPrefix(next);
    setCustomPrefix(next);
    setStoragePage(1);
  }

  function submitCustomPrefix(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const next = customPrefix.trim() || 'bronze/';
    setPrefix(next.endsWith('/') ? next : `${next}/`);
    setStoragePage(1);
  }

  async function startIngest(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setControlBusy(true);
    setError(null);
    try {
      const job = await apiFetch<IngestControlJob>('/v1/ingest/jobs', { method: 'POST', body: JSON.stringify({ sector: Number(sector), concurrency: Number(concurrency) }) });
      setControlJob(job);
      await load(true);
    } catch (controlError) {
      setError(controlError instanceof Error ? controlError.message : 'Không thể bắt đầu ingest');
    } finally {
      setControlBusy(false);
    }
  }

  async function cancelIngest(): Promise<void> {
    if (!controlJob?.job_id) return;
    setControlBusy(true);
    try {
      const job = await apiFetch<IngestControlJob>(`/v1/ingest/jobs/${encodeURIComponent(controlJob.job_id)}/cancel`, { method: 'POST' });
      setControlJob(job);
    } catch (controlError) {
      setError(controlError instanceof Error ? controlError.message : 'Không thể hủy ingest');
    } finally {
      setControlBusy(false);
    }
  }

  const ingestIsRunning = controlJob?.status === 'running' || controlJob?.status === 'cancelling' || (status?.status === 'running' && Boolean(status.control_job_id));

  return <div className="space-y-6">
    <div className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
      <div>
        <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground"><DownloadCloud className="size-4 text-primary" />Operational data plane</div>
        <h2 className="font-heading text-2xl font-semibold tracking-tight md:text-3xl">Ingest &amp; Storage</h2>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">Theo dõi tiến độ tải dữ liệu vào Bronze và kiểm tra object thật trong MinIO cùng một màn hình.</p>
      </div>
    </div>

    {error && <div className="flex items-start gap-3 border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive"><AlertCircle className="mt-0.5 size-4 shrink-0" /><div><p className="font-medium">Không tải được ingest/storage state</p><p className="mt-1 opacity-90">{error}</p></div></div>}

    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <Stat icon={Files} label="Products" value={status ? `${status.completed_products}/${status.total_products}` : '—'} detail="Stored or published" />
      <Stat icon={HardDrive} label="Downloaded" value={status ? formatBytes(status.completed_bytes) : '—'} detail={status ? `of ${formatBytes(status.expected_bytes)}` : 'Checkpoint not observed'} />
      <Stat icon={Wifi} label="Throughput" value={status ? formatRate(status.bytes_per_second, 's') : '—'} detail={status ? `${status.products_per_second.toFixed(2)} products/s` : 'Prometheus telemetry'} />
      <Stat icon={Gauge} label="Workers / queue" value={status ? `${status.inflight_products.toFixed(0)} / ${status.queue_depth.toFixed(0)}` : '—'} detail="In-flight products / queued" />
    </div>

    <Card className="rounded-md"><CardHeader className="border-b border-border/60"><div className="flex items-start justify-between gap-3"><div><CardTitle>Ingest controls</CardTitle><CardDescription>Start MAST → MinIO Bronze discovery. No product-count limit is sent; the 50 GB Bronze run budget remains the safety boundary.</CardDescription></div>{(controlJob || status?.status) && <Badge variant={statusVariant(controlJob?.status ?? status?.status ?? 'not_observed')}>{controlJob?.status ?? status?.status}</Badge>}</div></CardHeader><CardContent className="pt-5"><form className="grid gap-3 md:grid-cols-[1fr_1fr_auto]" onSubmit={startIngest}><label className="space-y-1 text-xs text-muted-foreground">Sector<Input type="number" min={1} value={sector} onChange={(event) => setSector(event.target.value)} /></label><label className="space-y-1 text-xs text-muted-foreground">Download workers<Input type="number" min={1} max={64} value={concurrency} onChange={(event) => setConcurrency(event.target.value)} /></label><div className="flex items-end gap-2">{ingestIsRunning && controlJob?.job_id ? <Button type="button" variant="destructive" onClick={() => void cancelIngest()} disabled={controlBusy}><Square />{controlJob.status === 'cancelling' ? 'Cancelling…' : 'Cancel ingest'}</Button> : <Button type="submit" disabled={controlBusy || ingestIsRunning}><Play />{ingestIsRunning ? 'Ingest running…' : controlBusy ? 'Starting…' : 'Start ingest'}</Button>}</div></form>{(controlJob?.error || status?.error) && <p className="mt-3 text-xs text-destructive">{controlJob?.error || status?.error}</p>}<p className="mt-3 text-xs text-muted-foreground">The run is single-flight and checkpointed in MinIO. Progress below is read from the durable checkpoint, not simulated in the browser.</p></CardContent></Card>

    <div className="grid min-w-0 gap-6 2xl:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
      <Card className="min-w-0 h-[620px] rounded-md">
        <CardHeader className="border-b border-border/60"><div className="flex items-start justify-between gap-3"><div><CardTitle>Ingest progress</CardTitle><CardDescription>Durable checkpoint state from MinIO</CardDescription></div><Badge variant={statusVariant(status?.status ?? 'not_observed')}>{status?.status ?? 'not observed'}</Badge></div></CardHeader>
        <CardContent className="h-[540px] space-y-5 overflow-x-hidden overflow-y-auto pt-5">
          {status?.observed ? <>
            <div><div className="mb-2 flex justify-between text-xs"><span className="text-muted-foreground">Product completion</span><span className="font-mono tabular-nums">{progress.toFixed(1)}%</span></div><Progress value={progress} className="h-2" /></div>
            <div className="grid gap-3 sm:grid-cols-2"><div className="border border-border/60 bg-muted/15 p-3"><p className="text-xs text-muted-foreground">Run ID</p><p className="mt-1 break-all font-mono text-xs">{status.run_id}</p></div><div className="border border-border/60 bg-muted/15 p-3"><p className="text-xs text-muted-foreground">Manifest</p><p className="mt-1 break-all font-mono text-xs">{status.manifest_path || '—'}</p></div></div>
            <div><div className="mb-2 flex items-center justify-between"><p className="text-xs font-medium uppercase tracking-[0.1em] text-muted-foreground">Download worker slots</p><span className="font-mono text-xs text-muted-foreground">{Math.min(configuredWorkers, Math.round(status.inflight_products))}/{configuredWorkers} active</span></div><div className="grid grid-cols-2 gap-2 lg:grid-cols-4">{Array.from({ length: configuredWorkers }, (_, index) => { const active = index < Math.round(status.inflight_products); const queued = !active && index < Math.round(status.inflight_products + status.queue_depth); return <div key={index} className="border border-border/60 bg-muted/15 p-3"><div className="flex items-center justify-between text-xs"><span className="font-mono">worker-{index + 1}</span><Badge variant={active ? 'secondary' : queued ? 'outline' : 'outline'}>{active ? 'downloading' : queued ? 'queued' : 'idle'}</Badge></div><Progress value={active ? 100 : 0} className="mt-3 h-1.5" /><p className="mt-2 text-[11px] text-muted-foreground">{active ? 'Active download slot' : queued ? 'Waiting in queue' : 'Available'}</p></div>; })}</div><p className="mt-2 text-[11px] text-muted-foreground">Slot state is derived from the live inflight and queue gauges; product-level truth remains in the checkpoint table below.</p></div>
            <div className="grid gap-3 sm:grid-cols-2"><div className="flex items-center gap-2 text-xs text-muted-foreground"><Timer className="size-4" />Started {formatDate(status.started_at)}</div><div className="flex items-center gap-2 text-xs text-muted-foreground"><RefreshCw className="size-4" />Updated {formatDate(status.updated_at)}</div></div>
            {status.source === 'api-runtime' && status.total_products === 0 && status.status === 'running' && <div className="border border-primary/30 bg-primary/5 p-3 text-xs text-muted-foreground">Đã dispatch tới ingester. Đang discovery MAST và chờ checkpoint đầu tiên; progress sẽ chuyển sang số liệu download thật ngay khi sản phẩm được lập kế hoạch.</div>}
            {status.error && <div className="border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">{status.error}</div>}
            {status.failed_products > 0 && <div className="border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">{status.failed_products} product(s) failed. Open the product table below to inspect retry/error details.</div>}
          </> : <div className="border border-dashed border-border/60 p-8 text-center text-sm text-muted-foreground">Chưa quan sát được checkpoint ingestion. Chạy một ingest run để progress xuất hiện tại đây.</div>}
        </CardContent>
      </Card>

      <Card className="min-w-0 h-[620px] rounded-md">
        <CardHeader className="border-b border-border/60"><div className="flex items-start justify-between gap-3"><div><CardTitle>Storage browser</CardTitle><CardDescription>{storage?.bucket || 'aurora'} / {storage?.prefix || prefix} · {formatBytes(storage?.total_bytes ?? 0)}</CardDescription></div><Badge variant="outline">{storage?.total ?? 0} objects</Badge></div></CardHeader>
        <CardContent className="h-[540px] space-y-4 overflow-x-hidden overflow-y-auto pt-5">
          <div className="flex flex-wrap gap-2">{prefixes.map((item) => <Button key={item} variant={prefix === item ? 'secondary' : 'outline'} size="sm" onClick={() => selectPrefix(item)}><Database />{item}</Button>)}</div>
          <form className="flex gap-2" onSubmit={submitCustomPrefix}><Input value={customPrefix} onChange={(event) => setCustomPrefix(event.target.value)} placeholder="bronze/tess/..." /><Button type="submit" variant="outline">Open prefix</Button></form>
          <div className="h-[360px] overflow-auto border border-border/60"><Table><TableHeader><TableRow><TableHead>Object key</TableHead><TableHead>Size</TableHead><TableHead>Modified</TableHead></TableRow></TableHeader><TableBody>{loading && !storage ? <TableRow><TableCell colSpan={3} className="h-24 text-center text-sm text-muted-foreground">Loading storage…</TableCell></TableRow> : storage?.objects.length ? storage.objects.map((object) => <TableRow key={object.key}><TableCell className="max-w-[420px] truncate font-mono text-xs" title={object.key}>{object.key}</TableCell><TableCell className="font-mono text-xs">{formatBytes(object.size_bytes)}</TableCell><TableCell className="whitespace-nowrap text-xs text-muted-foreground">{formatDate(object.last_modified)}</TableCell></TableRow>) : <TableRow><TableCell colSpan={3} className="h-24 text-center text-sm text-muted-foreground">No objects under this prefix.</TableCell></TableRow>}</TableBody></Table></div>
          <div className="flex items-center justify-between border-t border-border/60 pt-3"><span className="text-xs text-muted-foreground">Page {storage?.page ?? storagePage} · {storage?.objects.length ?? 0} shown of {storage?.total ?? 0}</span><div className="flex gap-2"><Button size="sm" variant="outline" disabled={storagePage <= 1 || loading} onClick={() => setStoragePage((page) => Math.max(1, page - 1))}><ChevronLeft />Previous</Button><Button size="sm" variant="outline" disabled={!storage?.truncated || loading} onClick={() => setStoragePage((page) => page + 1)}>Next<ChevronRight /></Button></div></div>
        </CardContent>
      </Card>
    </div>

    <Card className="rounded-md"><CardHeader className="border-b border-border/60"><CardTitle className="text-base">Products in current run</CardTitle><CardDescription>{status?.products_truncated ? 'Showing the latest 100 checkpoint products to keep live progress responsive.' : 'Checkpoint product state, object key and retry information.'}</CardDescription></CardHeader><CardContent className="p-0"><div className="max-h-[360px] overflow-auto"><Table><TableHeader><TableRow><TableHead>Product</TableHead><TableHead>Kind</TableHead><TableHead>State</TableHead><TableHead>Object key</TableHead><TableHead>Attempts</TableHead><TableHead>Updated</TableHead></TableRow></TableHeader><TableBody>{status?.products?.length ? status.products.map((product) => <TableRow key={product.id}><TableCell className="font-mono text-xs">{product.id}</TableCell><TableCell className="text-xs">{product.kind || '—'}</TableCell><TableCell><Badge variant={statusVariant(product.state)}>{product.state}</Badge>{product.last_error && <p className="mt-1 max-w-[220px] truncate text-[11px] text-destructive" title={product.last_error}>{product.last_error}</p>}</TableCell><TableCell className="max-w-[380px] truncate font-mono text-xs" title={product.object_key}>{product.object_key || '—'}</TableCell><TableCell className="font-mono text-xs">{product.attempts}</TableCell><TableCell className="whitespace-nowrap text-xs text-muted-foreground">{formatDate(product.updated_at)}</TableCell></TableRow>) : <TableRow><TableCell colSpan={6} className="h-24 text-center text-sm text-muted-foreground">No product checkpoint data.</TableCell></TableRow>}</TableBody></Table></div></CardContent></Card>
  </div>;
}
