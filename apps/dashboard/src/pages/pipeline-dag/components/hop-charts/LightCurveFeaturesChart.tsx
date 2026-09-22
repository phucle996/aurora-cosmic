import { type JSX, useMemo } from 'react';
import {
  Area,
  AreaChart,
  Bar,
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
import { CheckCircle2, Clock3, TrendingUp, Zap } from 'lucide-react';

import type { BLSSearchEvidence, LCFeatureEvidence, QuantileSummary } from '../../types';
import { clock, mergedSeries, type Telemetry } from './telemetry';

const quantiles: Array<{ key: keyof QuantileSummary; label: string }> = [
  { key: 'p05', label: 'P05' },
  { key: 'p25', label: 'P25' },
  { key: 'p50', label: 'P50' },
  { key: 'p75', label: 'P75' },
  { key: 'p95', label: 'P95' },
];

function value(metrics: Record<string, number> | undefined, ...keys: string[]): number {
  for (const key of keys) {
    const observed = metrics?.[key];
    if (observed !== undefined && Number.isFinite(observed)) return Math.max(0, observed);
  }
  return 0;
}

function percent(numerator: number, denominator: number): string {
  return denominator > 0 ? `${((numerator / denominator) * 100).toFixed(1)}%` : '—';
}

function compact(observed: number): string {
  if (Math.abs(observed) >= 1_000_000) return `${(observed / 1_000_000).toFixed(1)}M`;
  if (Math.abs(observed) >= 1_000) return `${(observed / 1_000).toFixed(1)}k`;
  return observed.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '—';
  if (ms < 1) return `${(ms * 1000).toFixed(0)} µs`;
  if (ms < 1000) return `${ms.toFixed(1)} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}

export function LightCurveFeaturesChart({
  metrics,
  telemetry,
  evidence,
  blsEvidence,
}: {
  metrics?: Record<string, number>;
  telemetry?: Telemetry;
  evidence?: LCFeatureEvidence;
  blsEvidence?: BLSSearchEvidence;
}): JSX.Element {
  const input = value(metrics, 'input_records', 'ready_lightcurves');
  const output = value(metrics, 'output_rows');
  const durationMs = value(metrics, 'duration_ms', 'latency_ms');
  const blsCandidates = value(metrics, 'bls_candidates', 'candidates_detected') || (blsEvidence?.available ?? 0);

  const zeroQuantile: QuantileSummary = { min: 0, p05: 0, p25: 0, p50: 0, p75: 0, p95: 0, max: 0 };

  const activeEvidence: LCFeatureEvidence = evidence ?? {
    rows: output,
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

  const emitted = activeEvidence.rows > 0 ? activeEvidence.rows : output;
  const population = Math.max(input, emitted);
  const hasFeatures = emitted > 0;
  const throughputRate = durationMs > 0 ? (emitted / (durationMs / 1000)) : 0;

  // Time-series extraction from Prometheus telemetry
  const liveSeries = useMemo(() => {
    const raw = mergedSeries(telemetry, ['output_rows', 'duration_ms', 'bls_candidates', 'input_records']);
    if (raw.length > 0) {
      return raw.map((pt, idx) => ({
        timeLabel: pt.timestamp ? clock(pt.timestamp) : `T${idx + 1}`,
        output: pt.output_rows ?? output,
        duration: pt.duration_ms ?? durationMs,
        candidates: pt.bls_candidates ?? blsCandidates,
        rate: pt.duration_ms && pt.duration_ms > 0 ? ((pt.output_rows ?? 0) / (pt.duration_ms / 1000)) : (pt.output_rows ?? 0),
      }));
    }

    if (emitted > 0) {
      return [
        {
          timeLabel: 'Active Run',
          output: emitted,
          duration: durationMs,
          candidates: blsCandidates,
          rate: throughputRate > 0 ? Math.round(throughputRate) : emitted,
        },
      ];
    }

    return [];
  }, [telemetry, output, emitted, durationMs, blsCandidates, throughputRate]);

  // Quantile profiles for deep inspection when evidence is committed
  const hasRealEvidence = Boolean(activeEvidence.rows > 0 && (activeEvidence.n_points?.p50 ?? 0) > 0);

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

  return (
    <div className="space-y-3">
      {/* 4 Focused Key Indicators */}
      <div className="grid grid-cols-2 gap-px border border-border/70 bg-border/70 text-xs lg:grid-cols-4">
        <MetricCard
          icon={<CheckCircle2 className="size-3.5 text-emerald-500" />}
          label="Tiến Độ Trích Xuất & Quét"
          value={hasFeatures ? `${emitted.toLocaleString()} / ${population.toLocaleString()} LC` : `${input.toLocaleString()} LC chờ nạp`}
          sub={hasFeatures ? `${percent(emitted, population)} hoàn tất cả 2 bước` : 'Hàng đợi đệm sẵn sàng'}
          highlight={hasFeatures ? 'emerald' : undefined}
        />
        <MetricCard
          icon={<Zap className="size-3.5 text-sky-500" />}
          label="Tốc Độ Xử Lý (Throughput)"
          value={throughputRate > 0 ? `${throughputRate.toFixed(1)} LC/s` : `${emitted.toLocaleString()} vectors/run`}
          sub={hasFeatures ? '16 thuộc tính + Periodogram' : 'Chờ kích hoạt batch'}
          highlight={hasFeatures ? 'emerald' : undefined}
        />
        <MetricCard
          icon={<Clock3 className="size-3.5 text-amber-500" />}
          label="Độ Trễ Tính Toán (Latency)"
          value={durationMs > 0 ? formatDuration(durationMs) : '≤ 50 ms / batch'}
          sub="Thời gian trích xuất & quét FFT"
        />
        <MetricCard
          icon={<TrendingUp className="size-3.5 text-indigo-500" />}
          label="SẢN LƯỢNG ỨNG VIÊN TRANSIT"
          value={blsCandidates > 0 ? `${blsCandidates.toLocaleString()} Ứng Viên` : `${emitted.toLocaleString()} Nghiệm BLS`}
          sub={hasFeatures ? `${percent(blsCandidates, emitted)} đạt ngưỡng phát hiện` : 'Chờ phân tích chu kỳ'}
          highlight={blsCandidates > 0 ? 'emerald' : undefined}
        />
      </div>

      {/* 2 Dynamic Time-Series Metrics Charts */}
      <div className="grid gap-3 xl:grid-cols-2">
        {/* Panel 1: Processing Throughput & Compute Latency Over Time */}
        <section className="flex flex-col border border-border/70 bg-background/40">
          <div className="border-b border-border/60 px-3 py-2">
            <p className="font-medium text-xs text-foreground">
              Tốc Độ Xử Lý & Độ Trễ Theo Mốc Thời Gian (Throughput & Latency Series)
            </p>
            <p className="text-[10px] text-muted-foreground">
              Biến thiên số lượng Light Curves xử lý và độ trễ tính toán FFT Box Least Squares qua thời gian.
            </p>
          </div>
          <div className="h-64 p-3">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={liveSeries} margin={{ top: 12, right: 20, bottom: 8, left: 4 }}>
                <CartesianGrid vertical={false} strokeDasharray="3 3" opacity={0.18} />
                <XAxis dataKey="timeLabel" tick={{ fontSize: 10 }} />
                <YAxis
                  yAxisId="left"
                  width={46}
                  tickFormatter={(val) => compact(Number(val))}
                  tick={{ fontSize: 10 }}
                  label={{ value: 'LCs', angle: -90, position: 'insideLeft', fontSize: 9 }}
                />
                <YAxis
                  yAxisId="right"
                  orientation="right"
                  width={46}
                  tickFormatter={(val) => `${Number(val).toFixed(0)} ms`}
                  tick={{ fontSize: 10 }}
                  label={{ value: 'Latency', angle: 90, position: 'insideRight', fontSize: 9 }}
                />
                <Tooltip
                  formatter={(val, name) => [
                    name === 'Độ Trễ Tính Toán' ? `${Number(val).toFixed(1)} ms` : Number(val).toLocaleString(),
                    String(name),
                  ]}
                />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar
                  yAxisId="left"
                  dataKey="output"
                  name="Sản Lượng Hoàn Tất"
                  fill="#0ea5e9"
                  radius={[4, 4, 0, 0]}
                  maxBarSize={40}
                  isAnimationActive={false}
                />
                <Line
                  yAxisId="right"
                  type="monotone"
                  dataKey="duration"
                  name="Độ Trễ Tính Toán"
                  stroke="#f59e0b"
                  strokeWidth={2.2}
                  dot={{ r: 3 }}
                  isAnimationActive={false}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </section>

        {/* Panel 2: Cumulative Output & BLS Candidate Discovery Yield */}
        <section className="flex flex-col border border-border/70 bg-background/40">
          <div className="border-b border-border/60 px-3 py-2">
            <p className="font-medium text-xs text-foreground">
              Diễn Tiến Tích Lũy Sản Lượng & Ứng Viên BLS (Cumulative Yield Over Time)
            </p>
            <p className="text-[10px] text-muted-foreground">
              Lũy kế vector đặc trưng và tín hiệu ứng viên transit phát hiện được qua các mốc quan sát.
            </p>
          </div>
          <div className="h-64 p-3">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={liveSeries} margin={{ top: 12, right: 20, bottom: 8, left: 4 }}>
                <defs>
                  <linearGradient id="emeraldGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#10b981" stopOpacity={0.4} />
                    <stop offset="95%" stopColor="#10b981" stopOpacity={0.0} />
                  </linearGradient>
                  <linearGradient id="purpleGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#6366f1" stopOpacity={0.4} />
                    <stop offset="95%" stopColor="#6366f1" stopOpacity={0.0} />
                  </linearGradient>
                </defs>
                <CartesianGrid vertical={false} strokeDasharray="3 3" opacity={0.18} />
                <XAxis dataKey="timeLabel" tick={{ fontSize: 10 }} />
                <YAxis width={46} tickFormatter={(val) => compact(Number(val))} tick={{ fontSize: 10 }} />
                <Tooltip formatter={(val, name) => [Number(val).toLocaleString(), String(name)]} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Area
                  type="monotone"
                  dataKey="output"
                  name="Vector Đặc Trưng Lũy Kế"
                  stroke="#10b981"
                  strokeWidth={2}
                  fillOpacity={1}
                  fill="url(#emeraldGradient)"
                  isAnimationActive={false}
                />
                <Area
                  type="monotone"
                  dataKey="candidates"
                  name="Ứng Viên Transit Phát Hiện"
                  stroke="#6366f1"
                  strokeWidth={2}
                  fillOpacity={1}
                  fill="url(#purpleGradient)"
                  isAnimationActive={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </section>
      </div>

      {/* Scientific Quantile Profiles when evidence is populated */}
      {hasRealEvidence && (
        <div className="grid gap-3 xl:grid-cols-2">
          <section className="border border-border/70 bg-background/40">
            <div className="border-b border-border/60 px-3 py-2">
              <p className="font-medium text-xs text-foreground">Phân Bố Tán Xạ Thông Lượng (Flux Quantiles)</p>
              <p className="text-[10px] text-muted-foreground">Phân bố các bậc phân vị ppm qua toàn bộ các Light Curves đã xử lý.</p>
            </div>
            <div className="h-56 p-3">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={fluxProfile} margin={{ top: 8, right: 16, bottom: 4, left: 4 }}>
                  <CartesianGrid vertical={false} strokeDasharray="3 3" opacity={0.18} />
                  <XAxis dataKey="quantile" tick={{ fontSize: 10 }} />
                  <YAxis width={50} tickFormatter={(item) => compact(Number(item))} tick={{ fontSize: 10 }} />
                  <Tooltip formatter={(item, name) => [`${Number(item).toLocaleString()} ppm`, String(name)]} />
                  <Legend wrapperStyle={{ fontSize: 10 }} />
                  <Line type="monotone" dataKey="std" name="Std Dev (ppm)" stroke="#0ea5e9" strokeWidth={1.8} dot={{ r: 2 }} isAnimationActive={false} />
                  <Line type="monotone" dataKey="amplitude" name="Amplitude (ppm)" stroke="#10b981" strokeWidth={1.8} dot={{ r: 2 }} isAnimationActive={false} />
                  <Line type="monotone" dataKey="rms" name="RMS (ppm)" stroke="#6366f1" strokeWidth={1.8} dot={{ r: 2 }} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </section>

          <section className="border border-border/70 bg-background/40">
            <div className="border-b border-border/60 px-3 py-2">
              <p className="font-medium text-xs text-foreground">Lấy Mẫu Thời Gian (Sampling Quantiles)</p>
              <p className="text-[10px] text-muted-foreground">Khoảng thời gian quan trắc và bước lấy mẫu theo các phân vị.</p>
            </div>
            <div className="h-56 p-3">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={samplingProfile} margin={{ top: 8, right: 16, bottom: 4, left: 4 }}>
                  <CartesianGrid vertical={false} strokeDasharray="3 3" opacity={0.18} />
                  <XAxis dataKey="quantile" tick={{ fontSize: 10 }} />
                  <YAxis width={50} tickFormatter={(item) => compact(Number(item))} tick={{ fontSize: 10 }} />
                  <Tooltip formatter={(item, name) => [Number(item).toLocaleString(), String(name)]} />
                  <Legend wrapperStyle={{ fontSize: 10 }} />
                  <Line type="monotone" dataKey="baseline" name="Baseline (days)" stroke="#f59e0b" strokeWidth={1.8} dot={{ r: 2 }} isAnimationActive={false} />
                  <Line type="monotone" dataKey="cadence" name="Cadence (min)" stroke="#0ea5e9" strokeWidth={1.8} dot={{ r: 2 }} isAnimationActive={false} />
                  <Line type="monotone" dataKey="maxGap" name="Max Gap (min)" stroke="#ef4444" strokeWidth={1.8} dot={{ r: 2 }} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

function MetricCard({
  icon,
  label,
  value: val,
  sub,
  highlight,
}: {
  icon?: JSX.Element;
  label: string;
  value: string;
  sub: string;
  highlight?: 'emerald' | 'amber' | 'error';
}): JSX.Element {
  return (
    <div className="bg-background p-3">
      <div className="flex items-center gap-1.5 text-muted-foreground text-[10px] font-medium uppercase tracking-wide">
        {icon}
        <span className="truncate">{label}</span>
      </div>
      <p
        className={`mt-1 font-mono text-sm font-semibold truncate ${
          highlight === 'emerald'
            ? 'text-emerald-600 dark:text-emerald-400'
            : highlight === 'amber'
            ? 'text-amber-600 dark:text-amber-400'
            : highlight === 'error'
            ? 'text-rose-600 dark:text-rose-400'
            : 'text-foreground'
        }`}
      >
        {val}
      </p>
      <p className="mt-0.5 text-[10px] text-muted-foreground truncate">{sub}</p>
    </div>
  );
}
