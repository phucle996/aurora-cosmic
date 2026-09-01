import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { JSX } from 'react';
import {
  AlertCircle,
  Clock3,
  RefreshCw,
} from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from 'recharts';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart';
import { Skeleton } from '@/components/ui/skeleton';
import { apiFetch } from '@/lib/api';

type MonitoringPoint = {
  timestamp: number;
  value: number;
  labels?: Record<string, string>;
};
type MonitoringMetric = {
  key: string;
  name: string;
  unit: string;
  kind: string;
  points: MonitoringPoint[];
};
type MonitoringStatus = 'up' | 'degraded' | 'no_data';
type MonitoringComponent = {
  id: string;
  name: string;
  group: string;
  container: string;
  status: MonitoringStatus;
  metrics: MonitoringMetric[];
};
type MonitoringResponse = {
  source: string;
  tab: string;
  range: string;
  start: string;
  end: string;
  step_seconds: number;
  components: MonitoringComponent[];
};

const components = [
  { id: 'go-ingester', label: 'Ingester', group: 'Pipeline' },
  { id: 'rust-preprocessor', label: 'Preprocessor', group: 'Pipeline' },
  { id: 'python-ml-worker', label: 'ML worker', group: 'Pipeline' },
  { id: 'rust-inference', label: 'Inference', group: 'Pipeline' },
  { id: 'gold-builder', label: 'Gold builder', group: 'Pipeline' },
  { id: 'go-api', label: 'Go API', group: 'Platform' },
  { id: 'dashboard', label: 'Dashboard', group: 'Platform' },
  { id: 'minio', label: 'MinIO', group: 'Platform' },
  { id: 'nats', label: 'NATS', group: 'Platform' },
  { id: 'clickhouse', label: 'ClickHouse', group: 'Platform' },
] as const;

const timeRanges = [
  { id: '15m', label: '15 min', step: 15 },
  { id: '1h', label: '1 hour', step: 60 },
  { id: '6h', label: '6 hours', step: 300 },
  { id: '24h', label: '24 hours', step: 900 },
] as const;

const capacityPairs = [
  { usedKey: 'memory', totalKey: 'memory_total', title: 'Process memory / host capacity', usedLabel: 'Process cgroup', totalLabel: 'Host RAM' },
  { usedKey: 'cpu_cores', totalKey: 'cpu_cores_total', title: 'Process CPU / host capacity', usedLabel: 'Process cores (1m rate)', totalLabel: 'Host logical cores' },
  { usedKey: 'gpu_memory_used', totalKey: 'gpu_memory_total', title: 'Shared GPU device memory', usedLabel: 'Device used', totalLabel: 'Device total' },
] as const;

const resourceMetricKeys = new Set([
  'memory',
  'cpu_cores',
  'disk_read',
  'disk_write',
  'gpu_utilization',
  'gpu_memory_used',
]);

function compactNumber(value: number): string {
  if (!Number.isFinite(value)) return '—';
  const absolute = Math.abs(value);
  if (absolute >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(1)}G`;
  if (absolute >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (absolute >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  if (absolute < 0.01 && value !== 0) return value.toExponential(1);
  return value.toFixed(value % 1 === 0 ? 0 : 2);
}

function formatBytes(value: number): string {
  if (!Number.isFinite(value)) return '—';
  if (Math.abs(value) < 1024) return `${compactNumber(value)} B`;
  if (Math.abs(value) < 1024 ** 2) return `${(value / 1024).toFixed(1)} KiB`;
  if (Math.abs(value) < 1024 ** 3) return `${(value / 1024 ** 2).toFixed(1)} MiB`;
  return `${(value / 1024 ** 3).toFixed(2)} GiB`;
}

function formatMetricValue(value: number, unit: string): string {
  if (!Number.isFinite(value)) return '—';
  if (unit === 'bytes') return formatBytes(value);
  if (unit === 'bytes/s') return `${formatBytes(value)}/s`;
  if (unit === 'seconds') {
    if (value > 0 && value < 0.001) return `${(value * 1_000_000).toFixed(0)} µs`;
    if (value > 0 && value < 1) return `${(value * 1000).toFixed(value < 0.01 ? 2 : 1)} ms`;
    return `${compactNumber(value)} s`;
  }
  if (unit === 'percent') return `${compactNumber(value)}%`;
  if (unit === 'up') return value >= 1 ? 'UP' : 'DOWN';
  return `${compactNumber(value)} ${unit}`.trim();
}

function formatCapacityValue(value: number, unit: string): string {
  if (unit === 'cores') {
    const digits = Math.abs(value) < 0.01 ? 3 : Math.abs(value) < 1 ? 2 : value % 1 === 0 ? 0 : 1;
    return `${value.toFixed(digits)} cores`;
  }
  return formatMetricValue(value, unit);
}

function formatTime(timestamp: number): string {
  return new Date(timestamp * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatObservedAt(value?: string): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? value : date.toLocaleString();
}

function metricColor(metric: MonitoringMetric): string {
  if (/error|failed|offline/.test(metric.key)) return '#e11d48';
  if (/queue|pending/.test(metric.key)) return '#f59e0b';
  if (/availability/.test(metric.key)) return '#10b981';
  return '#159dcc';
}

function statusVariant(status: MonitoringStatus): 'default' | 'secondary' | 'outline' {
  if (status === 'up') return 'default';
  if (status === 'degraded') return 'secondary';
  return 'outline';
}

function MetricChart({ metric, idle = false }: { metric: MonitoringMetric; idle?: boolean }): JSX.Element {
  const color = metricColor(metric);
  const chartConfig: ChartConfig = { value: { label: metric.name, color } };
  const points = metric.points.map((point) => ({ timestamp: point.timestamp, value: point.value }));
  const latest = points.at(-1)?.value;

  return (
    <Card className="min-w-0 rounded-none border-border/80 shadow-none">
      <CardHeader className="border-b border-border/60 pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate font-mono text-[9px] uppercase tracking-[0.12em] text-muted-foreground">{metric.kind} / {metric.key}</p>
            <CardTitle className="mt-1 truncate text-sm" title={metric.name}>{metric.name}</CardTitle>
          </div>
          <div className="shrink-0 text-right">
            <p className="font-mono text-sm font-medium tabular-nums text-foreground">{idle ? 'IDLE' : latest === undefined ? '—' : formatMetricValue(latest, metric.unit)}</p>
            <p className="mt-1 font-mono text-[9px] uppercase text-muted-foreground">{idle ? 'no observations' : `${points.length} samples`}</p>
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-3 sm:p-4">
        {points.length === 0 ? (
          <div className="flex h-44 items-center justify-center border border-dashed border-border/70 px-4 text-center text-xs text-muted-foreground">
            Metric signal unavailable
          </div>
        ) : (
          <ChartContainer
            config={chartConfig}
            className="w-full aspect-auto"
            style={{ height: 176, minHeight: 176 }}
            initialDimension={{ width: 640, height: 176 }}
          >
            <AreaChart data={points} margin={{ left: 0, right: 8, top: 8, bottom: 0 }}>
              <defs>
                <linearGradient id={`fill-${metric.key}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={color} stopOpacity={0.32} />
                  <stop offset="95%" stopColor={color} stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid vertical={false} strokeDasharray="3 3" />
              <XAxis dataKey="timestamp" tickLine={false} axisLine={false} tickMargin={8} minTickGap={28} tickFormatter={formatTime} />
              <YAxis tickLine={false} axisLine={false} width={48} padding={{ top: 8, bottom: 8 }} tickFormatter={(value) => compactNumber(Number(value))} />
              <ChartTooltip
                cursor={false}
                content={
                  <ChartTooltipContent
                    labelFormatter={(value) => formatTime(Number(value))}
                    formatter={(value) => formatMetricValue(Number(value), metric.unit)}
                  />
                }
              />
              <Area type="monotone" dataKey="value" stroke={color} strokeWidth={1.5} fill={`url(#fill-${metric.key})`} dot={false} isAnimationActive={false} />
            </AreaChart>
          </ChartContainer>
        )}
      </CardContent>
    </Card>
  );
}

function CapacityChart({
  used,
  total,
  title,
  usedLabel,
  totalLabel,
  detail,
}: {
  used: MonitoringMetric;
  total: MonitoringMetric;
  title: string;
  usedLabel: string;
  totalLabel: string;
  detail?: string;
}): JSX.Element {
  const latestTotal = total.points.at(-1)?.value;
  const totalByTimestamp = new Map(total.points.map((point) => [point.timestamp, point.value]));
  const points = used.points.flatMap((point) => {
    const totalValue = totalByTimestamp.get(point.timestamp) ?? latestTotal;
    if (totalValue === undefined || totalValue <= 0) return [];
    return [{ timestamp: point.timestamp, utilization: Math.min(100, Math.max(0, point.value / totalValue * 100)) }];
  });
  const latestUsed = used.points.at(-1)?.value;
  const utilization = latestUsed !== undefined && latestTotal !== undefined && latestTotal > 0
    ? Math.min(100, Math.max(0, latestUsed / latestTotal * 100))
    : undefined;
  const chartConfig: ChartConfig = {
    utilization: { label: 'Utilization', color: '#159dcc' },
  };

  return (
    <Card className="min-w-0 rounded-none border-border/80 shadow-none">
      <CardHeader className="border-b border-border/60 pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate font-mono text-[9px] uppercase tracking-[0.12em] text-muted-foreground">Capacity / {used.key}</p>
            <CardTitle className="mt-1 truncate text-sm" title={title}>{title}</CardTitle>
          </div>
          <div className="shrink-0 text-right">
            <p className="font-mono text-sm font-medium tabular-nums text-foreground">
              {latestUsed === undefined ? '—' : formatCapacityValue(latestUsed, used.unit)}
              <span className="mx-1 text-muted-foreground">/</span>
              {latestTotal === undefined ? '—' : formatCapacityValue(latestTotal, total.unit)}
            </p>
            <p className="mt-1 font-mono text-[9px] uppercase text-muted-foreground">{utilization === undefined ? 'ratio unavailable' : `${utilization.toFixed(1)}% utilized`}</p>
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-3 sm:p-4">
        {points.length === 0 ? (
          <div className="flex h-44 items-center justify-center border border-dashed border-border/70 px-4 text-center text-xs text-muted-foreground">
            Capacity signal unavailable
          </div>
        ) : (
          <ChartContainer
            config={chartConfig}
            className="w-full aspect-auto"
            style={{ height: 176, minHeight: 176 }}
            initialDimension={{ width: 640, height: 176 }}
          >
            <AreaChart data={points} margin={{ left: 0, right: 8, top: 8, bottom: 0 }}>
              <defs>
                <linearGradient id={`fill-capacity-${used.key}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#159dcc" stopOpacity={0.32} />
                  <stop offset="95%" stopColor="#159dcc" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid vertical={false} strokeDasharray="3 3" />
              <XAxis dataKey="timestamp" tickLine={false} axisLine={false} tickMargin={8} minTickGap={28} tickFormatter={formatTime} />
              <YAxis domain={[0, 100]} tickLine={false} axisLine={false} width={48} padding={{ top: 8, bottom: 8 }} tickFormatter={(value) => `${compactNumber(Number(value))}%`} />
              <ChartTooltip cursor={false} content={<ChartTooltipContent labelFormatter={(value) => formatTime(Number(value))} formatter={(value) => `${Number(value).toFixed(1)}%`} />} />
              <Area type="monotone" dataKey="utilization" stroke="#159dcc" strokeWidth={1.5} fill={`url(#fill-capacity-${used.key})`} dot={false} isAnimationActive={false} />
            </AreaChart>
          </ChartContainer>
        )}
        <div className="mt-2 border-t border-border/50 pt-2 font-mono text-[9px] text-muted-foreground">
          <p className="uppercase">Utilization = {usedLabel} / {totalLabel}</p>
          {detail ? <p className="mt-1 truncate" title={detail}>{detail}</p> : null}
        </div>
      </CardContent>
    </Card>
  );
}

export default function HealthSection(): JSX.Element {
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedTab = searchParams.get('tab') ?? components[0].id;
  const activeTab = components.some((component) => component.id === requestedTab) ? requestedTab : components[0].id;
  const requestedRange = searchParams.get('range') ?? '1h';
  const activeRange = timeRanges.find((range) => range.id === requestedRange) ?? timeRanges[1];
  const [response, setResponse] = useState<MonitoringResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const requestSequence = useRef(0);

  const tabMeta = useMemo(() => components.find((component) => component.id === activeTab) ?? components[0], [activeTab]);
  // Keep the last completed response mounted while the next component is
  // queried. This avoids replacing the chart grid with a loading skeleton on
  // every selector change.
  const selected = response?.components[0];
  const displayedTabMeta = components.find((component) => component.id === selected?.id) ?? tabMeta;
  const metricDisplays = useMemo(() => {
    if (!selected) return [];
    const byKey = new Map(selected.metrics.map((metric) => [metric.key, metric]));
    const totalKeys = new Set(capacityPairs.map((pair) => pair.totalKey));
    const hiddenMetricKeys = new Set(['cpu_info', 'gpu_available']);
    const gpuAvailable = (byKey.get('gpu_available')?.points.at(-1)?.value ?? 0) > 0;
    if (selected.id === 'python-ml-worker' && !gpuAvailable) {
      hiddenMetricKeys.add('gpu_utilization');
      hiddenMetricKeys.add('gpu_memory_used');
      hiddenMetricKeys.add('gpu_memory_total');
    }
    const cpuModel = byKey.get('cpu_info')?.points.at(-1)?.labels?.model;
    const trafficIdle = byKey.get('throughput')?.points.at(-1)?.value === 0;
    return selected.metrics.flatMap((metric) => {
      if (!metric.key || metric.points.length === 0 || hiddenMetricKeys.has(metric.key) || totalKeys.has(metric.key as typeof capacityPairs[number]['totalKey'])) return [];
      const pair = capacityPairs.find((candidate) => candidate.usedKey === metric.key);
      const total = pair ? byKey.get(pair.totalKey) : undefined;
      if (pair && total && total.points.length > 0) {
        return [{
          kind: 'capacity' as const,
          group: 'resource' as const,
          used: metric,
          total,
          pair,
          detail: pair.usedKey === 'cpu_cores' && cpuModel
            ? `CPU · ${cpuModel}`
            : pair.usedKey === 'gpu_memory_used'
              ? 'Shared device telemetry · not attributed to this process alone'
              : 'Process usage is measured from its systemd cgroup',
        }];
      }
      return [{
        kind: 'metric' as const,
        group: resourceMetricKeys.has(metric.key) ? 'resource' as const : 'workload' as const,
        metric,
        idle: metric.kind === 'histogram p95' && trafficIdle,
      }];
    });
  }, [selected]);
  const workloadDisplays = metricDisplays.filter((display) => display.group === 'workload');
  const resourceDisplays = metricDisplays.filter((display) => display.group === 'resource');
  const sampleCount = selected?.metrics.reduce((total, metric) => total + metric.points.length, 0) ?? 0;

  const load = useCallback(async (): Promise<void> => {
    const requestID = ++requestSequence.current;
    setLoading(true);
    setError(null);
    try {
      const payload = await apiFetch<MonitoringResponse>(
        `/v1/monitoring?tab=${encodeURIComponent(activeTab)}&range=${encodeURIComponent(activeRange.id)}&step=${activeRange.step}`,
      );
      if (requestID === requestSequence.current) setResponse(payload);
    } catch (requestError) {
      if (requestID === requestSequence.current) {
        setError(requestError instanceof Error ? requestError.message : 'Không thể tải monitoring');
      }
    } finally {
      if (requestID === requestSequence.current) setLoading(false);
    }
  }, [activeRange.id, activeRange.step, activeTab]);

  useEffect(() => {
    void load();
  }, [load]);

  const updateQuery = (key: 'tab' | 'range', value: string): void => {
    const next = new URLSearchParams(searchParams);
    next.set(key, value);
    setSearchParams(next);
  };

  return (
    <section className="space-y-5">
      <Card className="rounded-none border-border/80 shadow-none">
        <CardHeader className="border-b border-border/60 pb-4">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-primary">Component telemetry / {displayedTabMeta.group}</p>
                {selected ? <Badge variant={statusVariant(selected.status)} className="rounded-none font-mono text-[9px] uppercase">{selected.status.replace('_', ' ')}</Badge> : null}
              </div>
              <CardTitle className="mt-1 text-lg">{selected?.name ?? tabMeta.label}</CardTitle>
              <CardDescription className="font-mono text-[10px]">{selected?.container ?? 'Component metadata unavailable'}</CardDescription>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <label className="block">
                <span className="sr-only">Monitoring component</span>
                <select
                  value={activeTab}
                  onChange={(event) => updateQuery('tab', event.target.value)}
                  className="h-9 w-full rounded-none border border-input bg-background px-3 font-mono text-[10px] uppercase text-foreground outline-none focus:border-ring focus:ring-1 focus:ring-ring sm:w-48"
                >
                  <optgroup label="Pipeline">
                    {components.filter((component) => component.group === 'Pipeline').map((component) => <option key={component.id} value={component.id}>{component.label}</option>)}
                  </optgroup>
                  <optgroup label="Platform">
                    {components.filter((component) => component.group === 'Platform').map((component) => <option key={component.id} value={component.id}>{component.label}</option>)}
                  </optgroup>
                </select>
              </label>
              <div className="grid grid-cols-4 border border-border/70">
                {timeRanges.map((range) => (
                  <button
                    key={range.id}
                    type="button"
                    aria-pressed={activeRange.id === range.id}
                    onClick={() => updateQuery('range', range.id)}
                    className={`border-r border-border/70 px-2.5 py-2 font-mono text-[9px] uppercase last:border-r-0 sm:px-3 ${activeRange.id === range.id ? 'bg-primary text-primary-foreground' : 'bg-background text-muted-foreground hover:bg-muted/50'}`}
                  >
                    {range.label}
                  </button>
                ))}
              </div>
              <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading} className="h-9 rounded-none font-mono text-[9px] uppercase tracking-[0.08em]">
                <RefreshCw className={`size-3.5 ${loading ? 'animate-spin' : ''}`} />
                Query now
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="grid gap-px bg-border/60 sm:grid-cols-2 xl:grid-cols-4">
            <div className="bg-background/80 p-3"><p className="font-mono text-[9px] uppercase tracking-[0.1em] text-muted-foreground">Rendered signals</p><p className="mt-1 font-mono text-sm font-medium">{metricDisplays.length} charts</p></div>
            <div className="bg-background/80 p-3"><p className="font-mono text-[9px] uppercase tracking-[0.1em] text-muted-foreground">Window</p><p className="mt-1 font-mono text-sm font-medium">{response?.range ?? activeRange.id} · {response?.step_seconds ?? activeRange.step}s step</p></div>
            <div className="bg-background/80 p-3"><p className="font-mono text-[9px] uppercase tracking-[0.1em] text-muted-foreground">Samples received</p><p className="mt-1 font-mono text-sm font-medium">{sampleCount.toLocaleString()}</p></div>
            <div className="bg-background/80 p-3"><p className="font-mono text-[9px] uppercase tracking-[0.1em] text-muted-foreground">Observed at</p><p className="mt-1 truncate font-mono text-[10px] font-medium" title={response?.end}>{formatObservedAt(response?.end)}</p></div>
          </div>
        </CardContent>
      </Card>

      {loading && !selected ? (
        <div className="grid gap-4 md:grid-cols-2">
          {[0, 1, 2, 3].map((item) => <Skeleton key={item} className="h-64 rounded-none" />)}
        </div>
      ) : null}

      {error ? (
        <div className="flex flex-col gap-4 border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3"><AlertCircle className="mt-0.5 size-4 shrink-0" /><div><p className="font-medium">Prometheus query interrupted</p><p className="mt-0.5 text-xs">{error}</p></div></div>
          <Button variant="outline" size="sm" onClick={() => void load()} className="rounded-none">Retry query</Button>
        </div>
      ) : null}

      {selected && metricDisplays.length > 0 ? (
        <div className="space-y-6">
          {[
            {
              id: 'workload',
              title: 'Workload signals',
              description: 'Throughput, latency, errors and queue pressure emitted by this component.',
              displays: workloadDisplays,
            },
            {
              id: 'resource',
              title: 'Resource consumption',
              description: 'Per-service CPU, RAM and disk I/O accounting from the runtime cgroup.',
              displays: resourceDisplays,
            },
          ].filter((section) => section.displays.length > 0).map((section) => (
            <section key={section.id} className="space-y-3">
              <div className="border-l-2 border-primary pl-3">
                <h3 className="text-sm font-medium">{section.title}</h3>
                <p className="mt-0.5 text-xs text-muted-foreground">{section.description}</p>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                {section.displays.map((display) => display.kind === 'capacity'
                  ? <CapacityChart key={display.used.key} used={display.used} total={display.total} title={display.pair.title} usedLabel={display.pair.usedLabel} totalLabel={display.pair.totalLabel} detail={display.detail} />
                  : <MetricChart key={display.metric.key} metric={display.metric} idle={display.idle} />)}
              </div>
            </section>
          ))}
        </div>
      ) : !loading && !error ? (
        <div className="flex min-h-40 items-center justify-center border border-dashed border-border/70 px-5 text-center text-sm text-muted-foreground">
          <Clock3 className="mr-2 size-4 text-primary" /> Chưa có telemetry khả dụng cho {tabMeta.label}; hãy kiểm tra scrape health của component.
        </div>
      ) : null}
    </section>
  );
}
