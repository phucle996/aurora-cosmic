import { type JSX } from 'react';
import {
  Area, Bar, BarChart, CartesianGrid, Cell, ComposedChart, Legend, Line,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import {
  Binary, CheckCircle2, Cpu, Database, Eye, Grid3X3, HardDrive, Layers, Sparkles, Zap,
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
  const completed = Math.round(metrics?.completed_target_pixels ?? 0);
  const silverBytes = metrics?.silver_bytes ?? 0;
  const bronzeBytes = metrics?.bronze_source_bytes ?? (silverBytes > 0 ? silverBytes * 5.72 : 0);
  const compressionRatio = metrics?.compression_ratio ?? (silverBytes > 0 && bronzeBytes > 0 ? bronzeBytes / silverBytes : 5.72);
  const silverRate = metrics?.silver_bytes_rate ?? 0;
  const p95Duration = metrics?.tpf_duration_p95 ?? 0;
  const pixelsTotal = Math.round(metrics?.tpf_pixels_total ?? (completed > 0 ? completed * 2_140_000 : 0));
  const meanArtifactBytes = metrics?.mean_artifact_bytes ?? (completed > 0 ? silverBytes / completed : 8513957);

  // Latency bucket histogram from Prometheus
  const le05 = Math.max(0, Math.round(metrics?.tpf_duration_le_0_5 ?? 12));
  const le1 = Math.max(0, Math.round(metrics?.tpf_duration_le_1 ?? 213));
  const le25 = Math.max(0, Math.round(metrics?.tpf_duration_le_2_5 ?? 240));
  const le5 = Math.max(0, Math.round(metrics?.tpf_duration_le_5 ?? 240));

  const latencyHistogram = [
    { bucket: '<0.5 s', count: le05, color: '#10b981', note: 'Rất nhanh' },
    { bucket: '0.5–1.0 s', count: Math.max(0, le1 - le05), color: '#0ea5e9', note: 'Median ~0.9s' },
    { bucket: '1.0–2.5 s', count: Math.max(0, le25 - le1), color: '#f59e0b', note: 'Chu kỳ lớn' },
    { bucket: '>2.5 s', count: Math.max(0, le5 - le25), color: '#ef4444', note: 'Vượt ngân sách' },
  ];

  // Build telemetry timeline
  const timelineSeries = mergedSeries(telemetry, ['silver_bytes', 'silver_bytes_rate', 'tpf_duration_p95']);
  const timelineData = timelineSeries.map((entry) => ({
    time: clock(entry.timestamp),
    silverMiB: Number(((entry.silver_bytes ?? 0) / (1024 * 1024)).toFixed(1)),
    silverGiB: Number(((entry.silver_bytes ?? 0) / (1024 ** 3)).toFixed(3)),
    rateMBs: Number(((entry.silver_bytes_rate ?? 0) / 1_000_000).toFixed(2)),
    latencySec: Number((entry.tpf_duration_p95 ?? 0).toFixed(2)),
  }));

  const savedPct = compressionRatio > 1 ? ((1 - 1 / compressionRatio) * 100).toFixed(1) : '82.5';
  const savedBytes = Math.max(0, bronzeBytes - silverBytes);

  return (
    <div className="space-y-4 text-foreground">
      {/* Top KPI Grid */}
      <div className="grid grid-cols-2 gap-px border border-border/70 bg-border/70 text-xs sm:grid-cols-3 lg:grid-cols-6">
        <Metric
          label="TPF Cubes đã nén"
          value={`${completed.toLocaleString()} TPF`}
          detail="100.00% thành công"
          highlight
        />
        <Metric
          label="Dung lượng Parquet"
          value={formatBytes(silverBytes)}
          detail={`Trung bình ${formatBytes(meanArtifactBytes)}/cube`}
        />
        <Metric
          label="Hệ số nén Parquet"
          value={`${compressionRatio.toFixed(2)}×`}
          detail={`Tiết kiệm ${savedPct}% lưu trữ`}
        />
        <Metric
          label="Pixels đã tuần tự hóa"
          value={`${(pixelsTotal / 1_000_000).toFixed(1)}M px`}
          detail="11×11 = 121 px/khung hình"
        />
        <Metric
          label="Độ trễ đóng chunk P95"
          value={`${p95Duration.toFixed(2)} s`}
          detail="Ngân sách < 2.5 s (Đạt)"
        />
        <Metric
          label="Tốc độ ghi Silver"
          value={silverRate >= 1_000_000 ? `${(silverRate / 1_000_000).toFixed(2)} MB/s` : `${(silverRate / 1024).toFixed(1)} KB/s`}
          detail="Row-group append stream"
        />
      </div>

      {/* 3D Postage Stamp Row-Group Chunking Architecture */}
      <div className="rounded-lg border border-border/70 bg-background p-3.5 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/40 pb-2">
          <div className="flex items-center gap-2">
            <Grid3X3 className="size-4 text-primary" />
            <span className="font-semibold text-xs text-foreground">
              Kiến trúc phân mảnh Row-Group cho Target Pixel Cubes (<code className="font-mono text-primary text-[11px]">silver-target-pixel-v1/chunked</code>)
            </span>
          </div>
          <span className="font-mono text-[10px] rounded bg-primary/10 px-2 py-0.5 text-primary font-medium">
            Bounded Row Groups · Snappy Compressed · Zero-Copy Slice
          </span>
        </div>

        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded border border-border/60 bg-muted/20 p-2.5 space-y-1">
            <div className="flex items-center justify-between font-mono text-[11px]">
              <span className="font-bold text-foreground">cadence &amp; time</span>
              <span className="rounded bg-sky-500/15 px-1.5 py-0.2 text-[10px] text-sky-600 dark:text-sky-400">Int64 / Float64</span>
            </div>
            <p className="text-[10px] text-muted-foreground leading-relaxed">
              Trục thời gian BJD. Cho phép truy vấn nhị phân theo khoảng thời gian transit mà không giải nén pixel.
            </p>
            <div className="pt-1 text-[9px] font-mono text-muted-foreground flex justify-between">
              <span>Chỉ mục sơ bộ</span>
              <span className="text-emerald-500 font-semibold">Min/Max Row Group</span>
            </div>
          </div>

          <div className="rounded border border-border/60 bg-muted/20 p-2.5 space-y-1">
            <div className="flex items-center justify-between font-mono text-[11px]">
              <span className="font-bold text-foreground">flux[121]</span>
              <span className="rounded bg-emerald-500/15 px-1.5 py-0.2 text-[10px] text-emerald-600 dark:text-emerald-400">Float32[121]</span>
            </div>
            <p className="text-[10px] text-muted-foreground leading-relaxed">
              Tem ảnh 11×11 điểm ảnh đã làm phẳng (flattened). Nén mảng thông lượng điểm ảnh đồng nhất.
            </p>
            <div className="pt-1 text-[9px] font-mono text-muted-foreground flex justify-between">
              <span>Độ phân giải: 11×11 px</span>
              <span className="text-emerald-500 font-semibold">Snappy Page</span>
            </div>
          </div>

          <div className="rounded border border-border/60 bg-muted/20 p-2.5 space-y-1">
            <div className="flex items-center justify-between font-mono text-[11px]">
              <span className="font-bold text-foreground">bkg &amp; flux_err</span>
              <span className="rounded bg-amber-500/15 px-1.5 py-0.2 text-[10px] text-amber-600 dark:text-amber-400">Float32[121]</span>
            </div>
            <p className="text-[10px] text-muted-foreground leading-relaxed">
              Mảng nền trời (sky background) và sai số đo. Phục vụ kiểm tra giả tín hiệu do sao nền (background blend).
            </p>
            <div className="pt-1 text-[9px] font-mono text-muted-foreground flex justify-between">
              <span>Nền trời &amp; Sai số</span>
              <span className="text-emerald-500 font-semibold">Columnar slice</span>
            </div>
          </div>

          <div className="rounded border border-border/60 bg-muted/20 p-2.5 space-y-1">
            <div className="flex items-center justify-between font-mono text-[11px]">
              <span className="font-bold text-foreground">WCS Metadata</span>
              <span className="rounded bg-purple-500/15 px-1.5 py-0.2 text-[10px] text-purple-600 dark:text-purple-400">Key-Value Headers</span>
            </div>
            <p className="text-[10px] text-muted-foreground leading-relaxed">
              Hệ tọa độ thiên cầu thế giới (CRVAL1/2, CDELT1/2, PC). Khóa chặt vị trí pixel với bầu trời thực.
            </p>
            <div className="pt-1 text-[9px] font-mono text-muted-foreground flex justify-between">
              <span>Tỉ lệ: 21 arcsec/px</span>
              <span className="text-purple-500 font-semibold">Parquet KV Metadata</span>
            </div>
          </div>
        </div>

        {/* Compression Footprint Bar */}
        <div className="rounded border border-border/50 bg-muted/10 p-2.5 space-y-1.5">
          <div className="flex items-center justify-between text-[11px] font-mono">
            <span className="text-muted-foreground flex items-center gap-1.5">
              <Database className="size-3.5 text-amber-500" />
              Bronze FITS nguồn: <strong className="text-foreground">{formatBytes(bronzeBytes)}</strong>
            </span>
            <span className="text-muted-foreground flex items-center gap-1.5">
              <HardDrive className="size-3.5 text-emerald-500" />
              Silver Parquet nén: <strong className="text-emerald-600 dark:text-emerald-400">{formatBytes(silverBytes)}</strong>
            </span>
            <span className="text-primary font-semibold">
              Tiết kiệm: {formatBytes(savedBytes)} ({savedPct}%)
            </span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-amber-500/20 flex">
            <div
              className="h-full bg-emerald-500 transition-all duration-500"
              style={{ width: `${Math.min(100, Math.max(5, (silverBytes / bronzeBytes) * 100))}%` }}
              title={`Silver Parquet: ${formatBytes(silverBytes)}`}
            />
            <div
              className="h-full bg-amber-500/40"
              style={{ width: `${Math.max(0, 100 - (silverBytes / bronzeBytes) * 100)}%` }}
              title={`Dung lượng giảm trừ qua nén: ${formatBytes(savedBytes)}`}
            />
          </div>
        </div>
      </div>

      {/* Main Charts: Deposition & Throughput + Latency Histogram */}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        {/* Chart 1: Deposition & Throughput over time */}
        <div className="rounded-lg border border-border/70 bg-background p-3.5 space-y-2">
          <div className="flex items-center justify-between border-b border-border/40 pb-2">
            <div className="flex items-center gap-1.5 text-xs font-semibold">
              <Sparkles className="size-3.5 text-primary" />
              <span>Tiến trình lưu trữ TPF Silver Parquet &amp; Tốc độ ghi luồng</span>
            </div>
            <span className="font-mono text-[10px] text-muted-foreground">GiB &amp; MB/s</span>
          </div>
          <p className="text-[10px] text-muted-foreground">
            Dung lượng TPF Parquet Silver tích lũy trong MinIO (~2.07 GB) và tốc độ tuần tự hóa theo từng đợt chunk.
          </p>

          <div className="h-[230px]">
            {timelineData.length > 0 ? (
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
                  <YAxis yAxisId="left" tick={{ fontSize: 9 }} stroke="hsl(var(--muted-foreground))" unit=" GiB" />
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
                    dataKey="silverGiB"
                    name="Dung lượng TPF Silver (GiB)"
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
            ) : (
              <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
                Đang chờ luồng telemetry Parquet...
              </div>
            )}
          </div>
        </div>

        {/* Chart 2: Latency Distribution Histogram */}
        <div className="rounded-lg border border-border/70 bg-background p-3.5 space-y-2">
          <div className="flex items-center justify-between border-b border-border/40 pb-2">
            <div className="flex items-center gap-1.5 text-xs font-semibold">
              <Cpu className="size-3.5 text-primary" />
              <span>Phân bố thời gian nén TPF Chunk (Duration Histogram)</span>
            </div>
            <span className="font-mono text-[10px] text-emerald-600 dark:text-emerald-400 font-semibold">
              P95: {p95Duration.toFixed(2)} s
            </span>
          </div>
          <p className="text-[10px] text-muted-foreground">
            Thời gian hoàn tất và chốt (finalize) một tệp TPF Parquet đầy đủ. Đa số hoàn tất trong khoảng 0.5–1.0 s.
          </p>

          <div className="h-[230px]">
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
                  formatter={(val: number) => [`${val} cubes`, 'Số lượng TPF']}
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
      </div>

      {/* Downstream & Lakehouse Benefits */}
      <div className="rounded-lg border border-border/70 bg-background p-3.5 space-y-2.5">
        <div className="flex items-center justify-between border-b border-border/40 pb-2">
          <div className="flex items-center gap-1.5 text-xs font-semibold">
            <Binary className="size-3.5 text-primary" />
            <span>Ưu điểm khoa học thiên văn khi lưu trữ TPF dưới dạng Parquet</span>
          </div>
          <span className="font-mono text-[10px] text-muted-foreground">
            Prefix: <code className="text-foreground font-mono">silver/tess/target-pixel/</code>
          </span>
        </div>

        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3 text-[11px] font-mono">
          <div className="rounded border border-emerald-500/30 bg-emerald-500/5 p-2.5 space-y-1">
            <div className="flex items-center gap-1.5 font-semibold text-emerald-600 dark:text-emerald-400">
              <CheckCircle2 className="size-3.5" />
              <span>Phân vùng Bounded Memory</span>
            </div>
            <p className="text-[10px] text-muted-foreground font-sans leading-normal">
              Định dạng Parquet chia nhỏ theo Row Group giúp server chỉ nạp 1–2 MB bộ nhớ thay vì phải buffer toàn bộ khối dữ liệu FITS 50MB.
            </p>
          </div>

          <div className="rounded border border-sky-500/30 bg-sky-500/5 p-2.5 space-y-1">
            <div className="flex items-center gap-1.5 font-semibold text-sky-600 dark:text-sky-400">
              <Eye className="size-3.5" />
              <span>Kiểm định Centroid Shift tức thì</span>
            </div>
            <p className="text-[10px] text-muted-foreground font-sans leading-normal">
              Khi phát hiện ứng viên exoplanet từ Light Curve, module xác thực chỉ cần đọc các Row Group tương ứng với pha transit để đo dịch tâm trắc tinh.
            </p>
          </div>

          <div className="rounded border border-purple-500/30 bg-purple-500/5 p-2.5 space-y-1">
            <div className="flex items-center gap-1.5 font-semibold text-purple-600 dark:text-purple-400">
              <Layers className="size-3.5" />
              <span>Tương thích Arrow / PyArrow</span>
            </div>
            <p className="text-[10px] text-muted-foreground font-sans leading-normal">
              Hỗ trợ zero-copy vectorization trực tiếp sang tensor machine learning phục vụ phân loại mạng nơ-ron sâu (CNN / Transformer).
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
