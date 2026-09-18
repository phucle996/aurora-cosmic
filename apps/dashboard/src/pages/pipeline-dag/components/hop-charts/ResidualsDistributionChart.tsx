import { type JSX } from 'react';
import {
  Area, Bar, BarChart, CartesianGrid, Cell, ComposedChart, Legend, Line,
  ReferenceLine, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis,
} from 'recharts';

import type { Hop } from '../../types';
import { TelemetryUnavailable } from './TelemetryUnavailable';
import { clock, mergedSeries, type Telemetry } from './telemetry';

type ScatterPoint = NonNullable<Hop['scatter_points']>[number];
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

export function ResidualsDistributionChart({
  metrics, telemetry, focus, scatterPoints, tpfTransformPoints,
}: {
  metrics?: Record<string, number>;
  telemetry?: Telemetry;
  focus?: 'lightcurve' | 'target-pixel';
  scatterPoints?: ScatterPoint[];
  tpfTransformPoints?: TPFTransformPoint[];
}): JSX.Element {
  const lightCurves = Math.max(0, metrics?.completed_lightcurves ?? 0);
  const targetPixels = Math.max(0, metrics?.completed_target_pixels ?? 0);
  const total = focus === 'lightcurve' ? lightCurves : focus === 'target-pixel' ? targetPixels : lightCurves + targetPixels;
  const showLC = focus !== 'target-pixel';
  const showTPF = focus !== 'lightcurve';
  const preclipSamples = Math.max(0, metrics?.lc_preclip_samples ?? 0);
  const retainedSamples = Math.max(0, metrics?.lc_retained_samples ?? 0);
  const outliers = Math.max(0, metrics?.lc_outlier_removed ?? 0);
  if (total === 0 && preclipSamples === 0 && (tpfTransformPoints?.length ?? 0) === 0) return <TelemetryUnavailable detail="Chưa có transform evidence cho phase này." />;

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
    {focus !== 'target-pixel' && <div className="grid grid-cols-2 gap-px border border-border/70 bg-border/70 text-xs lg:grid-cols-6">
      <Metric label="Transformed products" value={total.toLocaleString()} detail={focus === 'lightcurve' ? `${lightCurves} LC` : focus === 'target-pixel' ? `${targetPixels} TPF` : `${lightCurves} LC · ${targetPixels} TPF`} />
      {showLC && <>
        <Metric label="LC retained" value={retainedSamples.toLocaleString()} detail={percent(retainedRate)} />
        <Metric label="Sigma clipped" value={outliers.toLocaleString()} detail={percent(clipRate)} />
        <Metric label="Scatter before" value={durableScatter ? `${formatPPM(beforeMean)} ppm` : '—'} detail="mean across LC" />
        <Metric label="Scatter after" value={durableScatter ? `${formatPPM(afterMean)} ppm` : '—'} detail={durableScatter ? `${signedPercent(scatterReduction)} change` : undefined} />
        <Metric label="High clipping" value={productScatter.length > 0 ? highClipProducts.toLocaleString() : '—'} detail=">10% cadences / LC" />
      </>}
      {showTPF && <Metric label="Finite TPF pixels · P05" value={hasFiniteEvidence ? `${finiteData[0].finite.toFixed(3)}%` : '—'} detail={durableFinite ? `${metrics?.tpf_finite_products ?? 0} products` : undefined} />}
    </div>}

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

    {showTPF && <TPFNormalizationDiagnostics points={tpfTransformPoints} finiteData={finiteData} hasFiniteEvidence={hasFiniteEvidence} finiteTrend={finiteTrend} hasFiniteTrend={hasFiniteTrend} />}

    {hasActivity && <section className="border border-border/70 bg-background/40"><ChartHeader title="Live transform rates" detail="Output cadence và sigma-clipped cadence trong cùng observation window." /><div className="h-52 p-2"><ResponsiveContainer width="100%" height="100%"><ComposedChart data={series}><CartesianGrid vertical={false} strokeDasharray="3 3" opacity={0.18} /><XAxis dataKey="timestamp" tickFormatter={clock} minTickGap={28} tick={{ fontSize: 10 }} /><YAxis tick={{ fontSize: 10 }} width={48} /><Tooltip labelFormatter={(item) => clock(Number(item))} formatter={(item) => `${Number(item).toFixed(2)} cadence/s`} /><Legend />{showLC && <Area dataKey="lc_output_rate" name="LC output" stroke="#22d3ee" fill="#22d3ee" fillOpacity={0.18} isAnimationActive={false} />}{showTPF && <Area dataKey="tpf_output_rate" name="TPF output" stroke="#a855f7" fill="#a855f7" fillOpacity={0.16} isAnimationActive={false} />}{showLC && <Line dataKey="outlierRate" name="LC sigma clipped" stroke="#f59e0b" strokeWidth={2} dot={false} isAnimationActive={false} />}</ComposedChart></ResponsiveContainer></div></section>}
  </div>;
}

function TPFNormalizationDiagnostics({
  points, finiteData, hasFiniteEvidence, finiteTrend, hasFiniteTrend,
}: {
  points?: TPFTransformPoint[];
  finiteData: Array<{ statistic: string; finite: number }>;
  hasFiniteEvidence: boolean;
  finiteTrend: Array<Record<string, number>>;
  hasFiniteTrend: boolean;
}): JSX.Element {
  const artifacts = (points ?? []).filter((point) => point.finite_pixel_fraction >= 0 && point.finite_pixel_fraction <= 1);
  const evidence = artifacts.filter((point) => point.diagnostics_observed && point.input_pixel_values > 0);
  if (evidence.length === 0) {
    if (artifacts.length > 0) return <LegacyTPFDiagnostics artifacts={artifacts} />;
    return <div className="grid gap-3 xl:grid-cols-2">
      <section className="border border-border/70 bg-background/40"><ChartHeader title="TPF finite-pixel distribution" detail="P05 làm lộ nhóm sản phẩm xấu nhất; P50 và mean mô tả mức hữu dụng điển hình." />{hasFiniteEvidence ? <div className="h-64 p-3"><ResponsiveContainer width="100%" height="100%"><BarChart data={finiteData}><CartesianGrid vertical={false} strokeDasharray="3 3" opacity={0.18} /><XAxis dataKey="statistic" tick={{ fontSize: 10 }} /><YAxis domain={[0, 100]} tickFormatter={(value) => `${value}%`} tick={{ fontSize: 10 }} width={45} /><Tooltip formatter={(value) => `${Number(value).toFixed(4)}% finite`} /><Bar dataKey="finite" name="Finite pixels" fill="#a855f7" isAnimationActive={false} /></BarChart></ResponsiveContainer></div> : <EvidencePending detail="Chưa có finite-pixel fraction trong TPF artifact quan sát được." />}</section>
      <section className="border border-border/70 bg-background/40"><ChartHeader title="Finite-pixel integrity over time" detail="Tín hiệu live của tỷ lệ pixel hữu hạn trong observation window." />{hasFiniteTrend ? <div className="h-64 p-3"><ResponsiveContainer width="100%" height="100%"><ComposedChart data={finiteTrend}><CartesianGrid vertical={false} strokeDasharray="3 3" opacity={0.18} /><XAxis dataKey="timestamp" tickFormatter={clock} minTickGap={28} tick={{ fontSize: 9 }} /><YAxis domain={[0, 100]} tickFormatter={(value) => `${value}%`} tick={{ fontSize: 9 }} width={45} /><Tooltip labelFormatter={(item) => clock(Number(item))} formatter={(value) => `${Number(value).toFixed(4)}% finite`} /><Line dataKey="finite" name="Finite pixels" stroke="#a855f7" strokeWidth={2} dot={false} isAnimationActive={false} /></ComposedChart></ResponsiveContainer></div> : <EvidencePending detail="Chưa có artifact-level normalization evidence trong scope hiện tại." />}</section>
    </div>;
  }

  const input = sumBy(evidence, (point) => point.input_pixel_values);
  const retained = sumBy(evidence, (point) => point.normalized_pixel_values);
  const nonfinite = sumBy(evidence, (point) => point.nonfinite_pixel_values);
  const invalidReference = sumBy(evidence, (point) => point.invalid_reference_values);
  const invalidReferencePixels = sumBy(evidence, (point) => point.invalid_reference_pixels);
  const chunks = sumBy(evidence, (point) => point.chunk_count);
  const scatterP50 = quantileNumbers(evidence.map((point) => point.scatter_p50_ppm), 0.50);
  const scatterP95 = quantileNumbers(evidence.map((point) => point.scatter_p95_ppm), 0.95);
  const driftP95 = quantileNumbers(evidence.map((point) => point.drift_p95_ppm), 0.95);
  const boundaryP95 = quantileNumbers(evidence.map((point) => point.boundary_jump_p95_ppm), 0.95);
  const integrity = [{ stage: 'Pixel values', retained, nonfinite, invalidReference }];
  const integrityRows = [
    { label: 'Retained', value: retained, color: '#10b981' },
    { label: 'Non-finite input', value: nonfinite, color: '#f59e0b' },
    { label: 'Invalid reference', value: invalidReference, color: '#ef4444' },
  ];
  const scatterHistogram = pairedHistogram(evidence, (point) => point.scatter_p50_ppm, (point) => point.scatter_p95_ppm);
  const boundaryHistogram = singleHistogram(evidence.map((point) => point.boundary_jump_p95_ppm));
  const driftTimeline = temporalEnvelope(evidence);

  return <div className="space-y-3">
    <div className="grid grid-cols-2 gap-px border border-border/70 bg-border/70 text-xs lg:grid-cols-4 xl:grid-cols-8">
      <Metric label="Artifacts observed" value={evidence.length.toLocaleString()} detail={`${chunks.toLocaleString()} chunks`} />
      <Metric label="Pixel values" value={input.toLocaleString()} detail="normalization input" />
      <Metric label="Retained" value={percent(ratio(retained, input))} detail={retained.toLocaleString()} />
      <Metric label="Invalid references" value={invalidReference.toLocaleString()} detail={`${invalidReferencePixels.toLocaleString()} pixel positions`} />
      <Metric label="MAD scatter · P50" value={`${formatPPM(scatterP50)} ppm`} detail="across artifacts" />
      <Metric label="MAD scatter · P95" value={`${formatPPM(scatterP95)} ppm`} detail="upper tail" />
      <Metric label="Reference drift · P95" value={`${formatPPM(driftP95)} ppm`} detail="half-chunk median shift" />
      <Metric label="Boundary jump · P95" value={`${formatPPM(boundaryP95)} ppm`} detail="chunk continuity" />
    </div>

    <section className="border border-border/70 bg-background/40">
      <ChartHeader title="Normalization integrity funnel" detail="Mỗi pixel-value đầu vào được phân loại thành retained, non-finite hoặc neutralized vì temporal reference không hợp lệ." />
      <div className="grid gap-3 p-3 xl:grid-cols-[minmax(0,1.5fr)_minmax(320px,1fr)]">
        <div className="h-36"><ResponsiveContainer width="100%" height="100%"><BarChart data={integrity} layout="vertical" margin={{ left: 18, right: 18 }}><CartesianGrid horizontal={false} strokeDasharray="3 3" opacity={0.18} /><XAxis type="number" tickFormatter={(value) => Number(value).toLocaleString()} tick={{ fontSize: 9 }} /><YAxis type="category" dataKey="stage" width={72} tick={{ fontSize: 9 }} /><Tooltip formatter={(value) => `${Number(value).toLocaleString()} · ${percent(ratio(Number(value), input))}`} /><Legend /><Bar dataKey="retained" name="Retained" stackId="integrity" fill="#10b981" isAnimationActive={false} /><Bar dataKey="nonfinite" name="Non-finite" stackId="integrity" fill="#f59e0b" isAnimationActive={false} /><Bar dataKey="invalidReference" name="Invalid reference" stackId="integrity" fill="#ef4444" isAnimationActive={false} /></BarChart></ResponsiveContainer></div>
        <div className="divide-y divide-border/60 border border-border/60">{integrityRows.map((row) => <div key={row.label} className="grid grid-cols-[1fr_auto_auto] items-center gap-4 px-3 py-2"><span className="flex items-center gap-2"><span className="size-2" style={{ backgroundColor: row.color }} />{row.label}</span><span className="font-mono font-semibold">{row.value.toLocaleString()}</span><span className="w-16 text-right font-mono text-muted-foreground">{percent(ratio(row.value, input))}</span></div>)}</div>
      </div>
    </section>

    <div className="grid gap-3 xl:grid-cols-2">
      <section className="border border-border/70 bg-background/40"><ChartHeader title="Robust temporal pixel scatter distribution" detail="Phân bố MAD scatter theo artifact; P50 mô tả pixel điển hình, P95 làm lộ đuôi pixel dao động mạnh." /><div className="h-72 p-3"><ResponsiveContainer width="100%" height="100%"><BarChart data={scatterHistogram}><CartesianGrid vertical={false} strokeDasharray="3 3" opacity={0.18} /><XAxis dataKey="bucket" tick={{ fontSize: 9 }} interval={0} /><YAxis allowDecimals={false} tick={{ fontSize: 9 }} width={36} /><Tooltip formatter={(value) => `${Number(value).toLocaleString()} artifacts`} /><Legend /><Bar dataKey="p50" name="Pixel scatter P50" fill="#22d3ee" isAnimationActive={false} /><Bar dataKey="p95" name="Pixel scatter P95" fill="#8b5cf6" isAnimationActive={false} /></BarChart></ResponsiveContainer></div></section>
      <section className="border border-border/70 bg-background/40"><ChartHeader title="Temporal reference drift" detail="Envelope P50/P95 theo thời gian hoàn tất artifact; khoảng cách mở rộng báo hiệu median reference kém ổn định." /><div className="h-72 p-3"><ResponsiveContainer width="100%" height="100%"><ComposedChart data={driftTimeline}><CartesianGrid vertical={false} strokeDasharray="3 3" opacity={0.18} /><XAxis dataKey="timestamp" tickFormatter={clock} minTickGap={28} tick={{ fontSize: 9 }} /><YAxis tickFormatter={(value) => compactPPM(Number(value))} tick={{ fontSize: 9 }} width={50} label={{ value: 'ppm', angle: -90, position: 'insideLeft', fontSize: 9 }} /><Tooltip labelFormatter={(item) => new Date(Number(item) * 1000).toLocaleString()} formatter={(value) => `${formatPPM(Number(value))} ppm`} /><Legend /><Area dataKey="p95" name="Drift P95" stroke="#f59e0b" fill="#f59e0b" fillOpacity={0.14} isAnimationActive={false} /><Line dataKey="p50" name="Drift P50" stroke="#22d3ee" strokeWidth={2} dot={false} isAnimationActive={false} /></ComposedChart></ResponsiveContainer></div></section>
    </div>

    <section className="border border-border/70 bg-background/40"><ChartHeader title="Chunk-boundary continuity" detail="Phân bố độ nhảy P95 giữa frame cuối chunk trước và frame đầu chunk sau; dịch sang bucket cao cho thấy seam do chunk normalization." /><div className="h-56 p-3"><ResponsiveContainer width="100%" height="100%"><BarChart data={boundaryHistogram}><CartesianGrid vertical={false} strokeDasharray="3 3" opacity={0.18} /><XAxis dataKey="bucket" tick={{ fontSize: 9 }} interval={0} /><YAxis allowDecimals={false} tick={{ fontSize: 9 }} width={36} /><Tooltip formatter={(value) => `${Number(value).toLocaleString()} artifacts`} /><Bar dataKey="count" name="Artifacts" fill="#f97316" isAnimationActive={false} /></BarChart></ResponsiveContainer></div></section>
  </div>;
}

function LegacyTPFDiagnostics({ artifacts }: { artifacts: TPFTransformPoint[] }): JSX.Element {
  const defectValues = artifacts.map((point) => Math.max(0, (1 - point.finite_pixel_fraction) * 1_000_000));
  const finiteValues = artifacts.map((point) => point.finite_pixel_fraction);
  const outputCadences = artifacts.map((point) => Math.max(0, point.output_cadences));
  const totalCadences = outputCadences.reduce((sum, value) => sum + value, 0);
  const perfectCount = defectValues.filter((value) => value <= 0.5).length;
  const hasDefects = perfectCount < artifacts.length;
  const defectP95 = quantileNumbers(defectValues, 0.95);
  const finiteP05 = quantileNumbers(finiteValues, 0.05);
  const integrityBands = integrityBandRows(defectValues);
  const integrityStack = [{ scope: 'Artifacts', ...Object.fromEntries(integrityBands.map((band) => [band.key, band.value])) }];
  const cadenceHistogram = adaptiveHistogram(outputCadences, 8);
  const timeline = legacyIntegrityTimeline(artifacts);
  const cadenceTimeline = legacyCadenceTimeline(artifacts);

  return <div className="space-y-3">
    <div className="border border-primary/25 bg-primary/5 px-3 py-2 text-[11px] text-muted-foreground">Đang phân tích trực tiếp metadata bền vững của artifact hiện có. MAD scatter, reference drift và chunk continuity sẽ được bổ sung khi các TPF được xử lý bằng telemetry schema mới.</div>
    <div className="grid grid-cols-2 gap-px border border-border/70 bg-border/70 text-xs md:grid-cols-3 xl:grid-cols-6">
      <Metric label="Artifacts observed" value={artifacts.length.toLocaleString()} detail="durable Silver metadata" />
      <Metric label="Normalized cadences" value={totalCadences.toLocaleString()} detail="across TPF artifacts" />
      <Metric label="Finite integrity · P05" value={`${(finiteP05 * 100).toFixed(5)}%`} detail="worst-tail threshold" />
      <Metric label="Defect density · P95" value={`${formatPPM(defectP95)} ppm`} detail="non-finite pixel values" />
      <Metric label="Perfect integrity" value={perfectCount.toLocaleString()} detail={percent(ratio(perfectCount, artifacts.length))} />
      <Metric label="Extended diagnostics" value="Pending regeneration" detail="MAD · drift · boundaries" />
    </div>

    {hasDefects ? <section className="border border-border/70 bg-background/40">
      <ChartHeader title="Pixel-integrity classification" detail="Phân tầng artifact theo mật độ pixel không hữu hạn; ppm làm lộ sai khác rất nhỏ mà trục phần trăm che mất." />
      <div className="grid gap-3 p-3 xl:grid-cols-[minmax(0,1.5fr)_minmax(360px,1fr)]">
        <div className="h-36"><ResponsiveContainer width="100%" height="100%"><BarChart data={integrityStack} layout="vertical" margin={{ left: 10, right: 18 }}><CartesianGrid horizontal={false} strokeDasharray="3 3" opacity={0.18} /><XAxis type="number" allowDecimals={false} tick={{ fontSize: 9 }} /><YAxis type="category" dataKey="scope" width={62} tick={{ fontSize: 9 }} /><Tooltip formatter={(value) => `${Number(value).toLocaleString()} artifacts · ${percent(ratio(Number(value), artifacts.length))}`} /><Legend />{integrityBands.map((band) => <Bar key={band.key} dataKey={band.key} name={band.label} stackId="integrity" fill={band.color} isAnimationActive={false} />)}</BarChart></ResponsiveContainer></div>
        <div className="divide-y divide-border/60 border border-border/60">{integrityBands.map((band) => <div key={band.key} className="grid grid-cols-[1fr_auto_auto] items-center gap-4 px-3 py-2"><span className="flex items-center gap-2"><span className="size-2" style={{ backgroundColor: band.color }} />{band.label}</span><span className="font-mono font-semibold">{band.value.toLocaleString()}</span><span className="w-16 text-right font-mono text-muted-foreground">{percent(ratio(band.value, artifacts.length))}</span></div>)}</div>
      </div>
    </section> : <div className="flex flex-wrap items-center justify-between gap-3 border border-emerald-500/35 bg-emerald-500/5 px-4 py-3"><div><p className="font-medium text-emerald-700 dark:text-emerald-300">Không phát hiện pixel không hữu hạn trong {artifacts.length.toLocaleString()} artifact hiện có</p><p className="mt-0.5 text-[10px] text-muted-foreground">Finite-pixel fraction = 100% cho toàn bộ scope; không dựng biểu đồ defect phẳng bằng 0.</p></div><span className="font-mono text-sm font-semibold">{perfectCount}/{artifacts.length} perfect</span></div>}

    <div className="grid gap-3 xl:grid-cols-2">
      <section className="border border-border/70 bg-background/40"><ChartHeader title="Normalized cadence-volume distribution" detail="Số artifact theo dải cadence đã đi qua temporal normalization; giúp phát hiện cube thiếu thời lượng hoặc lệch quy mô." /><div className="h-72 p-3"><ResponsiveContainer width="100%" height="100%"><BarChart data={cadenceHistogram}><CartesianGrid vertical={false} strokeDasharray="3 3" opacity={0.18} /><XAxis dataKey="bucket" tick={{ fontSize: 9 }} interval={0} /><YAxis allowDecimals={false} tick={{ fontSize: 9 }} width={36} /><Tooltip formatter={(value) => `${Number(value).toLocaleString()} artifacts`} /><Bar dataKey="count" name="Artifacts" fill="#22d3ee" isAnimationActive={false} /></BarChart></ResponsiveContainer></div></section>
      {hasDefects ? <section className="border border-border/70 bg-background/40"><ChartHeader title="Finite-pixel defect density over completion time" detail="P50/P95 non-finite density theo nhóm artifact hoàn tất; spike cho thấy một nhóm TPF có integrity thấp hơn nền." /><div className="h-72 p-3"><ResponsiveContainer width="100%" height="100%"><ComposedChart data={timeline}><CartesianGrid vertical={false} strokeDasharray="3 3" opacity={0.18} /><XAxis dataKey="timestamp" tickFormatter={clock} minTickGap={28} tick={{ fontSize: 9 }} /><YAxis tickFormatter={(value) => compactPPM(Number(value))} tick={{ fontSize: 9 }} width={50} label={{ value: 'defect ppm', angle: -90, position: 'insideLeft', fontSize: 9 }} /><Tooltip labelFormatter={(item) => new Date(Number(item) * 1000).toLocaleString()} formatter={(value) => `${formatPPM(Number(value))} ppm`} /><Legend /><Area dataKey="p95" name="Defect P95" stroke="#f97316" fill="#f97316" fillOpacity={0.16} isAnimationActive={false} /><Line dataKey="p50" name="Defect P50" stroke="#8b5cf6" strokeWidth={2} dot={false} isAnimationActive={false} /></ComposedChart></ResponsiveContainer></div></section> : <section className="border border-border/70 bg-background/40"><ChartHeader title="Normalized temporal coverage over completion time" detail="P50/P95 cadence count theo nhóm artifact; thay đổi cho thấy cube bị rút ngắn hoặc khác thời lượng quan sát." /><div className="h-72 p-3"><ResponsiveContainer width="100%" height="100%"><ComposedChart data={cadenceTimeline}><CartesianGrid vertical={false} strokeDasharray="3 3" opacity={0.18} /><XAxis dataKey="timestamp" tickFormatter={clock} minTickGap={28} tick={{ fontSize: 9 }} /><YAxis tickFormatter={(value) => compactCount(Number(value))} tick={{ fontSize: 9 }} width={52} /><Tooltip labelFormatter={(item) => new Date(Number(item) * 1000).toLocaleString()} formatter={(value) => `${Number(value).toLocaleString()} cadences`} /><Legend /><Area dataKey="p95" name="Cadences P95" stroke="#a855f7" fill="#a855f7" fillOpacity={0.16} isAnimationActive={false} /><Line dataKey="p50" name="Cadences P50" stroke="#22d3ee" strokeWidth={2} dot={false} isAnimationActive={false} /></ComposedChart></ResponsiveContainer></div></section>}
    </div>
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

function integrityBandRows(values: number[]): Array<{ key: string; label: string; value: number; color: string }> {
  const definitions = [
    { key: 'perfect', label: '≤0.5 ppm · perfect', accepts: (value: number) => value <= 0.5, color: '#10b981' },
    { key: 'trace', label: '0.5–10 ppm · trace', accepts: (value: number) => value > 0.5 && value <= 10, color: '#22d3ee' },
    { key: 'low', label: '10–100 ppm · low', accepts: (value: number) => value > 10 && value <= 100, color: '#a855f7' },
    { key: 'elevated', label: '100–1k ppm · elevated', accepts: (value: number) => value > 100 && value <= 1_000, color: '#f59e0b' },
    { key: 'high', label: '>1k ppm · high', accepts: (value: number) => value > 1_000, color: '#ef4444' },
  ];
  return definitions.map((definition) => ({
    key: definition.key,
    label: definition.label,
    value: values.filter(definition.accepts).length,
    color: definition.color,
  }));
}

function adaptiveHistogram(values: number[], requestedBins: number): Array<{ bucket: string; count: number }> {
  const observed = values.filter(Number.isFinite).map((value) => Math.max(0, Math.round(value)));
  if (observed.length === 0) return [];
  const minimum = Math.min(...observed);
  const maximum = Math.max(...observed);
  if (minimum === maximum) return [{ bucket: compactCount(minimum), count: observed.length }];
  const width = Math.max(1, Math.ceil((maximum - minimum + 1) / requestedBins));
  const bins = Math.min(requestedBins, Math.ceil((maximum - minimum + 1) / width));
  return Array.from({ length: bins }, (_, index) => {
    const lower = minimum + index * width;
    const upper = index === bins - 1 ? maximum : Math.min(maximum, lower + width - 1);
    return {
      bucket: `${compactCount(lower)}–${compactCount(upper)}`,
      count: observed.filter((value) => value >= lower && value <= upper).length,
    };
  });
}

function legacyIntegrityTimeline(points: TPFTransformPoint[]): Array<{ timestamp: number; p50: number; p95: number }> {
  const ordered = [...points]
    .map((point) => ({
      timestamp: Date.parse(point.completed_at) / 1000,
      defectPPM: Math.max(0, (1 - point.finite_pixel_fraction) * 1_000_000),
    }))
    .filter((point) => Number.isFinite(point.timestamp))
    .sort((a, b) => a.timestamp - b.timestamp);
  const bucketSize = Math.max(1, Math.ceil(ordered.length / 30));
  const result: Array<{ timestamp: number; p50: number; p95: number }> = [];
  for (let index = 0; index < ordered.length; index += bucketSize) {
    const bucket = ordered.slice(index, index + bucketSize);
    result.push({
      timestamp: bucket[Math.floor(bucket.length / 2)].timestamp,
      p50: quantileNumbers(bucket.map((point) => point.defectPPM), 0.50),
      p95: quantileNumbers(bucket.map((point) => point.defectPPM), 0.95),
    });
  }
  return result;
}

function legacyCadenceTimeline(points: TPFTransformPoint[]): Array<{ timestamp: number; p50: number; p95: number }> {
  const ordered = [...points]
    .map((point) => ({ timestamp: Date.parse(point.completed_at) / 1000, cadences: Math.max(0, point.output_cadences) }))
    .filter((point) => Number.isFinite(point.timestamp))
    .sort((a, b) => a.timestamp - b.timestamp);
  const bucketSize = Math.max(1, Math.ceil(ordered.length / 30));
  const result: Array<{ timestamp: number; p50: number; p95: number }> = [];
  for (let index = 0; index < ordered.length; index += bucketSize) {
    const bucket = ordered.slice(index, index + bucketSize);
    result.push({
      timestamp: bucket[Math.floor(bucket.length / 2)].timestamp,
      p50: quantileNumbers(bucket.map((point) => point.cadences), 0.50),
      p95: quantileNumbers(bucket.map((point) => point.cadences), 0.95),
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
function compactCount(value: number): string { return value >= 1_000 ? `${(value / 1_000).toFixed(value >= 10_000 ? 1 : 2)}k` : value.toLocaleString(); }
function shortObjectKey(value: string): string { const parts = value.split('/'); return parts.at(-1) || value; }

function Metric({ label, value, detail }: { label: string; value: string; detail?: string }): JSX.Element {
  return <div className="bg-background p-3"><p className="text-[10px] uppercase text-muted-foreground">{label}</p><p className="mt-1 font-mono font-semibold">{value}</p>{detail && <p className="font-mono text-[10px] text-muted-foreground">{detail}</p>}</div>;
}

function EvidencePending({ detail }: { detail: string }): JSX.Element {
  return <div className="flex h-64 items-center justify-center p-6"><p className="max-w-md border-l-2 border-primary/50 pl-3 text-[11px] text-muted-foreground">{detail}</p></div>;
}
