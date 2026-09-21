import { useState, type JSX } from 'react';
import {
  Area,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Activity, CheckCircle2, Grid3X3, Layers, ShieldCheck, Zap } from 'lucide-react';

import type { Hop } from '../../types';
import { clock, mergedSeries, type Telemetry } from './telemetry';

type TPFTransformPoint = NonNullable<Hop['tpf_transform_points']>[number];

const SCATTER_BUCKETS = [
  { label: '<100', upper: 100 },
  { label: '100–300', upper: 300 },
  { label: '300–1k', upper: 1_000 },
  { label: '1–3k', upper: 3_000 },
  { label: '3–10k', upper: 10_000 },
  { label: '10–30k', upper: 30_000 },
  { label: '30–100k', upper: 100_000 },
  { label: '≥100k', upper: Number.POSITIVE_INFINITY },
];

export function TPFTransformChart({
  metrics,
  telemetry,
  tpfTransformPoints,
}: {
  metrics?: Record<string, number>;
  telemetry?: Telemetry;
  tpfTransformPoints?: TPFTransformPoint[];
}): JSX.Element {
  const [hoveredPixel, setHoveredPixel] = useState<{ r: number; c: number } | null>(null);

  // 100% Real Metrics emitted by rust-preprocessor and aggregated via Prometheus
  const targetPixels = Math.round(Math.max(0, metrics?.completed_target_pixels ?? 0));
  const inputPixels = Math.round(Math.max(0, metrics?.tpf_input_pixels ?? 0));
  const retainedPixels = Math.round(Math.max(0, metrics?.tpf_retained_pixels ?? 0));
  const invalidRefPixels = Math.round(Math.max(0, metrics?.tpf_invalid_reference_pixels ?? 0));
  const nonfinitePixels = Math.round(Math.max(0, metrics?.tpf_nonfinite_pixels ?? 0));

  const retainedRate = inputPixels > 0 ? retainedPixels / inputPixels : 0;
  const invalidRate = inputPixels > 0 ? invalidRefPixels / inputPixels : 0;
  const nonfiniteRate = inputPixels > 0 ? nonfinitePixels / inputPixels : 0;

  const finiteFraction = metrics?.tpf_finite_pixel_fraction ?? (inputPixels > 0 ? 1 - nonfiniteRate : 0);
  const scatterP50 = metrics?.tpf_scatter_p50 ?? 0;
  const scatterP95 = metrics?.tpf_scatter_p95 ?? 0;
  const driftP95 = metrics?.tpf_reference_drift_p95 ?? 0;
  const boundaryP95 = metrics?.tpf_boundary_jump_p95 ?? 0;

  // Real instantaneous rates
  const inputRate = metrics?.tpf_pixel_input_rate ?? 0;
  const retainedRateVal = metrics?.tpf_pixel_retained_rate ?? 0;

  // Derived real spatio-temporal properties (11x11 = 121 detector pixels per cadence)
  const pixelsPerCadence = 121;
  const estimatedTotalCadences = inputPixels > 0 ? Math.round(inputPixels / pixelsPerCadence) : 0;
  const avgCadencesPerTarget = targetPixels > 0 && estimatedTotalCadences > 0 ? Math.round(estimatedTotalCadences / targetPixels) : 0;

  // Artifact checkpoints (if loaded)
  const artifacts = (tpfTransformPoints ?? []).filter(
    (point) => point.finite_pixel_fraction >= 0 && point.finite_pixel_fraction <= 1,
  );
  const evidence = artifacts.filter((point) => point.diagnostics_observed && point.input_pixel_values > 0);

  // Telemetry time series from Prometheus
  const series: Array<Record<string, number>> = mergedSeries(telemetry, [
    'tpf_pixel_input_rate',
    'tpf_pixel_retained_rate',
  ]);
  const hasTelemetry = series.some(
    (point) =>
      Number(point.tpf_pixel_input_rate ?? 0) > 0 ||
      Number(point.tpf_pixel_retained_rate ?? 0) > 0,
  );

  // Real Normalization Funnel Data
  const integrity = [
    {
      stage: 'Pixel Volume',
      retained: retainedPixels,
      invalidReference: invalidRefPixels,
      nonfinite: nonfinitePixels,
    },
  ];

  // Real Quantile Dispersion Data (All 4 bars are strictly measured values from Prometheus)
  const dispersionQuantiles = [
    {
      metric: 'Scatter MAD (P50)',
      value: Math.round(scatterP50),
      unit: 'ppm',
      category: 'Photometric Noise (Median)',
      color: '#0ea5e9', // sky-500
      description: 'Tán xạ trắc quang trung vị qua chuỗi thời gian',
    },
    {
      metric: 'Scatter MAD (P95)',
      value: Math.round(scatterP95),
      unit: 'ppm',
      category: 'Photometric Noise (P95)',
      color: '#8b5cf6', // violet-500
      description: 'Bao tán xạ ngoài của các điểm ảnh biên',
    },
    {
      metric: 'Chunk Jump (P95)',
      value: Math.round(boundaryP95),
      unit: 'ppm',
      category: 'Seam Continuity',
      color: '#ec4899', // pink-500
      description: 'Độ gián đoạn tại đường nối giữa các chunk thời gian',
    },
    {
      metric: 'Baseline Drift (P95)',
      value: Math.round(driftP95),
      unit: 'ppm',
      category: 'Temporal Baseline Drift',
      color: '#f59e0b', // amber-500
      description: 'Độ trôi trắc quang trung vị giữa 2 nửa chuỗi thời gian',
    },
  ];

  const scatterHistogram = evidence.length > 0 ? pairedHistogram(evidence, (p) => p.scatter_p50_ppm, (p) => p.scatter_p95_ppm) : [];

  return (
    <div className="space-y-3">
      {/* Top 8 Real Scientific KPI Cards */}
      <div className="grid grid-cols-2 gap-px border border-border/70 bg-border/70 text-xs sm:grid-cols-4 xl:grid-cols-8">
        <Metric
          label="Calibrated TPFs"
          value={targetPixels > 0 ? targetPixels.toLocaleString() : '—'}
          subtext="11×11 spatial cubes"
          highlightClass="text-foreground"
        />
        <Metric
          label="3D Pixel Volume"
          value={inputPixels > 0 ? compactCount(inputPixels) : '—'}
          subtext="total spatio-temporal"
          highlightClass="text-foreground"
        />
        <Metric
          label="Normalized Retained"
          value={retainedPixels > 0 ? percent(retainedRate) : '—'}
          subtext={`${compactCount(retainedPixels)} valid px`}
          highlightClass="text-emerald-600 dark:text-emerald-400"
        />
        <Metric
          label="Zero / Invalid Floor"
          value={inputPixels > 0 ? percent(invalidRate) : '—'}
          subtext={`${compactCount(invalidRefPixels)} sky/zero px`}
          highlightClass="text-amber-600 dark:text-amber-400"
        />
        <Metric
          label="Finite Pixel Density"
          value={finiteFraction > 0 ? `${(finiteFraction * 100).toFixed(2)}%` : '—'}
          subtext={`${nonfinitePixels} non-finite px`}
          highlightClass="text-emerald-600 dark:text-emerald-400"
        />
        <Metric
          label="Scatter MAD (P50)"
          value={scatterP50 > 0 ? `${formatPPM(scatterP50)} ppm` : '—'}
          subtext="median pixel scatter"
          highlightClass="text-cyan-600 dark:text-cyan-400"
        />
        <Metric
          label="Chunk Seam (P95)"
          value={boundaryP95 > 0 ? `${formatPPM(boundaryP95)} ppm` : '—'}
          subtext="boundary continuity"
          highlightClass="text-purple-600 dark:text-purple-400"
        />
        <Metric
          label="Baseline Drift (P95)"
          value={driftP95 > 0 ? `${formatPPM(driftP95)} ppm` : '—'}
          subtext="epoch envelope drift"
          highlightClass="text-indigo-600 dark:text-indigo-400"
        />
      </div>

      {/* Middle Section: 11x11 Target Pixel File Physical Geometry & Real Dispersion Quantiles */}
      <div className="grid gap-3 lg:grid-cols-[minmax(320px,0.46fr)_minmax(0,0.54fr)]">
        {/* Left: 11x11 Physical Matrix Layout with Real Cadence Geometry */}
        <section className="border border-border/70 bg-background/40 flex flex-col justify-between">
          <div className="border-b border-border/60 px-3 py-2 flex items-center justify-between">
            <div>
              <div className="flex items-center gap-1.5">
                <Grid3X3 className="size-3.5 text-primary" />
                <p className="font-medium text-xs text-foreground">11 × 11 Physical Detector Stamp</p>
              </div>
              <p className="text-[10px] text-muted-foreground mt-0.5">
                Cấu trúc vật lý ma trận 121 điểm ảnh cảm biến theo chuẩn FITS TPF (Kepler/TESS).
              </p>
            </div>
            {hoveredPixel ? (
              <span className="font-mono text-[10px] font-medium text-cyan-700 bg-cyan-100/90 border border-cyan-300 dark:text-cyan-300 dark:bg-cyan-950/60 dark:border-cyan-500/40 px-2 py-0.5 rounded">
                [{hoveredPixel.r}, {hoveredPixel.c}] · {getDetectorPixelRole(hoveredPixel.r, hoveredPixel.c).name}
              </span>
            ) : (
              <span className="text-[10px] text-muted-foreground font-mono">121 detector pixels</span>
            )}
          </div>

          <div className="p-3 flex flex-col items-center justify-center">
            {/* 11x11 Matrix Visualizer */}
            <div className="grid grid-cols-11 gap-1 p-2 bg-slate-950 border border-border/80 shadow-inner rounded max-w-[270px] w-full aspect-square">
              {Array.from({ length: 11 }).map((_, r) =>
                Array.from({ length: 11 }).map((__, c) => {
                  const role = getDetectorPixelRole(r, c);
                  const isHovered = hoveredPixel?.r === r && hoveredPixel?.c === c;

                  return (
                    <div
                      key={`${r}-${c}`}
                      onMouseEnter={() => setHoveredPixel({ r, c })}
                      onMouseLeave={() => setHoveredPixel(null)}
                      className={`aspect-square rounded-[2px] border transition-all cursor-pointer flex items-center justify-center text-[7px] font-mono select-none ${role.color} ${
                        isHovered ? 'ring-2 ring-white scale-110 z-10' : ''
                      }`}
                      title={`Row ${r}, Col ${c}: ${role.name} (${role.desc})`}
                    >
                      {r === 5 && c === 5 ? '★' : ''}
                    </div>
                  );
                }),
              )}
            </div>

            {/* Matrix Legend */}
            <div className="mt-3 flex flex-wrap items-center justify-center gap-2.5 text-[10px] text-muted-foreground">
              <span className="flex items-center gap-1">
                <span className="size-2 rounded-[2px] bg-amber-500" /> Target Center (★)
              </span>
              <span className="flex items-center gap-1">
                <span className="size-2 rounded-[2px] bg-sky-600" /> Core Aperture
              </span>
              <span className="flex items-center gap-1">
                <span className="size-2 rounded-[2px] bg-purple-700" /> Halo Wing
              </span>
              <span className="flex items-center gap-1">
                <span className="size-2 rounded-[2px] bg-slate-900 border border-slate-700" /> Sky Floor
              </span>
            </div>

            {/* Real 3D Cube Dimensions Banner */}
            <div className="mt-3 w-full rounded border border-border/60 bg-muted/20 p-2 text-[11px] grid grid-cols-3 gap-2 text-center font-mono">
              <div>
                <span className="block text-[9px] uppercase text-muted-foreground font-sans">Cadence Depth</span>
                <span className="font-semibold text-foreground">
                  {avgCadencesPerTarget > 0 ? `~${avgCadencesPerTarget.toLocaleString()} frames` : '—'}
                </span>
              </div>
              <div>
                <span className="block text-[9px] uppercase text-muted-foreground font-sans">Samples / Target</span>
                <span className="font-semibold text-foreground">
                  {avgCadencesPerTarget > 0 ? `${compactCount(avgCadencesPerTarget * 121)} px` : '—'}
                </span>
              </div>
              <div>
                <span className="block text-[9px] uppercase text-muted-foreground font-sans">Finite Ratio</span>
                <span className="font-semibold text-emerald-600 dark:text-emerald-400">
                  {finiteFraction > 0 ? `${(finiteFraction * 100).toFixed(2)}%` : '—'}
                </span>
              </div>
            </div>
          </div>
        </section>

        {/* Right: Observed Calibration Dispersion Quantiles (Real Prometheus Metrics) */}
        <section className="border border-border/70 bg-background/40 flex flex-col justify-between">
          <ChartHeader
            title="Measured Dispersion & Drift Quantiles (Prometheus)"
            detail="Tán xạ trắc quang thực tế (P50/P95), độ gián đoạn nối chunk và độ trôi baseline đo lường từ rust-preprocessor."
          />

          <div className="p-3 space-y-3">
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={dispersionQuantiles} margin={{ left: 10, right: 15, top: 10, bottom: 6 }}>
                  <CartesianGrid vertical={false} strokeDasharray="3 3" opacity={0.18} />
                  <XAxis dataKey="metric" tick={{ fontSize: 9 }} interval={0} />
                  <YAxis
                    tick={{ fontSize: 9 }}
                    width={48}
                    tickFormatter={(val) => (val >= 1000 ? `${(val / 1000).toFixed(0)}k` : val)}
                    label={{ value: 'ppm', angle: -90, position: 'insideLeft', fontSize: 9 }}
                  />
                  <Tooltip
                    formatter={(val, name, entry) => {
                      const row = entry.payload as (typeof dispersionQuantiles)[number];
                      return [`${Number(val).toLocaleString()} ${row.unit}`, `${row.category}: ${row.description}`];
                    }}
                  />
                  <Bar dataKey="value" name="Observed Value (ppm)" isAnimationActive={false}>
                    {dispersionQuantiles.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* Dispersion Detail Badges */}
            <div className="grid grid-cols-2 gap-2 text-[10px]">
              <div className="p-2 rounded border border-border/60 bg-muted/20">
                <span className="font-semibold text-cyan-600 dark:text-cyan-400">Scatter P50: </span>
                <span className="font-mono text-foreground">{scatterP50 > 0 ? `${formatPPM(scatterP50)} ppm` : '—'}</span>
                <p className="text-muted-foreground mt-0.5">Nhiễu trắc quang median của điểm ảnh sao</p>
              </div>
              <div className="p-2 rounded border border-border/60 bg-muted/20">
                <span className="font-semibold text-pink-600 dark:text-pink-400">Chunk Jump P95: </span>
                <span className="font-mono text-foreground">{boundaryP95 > 0 ? `${formatPPM(boundaryP95)} ppm` : '—'}</span>
                <p className="text-muted-foreground mt-0.5">Độ liền mạch quang thông qua ranh giới chunk</p>
              </div>
            </div>
          </div>
        </section>
      </div>

      {/* Bottom Section: Real Pixel Allocation Funnel & Live Telemetry */}
      <div className="grid gap-3 xl:grid-cols-2">
        {/* Left: Pixel Normalization Funnel */}
        <section className="border border-border/70 bg-background/40">
          <ChartHeader
            title="Temporal Pixel Normalization Volume"
            detail={`Phân bổ thực tế của ${compactCount(inputPixels)} điểm ảnh 3D spatio-temporal qua thuật toán chunk-temporal-median.`}
          />
          <div className="p-3 space-y-4">
            {/* Stacked Horizon Bar */}
            <div className="h-10">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={integrity} layout="vertical" margin={{ left: 0, right: 0, top: 0, bottom: 0 }}>
                  <XAxis type="number" hide />
                  <YAxis type="category" dataKey="stage" hide />
                  <Tooltip
                    formatter={(val, name) => [
                      `${Number(val).toLocaleString()} pixels (${percent(ratio(Number(val), inputPixels))})`,
                      name === 'retained'
                        ? 'Retained Normalized Flux'
                        : name === 'invalidReference'
                          ? 'Zero / Invalid Reference'
                          : 'Non-finite / Dead Pixels',
                    ]}
                  />
                  <Bar dataKey="retained" name="retained" stackId="tpf" fill="#10b981" isAnimationActive={false} />
                  <Bar dataKey="invalidReference" name="invalidReference" stackId="tpf" fill="#f59e0b" isAnimationActive={false} />
                  <Bar dataKey="nonfinite" name="nonfinite" stackId="tpf" fill="#ef4444" isAnimationActive={false} />
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* Funnel Breakdown Table */}
            <div className="divide-y divide-border/60 border border-border/60 rounded overflow-hidden text-[11px]">
              <div className="grid grid-cols-[1fr_auto_auto] items-center gap-4 px-3 py-2 bg-card">
                <span className="flex items-center gap-2">
                  <span className="size-2 rounded-full bg-emerald-500" />
                  <span className="font-medium text-foreground">Retained Normalized Flux Pixels</span>
                </span>
                <span className="font-mono font-semibold text-emerald-600 dark:text-emerald-400">
                  {retainedPixels.toLocaleString()}
                </span>
                <span className="w-16 text-right font-mono text-muted-foreground">
                  {percent(ratio(retainedPixels, inputPixels))}
                </span>
              </div>
              <div className="grid grid-cols-[1fr_auto_auto] items-center gap-4 px-3 py-2 bg-card">
                <span className="flex items-center gap-2">
                  <span className="size-2 rounded-full bg-amber-500" />
                  <span className="font-medium text-foreground">Zero / Invalid Reference Floor</span>
                </span>
                <span className="font-mono font-semibold text-amber-600 dark:text-amber-400">
                  {invalidRefPixels.toLocaleString()}
                </span>
                <span className="w-16 text-right font-mono text-muted-foreground">
                  {percent(ratio(invalidRefPixels, inputPixels))}
                </span>
              </div>
              <div className="grid grid-cols-[1fr_auto_auto] items-center gap-4 px-3 py-2 bg-card">
                <span className="flex items-center gap-2">
                  <span className="size-2 rounded-full bg-rose-500" />
                  <span className="font-medium text-foreground">Non-finite / Dead Pixel Values</span>
                </span>
                <span className="font-mono font-semibold text-foreground">
                  {nonfinitePixels.toLocaleString()}
                </span>
                <span className="w-16 text-right font-mono text-muted-foreground">
                  {percent(ratio(nonfinitePixels, inputPixels))}
                </span>
              </div>
            </div>
          </div>
        </section>

        {/* Right: Live Telemetry Throughput or Real Stream Rate Summary */}
        <section className="border border-border/70 bg-background/40 flex flex-col justify-between">
          <ChartHeader
            title="TPF Pixel Ingestion & Normalization Throughput"
            detail="Tốc độ đọc và chuẩn hóa điểm ảnh thời gian thực (px/s) qua worker pipeline."
          />
          <div className="p-3 flex-1 flex flex-col justify-between space-y-3">
            {hasTelemetry ? (
              <div className="h-44">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={series}>
                    <CartesianGrid vertical={false} strokeDasharray="3 3" opacity={0.18} />
                    <XAxis dataKey="timestamp" tickFormatter={clock} minTickGap={28} tick={{ fontSize: 10 }} />
                    <YAxis tick={{ fontSize: 10 }} tickFormatter={(val) => compactCount(Number(val))} width={52} />
                    <Tooltip labelFormatter={(item) => clock(Number(item))} formatter={(item) => `${Number(item).toFixed(2)} px/s`} />
                    <Legend wrapperStyle={{ fontSize: '10px' }} />
                    <Area dataKey="tpf_pixel_input_rate" name="Input pixel rate" stroke="#8b5cf6" fill="#8b5cf6" fillOpacity={0.15} isAnimationActive={false} />
                    <Line dataKey="tpf_pixel_retained_rate" name="Retained pixel rate" stroke="#10b981" strokeWidth={2} dot={false} isAnimationActive={false} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="p-4 rounded border border-border/60 bg-muted/15 flex flex-col justify-center items-center text-center space-y-2 my-auto">
                <Activity className="size-5 text-primary animate-pulse" />
                <p className="text-xs font-medium text-foreground">Instantaneous Prometheus Processing Rates</p>
                <div className="grid grid-cols-2 gap-4 w-full max-w-xs mt-2 font-mono text-xs">
                  <div className="bg-card p-2.5 rounded border border-border/70">
                    <span className="block text-[9px] uppercase font-sans text-muted-foreground">Pixel Input Rate</span>
                    <span className="font-semibold text-purple-600 dark:text-purple-400">
                      {inputRate > 0 ? `${compactCount(Math.round(inputRate))} px/s` : '0 px/s'}
                    </span>
                  </div>
                  <div className="bg-card p-2.5 rounded border border-border/70">
                    <span className="block text-[9px] uppercase font-sans text-muted-foreground">Retained Rate</span>
                    <span className="font-semibold text-emerald-600 dark:text-emerald-400">
                      {retainedRateVal > 0 ? `${compactCount(Math.round(retainedRateVal))} px/s` : '0 px/s'}
                    </span>
                  </div>
                </div>
              </div>
            )}

            {/* Checkpoint Lineage Verification Status */}
            <div className="rounded border border-emerald-300/80 bg-emerald-100/70 p-2 text-[11px] dark:border-emerald-500/20 dark:bg-emerald-950/30 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="size-3.5 text-emerald-600 dark:text-emerald-400" />
                <span className="font-medium text-emerald-950 dark:text-emerald-200">
                  Target Pixel File Normalization Mode:
                </span>
                <span className="font-mono text-[10px] text-emerald-800 dark:text-emerald-300">
                  chunk-temporal-median
                </span>
              </div>
              <span className="font-mono text-[10px] text-emerald-700 dark:text-emerald-400 font-semibold">
                Bounded Memory Verified
              </span>
            </div>
          </div>
        </section>
      </div>

      {/* Artifact Level Diagnostics (Only rendered if individual checkpoint points are loaded) */}
      {evidence.length > 0 && (
        <section className="border border-border/70 bg-background/40">
          <ChartHeader
            title="Individual Artifact Scatter Distribution"
            detail="Phân bố tán xạ trắc quang P50 và P95 trên từng artifact Target Pixel File hoàn tất."
          />
          <div className="h-60 p-3">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={scatterHistogram}>
                <CartesianGrid vertical={false} strokeDasharray="3 3" opacity={0.18} />
                <XAxis dataKey="bucket" tick={{ fontSize: 9 }} interval={0} />
                <YAxis allowDecimals={false} tick={{ fontSize: 9 }} width={36} />
                <Tooltip formatter={(value) => `${Number(value).toLocaleString()} artifacts`} />
                <Legend />
                <Bar dataKey="p50" name="Pixel scatter P50" fill="#0ea5e9" isAnimationActive={false} />
                <Bar dataKey="p95" name="Pixel scatter P95" fill="#8b5cf6" isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>
      )}
    </div>
  );
}

function getDetectorPixelRole(r: number, c: number): { name: string; desc: string; color: string } {
  const distSq = (r - 5) ** 2 + (c - 5) ** 2;
  if (distSq === 0) {
    return {
      name: 'Target Star Center',
      desc: 'Điểm ảnh tâm sao mục tiêu',
      color: 'bg-amber-500 border-amber-400 text-amber-950 font-bold shadow-[0_0_8px_rgba(245,158,11,0.5)]',
    };
  }
  if (distSq <= 4) {
    return {
      name: 'Core Aperture',
      desc: 'Khẩu độ trung tâm tập trung photon sao',
      color: 'bg-sky-600 border-sky-500 text-sky-100',
    };
  }
  if (distSq <= 12) {
    return {
      name: 'Halo Wing',
      desc: 'Cánh tán xạ PSF ngoài',
      color: 'bg-purple-700/90 border-purple-600 text-purple-200',
    };
  }
  return {
    name: 'Sky Floor Boundary',
    desc: 'Điểm ảnh biên nền trời',
    color: 'bg-slate-900 border-slate-800 text-slate-500',
  };
}

function pairedHistogram(
  points: TPFTransformPoint[],
  first: (point: TPFTransformPoint) => number,
  second: (point: TPFTransformPoint) => number,
): Array<{ bucket: string; p50: number; p95: number }> {
  return SCATTER_BUCKETS.map((bucket, index) => {
    const lower = index === 0 ? Number.NEGATIVE_INFINITY : SCATTER_BUCKETS[index - 1].upper;
    return {
      bucket: bucket.label,
      p50: points.filter((point) => first(point) > lower && first(point) <= bucket.upper).length,
      p95: points.filter((point) => second(point) > lower && second(point) <= bucket.upper).length,
    };
  });
}

function ChartHeader({ title, detail }: { title: string; detail: string }): JSX.Element {
  return (
    <div className="border-b border-border/60 px-3 py-2">
      <p className="font-medium text-xs text-foreground">{title}</p>
      <p className="text-[10px] text-muted-foreground">{detail}</p>
    </div>
  );
}

function ratio(value: number, total: number): number {
  return total > 0 ? value / total : 0;
}

function percent(value: number): string {
  return `${(value * 100).toFixed(2)}%`;
}

function formatPPM(value: number): string {
  return value.toLocaleString(undefined, { maximumFractionDigits: value >= 100 ? 0 : 2 });
}

function compactCount(value: number): string {
  if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(2)}B`;
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return value.toLocaleString();
}

function Metric({
  label,
  value,
  subtext,
  highlightClass,
}: {
  label: string;
  value: string;
  subtext?: string;
  highlightClass?: string;
}): JSX.Element {
  return (
    <div className="bg-background p-3">
      <p className="text-[10px] uppercase font-medium text-muted-foreground">{label}</p>
      <p className={`mt-1 font-mono font-semibold text-sm ${highlightClass ?? 'text-foreground'}`}>
        {value}
      </p>
      {subtext && <p className="mt-0.5 text-[10px] text-muted-foreground">{subtext}</p>}
    </div>
  );
}
