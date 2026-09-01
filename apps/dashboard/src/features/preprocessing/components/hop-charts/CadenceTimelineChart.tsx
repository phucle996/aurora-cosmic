import { type JSX } from 'react';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
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
  const hasActiveRate = data.some((point) => Number(point.throughput ?? 0) > 0);
  const total = Math.max(0, metrics?.total_files ?? 0);
  const lightCurves = Math.max(0, metrics?.lightcurve_files ?? 0);
  const targetPixels = Math.max(0, metrics?.target_pixel_files ?? 0);
  const pending = Math.max(0, metrics?.pending_files ?? 0);
  const failed = Math.max(0, metrics?.failed_files ?? 0);
  const checkpointed = Math.max(0, total - pending - failed);
  const modalities = [
    { name: 'Light Curve', value: lightCurves, fill: '#22d3ee' },
    { name: 'Target Pixel', value: targetPixels, fill: '#a855f7' },
    ...(Math.max(0, total - lightCurves - targetPixels) > 0 ? [{ name: 'Unclassified', value: Math.max(0, total - lightCurves - targetPixels), fill: '#64748b' }] : []),
  ].filter((item) => item.value > 0);
  const states = [{ scope: 'Bronze inventory', checkpointed, pending, failed }];

  return <div className="space-y-3">
    <div className="grid gap-px border border-border/70 bg-border/70 sm:grid-cols-3 text-xs"><Metric label="Bronze FITS" value={total.toLocaleString()} /><Metric label="Awaiting Silver" value={pending.toLocaleString()} /><Metric label="Stored footprint" value={formatBytes(metrics?.bronze_bytes ?? 0)} /></div>
    <div className="grid gap-3 lg:grid-cols-[minmax(260px,0.38fr)_minmax(0,0.62fr)]">
      <section className="border border-border/70 bg-background/40"><div className="border-b border-border/60 px-3 py-2"><p className="font-medium">Product modality</p><p className="text-[10px] text-muted-foreground">Durable FITS inventory by scientific product kind.</p></div><div className="h-60"><ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={modalities} dataKey="value" nameKey="name" innerRadius={46} outerRadius={78} paddingAngle={2} stroke="none" label={({ name, value }) => `${name} · ${value}`}>{modalities.map((item) => <Cell key={item.name} fill={item.fill} />)}</Pie><Tooltip formatter={(item) => `${Number(item).toLocaleString()} FITS`} /></PieChart></ResponsiveContainer></div></section>
      <section className="border border-border/70 bg-background/40"><div className="border-b border-border/60 px-3 py-2"><p className="font-medium">Inventory disposition</p><p className="text-[10px] text-muted-foreground">Checkpointed, pending and terminal failure are mutually exclusive.</p></div><div className="h-60 p-3"><ResponsiveContainer width="100%" height="100%"><BarChart data={states} layout="vertical" margin={{ left: 24, right: 12 }}><CartesianGrid horizontal={false} strokeDasharray="3 3" opacity={0.18} /><XAxis type="number" allowDecimals={false} tick={{ fontSize: 10 }} /><YAxis type="category" dataKey="scope" width={96} tick={{ fontSize: 10 }} /><Tooltip formatter={(item) => Number(item).toLocaleString()} /><Legend /><Bar dataKey="checkpointed" name="Checkpointed" stackId="state" fill="#10b981" isAnimationActive={false} /><Bar dataKey="pending" name="Pending" stackId="state" fill="#f59e0b" isAnimationActive={false} /><Bar dataKey="failed" name="Failed" stackId="state" fill="#ef4444" isAnimationActive={false} /></BarChart></ResponsiveContainer></div></section>
    </div>
    {hasActiveRate ? <section className="border border-border/70 bg-background/40"><div className="border-b border-border/60 px-3 py-2"><p className="font-medium">Observed processing rate</p></div><div className="h-44 p-2"><ResponsiveContainer width="100%" height="100%"><AreaChart data={data}><defs><linearGradient id="bronze-rate" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#22d3ee" stopOpacity={0.35} /><stop offset="95%" stopColor="#22d3ee" stopOpacity={0.02} /></linearGradient></defs><CartesianGrid vertical={false} strokeDasharray="3 3" opacity={0.18} /><XAxis dataKey="timestamp" tickFormatter={clock} minTickGap={28} tick={{ fontSize: 10 }} /><YAxis tick={{ fontSize: 10 }} width={40} /><Tooltip labelFormatter={(item) => clock(Number(item))} formatter={(item) => `${Number(item).toFixed(3)} file/s`} /><Area dataKey="throughput" stroke="#22d3ee" fill="url(#bronze-rate)" dot={false} isAnimationActive={false} /></AreaChart></ResponsiveContainer></div></section> : <p className="border-l-2 border-muted-foreground/40 bg-background/40 px-3 py-2 text-[11px] text-muted-foreground">Không có activity trong observation window hiện tại; durable inventory phía trên vẫn là evidence của run đã hoàn tất.</p>}
  </div>;
}

function Metric({ label, value }: { label: string; value: string }): JSX.Element {
  return <div className="bg-background p-3"><p className="text-[10px] uppercase text-muted-foreground">{label}</p><p className="mt-1 font-mono font-semibold text-foreground">{value}</p></div>;
}
