import type { JSX } from 'react';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { TelemetryUnavailable } from './TelemetryUnavailable';
import { clock, mergedSeries, type Telemetry } from './telemetry';

function formatBytes(value: number): string {
  if (value <= 0) return '0 B';
  if (value < 1024 ** 3) return `${(value / 1024 ** 2).toFixed(2)} MB`;
  return `${(value / 1024 ** 3).toFixed(2)} GiB`;
}

export function CadenceTimelineChart({ metrics, telemetry }: { mode?: 'stream' | 'batch'; metrics?: Record<string, number>; telemetry?: Telemetry; totalFiles?: number }): JSX.Element {
  const observed = metrics?.inventory_observed === 1;
  if (!observed) return <TelemetryUnavailable detail="MinIO Bronze inventory chưa sẵn sàng." />;
  const data = mergedSeries(telemetry, ['throughput']);
  return <div className="space-y-3"><div className="grid gap-2 sm:grid-cols-3 text-xs"><Metric label="Bronze FITS" value={(metrics?.total_files ?? 0).toLocaleString()} /><Metric label="Chưa checkpoint Silver" value={(metrics?.pending_files ?? 0).toLocaleString()} /><Metric label="Footprint" value={formatBytes(metrics?.bronze_bytes ?? 0)} /></div>{data.length === 0 ? <TelemetryUnavailable detail="Prometheus chưa có throughput sample trong cửa sổ hiện tại." /> : <div className="h-[min(20svh,200px)]"><ResponsiveContainer width="100%" height="100%"><LineChart data={data}><CartesianGrid strokeDasharray="3 3" opacity={0.18} /><XAxis dataKey="timestamp" tickFormatter={clock} minTickGap={28} tick={{ fontSize: 10 }} /><YAxis tick={{ fontSize: 10 }} width={40} /><Tooltip labelFormatter={(value) => clock(Number(value))} formatter={(value) => `${Number(value).toFixed(3)} file/s`} /><Line dataKey="throughput" stroke="#22d3ee" dot={false} isAnimationActive={false} /></LineChart></ResponsiveContainer></div>}</div>;
}

function Metric({ label, value }: { label: string; value: string }): JSX.Element {
  return <div className="rounded-md border border-border/60 bg-background/50 p-3"><p className="text-[10px] uppercase text-muted-foreground">{label}</p><p className="mt-1 font-mono font-semibold text-foreground">{value}</p></div>;
}
