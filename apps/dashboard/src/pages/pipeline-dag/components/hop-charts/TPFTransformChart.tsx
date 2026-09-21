import { type JSX } from 'react';
import {
  Area, Bar, BarChart, CartesianGrid, ComposedChart, Legend, Line,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';

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

const BOUNDARY_BUCKETS = [
  { label: '0 / no seam', upper: 0 },
  { label: '0–100', upper: 100 },
  { label: '100–300', upper: 300 },
  { label: '300–1k', upper: 1_000 },
  { label: '1–3k', upper: 3_000 },
  { label: '3–10k', upper: 10_000 },
  { label: '≥10k', upper: Number.POSITIVE_INFINITY },
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
  const targetPixels = Math.round(Math.max(0, metrics?.completed_target_pixels ?? 0));
  const inputPixels = Math.round(Math.max(0, metrics?.tpf_input_pixels ?? 0));
  const retainedPixels = Math.round(Math.max(0, metrics?.tpf_retained_pixels ?? 0));
  const invalidRefPixels = Math.round(Math.max(0, metrics?.tpf_invalid_reference_pixels ?? 0));
  const nonfinitePixels = Math.round(Math.max(0, metrics?.tpf_nonfinite_pixels ?? 0));

  const retainedRate = inputPixels > 0 ? retainedPixels / inputPixels : 1;
  const invalidRate = inputPixels > 0 ? invalidRefPixels / inputPixels : 0;

  const finiteFraction = metrics?.tpf_finite_pixel_fraction ?? 1.0;
  const scatterP50 = metrics?.tpf_scatter_p50 ?? 0;
  const scatterP95 = metrics?.tpf_scatter_p95 ?? 0;
  const driftP95 = metrics?.tpf_reference_drift_p95 ?? 0;
  const boundaryP95 = metrics?.tpf_boundary_jump_p95 ?? 0;

  const artifacts = (tpfTransformPoints ?? []).filter((point) => point.finite_pixel_fraction >= 0 && point.finite_pixel_fraction <= 1);
  const evidence = artifacts.filter((point) => point.diagnostics_observed && point.input_pixel_values > 0);

  const series: Array<Record<string, number>> = mergedSeries(telemetry, [
    'tpf_pixel_input_rate',
    'tpf_pixel_retained_rate',
    'tpf_output_rate',
  ]);
  const hasActivity = series.some(
    (point) =>
      Number(point.tpf_pixel_input_rate ?? 0) > 0 ||
      Number(point.tpf_pixel_retained_rate ?? 0) > 0 ||
      Number(point.tpf_output_rate ?? 0) > 0
  );

  // Normalization integrity funnel data
  const effInput = evidence.length > 0 ? sumBy(evidence, (p) => p.input_pixel_values) : inputPixels;
  const effRetained = evidence.length > 0 ? sumBy(evidence, (p) => p.normalized_pixel_values) : retainedPixels;
  const effInvalid = evidence.length > 0 ? sumBy(evidence, (p) => p.invalid_reference_values) : invalidRefPixels;
  const effNonfinite = evidence.length > 0 ? sumBy(evidence, (p) => p.nonfinite_pixel_values) : nonfinitePixels;

  const integrity = [{ stage: 'Pixel values', retained: effRetained, nonfinite: effNonfinite, invalidReference: effInvalid }];
  const integrityRows = [
    { label: 'Retained', value: effRetained, color: '#10b981' },
    { label: 'Neutralized (Invalid Ref)', value: effInvalid, color: '#f59e0b' },
    { label: 'Non-finite input', value: effNonfinite, color: '#ef4444' },
  ];

  // Artifact-level detailed arrays if available
  const scatterHistogram = evidence.length > 0 ? pairedHistogram(evidence, (p) => p.scatter_p50_ppm, (p) => p.scatter_p95_ppm) : [];
  const boundaryHistogram = evidence.length > 0 ? singleHistogram(evidence.map((p) => p.boundary_jump_p95_ppm)) : [];
  const driftTimeline = evidence.length > 0 ? temporalEnvelope(evidence) : [];

  // Aggregate statistics bar data when artifact stream is omitted
  const aggregateAstrometry = [
    { statistic: 'MAD Scatter P50', value: scatterP50 },
    { statistic: 'MAD Scatter P95', value: scatterP95 },
    { statistic: 'Reference Drift P95', value: driftP95 },
    { statistic: 'Boundary Jump P95', value: boundaryP95 },
  ];

  return (
    <div className="space-y-3">
      {/* Top KPI Cards */}
      <div className="grid grid-cols-2 gap-px border border-border/70 bg-border/70 text-xs lg:grid-cols-4 xl:grid-cols-8">
        <Metric label="Transformed TPFs" value={targetPixels.toLocaleString()} detail={`${targetPixels} TPF cubes`} />
        <Metric label="Pixel values" value={compactCount(effInput)} detail="temporal normalization" />
        <Metric label="Retained pixels" value={percent(retainedRate)} detail={compactCount(effRetained)} />
        <Metric label="Invalid references" value={percent(invalidRate)} detail={compactCount(effInvalid)} />
        <Metric label="Finite pixel fraction" value={`${(finiteFraction * 100).toFixed(3)}%`} detail="spatial validity" />
        <Metric label="MAD scatter · P50" value={scatterP50 > 0 ? `${formatPPM(scatterP50)} ppm` : '—'} detail="typical pixel" />
        <Metric label="Reference drift · P95" value={driftP95 > 0 ? `${formatPPM(driftP95)} ppm` : '—'} detail="chunk median shift" />
        <Metric label="Boundary jump · P95" value={boundaryP95 > 0 ? `${formatPPM(boundaryP95)} ppm` : '—'} detail="seam continuity" />
      </div>

      {/* Row 1: Normalization Integrity Funnel */}
      <section className="border border-border/70 bg-background/40">
        <ChartHeader
          title="TPF Normalization integrity funnel"
          detail="Mỗi pixel-value đầu vào của Target Pixel File được phân loại thành retained, non-finite hoặc neutralized vì temporal reference không hợp lệ."
        />
        <div className="grid gap-3 p-3 xl:grid-cols-[minmax(0,1.5fr)_minmax(320px,1fr)]">
          <div className="h-36">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={integrity} layout="vertical" margin={{ left: 18, right: 18 }}>
                <CartesianGrid horizontal={false} strokeDasharray="3 3" opacity={0.18} />
                <XAxis type="number" tickFormatter={(value) => compactCount(Number(value))} tick={{ fontSize: 9 }} />
                <YAxis type="category" dataKey="stage" width={72} tick={{ fontSize: 9 }} />
                <Tooltip formatter={(value) => `${Number(value).toLocaleString()} · ${percent(ratio(Number(value), effInput))}`} />
                <Legend />
                <Bar dataKey="retained" name="Retained" stackId="integrity" fill="#10b981" isAnimationActive={false} />
                <Bar dataKey="invalidReference" name="Neutralized ref" stackId="integrity" fill="#f59e0b" isAnimationActive={false} />
                <Bar dataKey="nonfinite" name="Non-finite" stackId="integrity" fill="#ef4444" isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="divide-y divide-border/60 border border-border/60">
            {integrityRows.map((row) => (
              <div key={row.label} className="grid grid-cols-[1fr_auto_auto] items-center gap-4 px-3 py-2">
                <span className="flex items-center gap-2">
                  <span className="size-2" style={{ backgroundColor: row.color }} />
                  {row.label}
                </span>
                <span className="font-mono font-semibold">{row.value.toLocaleString()}</span>
                <span className="w-16 text-right font-mono text-muted-foreground">{percent(ratio(row.value, effInput))}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Row 2: Diagnostics & Continuity */}
      {evidence.length > 0 ? (
        <>
          <div className="grid gap-3 xl:grid-cols-2">
            <section className="border border-border/70 bg-background/40">
              <ChartHeader
                title="Robust temporal pixel scatter distribution"
                detail="Phân bố MAD scatter theo artifact; P50 mô tả pixel điển hình, P95 làm lộ đuôi pixel dao động mạnh."
              />
              <div className="h-72 p-3">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={scatterHistogram}>
                    <CartesianGrid vertical={false} strokeDasharray="3 3" opacity={0.18} />
                    <XAxis dataKey="bucket" tick={{ fontSize: 9 }} interval={0} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 9 }} width={36} />
                    <Tooltip formatter={(value) => `${Number(value).toLocaleString()} artifacts`} />
                    <Legend />
                    <Bar dataKey="p50" name="Pixel scatter P50" fill="#22d3ee" isAnimationActive={false} />
                    <Bar dataKey="p95" name="Pixel scatter P95" fill="#8b5cf6" isAnimationActive={false} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </section>
            <section className="border border-border/70 bg-background/40">
              <ChartHeader
                title="Temporal reference drift"
                detail="Envelope P50/P95 theo thời gian hoàn tất artifact; khoảng cách mở rộng báo hiệu median reference kém ổn định."
              />
              <div className="h-72 p-3">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={driftTimeline}>
                    <CartesianGrid vertical={false} strokeDasharray="3 3" opacity={0.18} />
                    <XAxis dataKey="timestamp" tickFormatter={clock} minTickGap={28} tick={{ fontSize: 9 }} />
                    <YAxis tickFormatter={(value) => compactPPM(Number(value))} tick={{ fontSize: 9 }} width={50} label={{ value: 'ppm', angle: -90, position: 'insideLeft', fontSize: 9 }} />
                    <Tooltip labelFormatter={(item) => new Date(Number(item) * 1000).toLocaleString()} formatter={(value) => `${formatPPM(Number(value))} ppm`} />
                    <Legend />
                    <Area dataKey="p95" name="Drift P95" stroke="#f59e0b" fill="#f59e0b" fillOpacity={0.14} isAnimationActive={false} />
                    <Line dataKey="p50" name="Drift P50" stroke="#22d3ee" strokeWidth={2} dot={false} isAnimationActive={false} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </section>
          </div>
          <section className="border border-border/70 bg-background/40">
            <ChartHeader
              title="Chunk-boundary continuity"
              detail="Phân bố độ nhảy P95 giữa frame cuối chunk trước và frame đầu chunk sau; dịch sang bucket cao cho thấy seam do chunk normalization."
            />
            <div className="h-56 p-3">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={boundaryHistogram}>
                  <CartesianGrid vertical={false} strokeDasharray="3 3" opacity={0.18} />
                  <XAxis dataKey="bucket" tick={{ fontSize: 9 }} interval={0} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 9 }} width={36} />
                  <Tooltip formatter={(value) => `${Number(value).toLocaleString()} artifacts`} />
                  <Bar dataKey="count" name="Artifacts" fill="#f97316" isAnimationActive={false} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </section>
        </>
      ) : (
        <section className="border border-border/70 bg-background/40">
          <ChartHeader
            title="Temporal normalization diagnostics (Aggregated)"
            detail="Các chỉ số astrometry, MAD scatter, reference drift và chunk boundary jump đo được trực tiếp từ pipeline runtime."
          />
          <div className="h-72 p-3">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={aggregateAstrometry} margin={{ left: 10, right: 10, top: 10, bottom: 4 }}>
                <CartesianGrid vertical={false} strokeDasharray="3 3" opacity={0.18} />
                <XAxis dataKey="statistic" tick={{ fontSize: 10 }} />
                <YAxis tickFormatter={(val) => compactPPM(Number(val))} tick={{ fontSize: 10 }} width={55} label={{ value: 'ppm', angle: -90, position: 'insideLeft', fontSize: 10 }} />
                <Tooltip formatter={(val) => `${Number(val).toLocaleString(undefined, { maximumFractionDigits: 2 })} ppm`} />
                <Legend />
                <Bar dataKey="value" name="Observed ppm" fill="#a855f7" isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>
      )}

      {/* Row 3: Live rates */}
      {hasActivity && (
        <section className="border border-border/70 bg-background/40">
          <ChartHeader title="Live pixel transform rates" detail="Tốc độ pixel input và retained đi qua temporal pixel normalizer." />
          <div className="h-52 p-2">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={series}>
                <CartesianGrid vertical={false} strokeDasharray="3 3" opacity={0.18} />
                <XAxis dataKey="timestamp" tickFormatter={clock} minTickGap={28} tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} tickFormatter={(val) => compactCount(Number(val))} width={52} />
                <Tooltip labelFormatter={(item) => clock(Number(item))} formatter={(item) => `${Number(item).toFixed(2)} pixel/s`} />
                <Legend />
                <Area dataKey="tpf_pixel_input_rate" name="Input pixel rate" stroke="#8b5cf6" fill="#8b5cf6" fillOpacity={0.15} isAnimationActive={false} />
                <Line dataKey="tpf_pixel_retained_rate" name="Retained pixel rate" stroke="#10b981" strokeWidth={2} dot={false} isAnimationActive={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </section>
      )}
    </div>
  );
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

function singleHistogram(values: number[]): Array<{ bucket: string; count: number }> {
  return BOUNDARY_BUCKETS.map((bucket, index) => {
    const lower = index === 0 ? Number.NEGATIVE_INFINITY : BOUNDARY_BUCKETS[index - 1].upper;
    return { bucket: bucket.label, count: values.filter((value) => value > lower && value <= bucket.upper).length };
  });
}

function temporalEnvelope(points: TPFTransformPoint[]): Array<{ timestamp: number; p50: number; p95: number }> {
  const ordered = [...points]
    .map((point) => ({ ...point, timestamp: Date.parse(point.completed_at) / 1000 }))
    .filter((point) => Number.isFinite(point.timestamp))
    .sort((a, b) => a.timestamp - b.timestamp);
  const bucketSize = Math.max(1, Math.ceil(ordered.length / 24));
  const result: Array<{ timestamp: number; p50: number; p95: number }> = [];
  for (let index = 0; index < ordered.length; index += bucketSize) {
    const bucket = ordered.slice(index, index + bucketSize);
    result.push({
      timestamp: bucket[Math.floor(bucket.length / 2)].timestamp,
      p50: quantileNumbers(bucket.map((point) => point.drift_p50_ppm), 0.50),
      p95: quantileNumbers(bucket.map((point) => point.drift_p95_ppm), 0.95),
    });
  }
  return result;
}

function quantileNumbers(values: number[], quantile: number): number {
  const ordered = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (ordered.length === 0) return 0;
  const position = quantile * (ordered.length - 1);
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return ordered[lower];
  return ordered[lower] * (upper - position) + ordered[upper] * (position - lower);
}

function sumBy<T>(items: T[], getValue: (item: T) => number): number {
  return items.reduce((total, item) => total + Math.max(0, getValue(item)), 0);
}

function ChartHeader({ title, detail }: { title: string; detail: string }): JSX.Element {
  return (
    <div className="border-b border-border/60 px-3 py-2">
      <p className="font-medium">{title}</p>
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

function compactPPM(value: number): string {
  return value >= 1_000 ? `${(value / 1_000).toFixed(value >= 10_000 ? 0 : 1)}k` : formatPPM(value);
}

function compactCount(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return value.toLocaleString();
}

function Metric({ label, value, detail }: { label: string; value: string; detail?: string }): JSX.Element {
  return (
    <div className="bg-background p-3">
      <p className="text-[10px] uppercase text-muted-foreground">{label}</p>
      <p className="mt-1 font-mono font-semibold">{value}</p>
      {detail && <p className="font-mono text-[10px] text-muted-foreground">{detail}</p>}
    </div>
  );
}
