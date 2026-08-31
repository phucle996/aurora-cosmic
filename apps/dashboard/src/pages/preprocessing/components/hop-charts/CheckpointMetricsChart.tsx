import type { JSX } from 'react';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { clock, mergedSeries, type Telemetry } from './telemetry';

export function CheckpointMetricsChart({ metrics, telemetry }: { metrics?: Record<string, number>; telemetry?: Telemetry }): JSX.Element {
  const data = mergedSeries(telemetry, ['throughput']);
  return <div className="space-y-3"><div className="grid gap-2 sm:grid-cols-4 text-xs"><Metric label="Checkpoint tổng" value={metrics?.checkpoint_total ?? 0} /><Metric label="Đã hoàn tất" value={metrics?.checkpoint_completed ?? 0} /><Metric label="Đang chờ" value={metrics?.checkpoint_pending ?? 0} /><Metric label="Lỗi terminal" value={metrics?.checkpoint_failed ?? 0} /></div>{data.length > 0 && <div className="h-[min(18svh,180px)]"><ResponsiveContainer width="100%" height="100%"><LineChart data={data}><CartesianGrid strokeDasharray="3 3" opacity={0.18} /><XAxis dataKey="timestamp" tickFormatter={clock} minTickGap={28} tick={{ fontSize: 10 }} /><YAxis tick={{ fontSize: 10 }} width={40} /><Tooltip labelFormatter={(value) => clock(Number(value))} formatter={(value) => `${Number(value).toFixed(3)} file/s`} /><Line dataKey="throughput" stroke="#10b981" dot={false} isAnimationActive={false} /></LineChart></ResponsiveContainer></div>}</div>;
}

function Metric({ label, value }: { label: string; value: number }): JSX.Element {
  return <div className="rounded-md border border-border/60 bg-background/50 p-3"><p className="text-[10px] uppercase text-muted-foreground">{label}</p><p className="mt-1 font-mono font-semibold text-foreground">{value.toLocaleString()}</p></div>;
}
