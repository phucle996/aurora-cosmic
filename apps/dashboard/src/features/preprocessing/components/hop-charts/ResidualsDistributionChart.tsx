import { type JSX } from 'react';
import {
  Area, Bar, BarChart, CartesianGrid, Cell, ComposedChart, Legend, Line,
  ReferenceLine, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis,
} from 'recharts';

import type { Hop } from '../../types';
import { TelemetryUnavailable } from './TelemetryUnavailable';
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

export function ResidualsDistributionChart({
  metrics, telemetry, focus, scatterPoints,
}: {
  metrics?: Record<string, number>;
  telemetry?: Telemetry;
  focus?: 'lightcurve' | 'target-pixel';
  scatterPoints?: ScatterPoint[];
}): JSX.Element {
  const lightCurves = Math.max(0, metrics?.completed_lightcurves ?? 0);
  const targetPixels = Math.max(0, metrics?.completed_target_pixels ?? 0);
  const total = focus === 'lightcurve' ? lightCurves : focus === 'target-pixel' ? targetPixels : lightCurves + targetPixels;
  const showLC = focus !== 'target-pixel';
  const showTPF = focus !== 'lightcurve';
  const preclipSamples = Math.max(0, metrics?.lc_preclip_samples ?? 0);
  const retainedSamples = Math.max(0, metrics?.lc_retained_samples ?? 0);
  const outliers = Math.max(0, metrics?.lc_outlier_removed ?? 0);
  if (total === 0 && preclipSamples === 0) return <TelemetryUnavailable detail="Chưa có transform evidence cho phase này." />;

  const clipRate = ratio(outliers, preclipSamples);
  const retainedRate = ratio(retainedSamples, preclipSamples);
  const durableScatter = (metrics?.lc_scatter_products ?? 0) > 0;
  const beforeMean = durableScatter ? metrics?.lc_scatter_before_mean_durable ?? 0 : 0;
  const afterMean = durableScatter ? metrics?.lc_scatter_after_mean_durable ?? 0 : 0;
  const scatterReduction = beforeMean > 0 ? (beforeMean - afterMean) / beforeMean : 0;
  const aggregateScatter = [
    { statistic: 'P50', before: durableScatter ? metrics?.lc_scatter_before_p50_durable ?? 0 : metrics?.lc_scatter_before_p50 ?? 0, after: durableScatter ? metrics?.lc_scatter_after_p50_durable ?? 0 : metrics?.lc_scatter_after_p50 ?? 0 },
    { statistic: 'P95', before: durableScatter ? metrics?.lc_scatter_before_p95_durable ?? 0 : metrics?.lc_scatter_before_p95 ?? 0, after: durableScatter ? metrics?.lc_scatter_after_p95_durable ?? 0 : metrics?.lc_scatter_after_p95 ?? 0 },
  ];

  const productScatter = (scatterPoints ?? [])
    .filter((point) => point.before_ppm > 0 && point.after_ppm > 0)
    .map((point) => ({ ...point, artifact: shortObjectKey(point.object_key), clipRate: ratio(point.outlier_removed, point.preclip_samples) }));
  const scatterValues = productScatter.flatMap((point) => [point.before_ppm, point.after_ppm]);
  const scatterMin = scatterValues.length > 0 ? Math.max(1, Math.min(...scatterValues) * 0.8) : 1;
  const rawScatterMax = scatterValues.length > 0 ? Math.max(...scatterValues) * 1.2 : 10;
  const scatterMax = Math.max(scatterMin * 1.25, rawScatterMax);
  const histogram = SCATTER_BUCKETS.map((bucket, index) => {
    const lower = index === 0 ? Number.NEGATIVE_INFINITY : SCATTER_BUCKETS[index - 1].upper;
    return {
      bucket: bucket.label,
      before: productScatter.filter((point) => point.before_ppm > lower && point.before_ppm <= bucket.upper).length,
      after: productScatter.filter((point) => point.after_ppm > lower && point.after_ppm <= bucket.upper).length,
    };
  });
  const highClipProducts = productScatter.filter((point) => point.clipRate > 0.1).length;

  const clip3To4 = Math.max(0, metrics?.lc_sigma_clip_3_4_removed ?? 0);
  const clip4To5 = Math.max(0, metrics?.lc_sigma_clip_4_5_removed ?? 0);
  const clipGE5 = Math.max(0, metrics?.lc_sigma_clip_ge_5_removed ?? 0);
  const unclassifiedClip = Math.max(0, outliers - clip3To4 - clip4To5 - clipGE5);
  const clipImpact = [{ phase: 'Cadences', retained: retainedSamples, clip3To4, clip4To5, clipGE5, unclassifiedClip }];
  const clipRows = [
    { label: 'Retained', value: retainedSamples, color: '#10b981' },
    { label: 'Rejected 3–4σ', value: clip3To4, color: '#facc15' },
    { label: 'Rejected 4–5σ', value: clip4To5, color: '#fb923c' },
    { label: 'Rejected ≥5σ', value: clipGE5, color: '#ef4444' },
    ...(unclassifiedClip > 0 ? [{ label: 'Legacy / unclassified', value: unclassifiedClip, color: '#64748b' }] : []),
  ];

  const durableFinite = (metrics?.tpf_finite_products ?? 0) > 0;
  const finiteData = [
    { statistic: 'P05', finite: 100 * (durableFinite ? metrics?.tpf_finite_fraction_p05_durable ?? 0 : metrics?.tpf_finite_pixel_fraction_p05 ?? 0) },
    { statistic: 'P50', finite: 100 * (durableFinite ? metrics?.tpf_finite_fraction_p50_durable ?? 0 : metrics?.tpf_finite_pixel_fraction ?? 0) },
    { statistic: 'Mean', finite: 100 * (durableFinite ? metrics?.tpf_finite_fraction_mean_durable ?? 0 : metrics?.tpf_finite_pixel_fraction ?? 0) },
  ];
  const hasFiniteEvidence = finiteData.some((item) => item.finite > 0);
  const finiteTrend = mergedSeries(telemetry, ['tpf_finite_pixel_fraction']).map((point) => ({ ...point, finite: 100 * Number(point.tpf_finite_pixel_fraction ?? 0) }));
  const hasFiniteTrend = finiteTrend.some((point) => point.finite > 0);

  const series = mergedSeries(telemetry, ['lc_output_rate', 'tpf_output_rate', 'lc_outlier_removed_rate']).map((point) => ({ ...point, outlierRate: Number(point.lc_outlier_removed_rate ?? 0) }));
  const hasActivity = series.some((point) => (showLC && (Number(point.lc_output_rate ?? 0) > 0 || point.outlierRate > 0)) || (showTPF && Number(point.tpf_output_rate ?? 0) > 0));

  return <div className="space-y-3">
    <div className="grid grid-cols-2 gap-px border border-border/70 bg-border/70 text-xs lg:grid-cols-6">
      <Metric label="Transformed products" value={total.toLocaleString()} detail={focus === 'lightcurve' ? `${lightCurves} LC` : focus === 'target-pixel' ? `${targetPixels} TPF` : `${lightCurves} LC · ${targetPixels} TPF`} />
      {showLC && <>
        <Metric label="LC retained" value={retainedSamples.toLocaleString()} detail={percent(retainedRate)} />
        <Metric label="Sigma clipped" value={outliers.toLocaleString()} detail={percent(clipRate)} />
        <Metric label="Scatter before" value={durableScatter ? `${formatPPM(beforeMean)} ppm` : '—'} detail="mean across LC" />
        <Metric label="Scatter after" value={durableScatter ? `${formatPPM(afterMean)} ppm` : '—'} detail={durableScatter ? `${signedPercent(scatterReduction)} change` : undefined} />
        <Metric label="High clipping" value={productScatter.length > 0 ? highClipProducts.toLocaleString() : '—'} detail=">10% cadences / LC" />
      </>}
      {showTPF && <Metric label="Finite TPF pixels · P05" value={hasFiniteEvidence ? `${finiteData[0].finite.toFixed(3)}%` : '—'} detail={durableFinite ? `${metrics?.tpf_finite_products ?? 0} products` : undefined} />}
    </div>

    {showLC && <>
      <div className="grid gap-3 xl:grid-cols-2">
        <section className="border border-border/70 bg-background/40">
          <ChartHeader title="Post-normalization scatter: pre-clip vs retained" detail="Mỗi điểm là một Silver Light Curve; dưới đường y=x nghĩa là scatter giảm sau clipping." />
          {productScatter.length > 0 ? <div className="h-80 p-3"><ResponsiveContainer width="100%" height="100%"><ScatterChart margin={{ left: 8, right: 18, top: 12, bottom: 10 }}>
            <CartesianGrid strokeDasharray="3 3" opacity={0.18} />
            <XAxis type="number" dataKey="before_ppm" name="Before" scale="log" domain={[scatterMin, scatterMax]} tickFormatter={compactPPM} tick={{ fontSize: 9 }} label={{ value: 'Before clip · ppm', position: 'insideBottom', offset: -7, fontSize: 10 }} />
            <YAxis type="number" dataKey="after_ppm" name="After" scale="log" domain={[scatterMin, scatterMax]} tickFormatter={compactPPM} tick={{ fontSize: 9 }} width={55} label={{ value: 'After clip · ppm', angle: -90, position: 'insideLeft', fontSize: 10 }} />
            <Tooltip content={<ProductScatterTooltip />} />
            <ReferenceLine segment={[{ x: scatterMin, y: scatterMin }, { x: scatterMax, y: scatterMax }]} stroke="#94a3b8" strokeDasharray="5 4" />
            <Scatter name="Light Curve" data={productScatter} isAnimationActive={false}>{productScatter.map((point) => <Cell key={point.object_key} fill={point.after_ppm <= point.before_ppm ? '#22d3ee' : '#f97316'} fillOpacity={0.72} />)}</Scatter>
          </ScatterChart></ResponsiveContainer></div> : <AggregateScatterFallback data={aggregateScatter} />}
        </section>

        <section className="border border-border/70 bg-background/40">
          <ChartHeader title="Scatter distribution" detail="Độ lệch chuẩn flux theo ppm trước và sau clipping; bucket cố định để so sánh giữa run." />
          {productScatter.length > 0 ? <div className="h-80 p-3"><ResponsiveContainer width="100%" height="100%"><BarChart data={histogram} margin={{ left: 0, right: 8, top: 10, bottom: 4 }}>
            <CartesianGrid vertical={false} strokeDasharray="3 3" opacity={0.18} /><XAxis dataKey="bucket" tick={{ fontSize: 9 }} interval={0} /><YAxis allowDecimals={false} tick={{ fontSize: 9 }} width={35} /><Tooltip formatter={(value) => `${Number(value).toLocaleString()} Light Curves`} /><Legend />
            <Bar dataKey="before" name="Before clip" fill="#64748b" isAnimationActive={false} /><Bar dataKey="after" name="After clip" fill="#22d3ee" isAnimationActive={false} />
          </BarChart></ResponsiveContainer></div> : <EvidencePending detail="Artifact cũ chưa có paired scatter metadata để dựng histogram theo product." />}
        </section>
      </div>

      <section className="border border-border/70 bg-background/40">
        <div className="flex flex-wrap items-start justify-between gap-2 border-b border-border/60 px-3 py-2"><div><p className="font-medium">Sigma-clipping impact</p><p className="text-[10px] text-muted-foreground">Cadence bị loại được phân tầng theo khoảng cách σ thực đo tại thời điểm clipping.</p></div><div className="text-right"><p className="font-mono text-sm font-semibold">{outliers.toLocaleString()} rejected</p><p className="font-mono text-[10px] text-muted-foreground">{percent(clipRate)} of {preclipSamples.toLocaleString()}</p></div></div>
        <div className="grid gap-3 p-3 xl:grid-cols-[minmax(0,1.5fr)_minmax(320px,1fr)]">
          <div className="h-36"><ResponsiveContainer width="100%" height="100%"><BarChart data={clipImpact} layout="vertical" margin={{ left: 10, right: 18 }}>
            <CartesianGrid horizontal={false} strokeDasharray="3 3" opacity={0.18} /><XAxis type="number" tickFormatter={(value) => Number(value).toLocaleString()} tick={{ fontSize: 9 }} /><YAxis type="category" dataKey="phase" width={62} tick={{ fontSize: 9 }} /><Tooltip formatter={(value) => `${Number(value).toLocaleString()} · ${percent(ratio(Number(value), preclipSamples))}`} /><Legend />
            <Bar dataKey="retained" name="Retained" stackId="clip" fill="#10b981" isAnimationActive={false} /><Bar dataKey="clip3To4" name="3–4σ" stackId="clip" fill="#facc15" isAnimationActive={false} /><Bar dataKey="clip4To5" name="4–5σ" stackId="clip" fill="#fb923c" isAnimationActive={false} /><Bar dataKey="clipGE5" name="≥5σ" stackId="clip" fill="#ef4444" isAnimationActive={false} />{unclassifiedClip > 0 && <Bar dataKey="unclassifiedClip" name="Legacy" stackId="clip" fill="#64748b" isAnimationActive={false} />}
          </BarChart></ResponsiveContainer></div>
          <div className="divide-y divide-border/60 border border-border/60">{clipRows.map((row) => <div key={row.label} className="grid grid-cols-[1fr_auto_auto] items-center gap-4 px-3 py-2"><span className="flex items-center gap-2"><span className="size-2" style={{ backgroundColor: row.color }} />{row.label}</span><span className="font-mono font-semibold">{row.value.toLocaleString()}</span><span className="w-16 text-right font-mono text-muted-foreground">{percent(ratio(row.value, preclipSamples))}</span></div>)}</div>
        </div>
      </section>
    </>}

    {showTPF && <div className="grid gap-3 xl:grid-cols-2">
      <section className="border border-border/70 bg-background/40"><ChartHeader title="TPF finite-pixel distribution" detail="P05 làm lộ nhóm sản phẩm xấu nhất; P50 và mean mô tả mức hữu dụng điển hình." />{hasFiniteEvidence ? <div className="h-64 p-3"><ResponsiveContainer width="100%" height="100%"><BarChart data={finiteData}><CartesianGrid vertical={false} strokeDasharray="3 3" opacity={0.18} /><XAxis dataKey="statistic" tick={{ fontSize: 10 }} /><YAxis domain={[0, 100]} tickFormatter={(value) => `${value}%`} tick={{ fontSize: 10 }} width={45} /><Tooltip formatter={(value) => `${Number(value).toFixed(4)}% finite`} /><Bar dataKey="finite" name="Finite pixels" fill="#a855f7" isAnimationActive={false} /></BarChart></ResponsiveContainer></div> : <EvidencePending detail="Chưa có finite-pixel fraction trong TPF artifact quan sát được." />}</section>
      <section className="border border-border/70 bg-background/40"><ChartHeader title="TPF normalization integrity over time" detail="Theo dõi finite-pixel fraction của các sản phẩm gần nhất để phát hiện drift theo thời gian." />{hasFiniteTrend ? <div className="h-64 p-3"><ResponsiveContainer width="100%" height="100%"><ComposedChart data={finiteTrend}><CartesianGrid vertical={false} strokeDasharray="3 3" opacity={0.18} /><XAxis dataKey="timestamp" tickFormatter={clock} minTickGap={28} tick={{ fontSize: 9 }} /><YAxis domain={[0, 100]} tickFormatter={(value) => `${value}%`} tick={{ fontSize: 9 }} width={45} /><Tooltip labelFormatter={(item) => clock(Number(item))} formatter={(value) => `${Number(value).toFixed(4)}% finite`} /><Line dataKey="finite" name="Finite pixels" stroke="#a855f7" strokeWidth={2} dot={false} isAnimationActive={false} /></ComposedChart></ResponsiveContainer></div> : <EvidencePending detail="Không có TPF transform activity trong observation window hiện tại; phân bố durable bên trái vẫn dùng được." />}</section>
    </div>}

    {hasActivity && <section className="border border-border/70 bg-background/40"><ChartHeader title="Live transform rates" detail="Output cadence và sigma-clipped cadence trong cùng observation window." /><div className="h-52 p-2"><ResponsiveContainer width="100%" height="100%"><ComposedChart data={series}><CartesianGrid vertical={false} strokeDasharray="3 3" opacity={0.18} /><XAxis dataKey="timestamp" tickFormatter={clock} minTickGap={28} tick={{ fontSize: 10 }} /><YAxis tick={{ fontSize: 10 }} width={48} /><Tooltip labelFormatter={(item) => clock(Number(item))} formatter={(item) => `${Number(item).toFixed(2)} cadence/s`} /><Legend />{showLC && <Area dataKey="lc_output_rate" name="LC output" stroke="#22d3ee" fill="#22d3ee" fillOpacity={0.18} isAnimationActive={false} />}{showTPF && <Area dataKey="tpf_output_rate" name="TPF output" stroke="#a855f7" fill="#a855f7" fillOpacity={0.16} isAnimationActive={false} />}{showLC && <Line dataKey="outlierRate" name="LC sigma clipped" stroke="#f59e0b" strokeWidth={2} dot={false} isAnimationActive={false} />}</ComposedChart></ResponsiveContainer></div></section>}
  </div>;
}

function ProductScatterTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload?: ScatterPoint & { artifact: string; clipRate: number } }> }): JSX.Element | null {
  const point = payload?.[0]?.payload;
  if (!active || !point) return null;
  return <div className="border border-border bg-background p-2 text-[10px] shadow-lg"><p className="max-w-72 truncate font-mono font-semibold">{point.artifact}</p><p>Before: <strong>{formatPPM(point.before_ppm)} ppm</strong></p><p>After: <strong>{formatPPM(point.after_ppm)} ppm</strong></p><p>Clipped: <strong>{point.outlier_removed.toLocaleString()} · {percent(point.clipRate)}</strong></p>{point.sigma_clip_level > 0 && <p>Threshold: <strong>{point.sigma_clip_level}σ</strong></p>}</div>;
}

function AggregateScatterFallback({ data }: { data: Array<{ statistic: string; before: number; after: number }> }): JSX.Element {
  const hasEvidence = data.some((item) => item.before > 0 || item.after > 0);
  if (!hasEvidence) return <EvidencePending detail="Chưa có paired scatter evidence cho Light Curve trong scope hiện tại." />;
  return <div className="h-80 p-3"><ResponsiveContainer width="100%" height="100%"><BarChart data={data}><CartesianGrid vertical={false} strokeDasharray="3 3" opacity={0.18} /><XAxis dataKey="statistic" tick={{ fontSize: 10 }} /><YAxis tickFormatter={(value) => formatPPM(Number(value))} tick={{ fontSize: 10 }} width={56} /><Tooltip formatter={(value) => `${Number(value).toLocaleString(undefined, { maximumFractionDigits: 2 })} ppm`} /><Legend /><Bar dataKey="before" name="Before clip" fill="#64748b" isAnimationActive={false} /><Bar dataKey="after" name="After clip" fill="#22d3ee" isAnimationActive={false} /></BarChart></ResponsiveContainer></div>;
}

function ChartHeader({ title, detail }: { title: string; detail: string }): JSX.Element {
  return <div className="border-b border-border/60 px-3 py-2"><p className="font-medium">{title}</p><p className="text-[10px] text-muted-foreground">{detail}</p></div>;
}

function ratio(value: number, total: number): number { return total > 0 ? value / total : 0; }
function percent(value: number): string { return `${(value * 100).toFixed(2)}%`; }
function signedPercent(value: number): string {
  if (Math.abs(value) < 0.00005) return '0.00%';
  return `${value > 0 ? '−' : '+'}${Math.abs(value * 100).toFixed(2)}%`;
}
function formatPPM(value: number): string { return value.toLocaleString(undefined, { maximumFractionDigits: value >= 100 ? 0 : 2 }); }
function compactPPM(value: number): string { return value >= 1_000 ? `${(value / 1_000).toFixed(value >= 10_000 ? 0 : 1)}k` : formatPPM(value); }
function shortObjectKey(value: string): string { const parts = value.split('/'); return parts.at(-1) || value; }

function Metric({ label, value, detail }: { label: string; value: string; detail?: string }): JSX.Element {
  return <div className="bg-background p-3"><p className="text-[10px] uppercase text-muted-foreground">{label}</p><p className="mt-1 font-mono font-semibold">{value}</p>{detail && <p className="font-mono text-[10px] text-muted-foreground">{detail}</p>}</div>;
}

function EvidencePending({ detail }: { detail: string }): JSX.Element {
  return <div className="flex h-64 items-center justify-center p-6"><p className="max-w-md border-l-2 border-primary/50 pl-3 text-[11px] text-muted-foreground">{detail}</p></div>;
}
