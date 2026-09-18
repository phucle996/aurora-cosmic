import { type JSX } from 'react';
import {
  Area, Bar, BarChart, CartesianGrid, Cell, ComposedChart, Legend, Line,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';

import type { Hop } from '../../types';
import { TelemetryUnavailable } from './TelemetryUnavailable';
import { clock, mergedSeries, type Telemetry } from './telemetry';

type MaterializationPoint = NonNullable<Hop['materialization_points']>[number];
type EncodeFailure = NonNullable<Hop['encode_failures']>[number];
type SilverFailure = NonNullable<Hop['silver_failures']>[number];

function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '0 B';
  if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} KiB`;
  if (value < 1024 ** 3) return `${(value / 1024 ** 2).toFixed(2)} MiB`;
  return `${(value / 1024 ** 3).toFixed(2)} GiB`;
}

export function SilverMaterializationChart({
  metrics, telemetry, focus, materializationPoints, encodeFailures, silverFailures,
}: {
  metrics?: Record<string, number>;
  telemetry?: Telemetry;
  focus?: 'lightcurve' | 'target-pixel';
  materializationPoints?: MaterializationPoint[];
  encodeFailures?: EncodeFailure[];
  silverFailures?: SilverFailure[];
}): JSX.Element {
  const lightCurves = Math.max(0, metrics?.silver_lightcurves ?? 0);
  const targetPixels = Math.max(0, metrics?.silver_target_pixels ?? 0);
  const artifacts = focus === 'lightcurve' ? lightCurves : focus === 'target-pixel' ? targetPixels : Math.max(0, metrics?.silver_objects ?? 0);
  const points = (materializationPoints ?? []).filter((point) => !focus || matchesKind(point.product_kind, focus));
  const failures = (encodeFailures ?? []).filter((failure) => !focus || matchesKind(failure.product_kind, focus));

  if (artifacts === 0 && points.length === 0) return <TelemetryUnavailable detail="Chưa có Parquet artifact bền vững cho phase này." />;
  if (!focus || points.length === 0) return <StoredFootprintSummary metrics={metrics} telemetry={telemetry} points={points} failures={silverFailures ?? []} />;

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
  const sizeHistogram = buildSizeHistogram(points);
  const rowBands = buildRowBands(points);
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
        <ChartHeader title="Artifact size distribution" detail={`Bucket thích ứng với footprint của run và đang dùng ${sizeHistogram.unit}; P50/P95 giúp nhận ra file quá nhỏ hoặc quá lớn.`} />
        <div className="h-64 p-3"><ResponsiveContainer width="100%" height="100%"><BarChart data={sizeHistogram}>
          <CartesianGrid vertical={false} strokeDasharray="3 3" opacity={0.18} /><XAxis dataKey="bucket" tick={{ fontSize: 9 }} interval={0} label={{ value: `Artifact size · ${sizeHistogram.unit}`, position: 'insideBottom', offset: -4, fontSize: 9 }} /><YAxis allowDecimals={false} tick={{ fontSize: 9 }} width={34} /><Tooltip formatter={(value) => `${Number(value).toLocaleString()} artifacts`} /><Bar dataKey="artifacts" name="Parquet artifacts" fill="#22d3ee" isAnimationActive={false} />
        </BarChart></ResponsiveContainer></div>
      </section>
    </div>

    <section className="border border-border/70 bg-background/40">
      <ChartHeader title="Artifact profile by row-count band" detail="Dung lượng và số artifact được tách riêng để không trộn hai đơn vị trên cùng một trục." />
      <div className="grid gap-3 p-3 xl:grid-cols-[minmax(0,1.6fr)_minmax(320px,1fr)]">
        <div className="border border-border/60 bg-background/40">
          <div className="border-b border-border/50 px-3 py-2"><p className="font-medium">Parquet size P50 / P95</p><p className="text-[10px] text-muted-foreground">KiB theo từng dải encoded rows.</p></div>
          <div className="h-64 p-2"><ResponsiveContainer width="100%" height="100%"><BarChart data={rowBands.map((band) => ({ ...band, medianKiB: band.medianMiB * 1024, p95KiB: band.p95MiB * 1024 }))} margin={{ left: 4, right: 10, top: 24, bottom: 4 }}>
            <CartesianGrid vertical={false} strokeDasharray="3 3" opacity={0.18} /><XAxis dataKey="band" tick={{ fontSize: 9 }} /><YAxis tickFormatter={(value) => `${Number(value).toFixed(0)}`} tick={{ fontSize: 9 }} width={44} label={{ value: 'KiB', angle: -90, position: 'insideLeft', fontSize: 10 }} /><Tooltip content={<RowBandTooltip />} /><Legend verticalAlign="top" align="right" wrapperStyle={{ top: 0, fontSize: 10 }} /><Bar dataKey="medianKiB" name="Size P50" fill="#22d3ee" isAnimationActive={false} /><Bar dataKey="p95KiB" name="Size P95" fill="#f59e0b" isAnimationActive={false} />
          </BarChart></ResponsiveContainer></div>
        </div>
        <div className="border border-border/60 bg-background/40">
          <div className="border-b border-border/50 px-3 py-2"><p className="font-medium">Artifact count</p><p className="text-[10px] text-muted-foreground">Mức độ tập trung của dataset theo row band.</p></div>
          <div className="h-64 p-2"><ResponsiveContainer width="100%" height="100%"><BarChart data={rowBands} margin={{ left: 4, right: 10, top: 12, bottom: 4 }}>
            <CartesianGrid vertical={false} strokeDasharray="3 3" opacity={0.18} /><XAxis dataKey="band" tick={{ fontSize: 9 }} /><YAxis allowDecimals={false} tick={{ fontSize: 9 }} width={38} /><Tooltip formatter={(value) => `${Number(value).toLocaleString()} artifacts`} /><Bar dataKey="count" name="Artifacts" fill="#64748b" isAnimationActive={false} />
          </BarChart></ResponsiveContainer></div>
        </div>
      </div>
    </section>

    {failures.length > 0 ? <FailureReasons failures={failures} /> : <div className="border border-emerald-500/30 bg-emerald-500/5 px-3 py-2 text-[11px] text-emerald-700 dark:text-emerald-300">No Parquet encode failures observed for this phase.</div>}
  </div>;
}

function StoredFootprintSummary({ metrics, telemetry, points, failures }: { metrics?: Record<string, number>; telemetry?: Telemetry; points: MaterializationPoint[]; failures: SilverFailure[] }): JSX.Element {
  const lightCurves = Math.max(0, metrics?.silver_lightcurves ?? 0);
  const targetPixels = Math.max(0, metrics?.silver_target_pixels ?? 0);
  const footprintBytes = Math.max(0, metrics?.silver_bytes ?? 0);
  const recent = mergedSeries(telemetry, ['throughput', 'bronze_bytes_rate', 'silver_bytes_rate']);
  const hasActivity = recent.some((point) => Number(point.throughput ?? 0) > 0 || Number(point.silver_bytes_rate ?? 0) > 0);
  const observed = points.filter((point) => point.size_bytes > 0);
  const total = observed.length || lightCurves + targetPixels;
  const linked = observed.filter((point) => point.checkpoint_linked).length;
  const sizeVerified = observed.filter((point) => point.size_verified).length;
  const checksumBound = observed.filter((point) => point.checksum_bound).length;
  const schemaVerified = observed.filter((point) => point.schema_verified).length;
  const lineageBound = observed.filter((point) => point.lineage_bound).length;
  const verified = observed.filter((point) => point.integrity_verified).length;
  const retried = observed.filter((point) => point.verification_attempts > 1).length;
  const finalUploadFailures = failures.filter((failure) => !failure.recovered).length;
  const recoveredUploadFailures = failures.filter((failure) => failure.recovered).length;
  const sizes = observed.map((point) => point.size_bytes).sort((a, b) => a - b);
  const funnel = [
    { stage: 'Stored object', count: observed.length, fill: '#64748b' },
    { stage: 'Checkpoint linked', count: linked, fill: '#22d3ee' },
    { stage: 'Size matched', count: sizeVerified, fill: '#38bdf8' },
    { stage: 'SHA bound', count: checksumBound, fill: '#8b5cf6' },
    { stage: 'Schema matched', count: schemaVerified, fill: '#a855f7' },
    { stage: 'Lineage bound', count: lineageBound, fill: '#14b8a6' },
    { stage: 'Fully verified', count: verified, fill: '#10b981' },
  ];
  const modality = [
    verificationModalityRow('Light curves', observed.filter((point) => matchesKind(point.product_kind, 'lightcurve'))),
    verificationModalityRow('Target pixels', observed.filter((point) => matchesKind(point.product_kind, 'target-pixel'))),
  ].filter((row) => row.total > 0);
  const deposition = buildVerificationTimeline(observed);
  const anomalies = observed.filter((point) => !point.integrity_verified);
  return <div className="space-y-3">
    <div className="grid grid-cols-2 gap-px border border-border/70 bg-border/70 md:grid-cols-4 xl:grid-cols-8"><Metric label="Integrity verified" value={`${verified.toLocaleString()} / ${total.toLocaleString()}`} detail={percent(verified / Math.max(1, total))} /><Metric label="Checkpoint linked" value={linked.toLocaleString()} detail={percent(linked / Math.max(1, total))} /><Metric label="SHA metadata bound" value={checksumBound.toLocaleString()} detail={percent(checksumBound / Math.max(1, total))} /><Metric label="Stored footprint" value={formatBytes(footprintBytes)} detail={`${lightCurves} LC · ${targetPixels} TPF`} /><Metric label="Artifact P50" value={formatBytes(quantile(sizes, 0.50))} detail={`P95 ${formatBytes(quantile(sizes, 0.95))}`} /><Metric label="Verification retries" value={retried.toLocaleString()} detail="attempts > 1" /><Metric label="Upload failures" value={finalUploadFailures.toLocaleString()} detail="terminal / unresolved" /><Metric label="Recovered uploads" value={recoveredUploadFailures.toLocaleString()} detail="succeeded after retry" /></div>

    <section className="border border-border/70 bg-background/40"><ChartHeader title="Silver integrity verification funnel" detail="Một artifact chỉ đạt fully verified khi object tồn tại và checkpoint, byte size, SHA metadata, schema cùng lineage binding đều khớp." /><div className="grid gap-3 p-3 xl:grid-cols-[minmax(0,1.5fr)_minmax(360px,1fr)]"><div className="h-64"><ResponsiveContainer width="100%" height="100%"><BarChart data={funnel} layout="vertical" margin={{ left: 22, right: 18 }}><CartesianGrid horizontal={false} strokeDasharray="3 3" opacity={0.18} /><XAxis type="number" allowDecimals={false} tick={{ fontSize: 9 }} /><YAxis type="category" dataKey="stage" width={112} tick={{ fontSize: 9 }} /><Tooltip formatter={(value) => `${Number(value).toLocaleString()} artifacts · ${percent(Number(value) / Math.max(1, total))}`} /><Bar dataKey="count" name="Artifacts" isAnimationActive={false}>{funnel.map((row) => <Cell key={row.stage} fill={row.fill} />)}</Bar></BarChart></ResponsiveContainer></div><div className="divide-y divide-border/60 border border-border/60">{funnel.map((row) => <div key={row.stage} className="grid grid-cols-[1fr_auto_auto] items-center gap-4 px-3 py-2"><span className="flex items-center gap-2"><span className="size-2" style={{ backgroundColor: row.fill }} />{row.stage}</span><span className="font-mono font-semibold">{row.count.toLocaleString()}</span><span className="w-16 text-right font-mono text-muted-foreground">{percent(row.count / Math.max(1, total))}</span></div>)}</div></div></section>

    <div className="grid gap-3 xl:grid-cols-2">
      <section className="border border-border/70 bg-background/40"><ChartHeader title="Verified-byte deposition over time" detail="Dung lượng Silver đã hiện diện bền vững theo từng cửa sổ hoàn tất, tách LC và TPF để thấy tải lưu trữ thực tế." /><div className="h-72 p-3"><ResponsiveContainer width="100%" height="100%"><ComposedChart data={deposition}><CartesianGrid vertical={false} strokeDasharray="3 3" opacity={0.18} /><XAxis dataKey="timestamp" tickFormatter={clock} minTickGap={30} tick={{ fontSize: 9 }} /><YAxis tickFormatter={(value) => `${Number(value).toFixed(0)}`} tick={{ fontSize: 9 }} width={48} label={{ value: 'MiB', angle: -90, position: 'insideLeft', fontSize: 9 }} /><Tooltip labelFormatter={(value) => new Date(Number(value) * 1000).toLocaleString()} formatter={(value) => `${Number(value).toFixed(2)} MiB`} /><Legend /><Area dataKey="lightcurveMiB" name="Light Curve" stackId="bytes" stroke="#22d3ee" fill="#22d3ee" fillOpacity={0.38} isAnimationActive={false} /><Area dataKey="targetPixelMiB" name="Target Pixel" stackId="bytes" stroke="#10b981" fill="#10b981" fillOpacity={0.32} isAnimationActive={false} /></ComposedChart></ResponsiveContainer></div></section>
      <section className="border border-border/70 bg-background/40"><ChartHeader title="Verification outcome by product type" detail="So sánh artifact đạt đủ integrity contract và artifact thiếu ít nhất một binding ở từng nhánh dữ liệu." /><div className="h-72 p-3"><ResponsiveContainer width="100%" height="100%"><BarChart data={modality}><CartesianGrid vertical={false} strokeDasharray="3 3" opacity={0.18} /><XAxis dataKey="kind" tick={{ fontSize: 10 }} /><YAxis allowDecimals={false} tick={{ fontSize: 9 }} width={38} /><Tooltip formatter={(value) => `${Number(value).toLocaleString()} artifacts`} /><Legend /><Bar dataKey="verified" name="Fully verified" fill="#10b981" isAnimationActive={false} /><Bar dataKey="incomplete" name="Incomplete binding" fill="#f97316" isAnimationActive={false} /></BarChart></ResponsiveContainer></div></section>
    </div>

    {anomalies.length === 0 ? <div className="border border-emerald-500/30 bg-emerald-500/5 px-3 py-2 text-[11px] text-emerald-700 dark:text-emerald-300">Không phát hiện Silver object lệch size, SHA metadata, schema hoặc completed checkpoint trong inventory hiện tại.</div> : <VerificationAnomalies points={anomalies} />}
    {failures.length > 0 && <SilverFailureReasons failures={failures} />}
    {hasActivity && <div className="h-52 border border-border/60 bg-background/40 p-2"><ResponsiveContainer width="100%" height="100%"><ComposedChart data={recent}><CartesianGrid vertical={false} strokeDasharray="3 3" opacity={0.18} /><XAxis dataKey="timestamp" tickFormatter={clock} tick={{ fontSize: 9 }} /><YAxis tickFormatter={(value) => formatBytes(Number(value))} tick={{ fontSize: 9 }} width={58} /><Tooltip formatter={(value) => `${formatBytes(Number(value))}/s`} /><Legend /><Area dataKey="bronze_bytes_rate" name="Source read" stroke="#22d3ee" fill="#22d3ee" fillOpacity={0.14} /><Area dataKey="silver_bytes_rate" name="Stored write" stroke="#10b981" fill="#10b981" fillOpacity={0.14} /><Line dataKey="throughput" name="Objects/s" stroke="#f59e0b" dot={false} /></ComposedChart></ResponsiveContainer></div>}
  </div>;
}

function verificationModalityRow(kind: string, points: MaterializationPoint[]): { kind: string; total: number; verified: number; incomplete: number } {
  const verified = points.filter((point) => point.integrity_verified).length;
  return { kind, total: points.length, verified, incomplete: points.length - verified };
}

function buildVerificationTimeline(points: MaterializationPoint[]): Array<{ timestamp: number; lightcurveMiB: number; targetPixelMiB: number }> {
  const timestamps = points.map((point) => Date.parse(point.completed_at)).filter(Number.isFinite);
  if (timestamps.length === 0) return [];
  const range = Math.max(...timestamps) - Math.min(...timestamps);
  const bucketMS = Math.max(60_000, Math.ceil(range / 20 / 60_000) * 60_000);
  const buckets = new Map<number, { timestamp: number; lightcurveMiB: number; targetPixelMiB: number }>();
  for (const point of points) {
    const milliseconds = Date.parse(point.completed_at);
    if (!Number.isFinite(milliseconds)) continue;
    const key = Math.floor(milliseconds / bucketMS) * bucketMS;
    const row = buckets.get(key) ?? { timestamp: key / 1000, lightcurveMiB: 0, targetPixelMiB: 0 };
    const sizeMiB = point.size_bytes / 1024 ** 2;
    if (matchesKind(point.product_kind, 'target-pixel')) row.targetPixelMiB += sizeMiB;
    else if (matchesKind(point.product_kind, 'lightcurve')) row.lightcurveMiB += sizeMiB;
    buckets.set(key, row);
  }
  return [...buckets.values()].sort((a, b) => a.timestamp - b.timestamp);
}

function VerificationAnomalies({ points }: { points: MaterializationPoint[] }): JSX.Element {
  const reasons = [
    { reason: 'Checkpoint missing', count: points.filter((point) => !point.checkpoint_linked).length },
    { reason: 'Size mismatch', count: points.filter((point) => !point.size_verified).length },
    { reason: 'SHA binding missing/mismatch', count: points.filter((point) => !point.checksum_bound).length },
    { reason: 'Schema missing/mismatch', count: points.filter((point) => !point.schema_verified).length },
    { reason: 'Bronze lineage missing', count: points.filter((point) => !point.lineage_bound).length },
  ].filter((row) => row.count > 0);
  return <section className="border border-orange-500/35 bg-orange-500/5"><ChartHeader title="Integrity exceptions" detail="Một artifact có thể xuất hiện ở nhiều nguyên nhân nếu thiếu nhiều binding; đây là classification, không phải tổng duy nhất." /><div className="h-48 p-3"><ResponsiveContainer width="100%" height="100%"><BarChart data={reasons} layout="vertical"><CartesianGrid horizontal={false} strokeDasharray="3 3" opacity={0.18} /><XAxis type="number" allowDecimals={false} tick={{ fontSize: 9 }} /><YAxis type="category" dataKey="reason" width={170} tick={{ fontSize: 9 }} /><Tooltip formatter={(value) => `${Number(value).toLocaleString()} artifacts`} /><Bar dataKey="count" name="Exceptions" fill="#f97316" isAnimationActive={false} /></BarChart></ResponsiveContainer></div></section>;
}

function SilverFailureReasons({ failures }: { failures: SilverFailure[] }): JSX.Element {
  const grouped = new Map<string, { reason: string; failed: number; recovered: number }>();
  for (const failure of failures) {
    const reason = failure.kind === 'SILVER_CONFLICT' ? 'Object lineage conflict' : 'Object-store write / verify';
    const row = grouped.get(reason) ?? { reason, failed: 0, recovered: 0 };
    if (failure.recovered) row.recovered += 1;
    else row.failed += 1;
    grouped.set(reason, row);
  }
  return <section className="border border-border/70 bg-background/40"><ChartHeader title="Upload and verification failure outcomes" detail="Chỉ gồm failure class của Step 06; recovered nghĩa là một lần retry sau đó đã commit Silver thành công." /><div className="h-48 p-3"><ResponsiveContainer width="100%" height="100%"><BarChart data={[...grouped.values()]} layout="vertical"><CartesianGrid horizontal={false} strokeDasharray="3 3" opacity={0.18} /><XAxis type="number" allowDecimals={false} tick={{ fontSize: 9 }} /><YAxis type="category" dataKey="reason" width={175} tick={{ fontSize: 9 }} /><Tooltip formatter={(value) => `${Number(value).toLocaleString()} attempts`} /><Legend /><Bar dataKey="recovered" name="Recovered" stackId="failure" fill="#f59e0b" isAnimationActive={false} /><Bar dataKey="failed" name="Failed" stackId="failure" fill="#ef4444" isAnimationActive={false} /></BarChart></ResponsiveContainer></div></section>;
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

type RowBand = { band: string; count: number; medianMiB: number; p95MiB: number; compressionP50: number };

type SizeHistogram = Array<{ bucket: string; artifacts: number }> & { unit: 'KiB' | 'MiB' };

function buildSizeHistogram(points: MaterializationPoint[]): SizeHistogram {
  const sizes = points.map((point) => point.size_bytes).filter((value) => value > 0).sort((a, b) => a - b);
  const unit: SizeHistogram['unit'] = (sizes.at(-1) ?? 0) < 1024 ** 2 ? 'KiB' : 'MiB';
  const divisor = unit === 'KiB' ? 1024 : 1024 ** 2;
  if (sizes.length === 0) return Object.assign([], { unit }) as SizeHistogram;
  const values = sizes.map((value) => value / divisor);
  const minimum = values[0];
  const maximum = values.at(-1) ?? minimum;
  if (maximum === minimum) {
    return Object.assign([{ bucket: formatBucketValue(minimum), artifacts: values.length }], { unit }) as SizeHistogram;
  }
  const targetWidth = (maximum - minimum) / 8;
  const step = niceDecimalStep(targetWidth);
  const origin = Math.floor(minimum / step) * step;
  const end = Math.ceil(maximum / step) * step;
  const bucketCount = Math.max(1, Math.round((end - origin) / step));
  const histogram = Array.from({ length: bucketCount }, (_, index) => ({
    bucket: `${formatBucketValue(origin + index * step)}–${formatBucketValue(origin + (index + 1) * step)}`,
    artifacts: 0,
  }));
  for (const value of values) {
    const index = Math.min(bucketCount - 1, Math.max(0, Math.floor((value - origin) / step)));
    histogram[index].artifacts += 1;
  }
  return Object.assign(histogram, { unit }) as SizeHistogram;
}

function buildRowBands(points: MaterializationPoint[]): RowBand[] {
  const valid = points.filter((point) => point.rows > 0 && point.size_bytes > 0);
  if (valid.length === 0) return [];
  const minimum = Math.min(...valid.map((point) => point.rows));
  const maximum = Math.max(...valid.map((point) => point.rows));
  const step = niceRowStep(Math.max(1, (maximum - minimum) / 7));
  const origin = Math.floor(minimum / step) * step;
  const buckets = new Map<number, MaterializationPoint[]>();
  for (const point of valid) {
    const index = Math.floor((point.rows - origin) / step);
    buckets.set(index, [...(buckets.get(index) ?? []), point]);
  }
  return [...buckets.entries()].sort(([a], [b]) => a - b).map(([index, values]) => {
    const lower = origin + index * step;
    const upper = lower + step;
    const sizesMiB = values.map((point) => point.size_bytes / 1024 ** 2).sort((a, b) => a - b);
    const compression = values.filter((point) => point.source_bytes > 0).map((point) => point.source_bytes / point.size_bytes).sort((a, b) => a - b);
    return { band: `${compactRows(lower)}–${compactRows(upper)}`, count: values.length, medianMiB: quantile(sizesMiB, 0.5), p95MiB: quantile(sizesMiB, 0.95), compressionP50: quantile(compression, 0.5) };
  });
}

function RowBandTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload?: RowBand & { medianKiB?: number; p95KiB?: number } }> }): JSX.Element | null {
  const band = payload?.[0]?.payload;
  if (!active || !band) return null;
  return <div className="border border-border bg-background p-2 text-[10px] shadow-lg"><p className="font-mono font-semibold">{band.band} rows</p><p>Artifacts: <strong>{band.count.toLocaleString()}</strong></p><p>Size P50: <strong>{(band.medianKiB ?? band.medianMiB * 1024).toFixed(1)} KiB</strong></p><p>Size P95: <strong>{(band.p95KiB ?? band.p95MiB * 1024).toFixed(1)} KiB</strong></p><p>Compression P50: <strong>{band.compressionP50 > 0 ? `${band.compressionP50.toFixed(2)}×` : '—'}</strong></p></div>;
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
function niceRowStep(value: number): number {
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const normalized = value / magnitude;
  const factor = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return factor * magnitude;
}
function niceDecimalStep(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const normalized = value / magnitude;
  const factor = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return factor * magnitude;
}
function formatBucketValue(value: number): string { return value.toLocaleString(undefined, { maximumFractionDigits: value < 10 ? 1 : 0 }); }
function compactRows(value: number): string { return value >= 1_000 ? `${(value / 1_000).toFixed(value % 1_000 === 0 ? 0 : 1)}k` : value.toLocaleString(); }
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
