import { type JSX } from 'react';
import {
  Area, Bar, BarChart, CartesianGrid, Cell, ComposedChart, Legend, Line,
  ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis,
} from 'recharts';

import type { Hop } from '../../types';
import { TelemetryUnavailable } from './TelemetryUnavailable';
import { clock, mergedSeries, type Telemetry } from './telemetry';

type MaterializationPoint = NonNullable<Hop['materialization_points']>[number];
type EncodeFailure = NonNullable<Hop['encode_failures']>[number];

const SIZE_BUCKETS = [
  { label: '<1', upper: 1 },
  { label: '1–2', upper: 2 },
  { label: '2–5', upper: 5 },
  { label: '5–10', upper: 10 },
  { label: '10–25', upper: 25 },
  { label: '25–50', upper: 50 },
  { label: '≥50', upper: Number.POSITIVE_INFINITY },
];

function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '0 B';
  if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} KiB`;
  if (value < 1024 ** 3) return `${(value / 1024 ** 2).toFixed(2)} MiB`;
  return `${(value / 1024 ** 3).toFixed(2)} GiB`;
}

export function SilverMaterializationChart({
  metrics, telemetry, focus, materializationPoints, encodeFailures,
}: {
  metrics?: Record<string, number>;
  telemetry?: Telemetry;
  focus?: 'lightcurve' | 'target-pixel';
  materializationPoints?: MaterializationPoint[];
  encodeFailures?: EncodeFailure[];
}): JSX.Element {
  const lightCurves = Math.max(0, metrics?.silver_lightcurves ?? 0);
  const targetPixels = Math.max(0, metrics?.silver_target_pixels ?? 0);
  const artifacts = focus === 'lightcurve' ? lightCurves : focus === 'target-pixel' ? targetPixels : Math.max(0, metrics?.silver_objects ?? 0);
  const points = (materializationPoints ?? []).filter((point) => !focus || matchesKind(point.product_kind, focus));
  const failures = (encodeFailures ?? []).filter((failure) => !focus || matchesKind(failure.product_kind, focus));

  if (artifacts === 0 && points.length === 0) return <TelemetryUnavailable detail="Chưa có Parquet artifact bền vững cho phase này." />;
  if (!focus || points.length === 0) return <StoredFootprintSummary metrics={metrics} telemetry={telemetry} />;

  const encoded = points.length;
  const failed = failures.filter((failure) => !failure.recovered).length;
  const recovered = failures.filter((failure) => failure.recovered).length;
  const finalAttempts = encoded + failed;
  const successRate = finalAttempts > 0 ? encoded / finalAttempts : 0;
  const totalBytes = points.reduce((sum, point) => sum + point.size_bytes, 0);
  const sizes = points.map((point) => point.size_bytes).sort((a, b) => a - b);
  const medianSize = quantile(sizes, 0.5);
  const p95Size = quantile(sizes, 0.95);
  const durations = points.map((point) => point.encode_duration_ms).filter((value) => value > 0).sort((a, b) => a - b);
  const ratios = points.filter((point) => point.source_bytes > 0 && point.size_bytes > 0).map((point) => point.source_bytes / point.size_bytes);
  const medianRatio = quantile(ratios.sort((a, b) => a - b), 0.5);
  const sizeHistogram = SIZE_BUCKETS.map((bucket, index) => {
    const lower = index === 0 ? Number.NEGATIVE_INFINITY : SIZE_BUCKETS[index - 1].upper;
    return { bucket: bucket.label, artifacts: points.filter((point) => {
      const sizeMiB = point.size_bytes / 1024 ** 2;
      return sizeMiB > lower && sizeMiB <= bucket.upper;
    }).length };
  });
  const artifactScatter = points.filter((point) => point.rows > 0).map((point) => ({
    ...point,
    artifact: shortObjectKey(point.object_key),
    sizeMiB: point.size_bytes / 1024 ** 2,
    compressionRatio: point.source_bytes > 0 ? point.source_bytes / point.size_bytes : 0,
  }));
  const timeline = buildTimeline(points, failures);

  return <div className="space-y-3">
    <div className="grid grid-cols-2 gap-px border border-border/70 bg-border/70 text-xs lg:grid-cols-7">
      <Metric label="Encoded" value={`${encoded.toLocaleString()} / ${finalAttempts.toLocaleString()}`} detail={percent(successRate)} />
      <Metric label="Failed" value={failed.toLocaleString()} detail={recovered > 0 ? `${recovered} recovered` : 'final failures'} />
      <Metric label="Parquet footprint" value={formatBytes(totalBytes)} detail={`${encoded} artifacts`} />
      <Metric label="Artifact P50" value={formatBytes(medianSize)} detail={`P95 ${formatBytes(p95Size)}`} />
      <Metric label="Compression P50" value={medianRatio > 0 ? `${medianRatio.toFixed(2)}×` : '—'} detail="Bronze / Parquet" />
      <Metric label="Encode duration P50" value={durations.length > 0 ? formatDuration(quantile(durations, 0.5)) : '—'} detail={durations.length > 0 ? `P95 ${formatDuration(quantile(durations, 0.95))}` : 'new artifacts'} />
      <Metric label="Rows encoded" value={points.reduce((sum, point) => sum + point.rows, 0).toLocaleString()} detail={focus === 'lightcurve' ? 'LC cadences' : 'TPF cadences'} />
    </div>

    <div className="grid gap-3 xl:grid-cols-2">
      <section className="border border-border/70 bg-background/40">
        <ChartHeader title="Encode outcomes over time" detail="Artifact hoàn tất và lỗi Parquet được đặt theo timestamp bền vững; upload không thuộc chart này." />
        <div className="h-64 p-3"><ResponsiveContainer width="100%" height="100%"><BarChart data={timeline}>
          <CartesianGrid vertical={false} strokeDasharray="3 3" opacity={0.18} />
          <XAxis dataKey="timestamp" tickFormatter={clock} minTickGap={30} tick={{ fontSize: 9 }} />
          <YAxis allowDecimals={false} tick={{ fontSize: 9 }} width={34} />
          <Tooltip labelFormatter={(value) => new Date(Number(value) * 1000).toLocaleString()} formatter={(value) => `${Number(value).toLocaleString()} artifacts`} />
          <Legend /><Bar dataKey="encoded" name="Encoded" stackId="outcome" fill="#22d3ee" isAnimationActive={false} /><Bar dataKey="recovered" name="Recovered" stackId="outcome" fill="#f59e0b" isAnimationActive={false} /><Bar dataKey="failed" name="Failed" stackId="outcome" fill="#ef4444" isAnimationActive={false} />
        </BarChart></ResponsiveContainer></div>
      </section>

      <section className="border border-border/70 bg-background/40">
        <ChartHeader title="Artifact size distribution" detail="Số Parquet artifact trong từng dải dung lượng MiB; P50/P95 giúp nhận ra file quá nhỏ hoặc quá lớn." />
        <div className="h-64 p-3"><ResponsiveContainer width="100%" height="100%"><BarChart data={sizeHistogram}>
          <CartesianGrid vertical={false} strokeDasharray="3 3" opacity={0.18} /><XAxis dataKey="bucket" tick={{ fontSize: 9 }} label={{ value: 'Artifact size · MiB', position: 'insideBottom', offset: -4, fontSize: 9 }} /><YAxis allowDecimals={false} tick={{ fontSize: 9 }} width={34} /><Tooltip formatter={(value) => `${Number(value).toLocaleString()} artifacts`} /><Bar dataKey="artifacts" name="Parquet artifacts" fill="#22d3ee" isAnimationActive={false} />
        </BarChart></ResponsiveContainer></div>
      </section>
    </div>

    <section className="border border-border/70 bg-background/40">
      <ChartHeader title="Rows vs Parquet size" detail="Mỗi điểm là một artifact; điểm lệch khỏi xu hướng rows–size có thể là schema, cadence hoặc compression bất thường." />
      <div className="h-72 p-3"><ResponsiveContainer width="100%" height="100%"><ScatterChart margin={{ left: 6, right: 18, top: 10, bottom: 10 }}>
        <CartesianGrid strokeDasharray="3 3" opacity={0.18} /><XAxis type="number" dataKey="rows" name="Rows" tickFormatter={(value) => Number(value).toLocaleString()} tick={{ fontSize: 9 }} label={{ value: 'Encoded rows', position: 'insideBottom', offset: -7, fontSize: 10 }} /><YAxis type="number" dataKey="sizeMiB" name="Size" tickFormatter={(value) => `${Number(value).toFixed(1)}`} tick={{ fontSize: 9 }} width={48} label={{ value: 'Parquet · MiB', angle: -90, position: 'insideLeft', fontSize: 10 }} /><Tooltip content={<ArtifactTooltip />} /><Scatter data={artifactScatter} name="Artifact" isAnimationActive={false}>{artifactScatter.map((point) => <Cell key={point.object_key} fill={point.compressionRatio >= 1 ? '#10b981' : point.compressionRatio > 0 ? '#f97316' : '#22d3ee'} fillOpacity={0.72} />)}</Scatter>
      </ScatterChart></ResponsiveContainer></div>
    </section>

    {failures.length > 0 ? <FailureReasons failures={failures} /> : <div className="border border-emerald-500/30 bg-emerald-500/5 px-3 py-2 text-[11px] text-emerald-700 dark:text-emerald-300">No Parquet encode failures observed for this phase.</div>}
  </div>;
}

function StoredFootprintSummary({ metrics, telemetry }: { metrics?: Record<string, number>; telemetry?: Telemetry }): JSX.Element {
  const lightCurves = Math.max(0, metrics?.silver_lightcurves ?? 0);
  const targetPixels = Math.max(0, metrics?.silver_target_pixels ?? 0);
  const footprintBytes = Math.max(0, metrics?.silver_bytes ?? 0);
  const recent = mergedSeries(telemetry, ['throughput', 'bronze_bytes_rate', 'silver_bytes_rate']);
  const hasActivity = recent.some((point) => Number(point.throughput ?? 0) > 0 || Number(point.silver_bytes_rate ?? 0) > 0);
  const data = [{ kind: 'Light curves', artifacts: lightCurves, fill: '#22d3ee' }, { kind: 'Target pixels', artifacts: targetPixels, fill: '#10b981' }].filter((item) => item.artifacts > 0);
  return <div className="space-y-3">
    <div className="grid grid-cols-3 gap-px border border-border/70 bg-border/70"><Metric label="Verified objects" value={(lightCurves + targetPixels).toLocaleString()} /><Metric label="Stored footprint" value={formatBytes(footprintBytes)} /><Metric label="Mean object" value={formatBytes(footprintBytes / Math.max(1, lightCurves + targetPixels))} /></div>
    <div className="h-56 border border-border/60 bg-background/40 p-2"><ResponsiveContainer width="100%" height="100%"><BarChart data={data}><CartesianGrid vertical={false} strokeDasharray="3 3" opacity={0.18} /><XAxis dataKey="kind" tick={{ fontSize: 10 }} /><YAxis allowDecimals={false} tick={{ fontSize: 10 }} /><Tooltip formatter={(value) => `${Number(value).toLocaleString()} verified objects`} /><Bar dataKey="artifacts" name="Verified objects" isAnimationActive={false}>{data.map((entry) => <Cell key={entry.kind} fill={entry.fill} />)}</Bar></BarChart></ResponsiveContainer></div>
    {hasActivity && <div className="h-52 border border-border/60 bg-background/40 p-2"><ResponsiveContainer width="100%" height="100%"><ComposedChart data={recent}><CartesianGrid vertical={false} strokeDasharray="3 3" opacity={0.18} /><XAxis dataKey="timestamp" tickFormatter={clock} tick={{ fontSize: 9 }} /><YAxis tickFormatter={(value) => formatBytes(Number(value))} tick={{ fontSize: 9 }} width={58} /><Tooltip formatter={(value) => `${formatBytes(Number(value))}/s`} /><Legend /><Area dataKey="bronze_bytes_rate" name="Source read" stroke="#22d3ee" fill="#22d3ee" fillOpacity={0.14} /><Area dataKey="silver_bytes_rate" name="Stored write" stroke="#10b981" fill="#10b981" fillOpacity={0.14} /><Line dataKey="throughput" name="Objects/s" stroke="#f59e0b" dot={false} /></ComposedChart></ResponsiveContainer></div>}
  </div>;
}

function buildTimeline(points: MaterializationPoint[], failures: EncodeFailure[]): Array<{ timestamp: number; encoded: number; failed: number; recovered: number }> {
  const timestamps = [...points.map((point) => Date.parse(point.completed_at)), ...failures.map((failure) => Date.parse(failure.occurred_at))].filter(Number.isFinite);
  if (timestamps.length === 0) return [{ timestamp: Date.now() / 1000, encoded: points.length, failed: failures.filter((item) => !item.recovered).length, recovered: failures.filter((item) => item.recovered).length }];
  const range = Math.max(...timestamps) - Math.min(...timestamps);
  const bucketMS = Math.max(60_000, Math.ceil(range / 12 / 60_000) * 60_000);
  const buckets = new Map<number, { timestamp: number; encoded: number; failed: number; recovered: number }>();
  const bucket = (milliseconds: number) => Math.floor(milliseconds / bucketMS) * bucketMS;
  for (const point of points) {
    const key = bucket(Date.parse(point.completed_at));
    const item = buckets.get(key) ?? { timestamp: key / 1000, encoded: 0, failed: 0, recovered: 0 };
    item.encoded += 1; buckets.set(key, item);
  }
  for (const failure of failures) {
    const key = bucket(Date.parse(failure.occurred_at));
    const item = buckets.get(key) ?? { timestamp: key / 1000, encoded: 0, failed: 0, recovered: 0 };
    if (failure.recovered) item.recovered += 1; else item.failed += 1;
    buckets.set(key, item);
  }
  return [...buckets.values()].sort((a, b) => a.timestamp - b.timestamp);
}

function FailureReasons({ failures }: { failures: EncodeFailure[] }): JSX.Element {
  const grouped = new Map<string, { reason: string; failed: number; recovered: number }>();
  for (const failure of failures) {
    const reason = compactReason(failure.reason);
    const item = grouped.get(reason) ?? { reason, failed: 0, recovered: 0 };
    if (failure.recovered) item.recovered += 1; else item.failed += 1;
    grouped.set(reason, item);
  }
  return <section className="border border-border/70 bg-background/40"><ChartHeader title="Parquet failure reasons" detail="Chỉ gồm lỗi Arrow/local writer/finalize/checksum của Step 05; không gồm lỗi upload." /><div className="h-48 p-3"><ResponsiveContainer width="100%" height="100%"><BarChart data={[...grouped.values()]} layout="vertical"><CartesianGrid horizontal={false} strokeDasharray="3 3" opacity={0.18} /><XAxis type="number" allowDecimals={false} /><YAxis type="category" dataKey="reason" width={150} tick={{ fontSize: 9 }} /><Tooltip /><Legend /><Bar dataKey="recovered" name="Recovered" stackId="failure" fill="#f59e0b" /><Bar dataKey="failed" name="Failed" stackId="failure" fill="#ef4444" /></BarChart></ResponsiveContainer></div></section>;
}

function ArtifactTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload?: MaterializationPoint & { artifact: string; sizeMiB: number; compressionRatio: number } }> }): JSX.Element | null {
  const point = payload?.[0]?.payload;
  if (!active || !point) return null;
  return <div className="border border-border bg-background p-2 text-[10px] shadow-lg"><p className="max-w-80 truncate font-mono font-semibold">{point.artifact}</p><p>Rows: <strong>{point.rows.toLocaleString()}</strong></p><p>Parquet: <strong>{formatBytes(point.size_bytes)}</strong></p><p>Source: <strong>{formatBytes(point.source_bytes)}</strong></p><p>Compression: <strong>{point.compressionRatio > 0 ? `${point.compressionRatio.toFixed(2)}×` : '—'}</strong></p>{point.encode_duration_ms > 0 && <p>Encode: <strong>{formatDuration(point.encode_duration_ms)}</strong></p>}</div>;
}

function Metric({ label, value, detail }: { label: string; value: string; detail?: string }): JSX.Element {
  return <div className="bg-background p-3"><p className="text-[9px] uppercase text-muted-foreground">{label}</p><p className="mt-1 font-mono font-semibold">{value}</p>{detail && <p className="font-mono text-[9px] text-muted-foreground">{detail}</p>}</div>;
}
function ChartHeader({ title, detail }: { title: string; detail: string }): JSX.Element {
  return <div className="border-b border-border/60 px-3 py-2"><p className="font-medium">{title}</p><p className="text-[10px] text-muted-foreground">{detail}</p></div>;
}
function quantile(values: number[], q: number): number {
  if (values.length === 0) return 0;
  const position = q * (values.length - 1); const lower = Math.floor(position); const upper = Math.ceil(position);
  return lower === upper ? values[lower] : values[lower] * (upper - position) + values[upper] * (position - lower);
}
function percent(value: number): string { return `${(value * 100).toFixed(2)}%`; }
function formatDuration(milliseconds: number): string { return milliseconds < 1_000 ? `${milliseconds.toFixed(0)} ms` : `${(milliseconds / 1_000).toFixed(2)} s`; }
function shortObjectKey(value: string): string { return value.split('/').at(-1) || value; }
function compactReason(value: string): string {
  const normalized = value.toLowerCase();
  if (normalized.includes('recordbatch')) return 'Arrow RecordBatch';
  if (normalized.includes('finalize')) return 'Parquet finalize';
  if (normalized.includes('hash')) return 'Local checksum';
  if (normalized.includes('parquet')) return 'Parquet writer';
  return 'Local encode';
}
function matchesKind(value: string, focus: 'lightcurve' | 'target-pixel'): boolean {
  const normalized = value.toLowerCase().replaceAll('-', '_');
  return focus === 'lightcurve' ? normalized === 'lightcurve' || normalized === 'light_curve' : normalized === 'target_pixel' || normalized === 'targetpixel';
}
