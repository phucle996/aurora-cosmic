import type { JSX } from 'react';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { TelemetryUnavailable } from './TelemetryUnavailable';
import { clock, mergedSeries, type Telemetry } from './telemetry';

function bytes(value: number): string {
  if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} KiB/s`;
  return `${(value / 1024 ** 2).toFixed(1)} MiB/s`;
}

export function SilverMaterializationChart({ metrics, telemetry }: { metrics?: Record<string, number>; telemetry?: Telemetry }): JSX.Element {
  const data = mergedSeries(telemetry, ['throughput']);
  if (data.length === 0) return <TelemetryUnavailable detail="Prometheus chưa có mẫu throughput Silver trong cửa sổ quan sát." />;
  return <div className="space-y-3"><div className="grid grid-cols-3 gap-2 text-xs"><Metric label="Artifact" value={`${(metrics?.throughput ?? 0).toFixed(2)} file/s`} /><Metric label="Bronze read" value={bytes(metrics?.bronze_bytes_rate ?? 0)} /><Metric label="Silver write" value={bytes(metrics?.silver_bytes_rate ?? 0)} /></div><div className="h-[min(22svh,220px)]"><ResponsiveContainer width="100%" height="100%"><LineChart data={data}><CartesianGrid strokeDasharray="3 3" opacity={0.18} /><XAxis dataKey="timestamp" tickFormatter={clock} minTickGap={28} tick={{ fontSize: 10 }} /><YAxis tick={{ fontSize: 10 }} width={42} /><Tooltip labelFormatter={(value) => clock(Number(value))} formatter={(value) => [`${Number(value).toFixed(3)} file/s`, 'Silver throughput']} /><Line type="monotone" dataKey="throughput" stroke="#22d3ee" dot={false} isAnimationActive={false} /></LineChart></ResponsiveContainer></div></div>;
}

function Metric({ label, value }: { label: string; value: string }): JSX.Element {
  return <div className="rounded-md border border-border/60 bg-background/50 p-2"><p className="text-[10px] uppercase text-muted-foreground">{label}</p><p className="font-mono font-semibold">{value}</p></div>;
}
