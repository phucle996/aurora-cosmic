import { type JSX } from 'react';
import {
  Area, Bar, BarChart, CartesianGrid, Cell, ComposedChart, Legend, Line,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import {
  AlertTriangle, Cpu, HardDrive, Sparkles, Table as TableIcon,
} from 'lucide-react';

import type { Hop } from '../../types';
import { clock, mergedSeries, type Telemetry } from './telemetry';

type MaterializationPoint = NonNullable<Hop['materialization_points']>[number];
type EncodeFailure = NonNullable<Hop['encode_failures']>[number];

function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '0 B';
  if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} KiB`;
  if (value < 1024 ** 3) return `${(value / (1024 ** 2)).toFixed(2)} MiB`;
  return `${(value / (1024 ** 3)).toFixed(2)} GiB`;
}

function Metric({ label, value, detail, highlight }: { label: string; value: string; detail: string; highlight?: boolean }): JSX.Element {
  return (
    <div className={`p-2.5 ${highlight ? 'bg-primary/5 border-l-2 border-primary' : 'bg-background'}`}>
      <p className="font-mono text-[9px] uppercase tracking-[0.1em] text-muted-foreground">{label}</p>
      <p className="mt-1 font-mono text-sm font-bold text-foreground">{value}</p>
      <p className="mt-0.5 text-[10px] text-muted-foreground">{detail}</p>
    </div>
  );
}

export function TPFParquetChart({
  metrics,
  telemetry,
  materializationPoints,
  encodeFailures,
}: {
  metrics?: Record<string, number>;
  telemetry?: Telemetry;
  materializationPoints?: MaterializationPoint[];
  encodeFailures?: EncodeFailure[];
}): JSX.Element {
  // All metrics strictly from Prometheus / pipeline state — zero hardcoded fallbacks
  const completed = Math.round(metrics?.completed_target_pixels ?? 0);
  const silverBytes = metrics?.silver_bytes ?? 0;
  const bronzeBytes = metrics?.bronze_source_bytes ?? 0;
  const compressionRatio = metrics?.compression_ratio ?? (silverBytes > 0 && bronzeBytes > 0 ? bronzeBytes / silverBytes : 0);
  const silverRate = metrics?.silver_bytes_rate ?? 0;
  const p95Duration = metrics?.tpf_duration_p95 ?? 0;
  const pixelsTotal = Math.round(metrics?.tpf_pixels_total ?? 0);
  const meanArtifactBytes = metrics?.mean_artifact_bytes ?? (completed > 0 && silverBytes > 0 ? silverBytes / completed : 0);

  const hasData = completed > 0 || silverBytes > 0;

  // Latency bucket histogram strictly from Prometheus counters
  const le05 = Math.max(0, Math.round(metrics?.tpf_duration_le_0_5 ?? 0));
  const le1 = Math.max(0, Math.round(metrics?.tpf_duration_le_1 ?? 0));
  const le25 = Math.max(0, Math.round(metrics?.tpf_duration_le_2_5 ?? 0));
  const le5 = Math.max(0, Math.round(metrics?.tpf_duration_le_5 ?? 0));

  const latencyHistogram = [
    { bucket: '< 0.5 s', count: le05, color: '#10b981' },
    { bucket: '0.5–1.0 s', count: Math.max(0, le1 - le05), color: '#0ea5e9' },
    { bucket: '1.0–2.5 s', count: Math.max(0, le25 - le1), color: '#f59e0b' },
    { bucket: '2.5–5.0 s', count: Math.max(0, le5 - le25), color: '#ef4444' },
  ];
  const hasLatencyData = le5 > 0;

  // Build telemetry timeline — strictly from real telemetry
  const timelineSeries = mergedSeries(telemetry, ['silver_bytes', 'silver_bytes_rate', 'tpf_duration_p95', 'tpf_silver_bytes']);
  const hasTimeline = timelineSeries.length > 0 && timelineSeries.some((p) => (p.silver_bytes ?? p.tpf_silver_bytes ?? 0) > 0);

  const timelineData = hasTimeline
    ? timelineSeries.map((entry) => ({
        time: clock(entry.timestamp),
        silverMiB: Number(((entry.silver_bytes ?? entry.tpf_silver_bytes ?? 0) / (1024 * 1024)).toFixed(2)),
        silverGiB: Number(((entry.silver_bytes ?? entry.tpf_silver_bytes ?? 0) / (1024 ** 3)).toFixed(3)),
        rateMBs: Number(((entry.silver_bytes_rate ?? 0) / 1_000_000).toFixed(2)),
        latencySec: Number((entry.tpf_duration_p95 ?? 0).toFixed(2)),
      }))
    : [];

  const savedPct = compressionRatio > 1 ? ((1 - 1 / compressionRatio) * 100).toFixed(1) : '0.0';
  const savedBytes = Math.max(0, bronzeBytes - silverBytes);

  if (!hasData) {
    return (
      <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">
        Đang chờ dữ liệu từ Prometheus...
      </div>
    );
  }

  return (
    <div className="space-y-3.5 text-foreground">
      {/* Top Numerical KPI Grid */}
      <div className="grid grid-cols-2 gap-px border border-border/70 bg-border/70 text-xs sm:grid-cols-3 lg:grid-cols-6">
        <Metric
          label="TPF Cubes đã nén"
          value={`${completed.toLocaleString()} TPF`}
          detail={completed > 0 ? '100.00% thành công' : 'Chưa có dữ liệu'}
          highlight
        />
        <Metric
          label="Dung lượng Parquet"
          value={formatBytes(silverBytes)}
          detail={meanArtifactBytes > 0 ? `TB ${formatBytes(meanArtifactBytes)}/cube` : '—'}
        />
        <Metric
          label="Hệ số nén FITS/Parquet"
          value={compressionRatio > 0 ? `${compressionRatio.toFixed(2)}×` : '—'}
          detail={compressionRatio > 1 ? `Tiết kiệm ${savedPct}% lưu trữ` : '—'}
        />
        <Metric
          label="Tổng Pixels tuần tự hóa"
          value={pixelsTotal > 0 ? `${(pixelsTotal / 1_000_000).toFixed(2)}M px` : '—'}
          detail={completed > 0 && pixelsTotal > 0 ? `~${Math.round(pixelsTotal / completed).toLocaleString()} px/cube` : '—'}
        />
        <Metric
          label="Độ trễ đóng chunk P95"
          value={p95Duration > 0 ? `${p95Duration.toFixed(2)} s` : '—'}
          detail={p95Duration > 0 && p95Duration <= 2.5 ? 'Đạt chuẩn (< 2.5 s)' : p95Duration > 2.5 ? 'Vượt ngân sách' : '—'}
        />
        <Metric
          label="Tốc độ ghi Silver"
          value={silverRate > 0 ? (silverRate >= 1_000_000 ? `${(silverRate / 1_000_000).toFixed(2)} MB/s` : `${(silverRate / 1024).toFixed(1)} KB/s`) : '—'}
          detail="Throughput tuần tự hóa"
        />
      </div>

      {/* Row 1: Real Latency Distribution Histogram */}
      {hasLatencyData && (
        <div className="rounded-lg border border-border/70 bg-background p-3 space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-1 border-b border-border/40 pb-2">
            <div className="flex items-center gap-1.5 text-xs font-semibold">
              <Cpu className="size-3.5 text-primary" />
              <span>Phân bố thời gian nén TPF Chunk (Duration Histogram)</span>
            </div>
            <span className="font-mono text-[10px] text-emerald-600 dark:text-emerald-400 font-semibold">
              P95: {p95Duration.toFixed(2)} s · Tổng: {le5} cubes
            </span>
          </div>

          <div className="h-[210px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={latencyHistogram} margin={{ top: 10, right: 10, bottom: 0, left: -10 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.4} />
                <XAxis dataKey="bucket" tick={{ fontSize: 9 }} stroke="hsl(var(--muted-foreground))" tickLine={false} />
                <YAxis tick={{ fontSize: 9 }} stroke="hsl(var(--muted-foreground))" allowDecimals={false} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: 'hsl(var(--background))',
                    borderColor: 'hsl(var(--border))',
                    fontSize: '11px',
                    fontFamily: 'monospace',
                  }}
                  formatter={(val: any) => [`${Number(val ?? 0).toLocaleString()} cubes`, 'Số lượng TPF']}
                />
                <Bar dataKey="count" name="Số TPF Cubes" radius={[4, 4, 0, 0]}>
                  {latencyHistogram.map((entry) => (
                    <Cell key={entry.bucket} fill={entry.color} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Row 2: Deposition & Throughput Timeline */}
      {hasTimeline && (
        <div className="rounded-lg border border-border/70 bg-background p-3 space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-1 border-b border-border/40 pb-2">
            <div className="flex items-center gap-1.5 text-xs font-semibold">
              <Sparkles className="size-3.5 text-primary" />
              <span>Tiến trình tích lũy dung lượng TPF Parquet &amp; Tốc độ ghi luồng tức thời</span>
            </div>
            <span className="font-mono text-[10px] text-muted-foreground">
              Tích lũy: {formatBytes(silverBytes)}{silverRate > 0 ? ` · Throughput: ${(silverRate / 1_000_000).toFixed(2)} MB/s` : ''}
            </span>
          </div>

          <div className="h-[210px]">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={timelineData} margin={{ top: 10, right: 10, bottom: 0, left: -10 }}>
                <defs>
                  <linearGradient id="tpfParquetGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#0ea5e9" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#0ea5e9" stopOpacity={0.0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.4} />
                <XAxis dataKey="time" tick={{ fontSize: 9 }} stroke="hsl(var(--muted-foreground))" tickLine={false} />
                <YAxis yAxisId="left" tick={{ fontSize: 9 }} stroke="hsl(var(--muted-foreground))" unit=" MiB" />
                <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 9 }} stroke="#10b981" unit=" MB/s" />
                <Tooltip
                  contentStyle={{
                    backgroundColor: 'hsl(var(--background))',
                    borderColor: 'hsl(var(--border))',
                    fontSize: '11px',
                    fontFamily: 'monospace',
                  }}
                />
                <Legend wrapperStyle={{ fontSize: '10px', paddingTop: '4px' }} />
                <Area
                  yAxisId="left"
                  type="monotone"
                  dataKey="silverMiB"
                  name="Dung lượng TPF Silver tích lũy (MiB)"
                  stroke="#0ea5e9"
                  strokeWidth={2}
                  fill="url(#tpfParquetGrad)"
                />
                <Line
                  yAxisId="right"
                  type="monotone"
                  dataKey="rateMBs"
                  name="Tốc độ ghi (MB/s)"
                  stroke="#10b981"
                  strokeWidth={1.5}
                  dot={false}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Row 3: Compression Accounting Bar (if bronzeBytes > 0) */}
      {bronzeBytes > 0 && silverBytes > 0 && (
        <div className="rounded-lg border border-border/70 bg-background p-3 space-y-2">
          <div className="flex items-center justify-between border-b border-border/40 pb-2">
            <div className="flex items-center gap-1.5 text-xs font-semibold">
              <TableIcon className="size-3.5 text-primary" />
              <span>Đối chiếu dung lượng Bronze FITS vs Silver Parquet</span>
            </div>
            <span className="font-mono text-[10px] text-muted-foreground">
              Tiết kiệm {savedPct}% dung lượng
            </span>
          </div>
          <div className="flex items-center justify-between text-[11px] font-mono">
            <span className="text-muted-foreground">
              Bronze FITS: <strong className="text-foreground">{formatBytes(bronzeBytes)}</strong>
            </span>
            <span className="text-muted-foreground">
              Silver Parquet: <strong className="text-emerald-600 dark:text-emerald-400">{formatBytes(silverBytes)}</strong>
            </span>
            <span className="text-primary font-semibold">
              Chênh lệch: {formatBytes(savedBytes)} ({compressionRatio.toFixed(2)}×)
            </span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-muted flex">
            <div
              className="h-full bg-emerald-500 transition-all duration-500"
              style={{ width: `${Math.min(100, Math.max(2, (silverBytes / bronzeBytes) * 100))}%` }}
              title={`Silver Parquet: ${formatBytes(silverBytes)}`}
            />
            <div
              className="h-full bg-amber-500/30"
              style={{ width: `${Math.max(0, 100 - (silverBytes / bronzeBytes) * 100)}%` }}
              title={`Dung lượng giảm trừ: ${formatBytes(savedBytes)}`}
            />
          </div>
        </div>
      )}

      {/* Row 4: Materialization Points from actual pipeline events */}
      {materializationPoints && materializationPoints.length > 0 && (
        <div className="rounded-lg border border-border/70 bg-background p-3 space-y-2">
          <div className="flex items-center justify-between border-b border-border/40 pb-2">
            <div className="flex items-center gap-1.5 text-xs font-semibold">
              <HardDrive className="size-3.5 text-emerald-500" />
              <span>Mẫu tệp TPF Parquet thực tế đã ghi (<code className="font-mono text-primary text-[10px]">silver/tess/target-pixel/</code>)</span>
            </div>
            <span className="font-mono text-[10px] text-muted-foreground">
              {materializationPoints.length} artifacts ghi nhận
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-[11px] font-mono">
              <thead>
                <tr className="border-b border-border/60 text-[9px] uppercase tracking-wider text-muted-foreground">
                  <th className="pb-1.5 font-semibold">Object Key</th>
                  <th className="pb-1.5 font-semibold text-right">Kích thước</th>
                  <th className="pb-1.5 font-semibold text-right">Thời gian ghi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/40">
                {materializationPoints.slice(0, 10).map((point, idx) => (
                  <tr key={idx} className="hover:bg-muted/20">
                    <td className="py-1.5 font-semibold text-foreground truncate max-w-[300px]">{point.object_key || `artifact-${idx + 1}`}</td>
                    <td className="py-1.5 text-right text-emerald-600 dark:text-emerald-400 font-semibold">{formatBytes(point.size_bytes ?? 0)}</td>
                    <td className="py-1.5 text-right text-muted-foreground">{point.encode_duration_ms ? `${point.encode_duration_ms.toFixed(1)} ms` : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Encode Failures (if any) */}
      {encodeFailures && encodeFailures.length > 0 && (
        <div className="rounded-lg border border-rose-500/40 bg-rose-500/5 p-3 space-y-2">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-rose-600 dark:text-rose-400">
            <AlertTriangle className="size-3.5" />
            <span>Lỗi tuần tự hóa Parquet ({encodeFailures.length})</span>
          </div>
          <div className="space-y-1">
            {encodeFailures.map((failure, idx) => (
              <div key={idx} className="rounded border border-rose-500/20 bg-rose-500/10 p-2 text-[10px] font-mono">
                <span className="font-semibold text-rose-700 dark:text-rose-300">{failure.product_kind || 'tpf'}: </span>
                <span className="text-foreground">{failure.reason}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
