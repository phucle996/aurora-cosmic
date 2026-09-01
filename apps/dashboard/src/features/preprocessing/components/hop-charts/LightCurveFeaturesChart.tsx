import type { JSX } from 'react';
import {
  Area,
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import type { LCFeatureEvidence, QuantileSummary } from '@/features/factory-history/types';

const quantiles: Array<{ key: keyof QuantileSummary; label: string }> = [
  { key: 'p05', label: 'P05' },
  { key: 'p25', label: 'P25' },
  { key: 'p50', label: 'P50' },
  { key: 'p75', label: 'P75' },
  { key: 'p95', label: 'P95' },
];

function value(metrics: Record<string, number> | undefined, key: string): number {
  const observed = metrics?.[key];
  return observed !== undefined && Number.isFinite(observed) ? Math.max(0, observed) : 0;
}

function percent(numerator: number, denominator: number): string {
  return denominator > 0 ? `${(numerator / denominator * 100).toFixed(2)}%` : '—';
}

function compact(observed: number): string {
  if (Math.abs(observed) >= 1_000_000) return `${(observed / 1_000_000).toFixed(1)}M`;
  if (Math.abs(observed) >= 1_000) return `${(observed / 1_000).toFixed(1)}k`;
  return observed.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

export function LightCurveFeaturesChart({ metrics, evidence }: { metrics?: Record<string, number>; evidence?: LCFeatureEvidence }): JSX.Element {
  const input = value(metrics, 'input_records');
  const ledgerOutput = value(metrics, 'output_rows');

  if (!evidence) {
    const completedWithoutEvidence = ledgerOutput > 0;
    return <section className={`border border-dashed px-5 py-12 text-center ${completedWithoutEvidence ? 'border-red-500/60 bg-red-500/5' : 'border-border/70 bg-background/40'}`}>
      <p className="font-mono text-sm font-semibold uppercase">{completedWithoutEvidence ? 'Scientific evidence mismatch' : 'Feature extraction not executed'}</p>
      <p className="mx-auto mt-2 max-w-2xl text-[11px] leading-5 text-muted-foreground">
        {completedWithoutEvidence
          ? `Run ledger reports ${ledgerOutput.toLocaleString()} G03 outputs, but no candidate-feature rows were found for its committed snapshot IDs. The UI will not synthesize distributions.`
          : `${input.toLocaleString()} eligible Light Curves are visible upstream, but G03 has not emitted a committed feature snapshot for this view.`}
      </p>
    </section>;
  }

  const emitted = evidence.rows;
  const population = Math.max(input, emitted);
  const rejected = Math.max(0, population - emitted);
  const disposition = [{ phase: 'Feature extraction', emitted, rejected }];
  const fluxProfile = quantiles.map(({ key, label }) => ({
    quantile: label,
    std: evidence.flux_std_ppm[key],
    amplitude: evidence.flux_amplitude_ppm[key],
    rms: evidence.flux_rms_ppm[key],
    uncertainty: evidence.median_flux_err_ppm[key],
  }));
  const samplingProfile = quantiles.map(({ key, label }) => ({
    quantile: label,
    baseline: evidence.time_span_days[key],
    cadence: evidence.median_cadence_minutes[key],
    maxGap: evidence.max_gap_minutes[key],
  }));

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-px border border-border/70 bg-border/70 text-xs lg:grid-cols-3 2xl:grid-cols-6">
        <Metric label="Feature rows" observed={emitted.toLocaleString()} detail={`${evidence.snapshot_count.toLocaleString()} snapshots`} />
        <Metric label="Extraction yield" observed={percent(emitted, population)} detail={`${rejected.toLocaleString()} not emitted`} warning={rejected > 0} />
        <Metric label="Total cadences" observed={compact(evidence.total_cadences)} detail="across emitted LC" />
        <Metric label="Cadences / LC · P50" observed={compact(evidence.n_points.p50)} detail={`P05–P95 ${compact(evidence.n_points.p05)}–${compact(evidence.n_points.p95)}`} />
        <Metric label="Baseline · P50" observed={`${compact(evidence.time_span_days.p50)} d`} detail={`P05–P95 ${compact(evidence.time_span_days.p05)}–${compact(evidence.time_span_days.p95)} d`} />
        <Metric label="Cadence · P50" observed={`${compact(evidence.median_cadence_minutes.p50)} min`} detail={`max-gap P50 ${compact(evidence.max_gap_minutes.p50)} min`} />
      </div>

      <section className="border border-border/70 bg-background/40">
        <div className="border-b border-border/60 px-3 py-2">
          <p className="font-medium">Feature extraction disposition</p>
          <p className="text-[10px] text-muted-foreground">Đối chiếu input ledger với feature rows thực sự tồn tại trong các snapshot của run.</p>
        </div>
        <div className="h-[170px] p-3">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={disposition} layout="vertical" margin={{ top: 12, right: 24, bottom: 8, left: 12 }}>
              <CartesianGrid horizontal={false} strokeDasharray="3 3" opacity={0.2} />
              <XAxis type="number" domain={[0, Math.max(population, 1)]} allowDecimals={false} tickFormatter={(item) => compact(Number(item))} tick={{ fontSize: 10 }} />
              <YAxis type="category" dataKey="phase" width={110} tick={{ fontSize: 10 }} />
              <Tooltip formatter={(item, name) => [`${Number(item).toLocaleString()} LC`, String(name)]} />
              <Legend />
              <Bar dataKey="emitted" name="Feature row emitted" stackId="flow" fill="#10b981" isAnimationActive={false} />
              <Bar dataKey="rejected" name="Not emitted" stackId="flow" fill="#ef4444" isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </section>

      <div className="grid gap-3 xl:grid-cols-2">
        <section className="border border-border/70 bg-background/40">
          <div className="border-b border-border/60 px-3 py-2">
            <p className="font-medium">Flux variability quantile profile</p>
            <p className="text-[10px] text-muted-foreground">Phân bố robust theo Light Curve; cùng đơn vị ppm để so sánh scatter, amplitude, RMS và uncertainty.</p>
          </div>
          <div className="h-[300px] p-3">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={fluxProfile} margin={{ top: 12, right: 18, bottom: 8, left: 4 }}>
                <CartesianGrid vertical={false} strokeDasharray="3 3" opacity={0.2} />
                <XAxis dataKey="quantile" tick={{ fontSize: 10 }} />
                <YAxis tickFormatter={(item) => compact(Number(item))} width={52} tick={{ fontSize: 10 }} label={{ value: 'ppm', angle: -90, position: 'insideLeft', fontSize: 9 }} />
                <Tooltip formatter={(item, name) => [`${Number(item).toLocaleString(undefined, { maximumFractionDigits: 2 })} ppm`, String(name)]} />
                <Legend />
                <Line type="monotone" dataKey="std" name="Flux σ" stroke="#22d3ee" strokeWidth={2.2} dot={{ r: 3 }} isAnimationActive={false} />
                <Line type="monotone" dataKey="amplitude" name="P95−P05 amplitude" stroke="#a855f7" strokeWidth={2.2} dot={{ r: 3 }} isAnimationActive={false} />
                <Line type="monotone" dataKey="rms" name="Flux RMS" stroke="#10b981" strokeWidth={2.2} dot={{ r: 3 }} isAnimationActive={false} />
                <Line type="monotone" dataKey="uncertainty" name="Median uncertainty" stroke="#f59e0b" strokeWidth={1.8} strokeDasharray="4 3" dot={{ r: 2.5 }} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </section>

        <section className="border border-border/70 bg-background/40">
          <div className="border-b border-border/60 px-3 py-2">
            <p className="font-medium">Temporal sampling quantile profile</p>
            <p className="text-[10px] text-muted-foreground">Baseline dùng trục trái (days); cadence và largest gap dùng trục phải (minutes).</p>
          </div>
          <div className="h-[300px] p-3">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={samplingProfile} margin={{ top: 12, right: 20, bottom: 8, left: 4 }}>
                <CartesianGrid vertical={false} strokeDasharray="3 3" opacity={0.2} />
                <XAxis dataKey="quantile" tick={{ fontSize: 10 }} />
                <YAxis yAxisId="days" tickFormatter={(item) => compact(Number(item))} width={44} tick={{ fontSize: 10 }} label={{ value: 'days', angle: -90, position: 'insideLeft', fontSize: 9 }} />
                <YAxis yAxisId="minutes" orientation="right" tickFormatter={(item) => compact(Number(item))} width={50} tick={{ fontSize: 10 }} label={{ value: 'minutes', angle: 90, position: 'insideRight', fontSize: 9 }} />
                <Tooltip formatter={(item, name) => [Number(item).toLocaleString(undefined, { maximumFractionDigits: 3 }), String(name)]} />
                <Legend />
                <Area yAxisId="days" type="monotone" dataKey="baseline" name="Observation baseline · days" stroke="#22d3ee" fill="#22d3ee" fillOpacity={0.18} isAnimationActive={false} />
                <Line yAxisId="minutes" type="monotone" dataKey="cadence" name="Median cadence · min" stroke="#10b981" strokeWidth={2.2} dot={{ r: 3 }} isAnimationActive={false} />
                <Line yAxisId="minutes" type="monotone" dataKey="maxGap" name="Largest gap · min" stroke="#f97316" strokeWidth={2.2} dot={{ r: 3 }} isAnimationActive={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </section>
      </div>

      <div className="border-l-2 border-primary/50 bg-background/40 px-3 py-2 text-[11px] text-muted-foreground">
        Các đường nối P05→P95 là quantile profile của toàn bộ Light Curve trong snapshot, không phải time series và không phải dữ liệu nội suy giữa các target.
      </div>
    </div>
  );
}

function Metric({ label, observed, detail, warning = false }: { label: string; observed: string; detail: string; warning?: boolean }): JSX.Element {
  return <div className="min-w-0 bg-background p-3"><p className="truncate text-[9px] uppercase tracking-wide text-muted-foreground" title={label}>{label}</p><p className={`mt-1 truncate font-mono text-sm font-semibold tabular-nums ${warning ? 'text-red-600 dark:text-red-400' : ''}`}>{observed}</p><p className="mt-0.5 truncate font-mono text-[9px] text-muted-foreground" title={detail}>{detail}</p></div>;
}
