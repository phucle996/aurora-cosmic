import { type JSX } from 'react';
import { Area, Bar, BarChart, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

import { TelemetryUnavailable } from './TelemetryUnavailable';
import { clock, mergedSeries, type Telemetry } from './telemetry';

export function QualityMaskChart({ metrics, telemetry, modality }: { mode?: 'stream' | 'batch'; metrics?: Record<string, number>; telemetry?: Telemetry; totalFiles?: number; modality?: 'lightcurve' | 'target-pixel' }): JSX.Element {
  const lightCurves = Math.max(0, metrics?.completed_lightcurves ?? 0);
  const targetPixels = Math.max(0, metrics?.completed_target_pixels ?? 0);
  const total = modality === 'lightcurve' ? lightCurves : modality === 'target-pixel' ? targetPixels : lightCurves + targetPixels;
  const durableCountsObserved = metrics?.science_counts_observed === 1;
  const prometheusCountsObserved = (metrics?.lc_input_total ?? 0) + (metrics?.tpf_input_total ?? 0) > 0;
  const countsObserved = durableCountsObserved || prometheusCountsObserved;
  if (total === 0 && !countsObserved) return <TelemetryUnavailable detail="Chưa có completion evidence hoặc cadence counters cho validation phase." />;

  const count = (durableKey: string, prometheusKey: string): number => Math.max(0, metrics?.[durableCountsObserved ? durableKey : prometheusKey] ?? 0);
  const lcInput = count('lc_input_samples', 'lc_input_total');
  const lcQualityRemoved = count('lc_quality_removed', 'lc_quality_removed_total');
  const lcInvalidRemoved = Math.max(0, metrics?.lc_invalid_removed ?? 0);
  const lcNonfiniteRemoved = count('lc_nonfinite_removed', 'lc_nonfinite_removed_total');
  const lcNonpositiveRemoved = count('lc_nonpositive_removed', 'lc_nonpositive_removed_total');
  const lcUnclassifiedInvalid = durableCountsObserved ? Math.max(0, lcInvalidRemoved - lcNonfiniteRemoved - lcNonpositiveRemoved) : 0;
  const tpfInput = count('tpf_input_samples', 'tpf_input_total');
  const tpfQualityRemoved = count('tpf_quality_removed', 'tpf_quality_removed_total');
  const tpfInvalidRemoved = Math.max(0, metrics?.tpf_invalid_removed ?? 0);
  const tpfNonfiniteRemoved = count('tpf_nonfinite_removed', 'tpf_nonfinite_removed_total');
  const tpfNonpositiveRemoved = count('tpf_nonpositive_removed', 'tpf_nonpositive_removed_total');
  const tpfUnclassifiedInvalid = durableCountsObserved ? Math.max(0, tpfInvalidRemoved - tpfNonfiniteRemoved - tpfNonpositiveRemoved) : 0;
  const attrition = [
    { modality: 'Light Curve', input: lcInput, accepted: Math.max(0, lcInput - lcQualityRemoved - lcInvalidRemoved), qualityRemoved: lcQualityRemoved, nonfiniteRemoved: lcNonfiniteRemoved, nonpositiveRemoved: lcNonpositiveRemoved, unclassifiedInvalid: lcUnclassifiedInvalid },
    { modality: 'Target Pixel', input: tpfInput, accepted: Math.max(0, tpfInput - tpfQualityRemoved - tpfInvalidRemoved), qualityRemoved: tpfQualityRemoved, nonfiniteRemoved: tpfNonfiniteRemoved, nonpositiveRemoved: tpfNonpositiveRemoved, unclassifiedInvalid: tpfUnclassifiedInvalid },
  ].filter((item) => modality === undefined || (modality === 'lightcurve' ? item.modality === 'Light Curve' : item.modality === 'Target Pixel'));
  const inputSamples = attrition.reduce((sum, item) => sum + item.input, 0);
  const qualityRemoved = attrition.reduce((sum, item) => sum + item.qualityRemoved, 0);
  const nonfiniteRemoved = attrition.reduce((sum, item) => sum + item.nonfiniteRemoved, 0);
  const nonpositiveRemoved = attrition.reduce((sum, item) => sum + item.nonpositiveRemoved, 0);
  const unclassifiedInvalid = attrition.reduce((sum, item) => sum + item.unclassifiedInvalid, 0);
  const invalidRemoved = nonfiniteRemoved + nonpositiveRemoved + unclassifiedInvalid;
  const acceptedSamples = attrition.reduce((sum, item) => sum + item.accepted, 0);
  const removedSamples = qualityRemoved + invalidRemoved;
  const retention = inputSamples > 0 ? acceptedSamples / inputSamples * 100 : 0;

  const series = mergedSeries(telemetry, ['lc_input_rate', 'tpf_input_rate', 'lc_quality_removed_rate', 'tpf_quality_removed_rate', 'lc_invalid_removed_rate', 'tpf_invalid_removed_rate', 'lc_nonfinite_removed_rate', 'tpf_nonfinite_removed_rate', 'lc_nonpositive_removed_rate', 'tpf_nonpositive_removed_rate']).map((point) => {
    const includeLC = modality !== 'target-pixel';
    const includeTPF = modality !== 'lightcurve';
    const qualityRejected = (includeLC ? Number(point.lc_quality_removed_rate ?? 0) : 0) + (includeTPF ? Number(point.tpf_quality_removed_rate ?? 0) : 0);
    const nonfiniteRejected = (includeLC ? Number(point.lc_nonfinite_removed_rate ?? 0) : 0) + (includeTPF ? Number(point.tpf_nonfinite_removed_rate ?? 0) : 0);
    const invalidTimeRejected = (includeLC ? Number(point.lc_nonpositive_removed_rate ?? 0) : 0) + (includeTPF ? Number(point.tpf_nonpositive_removed_rate ?? 0) : 0);
    const invalidRejected = (includeLC ? Number(point.lc_invalid_removed_rate ?? 0) : 0) + (includeTPF ? Number(point.tpf_invalid_removed_rate ?? 0) : 0);
    return { ...point, focusedInputRate: (includeLC ? Number(point.lc_input_rate ?? 0) : 0) + (includeTPF ? Number(point.tpf_input_rate ?? 0) : 0), qualityRejected, nonfiniteRejected, invalidTimeRejected, legacyInvalidRejected: Math.max(0, invalidRejected - nonfiniteRejected - invalidTimeRejected), rejected: qualityRejected + invalidRejected };
  });
  const hasActivity = series.some((point) => point.focusedInputRate > 0 || point.rejected > 0);

  return <div className="space-y-3">
    <div className="grid grid-cols-2 gap-px border border-border/70 bg-border/70 text-xs lg:grid-cols-6"><Metric label="Input cadences" value={countsObserved ? inputSamples.toLocaleString() : '—'} detail={countsObserved ? '100.00%' : undefined} /><Metric label="Retained" value={countsObserved ? acceptedSamples.toLocaleString() : '—'} detail={countsObserved ? percent(acceptedSamples, inputSamples) : undefined} /><Metric label="Quality flag removed" value={countsObserved ? qualityRemoved.toLocaleString() : '—'} detail={countsObserved ? percent(qualityRemoved, inputSamples) : undefined} /><Metric label="NaN / ±Inf removed" value={countsObserved ? nonfiniteRemoved.toLocaleString() : '—'} detail={countsObserved ? percent(nonfiniteRemoved, inputSamples) : undefined} /><Metric label="Other invalid time" value={countsObserved ? (nonpositiveRemoved + unclassifiedInvalid).toLocaleString() : '—'} detail={countsObserved ? percent(nonpositiveRemoved + unclassifiedInvalid, inputSamples) : undefined} /><Metric label="Failed products" value={(metrics?.failed_products ?? 0).toLocaleString()} /></div>
    {countsObserved ? <section className="border border-border/70 bg-background/40"><div className="flex flex-wrap items-start justify-between gap-2 border-b border-border/60 px-3 py-2"><div><p className="font-medium">Cadence quality budget</p><p className="text-[10px] text-muted-foreground">Input = retained + quality flag + NaN/±Inf + invalid time.</p></div><div className="text-right"><p className="font-mono text-sm font-semibold text-emerald-500">{retention.toFixed(2)}% retained</p><p className="font-mono text-[10px] text-muted-foreground">{removedSamples.toLocaleString()} removed · {percent(removedSamples, inputSamples)}</p></div></div><div className="h-[260px] p-3"><ResponsiveContainer width="100%" height="100%"><BarChart data={attrition} layout="vertical" margin={{ left: 24, right: 20 }}><CartesianGrid horizontal={false} strokeDasharray="3 3" opacity={0.18} /><XAxis type="number" tickFormatter={(item) => Number(item).toLocaleString()} tick={{ fontSize: 10 }} /><YAxis type="category" dataKey="modality" width={92} tick={{ fontSize: 10 }} /><Tooltip formatter={(item, name, entry) => { const row = entry.payload as { input?: number }; return [`${Number(item).toLocaleString()} cadences · ${percent(Number(item), row.input ?? 0)}`, String(name)]; }} /><Legend /><Bar dataKey="accepted" name="Retained" stackId="quality" fill="#10b981" isAnimationActive={false} /><Bar dataKey="qualityRemoved" name="Quality flag" stackId="quality" fill="#f59e0b" isAnimationActive={false} /><Bar dataKey="nonfiniteRemoved" name="NaN / ±Inf" stackId="quality" fill="#ef4444" isAnimationActive={false} /><Bar dataKey="nonpositiveRemoved" name="Time ≤ 0" stackId="quality" fill="#f97316" isAnimationActive={false} /><Bar dataKey="unclassifiedInvalid" name="Legacy invalid" stackId="quality" fill="#64748b" isAnimationActive={false} /></BarChart></ResponsiveContainer></div><AttritionTable rows={attrition} />{unclassifiedInvalid > 0 && <p className="border-t border-border/60 px-3 py-2 text-[10px] text-muted-foreground">{unclassifiedInvalid.toLocaleString()} cadence thuộc artifact cũ chỉ có tổng invalid; cần reprocess để tách chính xác NaN/±Inf và time ≤ 0.</p>}</section> : <TelemetryUnavailable detail="Các Silver artifact quan sát được chưa có cadence-count metadata; không thể suy diễn số cadence bị loại từ số lượng file." />}
    {hasActivity && <section className="border border-border/70 bg-background/40"><div className="border-b border-border/60 px-3 py-2"><p className="font-medium">Live validation rate by reason</p><p className="text-[10px] text-muted-foreground">Input và cadence bị loại theo từng nguyên nhân trong observation window hiện tại.</p></div><div className="h-52 p-2"><ResponsiveContainer width="100%" height="100%"><ComposedChart data={series}><CartesianGrid vertical={false} strokeDasharray="3 3" opacity={0.18} /><XAxis dataKey="timestamp" tickFormatter={clock} minTickGap={28} tick={{ fontSize: 10 }} /><YAxis tick={{ fontSize: 10 }} width={48} /><Tooltip labelFormatter={(item) => clock(Number(item))} formatter={(item) => `${Number(item).toFixed(2)} cadence/s`} /><Legend /><Area type="monotone" dataKey="focusedInputRate" name={modality === 'lightcurve' ? 'LC input' : modality === 'target-pixel' ? 'TPF input' : 'LC + TPF input'} stroke={modality === 'target-pixel' ? '#a855f7' : '#22d3ee'} fill={modality === 'target-pixel' ? '#a855f7' : '#22d3ee'} fillOpacity={0.18} isAnimationActive={false} /><Line type="monotone" dataKey="qualityRejected" name="Quality flag" stroke="#f59e0b" strokeWidth={2} dot={false} isAnimationActive={false} /><Line type="monotone" dataKey="nonfiniteRejected" name="NaN / ±Inf" stroke="#ef4444" strokeWidth={2} dot={false} isAnimationActive={false} /><Line type="monotone" dataKey="invalidTimeRejected" name="Time ≤ 0" stroke="#f97316" strokeWidth={2} dot={false} isAnimationActive={false} /><Line type="monotone" dataKey="legacyInvalidRejected" name="Legacy invalid" stroke="#64748b" strokeWidth={1.5} strokeDasharray="4 3" dot={false} isAnimationActive={false} /></ComposedChart></ResponsiveContainer></div></section>}
  </div>;
}

type AttritionRow = { modality: string; input: number; accepted: number; qualityRemoved: number; nonfiniteRemoved: number; nonpositiveRemoved: number; unclassifiedInvalid: number };

function percent(value: number, total: number): string {
  return total > 0 ? `${(value / total * 100).toFixed(2)}%` : '0.00%';
}

function AttritionTable({ rows }: { rows: AttritionRow[] }): JSX.Element {
  const cells: Array<{ key: keyof Pick<AttritionRow, 'accepted' | 'qualityRemoved' | 'nonfiniteRemoved' | 'nonpositiveRemoved' | 'unclassifiedInvalid'>; label: string }> = [
    { key: 'accepted', label: 'Retained' }, { key: 'qualityRemoved', label: 'Quality' }, { key: 'nonfiniteRemoved', label: 'NaN / ±Inf' }, { key: 'nonpositiveRemoved', label: 'Time ≤ 0' }, { key: 'unclassifiedInvalid', label: 'Legacy invalid' },
  ];
  return <div className="overflow-x-auto border-t border-border/60"><table className="w-full min-w-[720px] text-left text-[10px]"><thead className="bg-muted/30 uppercase text-muted-foreground"><tr><th className="px-3 py-2 font-medium">Product</th><th className="px-3 py-2 font-medium">Input</th>{cells.map((cell) => <th key={cell.key} className="px-3 py-2 font-medium">{cell.label}</th>)}</tr></thead><tbody>{rows.map((row) => <tr key={row.modality} className="border-t border-border/50"><td className="px-3 py-2 font-medium">{row.modality}</td><td className="px-3 py-2 font-mono">{row.input.toLocaleString()} <span className="text-muted-foreground">(100.00%)</span></td>{cells.map((cell) => <td key={cell.key} className="px-3 py-2 font-mono">{row[cell.key].toLocaleString()} <span className="text-muted-foreground">({percent(row[cell.key], row.input)})</span></td>)}</tr>)}</tbody></table></div>;
}

function Metric({ label, value, detail }: { label: string; value: string; detail?: string }): JSX.Element {
  return <div className="bg-background p-3"><p className="text-[10px] uppercase text-muted-foreground">{label}</p><p className="mt-1 font-mono font-semibold">{value}</p>{detail && <p className="font-mono text-[10px] text-muted-foreground">{detail}</p>}</div>;
}
