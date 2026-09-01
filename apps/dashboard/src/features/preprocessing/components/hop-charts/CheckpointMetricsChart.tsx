import { type JSX } from 'react';
import { Area, AreaChart, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis, CartesianGrid } from 'recharts';
import { clock, mergedSeries, type Telemetry } from './telemetry';

export function CheckpointMetricsChart({ metrics, telemetry }: { metrics?: Record<string, number>; telemetry?: Telemetry }): JSX.Element {
  const data = mergedSeries(telemetry, ['throughput']);
  const completed = Math.max(0, metrics?.checkpoint_completed ?? 0);
  const pending = Math.max(0, metrics?.checkpoint_pending ?? 0);
  const failed = Math.max(0, metrics?.checkpoint_failed ?? 0);
  const total = Math.max(metrics?.checkpoint_total ?? 0, completed + pending + failed);
  const disposition = [
    { name: 'Completed', value: completed, fill: '#10b981' },
    { name: 'Pending', value: pending, fill: '#f59e0b' },
    { name: 'Terminal failure', value: failed, fill: '#ef4444' },
  ].filter((item) => item.value > 0);
  const hasActiveRate = data.some((point) => Number(point.throughput ?? 0) > 0);
  return <div className="space-y-3"><div className="grid gap-px border border-border/70 bg-border/70 sm:grid-cols-4 text-xs"><Metric label="Checkpoint total" value={total} /><Metric label="Completed" value={completed} /><Metric label="Pending" value={pending} /><Metric label="Terminal failure" value={failed} /></div><div className="grid gap-3 lg:grid-cols-2"><section className="border border-border/70 bg-background/40"><div className="border-b border-border/60 px-3 py-2"><p className="font-medium">Durable state distribution</p><p className="text-[10px] text-muted-foreground">Mutually exclusive checkpoint outcomes.</p></div><div className="h-64"><ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={disposition} dataKey="value" nameKey="name" innerRadius={52} outerRadius={84} paddingAngle={2} stroke="none" label={({ name, value }) => `${name} · ${value}`}>{disposition.map((item) => <Cell key={item.name} fill={item.fill} />)}</Pie><Tooltip formatter={(item) => `${Number(item).toLocaleString()} checkpoints`} /></PieChart></ResponsiveContainer></div></section><section className="border border-border/70 bg-background/40"><div className="border-b border-border/60 px-3 py-2"><p className="font-medium">Checkpoint throughput</p><p className="text-[10px] text-muted-foreground">Rate is drawn only while non-zero samples are observed.</p></div>{hasActiveRate ? <div className="h-64 p-2"><ResponsiveContainer width="100%" height="100%"><AreaChart data={data}><CartesianGrid vertical={false} strokeDasharray="3 3" opacity={0.18} /><XAxis dataKey="timestamp" tickFormatter={clock} minTickGap={28} tick={{ fontSize: 10 }} /><YAxis tick={{ fontSize: 10 }} width={40} /><Tooltip labelFormatter={(item) => clock(Number(item))} formatter={(item) => `${Number(item).toFixed(3)} file/s`} /><Area dataKey="throughput" stroke="#10b981" fill="#10b981" fillOpacity={0.16} dot={false} isAnimationActive={false} /></AreaChart></ResponsiveContainer></div> : <div className="flex h-64 items-center justify-center p-6 text-center text-xs text-muted-foreground">Run đang idle; không biến chuỗi 0 thành biểu đồ activity. Durable state distribution vẫn được giữ ở bên trái.</div>}</section></div></div>;
}

function Metric({ label, value }: { label: string; value: number }): JSX.Element {
  return <div className="bg-background p-3"><p className="text-[10px] uppercase text-muted-foreground">{label}</p><p className="mt-1 font-mono font-semibold text-foreground">{value.toLocaleString()}</p></div>;
}
