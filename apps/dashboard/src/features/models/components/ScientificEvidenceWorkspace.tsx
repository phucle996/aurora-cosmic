import { useMemo, type JSX, type ReactNode } from 'react';
import { Activity, BookOpen, Orbit, ShieldAlert } from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  Line,
  LineChart,
  ReferenceArea,
  ResponsiveContainer,
  Scatter,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

export type ScientificReviewEvidence = {
  n_points: number;
  time_span_days: number;
  sector_baseline_days: number;
  sector_coverage_percent: number;
  largest_gap_hours: number;
  median_cadence_minutes: number;
  flux_std_ppm: number;
  flux_amplitude_ppm: number;
  median_flux_err_ppm: number;
  bls_available: boolean;
  bls_period_days: number;
  bls_duration_hours: number;
  bls_transit_time_btjd: number;
  bls_depth_ppm: number;
  bls_power: number;
  variability_peak_fraction: number;
  transit_evidence_available: boolean;
  transit_deficit_sum: number;
  centroid_offset_pixels: number;
  toi_match_status: string;
  matched_toi_id: string;
};

export type LightcurveSeries = { time: number[]; flux: number[] };

type PhasePoint = { phase: number; flux: number; epoch: number };
type PhaseBin = { phase: number; flux: number; count: number };
type EvidenceTone = 'positive' | 'review' | 'negative' | 'neutral';

const toneStyles: Record<EvidenceTone, { cell: string; text: string; dot: string }> = {
  positive: { cell: 'bg-emerald-500/7 shadow-[inset_0_3px_0_rgb(16_185_129_/_0.75)]', text: 'text-emerald-700 dark:text-emerald-300', dot: 'bg-emerald-500' },
  review: { cell: 'bg-amber-500/7 shadow-[inset_0_3px_0_rgb(245_158_11_/_0.8)]', text: 'text-amber-700 dark:text-amber-300', dot: 'bg-amber-500' },
  negative: { cell: 'bg-red-500/7 shadow-[inset_0_3px_0_rgb(239_68_68_/_0.8)]', text: 'text-red-700 dark:text-red-300', dot: 'bg-red-500' },
  neutral: { cell: 'bg-background', text: 'text-foreground', dot: 'bg-muted-foreground' },
};

function threshold(value: number, positive: (value: number) => boolean, review: (value: number) => boolean): EvidenceTone {
  if (!Number.isFinite(value)) return 'review';
  if (positive(value)) return 'positive';
  if (review(value)) return 'review';
  return 'negative';
}

function worstTone(...tones: EvidenceTone[]): EvidenceTone {
  const rank: Record<EvidenceTone, number> = { neutral: 0, positive: 1, review: 2, negative: 3 };
  return tones.reduce((worst, tone) => rank[tone] > rank[worst] ? tone : worst, 'neutral');
}

function median(values: number[]): number {
  if (values.length === 0) return Number.NaN;
  const ordered = [...values].sort((a, b) => a - b);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 === 0 ? (ordered[middle - 1] + ordered[middle]) / 2 : ordered[middle];
}

function robustSigma(values: number[]): number {
  const center = median(values);
  if (!Number.isFinite(center)) return Number.NaN;
  return 1.4826 * median(values.map((value) => Math.abs(value - center)));
}

function format(value: number, digits = 2): string {
  return Number.isFinite(value) ? value.toLocaleString(undefined, { maximumFractionDigits: digits }) : '—';
}

function sample<T>(values: T[], limit: number): T[] {
  if (values.length <= limit) return values;
  const step = values.length / limit;
  return Array.from({ length: limit }, (_, index) => values[Math.floor(index * step)]);
}

function useDiagnostics(evidence: ScientificReviewEvidence, lightcurve?: LightcurveSeries) {
  return useMemo(() => {
    const points = lightcurve?.time
      .map((time, index) => ({ time, flux: lightcurve.flux[index] }))
      .filter((point) => Number.isFinite(point.time) && Number.isFinite(point.flux)) ?? [];
    const period = evidence.bls_period_days;
    const epochZero = evidence.bls_transit_time_btjd;
    const phaseAvailable = evidence.bls_available && period > 0 && Number.isFinite(epochZero) && epochZero !== 0 && points.length > 0;
    const phasePoints: PhasePoint[] = phaseAvailable ? points.map((point) => {
      const cycles = (point.time - epochZero) / period;
      const phase = ((cycles + 0.5) % 1 + 1) % 1 - 0.5;
      return { phase, flux: point.flux, epoch: Math.floor(cycles) };
    }).sort((a, b) => a.phase - b.phase) : [];

    const binCount = 72;
    const phaseBins: PhaseBin[] = [];
    for (let bin = 0; bin < binCount; bin += 1) {
      const lower = -0.5 + bin / binCount;
      const upper = -0.5 + (bin + 1) / binCount;
      const values = phasePoints.filter((point) => point.phase >= lower && point.phase < upper).map((point) => point.flux);
      if (values.length > 0) phaseBins.push({ phase: (lower + upper) / 2, flux: median(values), count: values.length });
    }

    const halfWindow = period > 0 ? Math.min(0.25, Math.max(0.001, (evidence.bls_duration_hours / 24) / period / 2)) : 0;
    const inTransit = phasePoints.filter((point) => Math.abs(point.phase) <= halfWindow);
    const outTransit = phasePoints.filter((point) => Math.abs(point.phase) > Math.max(halfWindow * 1.5, halfWindow + 0.005));
    const baseline = median(outTransit.map((point) => point.flux));
    const odd = inTransit.filter((point) => Math.abs(point.epoch) % 2 === 1);
    const even = inTransit.filter((point) => Math.abs(point.epoch) % 2 === 0);
    const depth = (baseline - median(inTransit.map((point) => point.flux))) * 1_000_000;
    const oddDepth = (baseline - median(odd.map((point) => point.flux))) * 1_000_000;
    const evenDepth = (baseline - median(even.map((point) => point.flux))) * 1_000_000;
    const noise = robustSigma(outTransit.map((point) => point.flux));
    const snr = noise > 0 && inTransit.length > 0 ? (depth / 1_000_000) / (noise / Math.sqrt(inTransit.length)) : Number.NaN;
    const observedTransits = new Set(inTransit.map((point) => point.epoch)).size;
    const depthMismatch = evidence.bls_depth_ppm > 0 ? Math.abs(depth - evidence.bls_depth_ppm) / evidence.bls_depth_ppm : Number.NaN;
    const oddEvenMean = (Math.abs(oddDepth) + Math.abs(evenDepth)) / 2;
    const oddEvenMismatch = oddEvenMean > 0 ? Math.abs(oddDepth - evenDepth) / oddEvenMean : Number.NaN;
    const durationFraction = period > 0 ? (evidence.bls_duration_hours / 24) / period : Number.NaN;
    const loadedFraction = evidence.n_points > 0 ? points.length / evidence.n_points : Number.NaN;
    const gapPeriodRatio = period > 0 ? evidence.largest_gap_hours / (period * 24) : Number.NaN;

    const ordered = [...points].sort((a, b) => a.time - b.time);
    const gaps = ordered.slice(1).map((point, index) => ({
      from: ordered[index].time,
      to: point.time,
      hours: (point.time - ordered[index].time) * 24,
    })).filter((gap) => gap.hours > Math.max(0.5, evidence.median_cadence_minutes / 60 * 5))
      .sort((a, b) => b.hours - a.hours);

    return {
      points,
      timeline: sample(ordered, 1800),
      phaseSample: sample(phasePoints, 2200),
      phaseBins,
      halfWindow,
      oddEven: [
        { group: 'Odd transits', depth: Number.isFinite(oddDepth) ? Math.max(0, oddDepth) : 0, samples: odd.length },
        { group: 'Even transits', depth: Number.isFinite(evenDepth) ? Math.max(0, evenDepth) : 0, samples: even.length },
      ],
      depth,
      oddDepth,
      evenDepth,
      snr,
      observedTransits,
      depthMismatch,
      oddEvenMismatch,
      durationFraction,
      loadedFraction,
      gapPeriodRatio,
      gaps: gaps.slice(0, 5),
      phaseAvailable,
    };
  }, [evidence, lightcurve]);
}

export function ScientificEvidenceWorkspace({ evidence, lightcurve, loading }: { evidence: ScientificReviewEvidence; lightcurve?: LightcurveSeries; loading: boolean }): JSX.Element {
  const diagnostics = useDiagnostics(evidence, lightcurve);
  const truncated = diagnostics.points.length > 0 && diagnostics.points.length < evidence.n_points;
  const depthTone = threshold(diagnostics.depthMismatch, (value) => value <= 0.2, (value) => value <= 0.5);
  const snrTone = threshold(diagnostics.snr, (value) => value >= 10, (value) => value >= 7);
  const transitCountTone = threshold(diagnostics.observedTransits, (value) => value >= 3, (value) => value >= 2);
  const durationTone = threshold(diagnostics.durationFraction, (value) => value >= 0.005 && value <= 0.1, (value) => value > 0 && value <= 0.15);
  const oddEvenTone = threshold(diagnostics.oddEvenMismatch, (value) => value <= 0.1, (value) => value <= 0.25);
  const loadedTone = threshold(diagnostics.loadedFraction, (value) => value >= 0.98, (value) => value >= 0.9);
  const coverageTone = threshold(evidence.sector_coverage_percent, (value) => value >= 90, (value) => value >= 70);
  const gapTone = threshold(diagnostics.gapPeriodRatio, (value) => value < 0.25, (value) => value <= 0.5);
  const centroidTone = evidence.transit_evidence_available
    ? threshold(evidence.centroid_offset_pixels, (value) => value < 0.2, (value) => value <= 1)
    : 'review';
  const catalogTone: EvidenceTone = evidence.matched_toi_id
    ? 'positive'
    : evidence.toi_match_status === 'PERIOD_MISMATCH' ? 'negative' : 'review';
  const transitTabTone = worstTone(depthTone, snrTone, transitCountTone, durationTone, oddEvenTone);
  const qualityTabTone = worstTone(loadedTone, coverageTone, gapTone);
  const contextTabTone = worstTone(centroidTone, catalogTone);

  return <div className="border border-border/70 bg-background/40">
    <Tabs defaultValue="transit" className="gap-0">
      <div className="flex flex-col gap-2 border-b border-border/60 px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
        <div><p className="text-sm font-medium">Scientific evidence</p><p className="text-xs text-muted-foreground">Kiểm tra hình thái transit, chất lượng tín hiệu và ngữ cảnh trước khi gán nhãn.</p></div>
        <TabsList variant="line" className="h-8 rounded-none">
          <TabsTrigger value="transit" className="rounded-none font-mono text-xs"><EvidenceDot tone={transitTabTone} />Transit evidence</TabsTrigger>
          <TabsTrigger value="quality" className="rounded-none font-mono text-xs"><EvidenceDot tone={qualityTabTone} />Signal quality</TabsTrigger>
          <TabsTrigger value="context" className="rounded-none font-mono text-xs"><EvidenceDot tone={contextTabTone} />Context</TabsTrigger>
        </TabsList>
      </div>
      <EvidenceLegend />

      <TabsContent value="transit" className="m-0 p-3">
        {!diagnostics.phaseAvailable ? <EvidenceUnavailable loading={loading} text="Phase-folded evidence chưa khả dụng vì thiếu full Light Curve hoặc BLS ephemeris." /> : <div className="space-y-3">
          {truncated && <div className="border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">Chỉ nhận {diagnostics.points.length.toLocaleString()} / {evidence.n_points.toLocaleString()} cadence; các chẩn đoán phase hiện chưa đầy đủ.</div>}
          <div className="grid gap-px border border-border/70 bg-border/70 sm:grid-cols-3 lg:grid-cols-6">
            <Metric label="Observed depth" value={`${format(diagnostics.depth)} ppm`} detail={`${(diagnostics.depthMismatch * 100).toFixed(1)}% from BLS`} tone={depthTone} />
            <Metric label="Robust SNR" value={format(diagnostics.snr, 2)} detail="green ≥10 · review 7–10" tone={snrTone} />
            <Metric label="Observed transits" value={format(diagnostics.observedTransits, 0)} detail="green ≥3 · review 2" tone={transitCountTone} />
            <Metric label="Duration / period" value={`${format(diagnostics.durationFraction * 100, 2)}%`} detail={`${format(evidence.bls_duration_hours, 2)} h transit`} tone={durationTone} />
            <Metric label="Odd depth" value={`${format(diagnostics.oddDepth)} ppm`} detail={`${format(diagnostics.oddEvenMismatch * 100, 2)}% odd/even Δ`} tone={oddEvenTone} />
            <Metric label="Even depth" value={`${format(diagnostics.evenDepth)} ppm`} detail="green Δ≤10%" tone={oddEvenTone} />
          </div>
          <div className="grid gap-3 2xl:grid-cols-[minmax(0,1.55fr)_minmax(22rem,0.75fr)]">
            <ChartFrame title="Phase-folded Light Curve" subtitle="Mỗi cadence được gấp theo BLS period; vùng xanh là transit window, đường cyan là median theo phase bin.">
              <ResponsiveContainer width="100%" height="100%"><ComposedChart data={diagnostics.phaseBins} margin={{ top: 8, right: 16, bottom: 10, left: 2 }}>
                <CartesianGrid vertical={false} strokeDasharray="3 3" opacity={0.25} />
                <XAxis type="number" dataKey="phase" domain={[-0.5, 0.5]} tick={{ fontSize: 11 }} label={{ value: 'orbital phase', position: 'insideBottom', offset: -5, fontSize: 11 }} />
                <YAxis width={64} tick={{ fontSize: 11 }} tickFormatter={(value) => Number(value).toFixed(3)} />
                <Tooltip labelFormatter={(value) => `Phase ${Number(value).toFixed(4)}`} formatter={(value, name) => [Number(value).toFixed(6), name === 'flux' ? 'Normalized flux' : name]} />
                <ReferenceArea x1={-diagnostics.halfWindow} x2={diagnostics.halfWindow} fill="var(--primary)" fillOpacity={0.1} />
                <Scatter data={diagnostics.phaseSample} dataKey="flux" fill="var(--muted-foreground)" fillOpacity={0.18} isAnimationActive={false} />
                <Line dataKey="flux" stroke="var(--primary)" strokeWidth={2} dot={false} isAnimationActive={false} />
              </ComposedChart></ResponsiveContainer>
            </ChartFrame>
            <ChartFrame title="Odd–even transit depth" subtitle="Độ sâu chẵn/lẻ lệch mạnh có thể là eclipsing binary hoặc period alias.">
              <ResponsiveContainer width="100%" height="100%"><BarChart data={diagnostics.oddEven} margin={{ top: 14, right: 14, bottom: 8, left: 4 }}>
                <CartesianGrid vertical={false} strokeDasharray="3 3" opacity={0.25} />
                <XAxis dataKey="group" tick={{ fontSize: 11 }} />
                <YAxis width={62} tick={{ fontSize: 11 }} unit=" ppm" />
                <Tooltip formatter={(value) => [`${format(Number(value))} ppm`, 'Observed depth']} />
                <Bar dataKey="depth" fill="var(--primary)" radius={0} isAnimationActive={false} />
              </BarChart></ResponsiveContainer>
            </ChartFrame>
          </div>
        </div>}
      </TabsContent>

      <TabsContent value="quality" className="m-0 p-3">
        {diagnostics.timeline.length === 0 ? <EvidenceUnavailable loading={loading} text="Không có Light Curve samples khả dụng." /> : <div className="space-y-3">
          <div className="grid gap-px border border-border/70 bg-border/70 sm:grid-cols-3 lg:grid-cols-6">
            <Metric label="Cadences loaded" value={`${diagnostics.points.length.toLocaleString()}`} detail={`${format(diagnostics.loadedFraction * 100, 1)}% available`} tone={loadedTone} />
            <Metric label="Sector coverage" value={`${format(evidence.sector_coverage_percent, 2)}%`} detail="green ≥90%" tone={coverageTone} />
            <Metric label="Largest gap" value={`${format(evidence.largest_gap_hours, 2)} h`} detail={`${format(diagnostics.gapPeriodRatio * 100, 1)}% of period`} tone={gapTone} />
            <Metric label="Median cadence" value={`${format(evidence.median_cadence_minutes, 3)} min`} tone="neutral" />
            <Metric label="Flux scatter" value={`${format(evidence.flux_std_ppm)} ppm`} />
            <Metric label="Median uncertainty" value={evidence.median_flux_err_ppm > 0 ? `${format(evidence.median_flux_err_ppm)} ppm` : 'Unavailable'} tone="neutral" />
          </div>
          <ChartFrame title="Observation timeline & data gaps" subtitle="Light Curve đã downsample để vẽ; các vùng đỏ đánh dấu những khoảng cadence thiếu dài nhất.">
            <ResponsiveContainer width="100%" height="100%"><LineChart data={diagnostics.timeline} margin={{ top: 8, right: 16, bottom: 10, left: 2 }}>
              <CartesianGrid vertical={false} strokeDasharray="3 3" opacity={0.25} />
              <XAxis dataKey="time" tick={{ fontSize: 11 }} tickFormatter={(value) => Number(value).toFixed(1)} label={{ value: 'time · BTJD', position: 'insideBottom', offset: -5, fontSize: 11 }} />
              <YAxis width={64} tick={{ fontSize: 11 }} tickFormatter={(value) => Number(value).toFixed(3)} />
              <Tooltip labelFormatter={(value) => `BTJD ${Number(value).toFixed(5)}`} formatter={(value) => [Number(value).toFixed(6), 'Normalized flux']} />
              {diagnostics.gaps.slice(0, 4).map((gap) => <ReferenceArea key={`${gap.from}-${gap.to}`} x1={gap.from} x2={gap.to} fill="var(--destructive)" fillOpacity={0.12} />)}
              <Line type="monotone" dataKey="flux" stroke="var(--primary)" strokeWidth={1.1} dot={false} isAnimationActive={false} />
            </LineChart></ResponsiveContainer>
          </ChartFrame>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">{diagnostics.gaps.length === 0 ? <p className="text-xs text-muted-foreground">Không phát hiện gap vượt ngưỡng 5× median cadence.</p> : diagnostics.gaps.map((gap, index) => <div key={`${gap.from}-${gap.to}`} className="border border-border/60 bg-muted/15 p-2.5"><p className="font-mono text-xs uppercase text-muted-foreground">Gap {index + 1}</p><p className="mt-1 font-mono text-sm font-semibold">{format(gap.hours, 2)} h</p><p className="mt-1 truncate font-mono text-xs text-muted-foreground">{gap.from.toFixed(3)} → {gap.to.toFixed(3)}</p></div>)}</div>
        </div>}
      </TabsContent>

      <TabsContent value="context" className="m-0 p-3">
        <div className="grid gap-3 lg:grid-cols-3">
          <ContextCard icon={<Orbit className="size-4" />} title="BLS ephemeris" status={evidence.bls_available ? 'AVAILABLE' : 'UNAVAILABLE'} tone={evidence.bls_available ? 'neutral' : 'review'}>
            <ContextRow label="Period" value={`${format(evidence.bls_period_days, 5)} d`} /><ContextRow label="Transit epoch" value={evidence.bls_transit_time_btjd ? `${format(evidence.bls_transit_time_btjd, 5)} BTJD` : '—'} /><ContextRow label="Power" value={format(evidence.bls_power, 4)} />
          </ContextCard>
          <ContextCard icon={<ShieldAlert className="size-4" />} title="Contamination checks" status={centroidTone === 'negative' ? 'HIGH RISK' : evidence.transit_evidence_available ? 'MEASURED' : 'REVIEW'} tone={centroidTone}>
            <ContextRow label="Centroid offset" value={evidence.transit_evidence_available ? `${format(evidence.centroid_offset_pixels, 3)} px` : '—'} tone={centroidTone} /><ContextRow label="Transit deficit" value={evidence.transit_evidence_available ? format(evidence.transit_deficit_sum, 5) : '—'} /><ContextRow label="Variability peak" value={`${format(evidence.variability_peak_fraction * 100, 2)}%`} />
          </ContextCard>
          <ContextCard icon={<BookOpen className="size-4" />} title="Catalog context" status={evidence.matched_toi_id ? 'TOI MATCH' : evidence.toi_match_status === 'PERIOD_MISMATCH' ? 'MISMATCH' : 'REVIEW'} tone={catalogTone}>
            <ContextRow label="TOI" value={evidence.matched_toi_id || '—'} /><ContextRow label="Catalog status" value={evidence.toi_match_status || 'Unavailable'} tone={catalogTone} /><p className="mt-3 text-xs leading-5 text-muted-foreground">Không có TOI match không đồng nghĩa với NEGATIVE; đây chỉ là bằng chứng ngữ cảnh.</p>
          </ContextCard>
        </div>
        <div className="mt-3 flex items-start gap-2 border border-primary/25 bg-primary/5 p-3 text-xs leading-5 text-muted-foreground"><Activity className="mt-0.5 size-4 shrink-0 text-primary" /><span>Periodogram đầy đủ chưa được Gold telemetry lưu lại. Giao diện chỉ trình bày BLS optimum đã quan sát và không dựng các peak giả. Khi backend phát hành periodogram buckets, tab này có thể hiển thị trực tiếp.</span></div>
      </TabsContent>
    </Tabs>
  </div>;
}

function ChartFrame({ title, subtitle, children }: { title: string; subtitle: string; children: JSX.Element }): JSX.Element {
  return <div className="border border-border/70"><div className="border-b border-border/60 px-3 py-2"><p className="text-sm font-medium">{title}</p><p className="text-xs text-muted-foreground">{subtitle}</p></div><div className="h-[320px] p-2">{children}</div></div>;
}

function Metric({ label, value, detail, tone = 'neutral' }: { label: string; value: string; detail?: string; tone?: EvidenceTone }): JSX.Element {
  const style = toneStyles[tone];
  return <div className={`min-w-0 p-3 ${style.cell}`}><p className="truncate font-mono text-xs uppercase tracking-wide text-muted-foreground">{label}</p><p className={`mt-1 truncate font-mono text-sm font-semibold ${style.text}`} title={value}>{value}</p>{detail && <p className="mt-1 truncate text-xs text-muted-foreground" title={detail}>{detail}</p>}</div>;
}

function ContextCard({ icon, title, status, tone = 'neutral', children }: { icon: JSX.Element; title: string; status: string; tone?: EvidenceTone; children: ReactNode }): JSX.Element {
  const style = toneStyles[tone];
  return <div className={`border border-border/70 p-3 ${style.cell}`}><div className="mb-3 flex items-center justify-between gap-2"><p className={`flex items-center gap-2 text-sm font-medium ${style.text}`}>{icon}{title}</p><Badge variant="outline" className={`rounded-none font-mono text-xs ${style.text}`}>{status}</Badge></div><div className="space-y-2">{children}</div></div>;
}

function ContextRow({ label, value, tone = 'neutral' }: { label: string; value: string; tone?: EvidenceTone }): JSX.Element {
  return <div className="flex items-start justify-between gap-3 border-b border-border/40 pb-1.5 text-xs"><span className="text-muted-foreground">{label}</span><span className={`max-w-[65%] break-words text-right font-mono font-medium ${toneStyles[tone].text}`}>{value}</span></div>;
}

function EvidenceDot({ tone }: { tone: EvidenceTone }): JSX.Element {
  return <span className={`size-2 shrink-0 rounded-full ${toneStyles[tone].dot}`} aria-label={tone === 'positive' ? 'supportive evidence' : tone === 'negative' ? 'conflicting evidence' : tone === 'review' ? 'review required' : 'context only'} />;
}

function EvidenceLegend(): JSX.Element {
  return <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-b border-border/50 bg-muted/10 px-3 py-2 text-xs">
    <span className="font-medium text-muted-foreground">Evidence direction</span>
    <span className="flex items-center gap-2"><EvidenceDot tone="positive" /><span>Supportive</span></span>
    <span className="flex items-center gap-2"><EvidenceDot tone="review" /><span>Review required</span></span>
    <span className="flex items-center gap-2"><EvidenceDot tone="negative" /><span>Conflicting / false-positive risk</span></span>
    <span className="ml-auto text-muted-foreground">Màu không tự động quyết định nhãn.</span>
  </div>;
}

function EvidenceUnavailable({ loading, text }: { loading: boolean; text: string }): JSX.Element {
  return <div className="flex h-[300px] items-center justify-center text-center text-xs text-muted-foreground">{loading ? 'Đang tải full Light Curve evidence…' : text}</div>;
}
