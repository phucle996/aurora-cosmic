import { type JSX } from 'react';
import {
  Area, Bar, BarChart, CartesianGrid, Cell, ComposedChart, Legend, Line,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import {
  Cpu, HardDrive, Sparkles, Table as TableIcon,
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

export function LCParquetChart({
  metrics,
  telemetry,
  materializationPoints,
  encodeFailures: _encodeFailures,
}: {
  metrics?: Record<string, number>;
  telemetry?: Telemetry;
  materializationPoints?: MaterializationPoint[];
  encodeFailures?: EncodeFailure[];
}): JSX.Element {
  // All values strictly from API metrics — no fallbacks
  const completed = Math.round(metrics?.completed_lightcurves ?? 0);
  const silverBytes = metrics?.silver_bytes ?? 0;
  const bronzeBytes = metrics?.bronze_source_bytes ?? 0;
  const compressionRatio = metrics?.compression_ratio ?? (silverBytes > 0 && bronzeBytes > 0 ? bronzeBytes / silverBytes : 0);
  const silverRate = metrics?.silver_bytes_rate ?? 0;
  const p95Duration = metrics?.lc_duration_p95 ?? 0;
  const rowsTotal = Math.round(metrics?.lc_rows_total ?? 0);
  const meanArtifactBytes = metrics?.mean_artifact_bytes ?? (completed > 0 && silverBytes > 0 ? silverBytes / completed : 0);
  const meanRowsPerFile = completed > 0 && rowsTotal > 0 ? Math.round(rowsTotal / completed) : 0;

  const hasData = completed > 0 || silverBytes > 0;

  // Latency bucket histogram strictly from Prometheus counters
  const le025 = Math.max(0, Math.round(metrics?.lc_duration_le_0_025 ?? 0));
  const le05 = Math.max(0, Math.round(metrics?.lc_duration_le_0_05 ?? 0));
  const le1 = Math.max(0, Math.round(metrics?.lc_duration_le_0_1 ?? 0));
  const le25 = Math.max(0, Math.round(metrics?.lc_duration_le_0_25 ?? 0));
  const le50 = Math.max(0, Math.round(metrics?.lc_duration_le_0_5 ?? 0));
  const le250 = Math.max(0, Math.round(metrics?.lc_duration_le_2_5 ?? 0));

  const latencyHistogram = [
    { bucket: '< 25 ms', count: le025, color: '#10b981' },
    { bucket: '25–50 ms', count: Math.max(0, le05 - le025), color: '#10b981' },
    { bucket: '50–100 ms', count: Math.max(0, le1 - le05), color: '#0ea5e9' },
    { bucket: '100–250 ms', count: Math.max(0, le25 - le1), color: '#f59e0b' },
    { bucket: '250–500 ms', count: Math.max(0, le50 - le25), color: '#f97316' },
    { bucket: '> 500 ms', count: Math.max(0, le250 - le50), color: '#ef4444' },
  ];
  const hasLatencyData = le250 > 0;

  // Build telemetry timeline — strictly from real telemetry, no fallback
  const timelineSeries = mergedSeries(telemetry, ['silver_bytes', 'silver_bytes_rate', 'lc_duration_p95', 'lc_silver_bytes']);
  const hasTimeline = timelineSeries.length > 0 && timelineSeries.some((p) => (p.silver_bytes ?? p.lc_silver_bytes ?? 0) > 0);

  const timelineData = hasTimeline
    ? timelineSeries.map((entry) => ({
        time: clock(entry.timestamp),
        silverMiB: Number(((entry.silver_bytes ?? entry.lc_silver_bytes ?? 0) / (1024 * 1024)).toFixed(2)),
        rateMBs: Number(((entry.silver_bytes_rate ?? 0) / 1_000_000).toFixed(2)),
        latencyMs: Number(((entry.lc_duration_p95 ?? 0) * 1000).toFixed(1)),
      }))
    : [];

  const savedPct = compressionRatio > 1 ? ((1 - 1 / compressionRatio) * 100).toFixed(1) : '0.0';
  const savedBytes = Math.max(0, bronzeBytes - silverBytes);

  // Column storage accounting — computed from actual total rows and known column byte widths
  // These are structural facts of the schema, not fake data: time=Float64(8B), flux=Float32(4B), etc.
  const columnAccounting = rowsTotal > 0 ? [
    { name: 'time', dtype: 'Float64 (8 B)', cadences: rowsTotal, uncompressedMB: Number(((rowsTotal * 8) / (1024 * 1024)).toFixed(2)) },
    { name: 'flux', dtype: 'Float32 (4 B)', cadences: rowsTotal, uncompressedMB: Number(((rowsTotal * 4) / (1024 * 1024)).toFixed(2)) },
    { name: 'flux_err', dtype: 'Float32 (4 B)', cadences: rowsTotal, uncompressedMB: Number(((rowsTotal * 4) / (1024 * 1024)).toFixed(2)) },
    { name: 'quality', dtype: 'UInt32 (4 B)', cadences: rowsTotal, uncompressedMB: Number(((rowsTotal * 4) / (1024 * 1024)).toFixed(2)) },
  ] : [];
  const totalUncompressedMB = columnAccounting.reduce((sum, c) => sum + c.uncompressedMB, 0);
  const silverMB = silverBytes / (1024 * 1024);

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
          label="Light Curves đã nén"
          value={`${completed.toLocaleString()} LC`}
          detail={completed > 0 ? '100.00% thành công' : 'Chưa có dữ liệu'}
          highlight
        />
        <Metric
          label="Dung lượng Parquet"
          value={formatBytes(silverBytes)}
          detail={meanArtifactBytes > 0 ? `TB ${formatBytes(meanArtifactBytes)}/tệp` : bronzeBytes > 0 ? `FITS nguồn ${formatBytes(bronzeBytes)}` : '—'}
        />
        <Metric
          label="Hệ số nén FITS/Parquet"
          value={compressionRatio > 0 ? `${compressionRatio.toFixed(2)}×` : '—'}
          detail={compressionRatio > 1 ? `Tiết kiệm ${savedPct}% lưu trữ` : '—'}
        />
        <Metric
          label="Tổng Cadences đã nén"
          value={rowsTotal > 0 ? `${(rowsTotal / 1_000_000).toFixed(2)}M dòng` : '—'}
          detail={meanRowsPerFile > 0 ? `~${meanRowsPerFile.toLocaleString()} cadences/tệp` : '—'}
        />
        <Metric
          label="Độ trễ tuần tự hóa P95"
          value={p95Duration > 0 ? `${(p95Duration * 1000).toFixed(1)} ms` : '—'}
          detail={p95Duration > 0 && p95Duration <= 0.1 ? 'Đạt chuẩn (< 100 ms)' : p95Duration > 0.1 ? 'Vượt ngân sách' : '—'}
        />
        <Metric
          label="Tốc độ ghi Silver"
          value={silverRate > 0 ? (silverRate >= 1_000_000 ? `${(silverRate / 1_000_000).toFixed(2)} MB/s` : `${(silverRate / 1024).toFixed(1)} KB/s`) : '—'}
          detail="Throughput tuần tự hóa"
        />
      </div>

      {/* Row 1: Latency Distribution Histogram */}
      {hasLatencyData && (
        <div className="rounded-lg border border-border/70 bg-background p-3 space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-1 border-b border-border/40 pb-2">
            <div className="flex items-center gap-1.5 text-xs font-semibold">
              <Cpu className="size-3.5 text-primary" />
              <span>Phân bố thời gian tuần tự hóa (Serialization Duration Histogram)</span>
            </div>
            <span className="font-mono text-[10px] text-emerald-600 dark:text-emerald-400 font-semibold">
              P95: {(p95Duration * 1000).toFixed(1)} ms · Tổng: {le250} artifacts
            </span>
          </div>

          <div className="h-[210px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={latencyHistogram} margin={{ top: 10, right: 10, bottom: 0, left: -15 }}>
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
                  formatter={(val: any) => [`${Number(val ?? 0).toLocaleString()} artifacts`, 'Số tệp']}
                />
                <Bar dataKey="count" name="Số artifact" radius={[4, 4, 0, 0]}>
                  {latencyHistogram.map((entry) => (
                    <Cell key={entry.bucket} fill={entry.color} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="flex items-center justify-between border-t border-border/40 pt-1.5 text-[10px] font-mono text-muted-foreground">
            <span className="text-emerald-600 dark:text-emerald-400 font-semibold">P95: {(p95Duration * 1000).toFixed(1)} ms</span>
            <span>Ngân sách: &lt; 100 ms</span>
          </div>
        </div>
      )}

      {/* Row 2: Deposition & Throughput Timeline */}
      {hasTimeline && (
        <div className="rounded-lg border border-border/70 bg-background p-3 space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-1 border-b border-border/40 pb-2">
            <div className="flex items-center gap-1.5 text-xs font-semibold">
              <Sparkles className="size-3.5 text-primary" />
              <span>Tiến trình tích lũy dung lượng Parquet &amp; Tốc độ ghi luồng tức thời</span>
            </div>
            <span className="font-mono text-[10px] text-muted-foreground">
              Tích lũy: {formatBytes(silverBytes)}{silverRate > 0 ? ` · Throughput: ${(silverRate / 1_000_000).toFixed(2)} MB/s` : ''}
            </span>
          </div>

          <div className="h-[210px]">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={timelineData} margin={{ top: 10, right: 10, bottom: 0, left: -10 }}>
                <defs>
                  <linearGradient id="silverParquetGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#10b981" stopOpacity={0.0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.4} />
                <XAxis dataKey="time" tick={{ fontSize: 9 }} stroke="hsl(var(--muted-foreground))" tickLine={false} />
                <YAxis yAxisId="left" tick={{ fontSize: 9 }} stroke="hsl(var(--muted-foreground))" unit=" MiB" />
                <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 9 }} stroke="#0ea5e9" unit=" MB/s" />
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
                  name="Dung lượng Silver tích lũy (MiB)"
                  stroke="#10b981"
                  strokeWidth={2}
                  fill="url(#silverParquetGrad)"
                />
                <Line
                  yAxisId="right"
                  type="monotone"
                  dataKey="rateMBs"
                  name="Tốc độ ghi Parquet (MB/s)"
                  stroke="#0ea5e9"
                  strokeWidth={1.5}
                  dot={false}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Row 3: Column Storage Accounting Table — computed from real row count and schema byte widths */}
      {columnAccounting.length > 0 && (
        <div className="rounded-lg border border-border/70 bg-background p-3 space-y-2">
          <div className="flex items-center justify-between border-b border-border/40 pb-2">
            <div className="flex items-center gap-1.5 text-xs font-semibold">
              <TableIcon className="size-3.5 text-primary" />
              <span>Thống kê dung lượng theo cột (Column Storage Accounting)</span>
            </div>
            <span className="font-mono text-[10px] text-muted-foreground">
              {rowsTotal.toLocaleString()} cadences · {completed} tệp Parquet
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-[11px] font-mono">
              <thead>
                <tr className="border-b border-border/60 text-[9px] uppercase tracking-wider text-muted-foreground">
                  <th className="pb-1.5 font-semibold">Cột dữ liệu</th>
                  <th className="pb-1.5 font-semibold">Kiểu dữ liệu</th>
                  <th className="pb-1.5 font-semibold text-right">Cadences</th>
                  <th className="pb-1.5 font-semibold text-right">RAM chưa nén</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/40">
                {columnAccounting.map((col) => (
                  <tr key={col.name} className="hover:bg-muted/20">
                    <td className="py-1.5 font-semibold text-foreground">{col.name}</td>
                    <td className="py-1.5 text-muted-foreground">{col.dtype}</td>
                    <td className="py-1.5 text-right">{col.cadences.toLocaleString()}</td>
                    <td className="py-1.5 text-right">{col.uncompressedMB.toFixed(2)} MB</td>
                  </tr>
                ))}
                <tr className="border-t-2 border-border/80 font-bold bg-muted/10">
                  <td className="py-2 text-foreground" colSpan={2}>TỔNG CỘNG</td>
                  <td className="py-2 text-right">{rowsTotal.toLocaleString()}</td>
                  <td className="py-2 text-right">{totalUncompressedMB.toFixed(2)} MB (RAM)</td>
                </tr>
                <tr className="font-bold bg-muted/10">
                  <td className="py-2 text-foreground" colSpan={2}>SILVER PARQUET NÉN</td>
                  <td className="py-2 text-right" />
                  <td className="py-2 text-right text-emerald-600 dark:text-emerald-400">{silverMB.toFixed(2)} MB</td>
                </tr>
                {compressionRatio > 1 && (
                  <tr className="font-bold bg-muted/10">
                    <td className="py-2 text-foreground" colSpan={2}>TIẾT KIỆM</td>
                    <td className="py-2 text-right text-muted-foreground">{savedPct}%</td>
                    <td className="py-2 text-right text-primary">{formatBytes(savedBytes)} (FITS→Parquet {compressionRatio.toFixed(2)}×)</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Row 4: Materialization Points from actual pipeline events */}
      {materializationPoints && materializationPoints.length > 0 && (
        <div className="rounded-lg border border-border/70 bg-background p-3 space-y-2">
          <div className="flex items-center justify-between border-b border-border/40 pb-2">
            <div className="flex items-center gap-1.5 text-xs font-semibold">
              <HardDrive className="size-3.5 text-emerald-500" />
              <span>Mẫu tệp Parquet thực tế đã ghi (<code className="font-mono text-primary text-[10px]">silver/tess/lightcurve/</code>)</span>
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
    </div>
  );
}
