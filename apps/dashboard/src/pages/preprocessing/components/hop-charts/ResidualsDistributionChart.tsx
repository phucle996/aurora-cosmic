import type { JSX } from 'react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { TelemetryUnavailable } from './TelemetryUnavailable';
import type { Telemetry } from './telemetry';

export function ResidualsDistributionChart({ metrics, telemetry }: { metrics?: Record<string, number>; telemetry?: Telemetry }): JSX.Element {
  if (!telemetry || Object.keys(telemetry).length === 0) return <TelemetryUnavailable detail="Prometheus chưa có output/outlier counters từ scientific transform." />;
  const data = [
    { kind: 'LC', output: metrics?.lc_output_rate ?? 0, removed: metrics?.lc_outlier_removed_rate ?? 0, p95: metrics?.lc_duration_p95 ?? 0 },
    { kind: 'TPF', output: metrics?.tpf_output_rate ?? 0, removed: 0, p95: metrics?.tpf_duration_p95 ?? 0 },
  ];
  return <div className="space-y-2"><div className="flex gap-4 text-[11px] text-muted-foreground"><span>LC p95: <b className="font-mono text-foreground">{(metrics?.lc_duration_p95 ?? 0).toFixed(2)}s</b></span><span>TPF p95: <b className="font-mono text-foreground">{(metrics?.tpf_duration_p95 ?? 0).toFixed(2)}s</b></span><span>TPF finite pixels: <b className="font-mono text-foreground">{((metrics?.tpf_finite_pixel_fraction ?? 0) * 100).toFixed(2)}%</b></span></div><div className="h-[min(24svh,240px)]"><ResponsiveContainer width="100%" height="100%"><BarChart data={data}><CartesianGrid strokeDasharray="3 3" opacity={0.18} /><XAxis dataKey="kind" /><YAxis tick={{ fontSize: 10 }} /><Tooltip formatter={(value, name) => name === 'p95' ? `${Number(value).toFixed(2)}s` : `${Number(value).toFixed(2)} cadence/s`} /><Bar dataKey="output" name="Retained output" fill="#10b981" isAnimationActive={false} /><Bar dataKey="removed" name="Sigma-clipped" fill="#a855f7" isAnimationActive={false} /></BarChart></ResponsiveContainer></div></div>;
}
