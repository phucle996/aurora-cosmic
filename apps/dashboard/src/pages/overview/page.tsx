import { useCallback, useEffect, useState } from 'react';
import type { JSX } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, RefreshCw } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { apiFetch } from '@/lib/api';
import { cn } from '@/lib/utils';

type MonitoringPoint = { timestamp: number; value: number };
type MonitoringMetric = {
  key: string;
  name: string;
  unit: string;
  kind: string;
  points: MonitoringPoint[];
};
type MonitoringComponent = {
  id: string;
  name: string;
  group: string;
  container: string;
  status: 'up' | 'degraded' | 'no_data';
  metrics: MonitoringMetric[];
};
type MonitoringResponse = { components: MonitoringComponent[] };
type SystemResponse = {
  status: 'HEALTHY' | 'DEGRADED';
  version: string;
  goroutines: number;
  alloc_bytes: number;
  uptime_sec: number;
  subsystems: Record<string, string>;
};
type IngestStatus = {
  observed: boolean;
  status: string;
  total_products: number;
  completed_products: number;
  failed_products: number;
  completed_bytes: number;
  queue_depth: number;
  observed_at?: string;
};
type StorageResponse = { total: number; total_bytes: number };
type CountResponse = { count: number };
type OverviewState = {
  system: SystemResponse | null;
  monitoring: MonitoringResponse | null;
  ingest: IngestStatus | null;
  storage: StorageResponse | null;
  targets: CountResponse | null;
};
type ServiceTone = 'healthy' | 'partial' | 'silent';

const emptyState: OverviewState = {
  system: null,
  monitoring: null,
  ingest: null,
  storage: null,
  targets: null,
};

const serviceMeta: Record<string, { role: string; runtime: string }> = {
  'go-ingester': { role: 'MAST acquisition', runtime: 'Go' },
  'rust-preprocessor': { role: 'Signal preparation', runtime: 'Rust' },
  'python-ml-worker': { role: 'Model training', runtime: 'Python · CUDA' },
  'rust-inference': { role: 'GPU inference', runtime: 'Rust · CUDA' },
  'go-api': { role: 'Query gateway', runtime: 'Go' },
  minio: { role: 'Object storage', runtime: 'S3' },
  nats: { role: 'Event backbone', runtime: 'JetStream' },
  clickhouse: { role: 'Analytics store', runtime: 'ClickHouse' },
};

async function optionalFetch<T>(path: string): Promise<T | null> {
  try {
    return await apiFetch<T>(path);
  } catch {
    return null;
  }
}

function formatBytes(value?: number): string {
  if (value === undefined || !Number.isFinite(value)) return '—';
  if (value === 0) return '0 B';
  if (value < 1024) return `${value.toFixed(0)} B`;
  if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 ** 3) return `${(value / 1024 ** 2).toFixed(1)} MB`;
  return `${(value / 1024 ** 3).toFixed(2)} GB`;
}

function formatUptime(seconds?: number): string {
  if (seconds === undefined || !Number.isFinite(seconds)) return '—';
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function formatMetric(value: number, unit: string): string {
  if (!Number.isFinite(value)) return '—';
  const normalized = unit.toLowerCase();
  if (normalized.includes('byte')) return formatBytes(value);
  if (normalized.includes('percent') || unit === '%') return `${value.toFixed(1)}%`;
  if (Math.abs(value) >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (Math.abs(value) >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return value.toFixed(Number.isInteger(value) ? 0 : 2);
}

function componentTone(status?: MonitoringComponent['status']): ServiceTone {
  if (status === 'up') return 'healthy';
  if (status === 'degraded') return 'partial';
  return 'silent';
}

function toneLabel(tone: ServiceTone): string {
  if (tone === 'healthy') return 'Healthy';
  if (tone === 'partial') return 'Partial telemetry';
  return 'No telemetry';
}

function StatusDot({ tone }: { tone: ServiceTone }): JSX.Element {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'inline-block size-1.5 shrink-0 rounded-full',
        tone === 'healthy' && 'bg-emerald-400',
        tone === 'partial' && 'bg-amber-400',
        tone === 'silent' && 'bg-slate-500',
      )}
    />
  );
}

function StatusBadge({ tone }: { tone: ServiceTone }): JSX.Element {
  return (
    <Badge
      variant="outline"
      className={cn(
        'h-6 rounded-sm px-2 font-normal',
        tone === 'healthy' && 'border-emerald-400/25 bg-emerald-400/5 text-emerald-300',
        tone === 'partial' && 'border-amber-400/25 bg-amber-400/5 text-amber-300',
        tone === 'silent' && 'border-border bg-muted/20 text-muted-foreground',
      )}
    >
      <StatusDot tone={tone} />
      {toneLabel(tone)}
    </Badge>
  );
}

function SummaryItem({ label, value, detail }: { label: string; value: string; detail: string }): JSX.Element {
  return (
    <div className="min-w-0 border-border/60 px-4 py-4 even:border-l [&:nth-child(n+3)]:border-t xl:border-l xl:border-t-0 xl:px-5 xl:first:border-l-0">
      <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">{label}</p>
      <p className="mt-2 font-mono text-xl font-medium tracking-tight tabular-nums text-foreground">{value}</p>
      <p className="mt-1 truncate text-xs text-muted-foreground">{detail}</p>
    </div>
  );
}

function latestSignal(component: MonitoringComponent): { name: string; value: string } {
  for (const metric of component.metrics) {
    if (metric.points.length > 0) {
      const point = metric.points[metric.points.length - 1];
      return { name: metric.name, value: formatMetric(point.value, metric.unit) };
    }
  }
  return { name: 'Awaiting samples', value: '—' };
}

function subsystemTone(value?: string): ServiceTone {
  if (!value) return 'silent';
  const normalized = value.toLowerCase();
  return normalized === 'up' || normalized === 'ready' || normalized === 'healthy' ? 'healthy' : 'partial';
}

export default function OverviewPage(): JSX.Element {
  const [data, setData] = useState<OverviewState>(emptyState);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const load = useCallback(async (manual = false): Promise<void> => {
    if (manual) setRefreshing(true);
    const [system, monitoring, ingest, storage, targets] = await Promise.all([
      optionalFetch<SystemResponse>('/v1/system'),
      optionalFetch<MonitoringResponse>('/v1/monitoring?tab=all&range=15m&step=60'),
      optionalFetch<IngestStatus>('/v1/ingest/status?products_limit=1'),
      optionalFetch<StorageResponse>('/v1/storage?prefix=bronze%2F&page=1&limit=1'),
      optionalFetch<CountResponse>('/v1/targets?limit=1'),
    ]);
    setData({ system, monitoring, ingest, storage, targets });
    setLastUpdated(new Date());
    setLoading(false);
    setRefreshing(false);
  }, []);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 15_000);
    return () => window.clearInterval(timer);
  }, [load]);

  const components = data.monitoring?.components ?? [];
  const healthyServices = components.filter((component) => component.status === 'up').length;
  const partialServices = components.filter((component) => component.status === 'degraded').length;
  const silentServices = components.filter((component) => component.status === 'no_data').length;
  const apiHealthy = data.system?.status === 'HEALTHY';
  const fleetTone: ServiceTone = silentServices > 0 ? 'silent' : partialServices > 0 ? 'partial' : components.length > 0 ? 'healthy' : 'silent';
  const ingestProgress = data.ingest && data.ingest.total_products > 0
    ? Math.min(100, (data.ingest.completed_products / data.ingest.total_products) * 100)
    : 0;

  const componentById = (id: string): MonitoringComponent | undefined => components.find((component) => component.id === id);
  const pipeline = [
    { id: 'go-ingester', step: '01', label: 'Acquire', detail: 'MAST → FITS' },
    { id: 'minio', step: '02', label: 'Bronze', detail: 'Raw object storage' },
    { id: 'rust-preprocessor', step: '03', label: 'Prepare', detail: 'Silver light curves' },
    { id: 'python-ml-worker', step: '04', label: 'Learn', detail: 'Training jobs' },
    { id: 'rust-inference', step: '05', label: 'Score', detail: 'Gold predictions' },
  ];

  const platformRows = [
    { label: 'API gateway', detail: `v${data.system?.version ?? '—'}`, tone: apiHealthy ? 'healthy' as const : 'silent' as const },
    { label: 'MinIO', detail: data.system?.subsystems?.storage_minio ?? 'No readiness data', tone: subsystemTone(data.system?.subsystems?.storage_minio) },
    { label: 'ClickHouse', detail: data.system?.subsystems?.query_engine ?? 'No readiness data', tone: subsystemTone(data.system?.subsystems?.query_engine) },
    { label: 'NATS JetStream', detail: componentById('nats')?.container ?? 'No readiness data', tone: componentTone(componentById('nats')?.status) },
  ];

  const notices = [
    ...(!data.ingest?.observed ? [{ title: 'No ingest checkpoint', detail: 'No durable ingestion run has been observed yet.', href: '/ingest' }] : []),
    ...(data.targets?.count === 0 ? [{ title: 'Target catalog is empty', detail: 'Run ingestion and materialize targets before analysis.', href: '/targets' }] : []),
    ...(partialServices > 0 ? [{ title: `${partialServices} service${partialServices > 1 ? 's' : ''} with partial telemetry`, detail: 'The service is reachable, but one or more expected signals are absent.', href: '/monitoring' }] : []),
    ...(silentServices > 0 ? [{ title: `${silentServices} service${silentServices > 1 ? 's' : ''} without telemetry`, detail: 'Prometheus has no recent samples for these services.', href: '/monitoring' }] : []),
  ];

  const noData = !loading && Object.values(data).every((value) => value === null);

  return (
    <div className="mx-auto max-w-[1600px] space-y-5">
      <header className="flex flex-col gap-4 border-b border-border/70 pb-5 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Operations</p>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">System overview</h1>
          <p className="mt-1 text-sm text-muted-foreground">Runtime health, pipeline state and storage activity across AURORA.</p>
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground">
          <span className="flex items-center gap-2">
            <StatusDot tone={fleetTone} />
            {fleetTone === 'healthy' ? 'All systems operational' : fleetTone === 'partial' ? 'Operational with warnings' : 'Telemetry incomplete'}
          </span>
          <span className="font-mono tabular-nums">
            {lastUpdated ? `Updated ${lastUpdated.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}` : 'Loading status'}
          </span>
          <Button variant="outline" size="sm" className="h-8 rounded-sm" onClick={() => void load(true)} disabled={refreshing}>
            <RefreshCw className={cn('size-3.5', refreshing && 'animate-spin')} />
            Refresh
          </Button>
        </div>
      </header>

      {noData && (
        <div className="border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          The dashboard API is unavailable. Live operational data could not be loaded.
        </div>
      )}

      {loading ? (
        <Skeleton className="h-32 rounded-md" />
      ) : (
        <section className="overflow-hidden rounded-md border border-border/70 bg-card/40">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 px-5 py-2.5 text-[11px] text-muted-foreground">
            <span className="font-medium text-foreground">Development environment</span>
            <span className="font-mono">API v{data.system?.version ?? '—'} · Uptime {formatUptime(data.system?.uptime_sec)}</span>
          </div>
          <div className="grid grid-cols-2 xl:grid-cols-4">
            <SummaryItem label="Service fleet" value={`${healthyServices}/${components.length || '—'}`} detail={`${partialServices + silentServices} require review`} />
            <SummaryItem label="Targets" value={(data.targets?.count ?? 0).toLocaleString()} detail="Indexed in ClickHouse" />
            <SummaryItem label="Bronze storage" value={formatBytes(data.storage?.total_bytes)} detail={`${data.storage?.total ?? 0} objects in MinIO`} />
            <SummaryItem label="Current ingest" value={data.ingest?.observed ? `${ingestProgress.toFixed(0)}%` : 'Idle'} detail={data.ingest?.observed ? `${data.ingest.completed_products}/${data.ingest.total_products} products` : 'No active checkpoint'} />
          </div>
        </section>
      )}

      <div className="grid min-w-0 gap-5 xl:grid-cols-[minmax(0,1.6fr)_minmax(300px,0.4fr)]">
        <Card className="min-w-0 rounded-md border-border/70 shadow-none">
          <CardHeader className="border-b border-border/60 py-4">
            <CardTitle className="text-sm font-semibold">Data pipeline</CardTitle>
            <CardDescription>Execution path from TESS acquisition to ranked candidates.</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <div className="grid md:grid-cols-5">
              {pipeline.map((stage, index) => {
                const tone = componentTone(componentById(stage.id)?.status);
                return (
                  <div key={stage.id} className="relative border-b border-border/60 px-4 py-5 last:border-b-0 md:border-r md:border-b-0 md:last:border-r-0">
                    <div className="flex items-center justify-between gap-3">
                      <span className="font-mono text-[10px] text-muted-foreground">{stage.step}</span>
                      {index < pipeline.length - 1 && <ArrowRight className="hidden size-3 text-muted-foreground/50 md:block" />}
                    </div>
                    <p className="mt-4 text-sm font-medium text-foreground">{stage.label}</p>
                    <p className="mt-1 text-xs text-muted-foreground">{stage.detail}</p>
                    <p className="mt-4 flex items-center gap-2 text-[11px] text-muted-foreground">
                      <StatusDot tone={tone} />{toneLabel(tone)}
                    </p>
                  </div>
                );
              })}
            </div>
            <div className="border-t border-border/60 px-5 py-4">
              <div className="mb-2 flex items-center justify-between gap-3 text-xs">
                <span className="text-muted-foreground">Ingest run</span>
                <span className="font-mono tabular-nums text-foreground">{data.ingest?.observed ? `${data.ingest.completed_products}/${data.ingest.total_products} products` : 'Not running'}</span>
              </div>
              <Progress value={ingestProgress} className="h-1 rounded-none" />
            </div>
          </CardContent>
        </Card>

        <Card className="min-w-0 rounded-md border-border/70 shadow-none">
          <CardHeader className="border-b border-border/60 py-4">
            <CardTitle className="text-sm font-semibold">Platform health</CardTitle>
            <CardDescription>Core dependencies and API runtime.</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            {platformRows.map((row) => (
              <div key={row.label} className="flex items-center justify-between gap-4 border-b border-border/60 px-5 py-3 last:border-b-0">
                <div className="min-w-0">
                  <p className="text-xs font-medium text-foreground">{row.label}</p>
                  <p className="mt-0.5 truncate font-mono text-[10px] text-muted-foreground">{row.detail}</p>
                </div>
                <StatusBadge tone={row.tone} />
              </div>
            ))}
            <div className="grid grid-cols-3 border-t border-border/60 bg-muted/10">
              <div className="px-4 py-3"><p className="text-[10px] text-muted-foreground">Uptime</p><p className="mt-1 font-mono text-xs">{formatUptime(data.system?.uptime_sec)}</p></div>
              <div className="border-l border-border/60 px-4 py-3"><p className="text-[10px] text-muted-foreground">Memory</p><p className="mt-1 font-mono text-xs">{formatBytes(data.system?.alloc_bytes)}</p></div>
              <div className="border-l border-border/60 px-4 py-3"><p className="text-[10px] text-muted-foreground">Routines</p><p className="mt-1 font-mono text-xs">{data.system?.goroutines ?? '—'}</p></div>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid min-w-0 gap-5 2xl:grid-cols-[minmax(0,1.6fr)_minmax(300px,0.4fr)]">
        <Card className="min-w-0 rounded-md border-border/70 shadow-none">
          <CardHeader className="border-b border-border/60 py-4">
            <div className="flex items-start justify-between gap-4">
              <div><CardTitle className="text-sm font-semibold">Service fleet</CardTitle><CardDescription>Latest Prometheus signal for each runtime component.</CardDescription></div>
              <Badge variant="outline" className="rounded-sm font-mono font-normal">{components.length} services</Badge>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <div className="max-w-full overflow-x-auto">
              <Table className="min-w-[760px]">
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>Service</TableHead>
                    <TableHead>Function</TableHead>
                    <TableHead>Runtime</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Latest signal</TableHead>
                    <TableHead className="text-right">Value</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {components.map((component) => {
                    const meta = serviceMeta[component.id] ?? { role: component.group, runtime: 'Service' };
                    const signal = latestSignal(component);
                    return (
                      <TableRow key={component.id}>
                        <TableCell>
                          <p className="whitespace-nowrap text-xs font-medium">{component.name}</p>
                          <p className="mt-0.5 font-mono text-[10px] text-muted-foreground">{component.container}</p>
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">{meta.role}</TableCell>
                        <TableCell className="whitespace-nowrap font-mono text-[11px] text-muted-foreground">{meta.runtime}</TableCell>
                        <TableCell><StatusBadge tone={componentTone(component.status)} /></TableCell>
                        <TableCell className="max-w-[220px] truncate text-xs text-muted-foreground">{signal.name}</TableCell>
                        <TableCell className="text-right font-mono text-xs tabular-nums">{signal.value}</TableCell>
                      </TableRow>
                    );
                  })}
                  {!loading && components.length === 0 && (
                    <TableRow><TableCell colSpan={6} className="h-28 text-center text-sm text-muted-foreground">Monitoring data is unavailable.</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        <Card className="min-w-0 rounded-md border-border/70 shadow-none">
          <CardHeader className="border-b border-border/60 py-4">
            <CardTitle className="text-sm font-semibold">Attention required</CardTitle>
            <CardDescription>Operational items that block useful analysis.</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            {notices.length > 0 ? notices.map((notice) => (
              <Link key={notice.title} to={notice.href} className="group block border-b border-border/60 px-5 py-4 last:border-b-0 hover:bg-muted/20">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 border-l-2 border-amber-400/60 pl-3">
                    <p className="text-xs font-medium text-foreground">{notice.title}</p>
                    <p className="mt-1 text-[11px] leading-4 text-muted-foreground">{notice.detail}</p>
                  </div>
                  <ArrowRight className="mt-0.5 size-3.5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                </div>
              </Link>
            )) : (
              <div className="px-5 py-8 text-center text-xs text-muted-foreground">No action items.</div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
