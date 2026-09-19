import { useEffect, useMemo, useState, type JSX } from 'react';
import { Activity, Gauge, HardDrive, MonitorCog, Server, Zap } from 'lucide-react';
import { Area, AreaChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { apiFetch } from '@/lib/api';
import { formatBytes } from '@/types/models';

type Point = { timestamp: number; value: number; labels?: Record<string, string> };
type Metric = { key: string; name: string; unit: string; points: Point[] };
type MonitoringResponse = { components?: { id: string; status: string; metrics: Metric[] }[] };
type SeriesPoint = { timestamp: number;[key: string]: number };

function latest(metrics: Metric[], key: string): number {
  return metrics.find((item) => item.key === key)?.points.at(-1)?.value ?? 0;
}

function metricPoints(metrics: Metric[], key: string): Point[] {
  return metrics.find((metric) => metric.key === key)?.points ?? [];
}

function combine(metrics: Metric[], keys: string[], transforms: Partial<Record<string, (value: number, timestamp: number) => number>> = {}): SeriesPoint[] {
  const maps = new Map(keys.map((key) => [key, new Map(metricPoints(metrics, key).map((point) => [point.timestamp, point.value]))]));
  const timestamps = [...new Set(keys.flatMap((key) => metricPoints(metrics, key).map((point) => point.timestamp)))].sort((a, b) => a - b);
  return timestamps.map((timestamp) => {
    const row: SeriesPoint = { timestamp };
    for (const key of keys) {
      const observed = maps.get(key)?.get(timestamp) ?? 0;
      row[key] = transforms[key]?.(observed, timestamp) ?? observed;
    }
    return row;
  });
}

function formatTime(timestamp: number): string {
  return new Date(timestamp * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function percent(value: number, total: number): string {
  return total > 0 ? `${((value / total) * 100).toFixed(1)}%` : '—';
}

export function TrainingRuntimePanel(): JSX.Element {
  const [metrics, setMetrics] = useState<Metric[]>([]);
  const [status, setStatus] = useState('loading');

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const response = await apiFetch<MonitoringResponse>('/v1/monitoring?component=python-ml-worker&range=15m&step=15');
        const component = response.components?.find((item) => item.id === 'python-ml-worker');
        if (!cancelled) {
          setMetrics(component?.metrics ?? []);
          setStatus(component?.status ?? 'no_data');
        }
      } catch {
        if (!cancelled) setStatus('no_data');
      }
    };
    void load();
    const timer = window.setInterval(() => void load(), 15_000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, []);

  const throughput = latest(metrics, 'throughput');
  const durationP95 = latest(metrics, 'duration_p95');
  const inflight = latest(metrics, 'inflight');
  const queue = latest(metrics, 'queue');
  const gpuAvailable = latest(metrics, 'gpu_available') > 0;
  const gpuUtilization = latest(metrics, 'gpu_utilization');
  const gpuMemoryUsed = latest(metrics, 'gpu_memory_used');
  const gpuMemoryTotal = latest(metrics, 'gpu_memory_total');

  const gpuUsageSeries = useMemo(() => combine(metrics, ['gpu_utilization']), [metrics]);
  const vramSeries = useMemo(
    () => combine(metrics, ['gpu_memory_used', 'gpu_memory_total'], {
      gpu_memory_used: (val) => val / 1024 / 1024,
      gpu_memory_total: (val) => val / 1024 / 1024,
    }),
    [metrics],
  );
  const throughputSeries = useMemo(() => combine(metrics, ['throughput', 'errors']), [metrics]);
  const pressureSeries = useMemo(() => combine(metrics, ['inflight', 'queue']), [metrics]);

  return (
    <section className="min-w-0 border border-border/80 bg-card">
      <header className="flex flex-col gap-3 border-b border-border/60 p-4 sm:flex-row sm:items-start sm:justify-between sm:p-5">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-primary">Runtime observatory / recent 15 minutes</p>
          <h3 className="mt-1 flex items-center gap-2 text-lg font-semibold">
            <Server className="size-4 text-primary" />Training worker hardware &amp; pipeline telemetry
          </h3>
          <p className="mt-1 text-xs text-muted-foreground">Observed compute pressure, GPU telemetry, and job execution metrics from Prometheus.</p>
        </div>
        <span
          className={`w-fit border px-2 py-1 font-mono text-[10px] uppercase ${status === 'up'
              ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
              : status === 'loading'
                ? 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300'
                : 'border-rose-500/40 bg-rose-500/10 text-rose-700 dark:text-rose-300'
            }`}
        >
          {status === 'up' ? 'WORKER ONLINE' : status === 'loading' ? 'LOADING' : 'SIGNAL UNAVAILABLE'}
        </span>
      </header>

      <div className="grid gap-px border-b border-border/60 bg-border/60 sm:grid-cols-2 xl:grid-cols-4">
        <RuntimeStat
          icon={<MonitorCog className="size-3.5 text-sky-500" />}
          label="GPU utilization"
          value={gpuAvailable ? `${gpuUtilization.toFixed(1)}%` : 'Unavailable'}
          detail={gpuAvailable ? 'CUDA hardware active' : 'No observed accelerator'}
        />
        <RuntimeStat
          icon={<Gauge className="size-3.5 text-violet-500" />}
          label="Device VRAM"
          value={gpuAvailable ? `${formatBytes(gpuMemoryUsed)} / ${formatBytes(gpuMemoryTotal)}` : '—'}
          detail={gpuAvailable ? `${percent(gpuMemoryUsed, gpuMemoryTotal)} VRAM allocated` : 'GPU telemetry inactive'}
        />
        <RuntimeStat
          icon={<Activity className="size-3.5 text-emerald-500" />}
          label="Job concurrency"
          value={`${inflight.toLocaleString()} active`}
          detail={`${queue.toLocaleString()} queued jobs`}
        />
        <RuntimeStat
          icon={<Zap className="size-3.5 text-amber-500" />}
          label="Training throughput"
          value={`${throughput.toFixed(2)} jobs/s`}
          detail={durationP95 > 0 ? `P95 ${durationP95 < 1 ? (durationP95 * 1000).toFixed(0) + ' ms' : durationP95.toFixed(2) + ' s'}` : 'Idle baseline'}
        />
      </div>

      {metrics.length === 0 ? (
        <div className="m-4 flex min-h-52 items-center justify-center border border-dashed border-border/70 px-5 text-center text-xs text-muted-foreground">
          No telemetry observation is available for this worker.
        </div>
      ) : (
        <div className="grid min-w-0 lg:grid-cols-2">
          <RuntimeChart
            title="GPU Device Utilization"
            detail="NVIDIA GPU device compute utilization percentage over time via NVML."
            icon={<MonitorCog className="size-3.5" />}
          >
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={gpuUsageSeries} margin={{ top: 8, right: 10, bottom: 0, left: 0 }}>
                <defs>
                  <linearGradient id="training-util" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#0ea5e9" stopOpacity={0.25} />
                    <stop offset="95%" stopColor="#0ea5e9" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid vertical={false} strokeDasharray="3 3" opacity={0.22} />
                <XAxis dataKey="timestamp" tickFormatter={formatTime} tick={{ fontSize: 9 }} minTickGap={32} />
                <YAxis domain={[0, 100]} tickFormatter={(item) => `${Number(item).toFixed(0)}%`} width={38} tick={{ fontSize: 9 }} />
                <Tooltip labelFormatter={(item) => formatTime(Number(item))} formatter={(item, name) => [`${Number(item).toFixed(1)}%`, String(name)]} />
                <Legend />
                <Area type="monotone" dataKey="gpu_utilization" name="GPU Utilization" stroke="#0ea5e9" fill="url(#training-util)" strokeWidth={1.8} dot={false} isAnimationActive={false} />
              </AreaChart>
            </ResponsiveContainer>
          </RuntimeChart>

          <RuntimeChart
            title="Device VRAM Allocation"
            detail="Allocated GPU device memory compared to physical memory capacity (MiB)."
            icon={<HardDrive className="size-3.5" />}
            borderLeft
          >
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={vramSeries} margin={{ top: 8, right: 10, bottom: 0, left: 0 }}>
                <CartesianGrid vertical={false} strokeDasharray="3 3" opacity={0.22} />
                <XAxis dataKey="timestamp" tickFormatter={formatTime} tick={{ fontSize: 9 }} minTickGap={32} />
                <YAxis tickFormatter={(item) => `${Number(item).toFixed(0)}`} width={48} tick={{ fontSize: 9 }} />
                <Tooltip labelFormatter={(item) => formatTime(Number(item))} formatter={(item, name) => [`${Number(item).toFixed(1)} MiB`, String(name)]} />
                <Legend />
                <Line type="monotone" dataKey="gpu_memory_used" name="VRAM Used" stroke="#8b5cf6" strokeWidth={1.8} dot={false} isAnimationActive={false} />
                <Line type="monotone" dataKey="gpu_memory_total" name="Total VRAM" stroke="#64748b" strokeWidth={1.2} strokeDasharray="4 4" dot={false} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </RuntimeChart>

          <RuntimeChart
            title="Training Throughput & Errors"
            detail="Completed ML training jobs/sec and failure rate observed by Prometheus."
            icon={<Zap className="size-3.5" />}
            borderTop
          >
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={throughputSeries} margin={{ top: 8, right: 10, bottom: 0, left: 0 }}>
                <CartesianGrid vertical={false} strokeDasharray="3 3" opacity={0.22} />
                <XAxis dataKey="timestamp" tickFormatter={formatTime} tick={{ fontSize: 9 }} minTickGap={32} />
                <YAxis tickFormatter={(item) => `${Number(item).toFixed(2)}`} width={44} tick={{ fontSize: 9 }} />
                <Tooltip labelFormatter={(item) => formatTime(Number(item))} formatter={(item, name) => [`${Number(item).toFixed(3)}/s`, String(name)]} />
                <Legend />
                <Line type="monotone" dataKey="throughput" name="Jobs / sec" stroke="#10b981" strokeWidth={1.8} dot={false} isAnimationActive={false} />
                <Line type="monotone" dataKey="errors" name="Errors / sec" stroke="#ef4444" strokeWidth={1.8} dot={false} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </RuntimeChart>

          <RuntimeChart
            title="Worker Concurrency & Queue"
            detail="In-flight executing training jobs and queued jobs waiting for allocation."
            icon={<Activity className="size-3.5" />}
            borderLeft
            borderTop
          >
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={pressureSeries} margin={{ top: 8, right: 10, bottom: 0, left: 0 }}>
                <CartesianGrid vertical={false} strokeDasharray="3 3" opacity={0.22} />
                <XAxis dataKey="timestamp" tickFormatter={formatTime} tick={{ fontSize: 9 }} minTickGap={32} />
                <YAxis allowDecimals={false} width={32} tick={{ fontSize: 9 }} />
                <Tooltip labelFormatter={(item) => formatTime(Number(item))} formatter={(item, name) => [Number(item).toLocaleString(), String(name)]} />
                <Legend />
                <Line type="stepAfter" dataKey="inflight" name="In-flight" stroke="#22d3ee" strokeWidth={1.8} dot={false} isAnimationActive={false} />
                <Line type="stepAfter" dataKey="queue" name="Queued" stroke="#f59e0b" strokeWidth={1.8} dot={false} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </RuntimeChart>
        </div>
      )}
    </section>
  );
}

function RuntimeStat({ icon, label, value, detail }: { icon: JSX.Element; label: string; value: string; detail: string }): JSX.Element {
  return (
    <div className="min-w-0 bg-card p-3">
      <p className="flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-wide text-muted-foreground">
        {icon}{label}
      </p>
      <p className="mt-1 truncate font-mono text-sm font-semibold tabular-nums" title={value}>
        {value}
      </p>
      <p className="mt-0.5 truncate text-[9px] text-muted-foreground" title={detail}>
        {detail}
      </p>
    </div>
  );
}

function RuntimeChart({
  title,
  detail,
  icon,
  children,
  borderLeft = false,
  borderTop = false,
}: {
  title: string;
  detail: string;
  icon: JSX.Element;
  children: JSX.Element;
  borderLeft?: boolean;
  borderTop?: boolean;
}): JSX.Element {
  return (
    <div className={`${borderLeft ? 'lg:border-l' : ''} ${borderTop ? 'border-t' : ''} border-border/60`}>
      <div className="border-b border-border/50 px-4 py-3">
        <p className="flex items-center gap-1.5 text-xs font-medium">{icon}{title}</p>
        <p className="mt-0.5 text-[10px] text-muted-foreground">{detail}</p>
      </div>
      <div className="h-[240px] p-3">{children}</div>
    </div>
  );
}
