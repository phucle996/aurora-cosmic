import { useEffect, useMemo, useState, type JSX } from 'react';
import { Activity, Cpu, HardDrive, MemoryStick, MonitorCog, Server } from 'lucide-react';
import { Area, AreaChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { apiFetch } from '@/lib/api';
import { formatBytes } from '../types';

type Point = { timestamp: number; value: number; labels?: Record<string, string> };
type Metric = { key: string; name: string; unit: string; points: Point[] };
type MonitoringResponse = { components?: { id: string; status: string; metrics: Metric[] }[] };
type SeriesPoint = { timestamp: number; [key: string]: number };

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
  return total > 0 ? `${(value / total * 100).toFixed(1)}%` : '—';
}

export function TrainingRuntimePanel(): JSX.Element {
  const [metrics, setMetrics] = useState<Metric[]>([]);
  const [status, setStatus] = useState('loading');

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const response = await apiFetch<MonitoringResponse>('/v1/monitoring?tab=python-ml-worker&range=15m&step=15');
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

  const memory = latest(metrics, 'memory');
  const memoryTotal = latest(metrics, 'memory_total');
  const cpuCores = latest(metrics, 'cpu_cores');
  const cpuCoresTotal = latest(metrics, 'cpu_cores_total');
  const inflight = latest(metrics, 'inflight');
  const queue = latest(metrics, 'queue');
  const gpuAvailable = latest(metrics, 'gpu_available') > 0;
  const gpuUtilization = latest(metrics, 'gpu_utilization');
  const gpuMemoryUsed = latest(metrics, 'gpu_memory_used');
  const gpuMemoryTotal = latest(metrics, 'gpu_memory_total');
  const cpuModel = metrics.find((metric) => metric.key === 'cpu_info')?.points.at(-1)?.labels?.model ?? 'CPU metadata unavailable';
  const memoryTotalByTime = useMemo(() => new Map(metricPoints(metrics, 'memory_total').map((point) => [point.timestamp, point.value])), [metrics]);
  const cpuTotalByTime = useMemo(() => new Map(metricPoints(metrics, 'cpu_cores_total').map((point) => [point.timestamp, point.value])), [metrics]);
  const utilization = useMemo(() => combine(metrics, ['cpu_cores', 'memory', 'gpu_utilization'], {
    cpu_cores: (observed, timestamp) => { const total = cpuTotalByTime.get(timestamp) ?? cpuCoresTotal; return total > 0 ? observed / total * 100 : 0; },
    memory: (observed, timestamp) => { const total = memoryTotalByTime.get(timestamp) ?? memoryTotal; return total > 0 ? observed / total * 100 : 0; },
  }), [metrics, cpuTotalByTime, memoryTotalByTime, cpuCoresTotal, memoryTotal]);
  const footprints = useMemo(() => combine(metrics, ['memory', 'gpu_memory_used'], { memory: (observed) => observed / 1024 / 1024, gpu_memory_used: (observed) => observed / 1024 / 1024 }), [metrics]);
  const io = useMemo(() => combine(metrics, ['disk_read', 'disk_write'], { disk_read: (observed) => observed / 1024 / 1024, disk_write: (observed) => observed / 1024 / 1024 }), [metrics]);
  const pressure = useMemo(() => combine(metrics, ['inflight', 'queue']), [metrics]);

  return <section className="min-w-0 border border-border/80 bg-card">
    <header className="flex flex-col gap-3 border-b border-border/60 p-4 sm:flex-row sm:items-start sm:justify-between sm:p-5">
      <div><p className="font-mono text-[10px] uppercase tracking-[0.14em] text-primary">Runtime observatory / recent 15 minutes</p><h3 className="mt-1 flex items-center gap-2 text-lg font-semibold"><Server className="size-4 text-primary" />Training worker resources</h3><p className="mt-1 text-xs text-muted-foreground">Observed compute pressure and resource footprint for the ML worker.</p></div>
      <span className={`w-fit border px-2 py-1 font-mono text-[10px] uppercase ${status === 'up' ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300' : 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300'}`}>{status === 'up' ? 'WORKER ONLINE' : status === 'loading' ? 'LOADING' : 'SIGNAL UNAVAILABLE'}</span>
    </header>

    <div className="grid gap-px border-b border-border/60 bg-border/60 sm:grid-cols-2 xl:grid-cols-4">
      <RuntimeStat icon={<Cpu className="size-3.5 text-amber-500" />} label="CPU allocation" value={`${cpuCores.toFixed(3)} / ${cpuCoresTotal || '—'} cores`} detail={`${percent(cpuCores, cpuCoresTotal)} · ${cpuModel}`} />
      <RuntimeStat icon={<MemoryStick className="size-3.5 text-violet-500" />} label="Worker memory" value={`${formatBytes(memory)} / ${formatBytes(memoryTotal)}`} detail={`${percent(memory, memoryTotal)} of host capacity`} />
      <RuntimeStat icon={<MonitorCog className="size-3.5 text-sky-500" />} label="GPU device" value={gpuAvailable ? `${gpuUtilization.toFixed(1)}% utilization` : 'Unavailable'} detail={gpuAvailable ? `${formatBytes(gpuMemoryUsed)} / ${formatBytes(gpuMemoryTotal)} VRAM` : 'No observed CUDA device'} />
      <RuntimeStat icon={<Activity className="size-3.5 text-emerald-500" />} label="Execution pressure" value={`${inflight.toLocaleString()} active`} detail={`${queue.toLocaleString()} queued`} />
    </div>

    {metrics.length === 0 ? <div className="m-4 flex min-h-52 items-center justify-center border border-dashed border-border/70 px-5 text-center text-xs text-muted-foreground">No resource observation is available for this worker.</div> : <div className="grid min-w-0 lg:grid-cols-2">
      <RuntimeChart title="Resource utilization" detail="CPU and worker RAM are normalized against observed capacities; GPU is device utilization." icon={<Activity className="size-3.5" />}>
        <ResponsiveContainer width="100%" height="100%"><AreaChart data={utilization} margin={{ top: 8, right: 10, bottom: 0, left: 0 }}><defs><linearGradient id="training-util" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#0ea5e9" stopOpacity={0.25} /><stop offset="95%" stopColor="#0ea5e9" stopOpacity={0.02} /></linearGradient></defs><CartesianGrid vertical={false} strokeDasharray="3 3" opacity={0.22} /><XAxis dataKey="timestamp" tickFormatter={formatTime} tick={{ fontSize: 9 }} minTickGap={32} /><YAxis domain={[0, 100]} tickFormatter={(item) => `${Number(item).toFixed(0)}%`} width={38} tick={{ fontSize: 9 }} /><Tooltip labelFormatter={(item) => formatTime(Number(item))} formatter={(item, name) => [`${Number(item).toFixed(2)}%`, String(name)]} /><Legend /><Area type="monotone" dataKey="cpu_cores" name="CPU" stroke="#f59e0b" fill="none" strokeWidth={1.8} dot={false} isAnimationActive={false} /><Area type="monotone" dataKey="memory" name="Worker RAM" stroke="#8b5cf6" fill="none" strokeWidth={1.8} dot={false} isAnimationActive={false} /><Area type="monotone" dataKey="gpu_utilization" name="GPU" stroke="#0ea5e9" fill="url(#training-util)" strokeWidth={1.8} dot={false} isAnimationActive={false} /></AreaChart></ResponsiveContainer>
      </RuntimeChart>
      <RuntimeChart title="Memory footprint" detail="Absolute allocated memory; host capacity and GPU capacity are reported separately above." icon={<MemoryStick className="size-3.5" />} borderLeft>
        <ResponsiveContainer width="100%" height="100%"><LineChart data={footprints} margin={{ top: 8, right: 10, bottom: 0, left: 0 }}><CartesianGrid vertical={false} strokeDasharray="3 3" opacity={0.22} /><XAxis dataKey="timestamp" tickFormatter={formatTime} tick={{ fontSize: 9 }} minTickGap={32} /><YAxis tickFormatter={(item) => `${Number(item).toFixed(0)}`} width={44} tick={{ fontSize: 9 }} /><Tooltip labelFormatter={(item) => formatTime(Number(item))} formatter={(item, name) => [`${Number(item).toFixed(1)} MiB`, String(name)]} /><Legend /><Line type="monotone" dataKey="memory" name="Worker RAM" stroke="#8b5cf6" strokeWidth={1.8} dot={false} isAnimationActive={false} /><Line type="monotone" dataKey="gpu_memory_used" name="Device VRAM" stroke="#0ea5e9" strokeWidth={1.8} dot={false} isAnimationActive={false} /></LineChart></ResponsiveContainer>
      </RuntimeChart>
      <RuntimeChart title="Storage throughput" detail="Read and write bandwidth attributed to the training worker." icon={<HardDrive className="size-3.5" />} borderTop>
        <ResponsiveContainer width="100%" height="100%"><LineChart data={io} margin={{ top: 8, right: 10, bottom: 0, left: 0 }}><CartesianGrid vertical={false} strokeDasharray="3 3" opacity={0.22} /><XAxis dataKey="timestamp" tickFormatter={formatTime} tick={{ fontSize: 9 }} minTickGap={32} /><YAxis tickFormatter={(item) => `${Number(item).toFixed(1)}`} width={44} tick={{ fontSize: 9 }} /><Tooltip labelFormatter={(item) => formatTime(Number(item))} formatter={(item, name) => [`${Number(item).toFixed(3)} MiB/s`, String(name)]} /><Legend /><Line type="monotone" dataKey="disk_read" name="Read" stroke="#10b981" strokeWidth={1.8} dot={false} isAnimationActive={false} /><Line type="monotone" dataKey="disk_write" name="Write" stroke="#f97316" strokeWidth={1.8} dot={false} isAnimationActive={false} /></LineChart></ResponsiveContainer>
      </RuntimeChart>
      <RuntimeChart title="Run concurrency" detail="Exact in-flight and queued jobs; an idle worker is represented by a zero baseline." icon={<Activity className="size-3.5" />} borderLeft borderTop>
        <ResponsiveContainer width="100%" height="100%"><LineChart data={pressure} margin={{ top: 8, right: 10, bottom: 0, left: 0 }}><CartesianGrid vertical={false} strokeDasharray="3 3" opacity={0.22} /><XAxis dataKey="timestamp" tickFormatter={formatTime} tick={{ fontSize: 9 }} minTickGap={32} /><YAxis allowDecimals={false} width={32} tick={{ fontSize: 9 }} /><Tooltip labelFormatter={(item) => formatTime(Number(item))} formatter={(item, name) => [Number(item).toLocaleString(), String(name)]} /><Legend /><Line type="stepAfter" dataKey="inflight" name="In-flight" stroke="#22d3ee" strokeWidth={1.8} dot={false} isAnimationActive={false} /><Line type="stepAfter" dataKey="queue" name="Queued" stroke="#f59e0b" strokeWidth={1.8} dot={false} isAnimationActive={false} /></LineChart></ResponsiveContainer>
      </RuntimeChart>
    </div>}
  </section>;
}

function RuntimeStat({ icon, label, value, detail }: { icon: JSX.Element; label: string; value: string; detail: string }): JSX.Element { return <div className="min-w-0 bg-card p-3"><p className="flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-wide text-muted-foreground">{icon}{label}</p><p className="mt-1 truncate font-mono text-sm font-semibold tabular-nums" title={value}>{value}</p><p className="mt-0.5 truncate text-[9px] text-muted-foreground" title={detail}>{detail}</p></div>; }
function RuntimeChart({ title, detail, icon, children, borderLeft = false, borderTop = false }: { title: string; detail: string; icon: JSX.Element; children: JSX.Element; borderLeft?: boolean; borderTop?: boolean }): JSX.Element { return <div className={`${borderLeft ? 'lg:border-l' : ''} ${borderTop ? 'border-t' : ''} border-border/60`}><div className="border-b border-border/50 px-4 py-3"><p className="flex items-center gap-1.5 text-xs font-medium">{icon}{title}</p><p className="mt-0.5 text-[10px] text-muted-foreground">{detail}</p></div><div className="h-[240px] p-3">{children}</div></div>; }
