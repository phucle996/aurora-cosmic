import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent, JSX } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertCircle,
  ArrowRight,
  Database,
  DownloadCloud,
  Gauge,
  HardDrive,
  Play,
  RefreshCw,
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
  return (
    <div className="border border-border/60 bg-muted/15 p-4">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Icon className="size-4 text-primary" />
        {label}
      </div>
      <p className="mt-2 font-mono text-xl font-semibold tabular-nums">{value}</p>
      <p className="mt-1 text-xs text-muted-foreground">{detail}</p>
    </div>
  );
}

export default function IngestSection(): JSX.Element {
  const [status, setStatus] = useState<IngestStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [controlJob, setControlJob] = useState<IngestControlJob | null>(null);
  const [sector, setSector] = useState('42');
  const [concurrency, setConcurrency] = useState('8');
  const [controlBusy, setControlBusy] = useState(false);
  const [productFilter, setProductFilter] = useState<'all' | 'completed' | 'downloading' | 'failed'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const loadInFlight = useRef<Promise<void> | null>(null);

  const configuredWorkers = Math.max(1, controlJob?.concurrency ?? (Number(concurrency) || 1));

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
    const timer = window.setInterval(() => {
      void load();
    }, 2000);

    const eventSource = new EventSource(`${apiBase}/v1/events?workflow=ingest`);
    eventSource.addEventListener('workflow', (event) => {
      try {
        const payload = JSON.parse((event as MessageEvent<string>).data) as IngestStatus;
        if (payload && typeof payload === 'object') {
          setStatus((current) => ({ ...current, ...payload, observed: true }));
        }
      } catch {
        // SSE parsing fallback
      }
    });

    return () => {
      window.clearInterval(timer);
      eventSource.close();
    };
  }, [load]);

  const isIngesting = useMemo(() => {
    const s = (status?.status ?? '').toLowerCase();
    const c = (controlJob?.status ?? '').toLowerCase();
    return (
      s === 'running' ||
      s === 'downloading' ||
      s === 'cancelling' ||
      c === 'running' ||
      c === 'cancelling' ||
      (status?.downloading ?? 0) > 0 ||
      (status?.inflight_products ?? 0) > 0
    );
  }, [status?.status, status?.downloading, status?.inflight_products, controlJob?.status]);

  const activeJobId = controlJob?.job_id || status?.control_job_id || status?.run_id || 'active';

  const handleStart = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setControlBusy(true);
    setError(null);
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

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col justify-between gap-4 xl:flex-row xl:items-end">
        <div>
          <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
            <DownloadCloud className="size-4 text-primary" aria-hidden="true" />
            NASA MAST Ingestion Pipeline
          </div>
          <h2 className="font-heading text-2xl font-semibold tracking-tight md:text-3xl">Ingestion Control Plane</h2>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            Điều phối và giám sát tiến trình tải dữ liệu trắc quang FITS từ kho lưu trữ NASA MAST về vùng đệm Bronze.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {isIngesting && (
            <Button
              size="sm"
              onClick={handleCancel}
              disabled={controlBusy}
              className="gap-2 shadow-md shadow-red-600/20 font-semibold bg-red-600 hover:bg-red-700 text-white border-0 animate-pulse"
            >
              <Square className="size-3.5 fill-white text-white" />
              <span className="text-white font-semibold">{controlBusy ? 'Đang dừng...' : 'Dừng Ingest'}</span>
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
            <RefreshCw className={`size-3.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
          <Button asChild size="sm" className="gap-2">
            <Link to="/datasets">
              <Database className="size-4" />
              Explore Datasets (Lakehouse)
              <ArrowRight className="size-3.5" />
            </Link>
          </Button>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
          <AlertCircle className="size-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {(status?.catalog_progress || status?.manifest_progress) && (
        <div className="grid gap-4 xl:grid-cols-2">
          {status?.catalog_progress && (
            <Card className="border-cyan-500/25">
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <CardTitle className="text-base">1 · Catalog Sync · TIC + TOI</CardTitle>
                    <CardDescription>TOI toàn cục và TIC đúng phạm vi target được chọn.</CardDescription>
                  </div>
                  <Badge variant="outline" className="font-mono">{status.catalog_progress.state}</Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span className="font-mono">{status.catalog_progress.stage}</span>
                  <span>{status.catalog_progress.completed}/{status.catalog_progress.total}</span>
                </div>
                <Progress value={status.catalog_progress.total > 0 ? status.catalog_progress.completed / status.catalog_progress.total * 100 : 0} className="h-2" />
                <div className="grid grid-cols-2 gap-3 text-xs">
                  <div>TOI rows: <span className="font-mono">{status.catalog_progress.toi_rows.toLocaleString()}</span></div>
                  <div>TIC rows: <span className="font-mono">{status.catalog_progress.tic_rows.toLocaleString()}</span></div>
                </div>
                {status.catalog_progress.error && <p className="text-xs text-destructive">{status.catalog_progress.error}</p>}
              </CardContent>
            </Card>
          )}

          {status?.manifest_progress && (
            <Card className="border-emerald-500/25">
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <CardTitle className="text-base">2 · Research Manifest Planning</CardTitle>
                    <CardDescription>Dò MAST, ghép TPF + LC, ưu tiên TOI và khóa snapshot catalog.</CardDescription>
                  </div>
                  <Badge variant="outline" className="font-mono">{status.manifest_progress.state}</Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span className="font-mono">{status.manifest_progress.stage}</span>
                  <span>{status.manifest_progress.completed}/{status.manifest_progress.total}</span>
                </div>
                <Progress value={status.manifest_progress.total > 0 ? status.manifest_progress.completed / status.manifest_progress.total * 100 : 0} className="h-2" />
                <div className="grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
                  <div>MAST products<br /><span className="font-mono text-foreground">{status.manifest_progress.discovered_products.toLocaleString()}</span></div>
                  <div>TPF + LC pairs<br /><span className="font-mono text-foreground">{status.manifest_progress.paired_samples.toLocaleString()}</span></div>
                  <div>Selected targets<br /><span className="font-mono text-foreground">{status.manifest_progress.selected_samples.toLocaleString()}</span></div>
                  <div>TOI priority<br /><span className="font-mono text-foreground">{status.manifest_progress.priority_samples.toLocaleString()}</span></div>
                </div>
                {status.manifest_progress.error && <p className="text-xs text-destructive">{status.manifest_progress.error}</p>}
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* Control & Progress Card */}
      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle className="text-base font-semibold">Khởi chạy / Điều khiển Ingest</CardTitle>
            <CardDescription>Cấu hình Sector và số luồng worker tải song song.</CardDescription>
          </CardHeader>
          <CardContent>
            <form className="space-y-4" onSubmit={handleStart}>
              <div className="space-y-2">
                <label htmlFor="sector-input" className="text-xs font-medium text-muted-foreground">
                  TESS Sector
                </label>
                <Input
                  id="sector-input"
                  type="number"
                  min="1"
                  max="100"
                  value={sector}
                  onChange={(e) => setSector(e.target.value)}
                  placeholder="42"
                  disabled={controlBusy || isIngesting}
                />
              </div>
              <div className="space-y-2">
                <label htmlFor="concurrency-input" className="text-xs font-medium text-muted-foreground">
                  Concurrency (Số luồng)
                </label>
                <Input
                  id="concurrency-input"
                  type="number"
                  min="1"
                  max="32"
                  value={concurrency}
                  onChange={(e) => setConcurrency(e.target.value)}
                  placeholder="8"
                  disabled={controlBusy || isIngesting}
                />
              </div>
              <div className="flex items-center gap-2 pt-2">
                {isIngesting ? (
                  <Button
                    type="button"
                    className="w-full gap-2 font-semibold bg-red-600 hover:bg-red-700 text-white shadow-md shadow-red-600/30 border-0"
                    onClick={handleCancel}
                    disabled={controlBusy}
                  >
                    <Square className="size-4 fill-white text-white shrink-0" />
                    <span className="text-white font-semibold">
                      {controlBusy ? 'Đang gửi lệnh dừng...' : 'Dừng Quá Trình Ingest (Stop)'}
                    </span>
                  </Button>
                ) : (
                  <Button type="submit" className="w-full gap-2" disabled={controlBusy}>
                    <Play className="size-4 fill-current" />
                    {controlBusy ? 'Đang khởi động...' : 'Bắt đầu Ingest'}
                  </Button>
                )}
              </div>
            </form>

            {(controlJob || isIngesting) && (
              <div className="mt-4 border-t border-border/60 pt-4 text-xs space-y-1">
                <div className="flex justify-between text-muted-foreground">
                  <span>Job ID:</span>
                  <span className="font-mono text-foreground truncate max-w-[160px]">{activeJobId}</span>
                </div>
                <div className="flex justify-between text-muted-foreground">
                  <span>Trạng thái:</span>
                  <Badge variant={statusVariant(controlJob?.status || status?.status || 'running')}>
                    {controlJob?.status || status?.status || 'running'}
                  </Badge>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Progress & Live Telemetry */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-base font-semibold">Tiến độ & Thông lượng tải</CardTitle>
                <CardDescription>Trạng thái thực thi và dữ liệu telemetry nhận từ NATS/Prometheus.</CardDescription>
              </div>
              <div className="flex items-center gap-2">
                {isIngesting && (
                  <Button
                    type="button"
                    size="sm"
                    className="gap-1.5 h-7 px-2.5 text-xs font-semibold bg-red-600 hover:bg-red-700 text-white shadow-sm border-0"
                    onClick={handleCancel}
                    disabled={controlBusy}
                  >
                    <Square className="size-3 fill-white text-white shrink-0" />
                    <span className="text-white font-semibold">{controlBusy ? 'Đang dừng...' : 'Dừng Ingest'}</span>
                  </Button>
                )}
                <Badge variant={statusVariant(status?.status ?? 'idle')}>
                  {status?.status ?? 'not_observed'}
                </Badge>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-2">
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>Tiến độ hoàn thành: {status?.completed_products ?? 0} / {status?.total_products ?? 0} tệp</span>
                <span className="font-mono font-medium text-foreground">{percent}%</span>
              </div>
              <Progress value={percent} className="h-2" />
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <Stat
                icon={Gauge}
                label="Throughput"
                value={`${(status?.products_per_second ?? 0).toFixed(1)} /s`}
                detail={formatRate(status?.bytes_per_second ?? 0, 's')}
              />
              <Stat
                icon={HardDrive}
                label="Dung lượng tải"
                value={formatBytes(status?.completed_bytes ?? 0)}
                detail={`Dự kiến: ${formatBytes(status?.expected_bytes ?? 0)}`}
              />
              <Stat
                icon={Timer}
                label="Queue Depth"
                value={String(status?.queue_depth ?? 0)}
                detail={`${status?.inflight_products ?? 0} đang tải`}
              />
              <Stat
                icon={Wifi}
                label="Active Workers"
                value={String(configuredWorkers)}
                detail={`Lỗi: ${status?.failed_products ?? 0}`}
              />
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              {productKinds.map(({ key, label, summary }) => <div key={key} className="rounded-md border border-border/60 bg-muted/15 px-3 py-2.5 text-xs"><div className="flex items-center justify-between gap-2"><span className="font-medium text-foreground">{label}</span><span className="font-mono text-muted-foreground">{summary?.completed ?? 0}/{summary?.planned ?? 0}</span></div><p className="mt-1 text-muted-foreground">{summary?.downloading ?? 0} đang tải · {summary?.failed ?? 0} lỗi</p></div>)}
            </div>

            {status?.manifest_path && (
              <div className="flex items-center justify-between rounded-md bg-muted/20 px-3 py-2 text-xs">
                <span className="text-muted-foreground">Manifest Checkpoint:</span>
                <span className="font-mono text-foreground truncate max-w-[320px]">{status.manifest_path}</span>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Product Execution Table */}
      <Card>
        <CardHeader>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle className="text-base font-semibold">Danh sách tệp FITS trong đợt Ingest</CardTitle>
              <CardDescription>Chi tiết trạng thái tải của từng cặp sản phẩm mục tiêu (Light Curve + TPF).</CardDescription>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 size-3.5 text-muted-foreground" />
                <Input
                  placeholder="Tìm TIC ID hoặc Object Key..."
                  className="h-8 w-48 pl-8 text-xs sm:w-64"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>
              <div className="flex items-center rounded-md border border-border/60 bg-muted/20 p-0.5 text-xs">
                <button
                  type="button"
                  className={`px-2.5 py-1 rounded-sm ${productFilter === 'all' ? 'bg-primary text-primary-foreground font-medium' : 'text-muted-foreground hover:text-foreground'}`}
                  onClick={() => setProductFilter('all')}
                >
                  Tất cả ({status?.products?.length ?? 0})
                </button>
                <button
                  type="button"
                  className={`px-2.5 py-1 rounded-sm ${productFilter === 'completed' ? 'bg-primary text-primary-foreground font-medium' : 'text-muted-foreground hover:text-foreground'}`}
                  onClick={() => setProductFilter('completed')}
                >
                  Hoàn thành
                </button>
                <button
                  type="button"
                  className={`px-2.5 py-1 rounded-sm ${productFilter === 'downloading' ? 'bg-primary text-primary-foreground font-medium' : 'text-muted-foreground hover:text-foreground'}`}
                  onClick={() => setProductFilter('downloading')}
                >
                  Đang tải
                </button>
                <button
                  type="button"
                  className={`px-2.5 py-1 rounded-sm ${productFilter === 'failed' ? 'bg-primary text-primary-foreground font-medium' : 'text-muted-foreground hover:text-foreground'}`}
                  onClick={() => setProductFilter('failed')}
                >
                  Lỗi
                </button>
              </div>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table className="w-full">
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="w-auto min-w-[320px] pl-4">Mã sản phẩm (ID / FITS File)</TableHead>
                  <TableHead className="w-[130px]">Loại</TableHead>
                  <TableHead className="w-[130px]">Trạng thái</TableHead>
                  <TableHead className="w-[120px] text-right">Dung lượng</TableHead>
                  <TableHead className="w-[90px] text-center">Số lần thử</TableHead>
                  <TableHead className="w-[180px] text-right pr-4">Cập nhật lần cuối</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredProducts.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="h-32 text-center text-sm text-muted-foreground">
                      {status?.products?.length === 0
                        ? 'Chưa có sản phẩm nào trong phiên làm việc hiện tại. Hãy bấm "Bắt đầu Ingest" để chạy.'
                        : 'Không tìm thấy sản phẩm phù hợp với bộ lọc.'}
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredProducts.slice(0, 50).map((product) => {
                    const ticMatch = product.id.match(/-(\d{8,16})-/);
                    const ticNum = ticMatch ? ticMatch[1].replace(/^0+/, '') : null;
                    return (
                      <TableRow key={product.id} className="hover:bg-muted/40">
                        <TableCell className="font-mono text-xs font-medium pl-4">
                          <div className="flex items-center gap-2">
                            {ticNum && (
                              <Badge
                                variant="outline"
                                className="font-mono text-[10px] bg-primary/10 text-primary border-primary/25 shrink-0"
                              >
                                TIC {ticNum}
                              </Badge>
                            )}
                            <span className="text-foreground select-all break-all" title={product.id}>
                              {product.id}
                            </span>
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className="text-[11px] font-mono">
                            {product.kind}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Badge variant={statusVariant(product.state)}>
                            {product.state}
                          </Badge>
                        </TableCell>
                        <TableCell className="font-mono text-xs text-right">
                          {product.size_bytes > 0 || product.expected_size_bytes > 0
                            ? formatBytes(product.size_bytes > 0 ? product.size_bytes : product.expected_size_bytes)
                            : '—'}
                        </TableCell>
                        <TableCell className="font-mono text-xs text-center">{product.attempts}</TableCell>
                        <TableCell className="text-xs text-muted-foreground text-right pr-4 font-mono">
                          {formatDate(product.updated_at)}
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>
          {filteredProducts.length > 50 && (
            <p className="mt-3 text-center text-xs text-muted-foreground">
              Đang hiển thị 50 trên tổng số {filteredProducts.length} sản phẩm.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
