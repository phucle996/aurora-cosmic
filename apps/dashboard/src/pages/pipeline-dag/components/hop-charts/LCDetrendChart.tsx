import { type JSX } from 'react';
import {
  Area, Bar, BarChart, CartesianGrid, Cell, ComposedChart, Legend, Line,
  ReferenceLine, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis,
} from 'recharts';

import type { Hop } from '../../types';
import { clock, mergedSeries, type Telemetry } from './telemetry';

type ScatterPoint = NonNullable<Hop['scatter_points']>[number];

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

export function LCDetrendChart({
  metrics,
  telemetry,
  scatterPoints,
}: {
  metrics?: Record<string, number>;
  telemetry?: Telemetry;
  scatterPoints?: ScatterPoint[];
}): JSX.Element {
  const lightCurves = Math.round(Math.max(0, metrics?.completed_lightcurves ?? 0));
  const retainedSamples = Math.round(Math.max(0, metrics?.lc_retained_samples ?? metrics?.lc_output_total ?? 0));
  const outliers = Math.round(Math.max(0, metrics?.lc_outlier_removed ?? metrics?.lc_outlier_removed_total ?? 0));
  const preclipSamples = Math.round(Math.max(0, metrics?.lc_preclip_samples ?? (retainedSamples + outliers)));

  const clipRate = ratio(outliers, preclipSamples);
  const retainedRate = preclipSamples > 0 ? ratio(retainedSamples, preclipSamples) : 1;

  const durableScatter = (metrics?.lc_scatter_products ?? 0) > 0 || (metrics?.lc_scatter_before_p50 ?? 0) > 0;
  const beforeMean = metrics?.lc_scatter_before_mean_durable ?? metrics?.lc_scatter_before_p50 ?? 0;
  const afterMean = metrics?.lc_scatter_after_mean_durable ?? metrics?.lc_scatter_after_p50 ?? 0;
  const scatterReduction = beforeMean > 0 ? (beforeMean - afterMean) / beforeMean : 0;
  const afterP95 = metrics?.lc_scatter_after_p95 ?? metrics?.lc_scatter_after_p95_durable ?? 0;

  const aggregateScatter = [
    {
      statistic: 'P50',
      before: metrics?.lc_scatter_before_p50_durable ?? metrics?.lc_scatter_before_p50 ?? 0,
      after: metrics?.lc_scatter_after_p50_durable ?? metrics?.lc_scatter_after_p50 ?? 0,
    },
    {
      statistic: 'Mean',
      before: beforeMean,
      after: afterMean,
    },
    {
      statistic: 'P95',
      before: metrics?.lc_scatter_before_p95_durable ?? metrics?.lc_scatter_before_p95 ?? 0,
      after: afterP95,
    },
  ];

  const productScatter = (scatterPoints ?? [])
    .filter((point) => point.before_ppm > 0 && point.after_ppm > 0)
    .map((point) => ({
      ...point,
      artifact: shortObjectKey(point.object_key),
      clipRate: ratio(point.outlier_removed, point.preclip_samples),
    }));

  const scatterValues = productScatter.flatMap((point) => [point.before_ppm, point.after_ppm]);
  const scatterMin = scatterValues.length > 0 ? Math.max(1, Math.min(...scatterValues) * 0.8) : 1;
  const rawScatterMax = scatterValues.length > 0 ? Math.max(...scatterValues) * 1.2 : 10;
  const scatterMax = Math.max(scatterMin * 1.25, rawScatterMax);

  // Paired product histogram if individual scatter points exist
  const productHistogram = SCATTER_BUCKETS.map((bucket, index) => {
    const lower = index === 0 ? Number.NEGATIVE_INFINITY : SCATTER_BUCKETS[index - 1].upper;
    return {
      bucket: bucket.label,
      before: productScatter.filter((point) => point.before_ppm > lower && point.before_ppm <= bucket.upper).length,
      after: productScatter.filter((point) => point.after_ppm > lower && point.after_ppm <= bucket.upper).length,
    };
  });

  // Real aggregate Prometheus histogram buckets across all products
  const hasPromHistogram = (metrics?.lc_scatter_products ?? 0) > 0 || (metrics?.lc_scatter_bucket_le_1000 ?? 0) > 0;
  const totalCount = metrics?.lc_scatter_products ?? lightCurves;
  const le100 = metrics?.lc_scatter_bucket_le_100 ?? 0;
  const le300 = metrics?.lc_scatter_bucket_le_300 ?? 0;
  const le1k = metrics?.lc_scatter_bucket_le_1000 ?? 0;
  const le3k = metrics?.lc_scatter_bucket_le_3000 ?? 0;
  const le10k = metrics?.lc_scatter_bucket_le_10000 ?? 0;
  const le30k = metrics?.lc_scatter_bucket_le_30000 ?? 0;
  const le100k = metrics?.lc_scatter_bucket_le_100000 ?? 0;

  const aggregateHistogram = [
    { bucket: '<100', count: Math.max(0, le100) },
    { bucket: '100–300', count: Math.max(0, le300 - le100) },
    { bucket: '300–1k', count: Math.max(0, le1k - le300) },
    { bucket: '1–3k', count: Math.max(0, le3k - le1k) },
    { bucket: '3–10k', count: Math.max(0, le10k - le3k) },
    { bucket: '10–30k', count: Math.max(0, le30k - le10k) },
    { bucket: '30–100k', count: Math.max(0, le100k - le30k) },
    { bucket: '≥100k', count: Math.max(0, totalCount - le100k) },
  ];

  const highClipProducts = productScatter.filter((point) => point.clipRate > 0.1).length;

  const clip3To4 = Math.round(Math.max(0, metrics?.lc_sigma_clip_3_4_removed ?? 0));
  const clip4To5 = Math.round(Math.max(0, metrics?.lc_sigma_clip_4_5_removed ?? 0));
  const clipGE5 = Math.round(Math.max(0, metrics?.lc_sigma_clip_ge_5_removed ?? 0));
  const unclassifiedClip = Math.max(0, outliers - clip3To4 - clip4To5 - clipGE5);
  const clipImpact = [{ phase: 'Cadences', retained: retainedSamples, clip3To4, clip4To5, clipGE5, unclassifiedClip }];
  const clipRows = [
    { label: 'Retained', value: retainedSamples, color: '#10b981' },
    { label: 'Rejected 3–4σ', value: clip3To4, color: '#facc15' },
    { label: 'Rejected 4–5σ', value: clip4To5, color: '#fb923c' },
    { label: 'Rejected ≥5σ', value: clipGE5, color: '#ef4444' },
    ...(unclassifiedClip > 0 ? [{ label: 'Legacy / unclassified', value: unclassifiedClip, color: '#64748b' }] : []),
  ];

  const series: Array<Record<string, number> & { outlierRate: number }> = mergedSeries(telemetry, ['lc_output_rate', 'lc_outlier_removed_rate']).map((point) => ({
    ...point,
    outlierRate: Number(point.lc_outlier_removed_rate ?? 0),
  }));
  const hasActivity = series.some((point) => Number(point.lc_output_rate ?? 0) > 0 || point.outlierRate > 0);

  return (
    <div className="space-y-3">
      {/* KPI Header Cards */}
      <div className="grid grid-cols-2 gap-px border border-border/70 bg-border/70 text-xs lg:grid-cols-6">
        <Metric label="Transformed products" value={lightCurves.toLocaleString()} detail={`${lightCurves} Light Curves`} />
        <Metric label="LC retained" value={retainedSamples.toLocaleString()} detail={percent(retainedRate)} />
        <Metric label="Sigma clipped" value={outliers.toLocaleString()} detail={percent(clipRate)} />
        <Metric label="Scatter before" value={durableScatter ? `${formatPPM(beforeMean)} ppm` : '—'} detail="mean across LC" />
        <Metric label="Scatter after" value={durableScatter ? `${formatPPM(afterMean)} ppm` : '—'} detail={durableScatter ? `${signedPercent(scatterReduction)} change` : undefined} />
        <Metric label="Scatter tail · P95" value={afterP95 > 0 ? `${formatPPM(afterP95)} ppm` : (productScatter.length > 0 ? `${highClipProducts} high-clip` : '—')} detail={afterP95 > 0 ? 'upper 95th percentile' : '>10% cadences / LC'} />
      </div>

      {/* Row 1: Scatter Quantiles / Log Scatter Chart & Distribution Histogram */}
      <div className="grid gap-3 xl:grid-cols-2">
        <section className="border border-border/70 bg-background/40">
          <ChartHeader
            title="Post-normalization scatter: pre-clip vs retained"
            detail="Mỗi điểm là một Silver Light Curve; dưới đường y=x nghĩa là scatter giảm sau clipping."
          />
          {productScatter.length > 0 ? (
            <div className="h-80 p-3">
              <ResponsiveContainer width="100%" height="100%">
                <ScatterChart margin={{ left: 8, right: 18, top: 12, bottom: 10 }}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.18} />
                  <XAxis
                    type="number"
                    dataKey="before_ppm"
                    name="Before"
                    scale="log"
                    domain={[scatterMin, scatterMax]}
                    tickFormatter={compactPPM}
                    tick={{ fontSize: 9 }}
                    label={{ value: 'Before clip · ppm', position: 'insideBottom', offset: -7, fontSize: 10 }}
                  />
                  <YAxis
                    type="number"
                    dataKey="after_ppm"
                    name="After"
                    scale="log"
                    domain={[scatterMin, scatterMax]}
                    tickFormatter={compactPPM}
                    tick={{ fontSize: 9 }}
                    width={55}
                    label={{ value: 'After clip · ppm', angle: -90, position: 'insideLeft', fontSize: 10 }}
                  />
                  <Tooltip content={<ProductScatterTooltip />} />
                  <ReferenceLine
                    segment={[{ x: scatterMin, y: scatterMin }, { x: scatterMax, y: scatterMax }]}
                    stroke="#94a3b8"
                    strokeDasharray="5 4"
                  />
                  <Scatter name="Light Curve" data={productScatter} isAnimationActive={false}>
                    {productScatter.map((point) => (
                      <Cell key={point.object_key} fill={point.after_ppm <= point.before_ppm ? '#22d3ee' : '#f97316'} fillOpacity={0.72} />
                    ))}
                  </Scatter>
                </ScatterChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <AggregateScatterFallback data={aggregateScatter} />
          )}
        </section>

        <section className="border border-border/70 bg-background/40">
          <ChartHeader
            title="Scatter distribution"
            detail="Độ lệch chuẩn flux theo ppm đo được trên toàn bộ sản phẩm Light Curve đã qua normalize."
          />
          {productScatter.length > 0 ? (
            <div className="h-80 p-3">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={productHistogram} margin={{ left: 0, right: 8, top: 10, bottom: 4 }}>
                  <CartesianGrid vertical={false} strokeDasharray="3 3" opacity={0.18} />
                  <XAxis dataKey="bucket" tick={{ fontSize: 9 }} interval={0} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 9 }} width={35} />
                  <Tooltip formatter={(value) => `${Number(value).toLocaleString()} Light Curves`} />
                  <Legend />
                  <Bar dataKey="before" name="Before clip" fill="#64748b" isAnimationActive={false} />
                  <Bar dataKey="after" name="After clip" fill="#22d3ee" isAnimationActive={false} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : hasPromHistogram ? (
            <div className="h-80 p-3">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={aggregateHistogram} margin={{ left: 0, right: 8, top: 10, bottom: 4 }}>
                  <CartesianGrid vertical={false} strokeDasharray="3 3" opacity={0.18} />
                  <XAxis dataKey="bucket" tick={{ fontSize: 9 }} interval={0} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 9 }} width={35} />
                  <Tooltip formatter={(value) => `${Number(value).toLocaleString()} Light Curves`} />
                  <Legend />
                  <Bar dataKey="count" name="Normalized Light Curves" fill="#22d3ee" isAnimationActive={false} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <EvidencePending detail="Chưa có dữ liệu histogram scatter trong scope hiện tại." />
          )}
        </section>
      </div>

      {/* Row 2: Sigma-clipping Impact Funnel */}
      <section className="border border-border/70 bg-background/40">
        <div className="flex flex-wrap items-start justify-between gap-2 border-b border-border/60 px-3 py-2">
          <div>
            <p className="font-medium">Sigma-clipping impact</p>
            <p className="text-[10px] text-muted-foreground">Cadence bị loại được phân tầng theo ngưỡng σ cấu hình tại bước PDC-SAP detrending.</p>
          </div>
          <div className="text-right">
            <p className="font-mono text-sm font-semibold">{outliers.toLocaleString()} rejected</p>
            <p className="font-mono text-[10px] text-muted-foreground">{percent(clipRate)} of {preclipSamples.toLocaleString()}</p>
          </div>
        </div>
        <div className="grid gap-3 p-3 xl:grid-cols-[minmax(0,1.5fr)_minmax(320px,1fr)]">
          <div className="h-36">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={clipImpact} layout="vertical" margin={{ left: 10, right: 18 }}>
                <CartesianGrid horizontal={false} strokeDasharray="3 3" opacity={0.18} />
                <XAxis type="number" tickFormatter={(value) => Number(value).toLocaleString()} tick={{ fontSize: 9 }} />
                <YAxis type="category" dataKey="phase" width={62} tick={{ fontSize: 9 }} />
                <Tooltip formatter={(value) => `${Number(value).toLocaleString()} · ${percent(ratio(Number(value), preclipSamples))}`} />
                <Legend />
                <Bar dataKey="retained" name="Retained" stackId="clip" fill="#10b981" isAnimationActive={false} />
                <Bar dataKey="clip3To4" name="3–4σ" stackId="clip" fill="#facc15" isAnimationActive={false} />
                <Bar dataKey="clip4To5" name="4–5σ" stackId="clip" fill="#fb923c" isAnimationActive={false} />
                <Bar dataKey="clipGE5" name="≥5σ" stackId="clip" fill="#ef4444" isAnimationActive={false} />
                {unclassifiedClip > 0 && <Bar dataKey="unclassifiedClip" name="Legacy" stackId="clip" fill="#64748b" isAnimationActive={false} />}
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="divide-y divide-border/60 border border-border/60">
            {clipRows.map((row) => (
              <div key={row.label} className="grid grid-cols-[1fr_auto_auto] items-center gap-4 px-3 py-2">
                <span className="flex items-center gap-2">
                  <span className="size-2" style={{ backgroundColor: row.color }} />
                  {row.label}
                </span>
                <span className="font-mono font-semibold">{row.value.toLocaleString()}</span>
                <span className="w-16 text-right font-mono text-muted-foreground">{percent(ratio(row.value, preclipSamples))}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Row 3: Live transform rates */}
      {hasActivity && (
        <section className="border border-border/70 bg-background/40">
          <ChartHeader title="Live transform rates" detail="Output cadence và sigma-clipped cadence trong cùng observation window." />
          <div className="h-52 p-2">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={series}>
                <CartesianGrid vertical={false} strokeDasharray="3 3" opacity={0.18} />
                <XAxis dataKey="timestamp" tickFormatter={clock} minTickGap={28} tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} width={48} />
                <Tooltip labelFormatter={(item) => clock(Number(item))} formatter={(item) => `${Number(item).toFixed(2)} cadence/s`} />
                <Legend />
                <Area dataKey="lc_output_rate" name="LC output" stroke="#22d3ee" fill="#22d3ee" fillOpacity={0.18} isAnimationActive={false} />
                <Line dataKey="outlierRate" name="LC sigma clipped" stroke="#f59e0b" strokeWidth={2} dot={false} isAnimationActive={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </section>
      )}
    </div>
  );
}

function ProductScatterTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload?: ScatterPoint & { artifact: string; clipRate: number } }> }): JSX.Element | null {
  const point = payload?.[0]?.payload;
  if (!active || !point) return null;
  return (
    <div className="border border-border bg-background p-2 text-[10px] shadow-lg">
      <p className="max-w-72 truncate font-mono font-semibold">{point.artifact}</p>
      <p>Before: <strong>{formatPPM(point.before_ppm)} ppm</strong></p>
      <p>After: <strong>{formatPPM(point.after_ppm)} ppm</strong></p>
      <p>Clipped: <strong>{point.outlier_removed.toLocaleString()} · {percent(point.clipRate)}</strong></p>
      {point.sigma_clip_level > 0 && <p>Threshold: <strong>{point.sigma_clip_level}σ</strong></p>}
    </div>
  );
}

function AggregateScatterFallback({ data }: { data: Array<{ statistic: string; before: number; after: number }> }): JSX.Element {
  const hasEvidence = data.some((item) => item.before > 0 || item.after > 0);
  if (!hasEvidence) return <EvidencePending detail="Chưa có paired scatter evidence cho Light Curve trong scope hiện tại." />;
  return (
    <div className="h-80 p-3">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data}>
          <CartesianGrid vertical={false} strokeDasharray="3 3" opacity={0.18} />
          <XAxis dataKey="statistic" tick={{ fontSize: 10 }} />
          <YAxis tickFormatter={(value) => formatPPM(Number(value))} tick={{ fontSize: 10 }} width={56} />
          <Tooltip formatter={(value) => `${Number(value).toLocaleString(undefined, { maximumFractionDigits: 2 })} ppm`} />
          <Legend />
          <Bar dataKey="before" name="Before clip" fill="#64748b" isAnimationActive={false} />
          <Bar dataKey="after" name="After clip" fill="#22d3ee" isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
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

function signedPercent(value: number): string {
  if (Math.abs(value) < 0.00005) return '0.00%';
  return `${value > 0 ? '−' : '+'}${Math.abs(value * 100).toFixed(2)}%`;
}

function formatPPM(value: number): string {
  return value.toLocaleString(undefined, { maximumFractionDigits: value >= 100 ? 0 : 2 });
}

function compactPPM(value: number): string {
  return value >= 1_000 ? `${(value / 1_000).toFixed(value >= 10_000 ? 0 : 1)}k` : formatPPM(value);
}

function shortObjectKey(value: string): string {
  const parts = value.split('/');
  return parts.at(-1) || value;
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

function EvidencePending({ detail }: { detail: string }): JSX.Element {
  return (
    <div className="flex h-64 items-center justify-center p-6">
      <p className="max-w-md border-l-2 border-primary/50 pl-3 text-[11px] text-muted-foreground">{detail}</p>
    </div>
  );
}
