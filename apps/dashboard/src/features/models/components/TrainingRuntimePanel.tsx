import { useEffect, useMemo, useState, type JSX } from 'react';
import { Activity, Cpu, MemoryStick, MonitorCog, Server } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { apiFetch } from '@/lib/api';
import { formatBytes } from '../types';

type Point = { timestamp: string; value: number; labels?: Record<string, string> };
type Metric = { key: string; name: string; unit: string; points: Point[] };
type MonitoringResponse = { components?: { id: string; status: string; metrics: Metric[] }[] };

function latest(metrics: Metric[], key: string): number {
  const metric = metrics.find((item) => item.key === key);
  return metric?.points.at(-1)?.value ?? 0;
}

function MiniTrend({ points, ceiling = 0, tone = 'bg-primary/60' }: { points: Point[]; ceiling?: number; tone?: string }): JSX.Element {
  const values = points.map((point) => point.value).filter(Number.isFinite);
  const max = Math.max(ceiling, ...values, 1);
  return <div className="mt-3 flex h-14 items-end gap-0.5" aria-label="15 minute resource trend">{values.slice(-30).map((value, index) => <span key={index} className={`min-w-1 flex-1 rounded-t ${tone}`} style={{ height: `${Math.max(5, (value / max) * 100)}%` }} />)}</div>;
}

function sumPoints(first: Point[], second: Point[]): Point[] { return first.map((point, index) => ({ ...point, value: point.value + (second[index]?.value ?? 0) })); }
function rate(value: number): string { return `${formatBytes(value)}/s`; }

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
  const cpuSeconds = latest(metrics, 'cpu_time');
  const inflight = latest(metrics, 'inflight');
  const queue = latest(metrics, 'queue');
  const gpuUtilization = latest(metrics, 'gpu_utilization');
  const gpuMemoryUsed = latest(metrics, 'gpu_memory_used');
  const gpuMemoryTotal = latest(metrics, 'gpu_memory_total');
  const cpuCores = latest(metrics, 'cpu_cores');
  const cpuCoresTotal = latest(metrics, 'cpu_cores_total');
  const memoryTotal = latest(metrics, 'memory_total');
  const memoryTrend = useMemo(() => metrics.find((metric) => metric.key === 'memory')?.points ?? [], [metrics]);
  const cpuTrend = useMemo(() => metrics.find((metric) => metric.key === 'cpu_cores')?.points ?? [], [metrics]);
  const gpuTrend = useMemo(() => metrics.find((metric) => metric.key === 'gpu_utilization')?.points ?? [], [metrics]);
  const diskRead = useMemo(() => metrics.find((metric) => metric.key === 'disk_read')?.points ?? [], [metrics]);
  const diskWrite = useMemo(() => metrics.find((metric) => metric.key === 'disk_write')?.points ?? [], [metrics]);
  const diskTrend = useMemo(() => sumPoints(diskRead, diskWrite), [diskRead, diskWrite]);
  const cpuModel = metrics.find((metric) => metric.key === 'cpu_info')?.points.at(-1)?.labels?.model ?? 'Host CPU';

  return <Card className="border-cyan-500/30 bg-cyan-500/[0.035]">
    <CardHeader className="pb-3"><div className="flex flex-wrap items-start justify-between gap-3"><div><CardTitle className="flex items-center gap-2 text-base"><Server className="size-4 text-cyan-400" /> AI Training Runtime</CardTitle><CardDescription>Native systemd worker · cập nhật telemetry mỗi 15 giây</CardDescription></div><span className={`rounded-full px-2 py-1 text-[10px] font-semibold uppercase ${status === 'up' ? 'bg-emerald-500/15 text-emerald-300' : 'bg-amber-500/15 text-amber-300'}`}>{status === 'up' ? 'Worker online' : status === 'loading' ? 'Loading telemetry' : 'No telemetry'}</span></div></CardHeader>
    <CardContent className="grid gap-3 md:grid-cols-2">
      <ResourceChart icon={<Cpu className="size-4 text-amber-400" />} title="CPU" value={`${cpuCores.toFixed(2)} / ${cpuCoresTotal || '—'} cores`} detail={cpuModel} points={cpuTrend} ceiling={cpuCoresTotal} tone="bg-amber-400/70" />
      <ResourceChart icon={<MemoryStick className="size-4 text-violet-300" />} title="Memory" value={`${formatBytes(memory)} / ${formatBytes(memoryTotal)}`} detail="ML worker MemoryCurrent / host RAM" points={memoryTrend} ceiling={memoryTotal} tone="bg-violet-400/70" />
      <ResourceChart icon={<MonitorCog className="size-4 text-cyan-400" />} title="GPU" value={gpuMemoryTotal ? `${gpuUtilization.toFixed(0)}% · ${formatBytes(gpuMemoryUsed)} / ${formatBytes(gpuMemoryTotal)}` : 'CUDA runtime available'} detail="NVML utilization + VRAM · GPU runs only" points={gpuTrend} ceiling={100} tone="bg-cyan-400/70" />
      <ResourceChart icon={<Activity className="size-4 text-emerald-300" />} title="Disk I/O" value={`${rate(latest(metrics, 'disk_read'))} read · ${rate(latest(metrics, 'disk_write'))} write`} detail={`${inflight} active · ${queue} queued · ${cpuSeconds.toFixed(1)} CPU seconds`} points={diskTrend} tone="bg-emerald-400/70" />
      <p className="md:col-span-2 text-[10px] text-muted-foreground">Prometheus range: 15 minutes. CPU/RAM/Disk are scoped to the native ML worker service; GPU utilization and VRAM are sampled through NVML.</p>
    </CardContent>
  </Card>;
}

function ResourceChart({ icon, title, value, detail, points, ceiling, tone }: { icon: JSX.Element; title: string; value: string; detail: string; points: Point[]; ceiling?: number; tone: string }): JSX.Element { return <div className="rounded-lg border border-border/70 bg-background/50 p-3"><div className="flex items-center gap-2 text-xs text-muted-foreground">{icon}{title}</div><p className="mt-2 font-mono text-sm font-semibold">{value}</p><p className="mt-1 truncate text-[10px] text-muted-foreground" title={detail}>{detail}</p><MiniTrend points={points} ceiling={ceiling} tone={tone} /></div>; }
