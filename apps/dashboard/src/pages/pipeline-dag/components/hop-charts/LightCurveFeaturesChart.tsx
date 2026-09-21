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

import type { LCFeatureEvidence, QuantileSummary } from '../../types';

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
  const isBaseline = !evidence;
  const zeroQuantile: QuantileSummary = { min: 0, p05: 0, p25: 0, p50: 0, p75: 0, p95: 0, max: 0 };

  const activeEvidence: LCFeatureEvidence = evidence ?? {
    rows: ledgerOutput,
    snapshot_count: 0,
    total_cadences: 0,
    n_points: zeroQuantile,
    time_span_days: zeroQuantile,
    median_cadence_minutes: zeroQuantile,
    max_gap_minutes: zeroQuantile,
    flux_std_ppm: zeroQuantile,
    flux_amplitude_ppm: zeroQuantile,
    flux_rms_ppm: zeroQuantile,
    median_flux_err_ppm: zeroQuantile,
  };

  const emitted = activeEvidence.rows;
  const population = Math.max(input, emitted);
  const rejected = Math.max(0, population - emitted);
  const disposition = [{ phase: 'Feature extraction', emitted, rejected }];
  const fluxProfile = quantiles.map(({ key, label }) => ({
    quantile: label,
    std: activeEvidence.flux_std_ppm[key] ?? 0,
    amplitude: activeEvidence.flux_amplitude_ppm[key] ?? 0,
    rms: activeEvidence.flux_rms_ppm[key] ?? 0,
    uncertainty: activeEvidence.median_flux_err_ppm[key] ?? 0,
  }));
  const samplingProfile = quantiles.map(({ key, label }) => ({
    quantile: label,
    baseline: activeEvidence.time_span_days[key] ?? 0,
    cadence: activeEvidence.median_cadence_minutes[key] ?? 0,
    maxGap: activeEvidence.max_gap_minutes[key] ?? 0,
  }));
  const hasFeatures = activeEvidence.rows > 0;

  return (
    <div className="space-y-3">
      {isBaseline && (
        <div className="flex items-center justify-between border border-border/70 bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5 font-medium">
            <span className="size-2 rounded-full bg-amber-500" />
            Khung phân tích cơ sở: G03 chưa có committed feature evidence (hiển thị mức nền 0).
          </span>
          <span className="font-mono text-[10px] uppercase">
            {input > 0 ? `${input.toLocaleString()} inputs upstream` : 'Sẵn sàng ghi nhận'}
          </span>
        </div>
      )}

      <div className="grid grid-cols-2 gap-px border border-border/70 bg-border/70 text-xs lg:grid-cols-3 2xl:grid-cols-6">
        <Metric label="Feature rows" observed={hasFeatures ? emitted.toLocaleString() : `${input.toLocaleString()} queued`} detail={hasFeatures ? `${activeEvidence.snapshot_count.toLocaleString()} snapshots` : 'intake buffer ready'} />
        <Metric label="Extraction yield" observed={hasFeatures ? percent(emitted, population) : '100% ELIGIBLE'} detail={hasFeatures ? `${rejected.toLocaleString()} not emitted` : `${input.toLocaleString()} targets admitted`} warning={rejected > 0 && !isBaseline} />
        <Metric label="Feature vector" observed="16 metrics" detail="astrophysical moments" />
        <Metric label="Temporal metrics" observed="3 dimensions" detail="baseline · cadence · max-gap" />
        <Metric label="Noise dispersion" observed="4 metrics" detail="σ · amplitude · RMS · error" />
        <Metric label="Execution gate" observed={hasFeatures ? 'COMMITTED' : 'AWAITING BATCH'} detail={hasFeatures ? 'snapshots committed' : 'admission threshold ready'} />
      </div>

      {!hasFeatures ? (
        <section className="border border-border/70 bg-background/40 p-4 space-y-3">
          <div className="flex items-center justify-between border-b border-border/60 pb-2">
            <div>
              <p className="font-medium text-xs text-foreground">G03 Feature Extraction Pipeline Specifications</p>
              <p className="text-[10px] text-muted-foreground">Các chỉ số vật lý thiên văn sẽ được trích xuất tự động ngay khi batch 329 ứng viên được kích hoạt.</p>
            </div>
            <span className="font-mono text-[10px] bg-primary/10 text-primary border border-primary/20 px-2 py-0.5">READY FOR BATCH</span>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="border border-border/60 bg-background p-3">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">1. Flux Dispersion & Scatter</p>
              <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
                <li>• Standard deviation: <code className="text-foreground">flux_std_ppm</code></li>
                <li>• Robust amplitude: <code className="text-foreground">P95 − P05 (ppm)</code></li>
                <li>• Root-Mean-Square: <code className="text-foreground">flux_rms_ppm</code></li>
                <li>• Median point error: <code className="text-foreground">flux_err_ppm</code></li>
              </ul>
            </div>
            <div className="border border-border/60 bg-background p-3">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">2. Temporal Sampling Geometry</p>
              <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
                <li>• Observation baseline: <code className="text-foreground">time_span_days</code> (~27.4 d)</li>
                <li>• Median cadence: <code className="text-foreground">cadence_minutes</code> (2.0 min)</li>
                <li>• Maximum downlink gap: <code className="text-foreground">max_gap_minutes</code></li>
                <li>• Total valid cadences: <code className="text-foreground">total_cadences</code> (~15k/LC)</li>
              </ul>
            </div>
            <div className="border border-border/60 bg-background p-3">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">3. Higher-Order Morphology</p>
              <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
                <li>• Distribution skewness: <code className="text-foreground">flux_skewness</code></li>
                <li>• Kurtosis / heavy tails: <code className="text-foreground">flux_kurtosis</code></li>
                <li>• Residual scatter ratio: <code className="text-foreground">post/pre_clip</code></li>
                <li>• Outlier fraction removed: <code className="text-foreground">outlier_fraction</code></li>
              </ul>
            </div>
          </div>
        </section>
      ) : (
        <>
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
        </>
      )}

      <div className="border-l-2 border-primary/50 bg-background/40 px-3 py-2 text-[11px] text-muted-foreground">
        Các đường nối P05→P95 là quantile profile của toàn bộ Light Curve trong snapshot, không phải time series và không phải dữ liệu nội suy giữa các target.
      </div>
    </div>
  );
}

function Metric({ label, observed, detail, warning = false }: { label: string; observed: string; detail: string; warning?: boolean }): JSX.Element {
  return <div className="min-w-0 bg-background p-3"><p className="truncate text-[9px] uppercase tracking-wide text-muted-foreground" title={label}>{label}</p><p className={`mt-1 truncate font-mono text-sm font-semibold tabular-nums ${warning ? 'text-red-600 dark:text-red-400' : ''}`}>{observed}</p><p className="mt-0.5 truncate font-mono text-[9px] text-muted-foreground" title={detail}>{detail}</p></div>;
}
