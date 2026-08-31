import type { JSX } from 'react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { TelemetryUnavailable } from './TelemetryUnavailable';
import type { Telemetry } from './telemetry';

export function QualityMaskChart({ metrics, telemetry }: { mode?: 'stream' | 'batch'; metrics?: Record<string, number>; telemetry?: Telemetry; totalFiles?: number }): JSX.Element {
  if (!telemetry || Object.keys(telemetry).length === 0) return <TelemetryUnavailable detail="Prometheus chưa scrape science sample counters từ worker." />;
  const data = [
    { kind: 'LC', quality: metrics?.lc_quality_removed_rate ?? 0, invalid: metrics?.lc_invalid_removed_rate ?? 0 },
    { kind: 'TPF', quality: metrics?.tpf_quality_removed_rate ?? 0, invalid: metrics?.tpf_invalid_removed_rate ?? 0 },
  ];
  return <div className="space-y-2"><p className="text-[11px] text-muted-foreground">Cadence bị loại mỗi giây, đo trực tiếp trong quality/finite filter.</p><div className="h-[min(25svh,250px)]"><ResponsiveContainer width="100%" height="100%"><BarChart data={data}><CartesianGrid strokeDasharray="3 3" opacity={0.18} /><XAxis dataKey="kind" /><YAxis tick={{ fontSize: 10 }} /><Tooltip formatter={(value) => `${Number(value).toFixed(2)} cadence/s`} /><Bar dataKey="quality" name="QUALITY removed" fill="#f59e0b" isAnimationActive={false} /><Bar dataKey="invalid" name="Invalid removed" fill="#ef4444" isAnimationActive={false} /></BarChart></ResponsiveContainer></div></div>;
}
