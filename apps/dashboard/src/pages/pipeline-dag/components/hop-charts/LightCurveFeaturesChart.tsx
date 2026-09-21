import { type JSX } from 'react';
import {
  Area,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { CheckCircle2, Layers, Activity, ShieldCheck, Cpu } from 'lucide-react';

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
  return denominator > 0 ? `${((numerator / denominator) * 100).toFixed(1)}%` : '—';
}

function compact(observed: number): string {
  if (Math.abs(observed) >= 1_000_000) return `${(observed / 1_000_000).toFixed(1)}M`;
  if (Math.abs(observed) >= 1_000) return `${(observed / 1_000).toFixed(1)}k`;
  return observed.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

export function LightCurveFeaturesChart({
  metrics,
  evidence,
}: {
  metrics?: Record<string, number>;
  evidence?: LCFeatureEvidence;
}): JSX.Element {
  const input = value(metrics, 'input_records');
  const ledgerOutput = value(metrics, 'output_rows');
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
  const hasFeatures = activeEvidence.rows > 0;

  // Data 1: Kiến trúc vector đặc trưng (16 chiều)
  const vectorTaxonomyData = [
    { name: 'Tán Xạ Thông Lượng', count: 4, fill: '#0ea5e9', desc: 'σ_flux, amplitude, RMS, median error' },
    { name: 'Lấy Mẫu Thời Gian', count: 4, fill: '#10b981', desc: 'baseline days, cadence min, max gap, valid points' },
    { name: 'Hình Thái Bậc Cao', count: 8, fill: '#8b5cf6', desc: 'skewness, kurtosis, clip ratios, outlier fraction' },
  ];

  // Data 2: Đối soát nạp & tiến độ trích xuất
  const dispositionData = [
    { name: 'Mục Tiêu Nhận Upstream', count: input, fill: '#0ea5e9' },
    { name: 'Đủ Điều Kiện Tính Vector', count: input, fill: '#10b981' },
    { name: 'Đặc Trưng Đã Cam Kết', count: emitted, fill: hasFeatures ? '#6366f1' : '#64748b' },
  ];

  const maxDispositionDomain = Math.max(input, emitted, 1);

  // Quantile profiles for completed runs
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
          icon={hasFeatures ? <CheckCircle2 className="size-3.5 text-emerald-500" /> : <Cpu className="size-3.5 text-sky-500" />}
          label="Tiến Độ Trích Xuất (Feature Rows)"
          value={hasFeatures ? `${emitted.toLocaleString()} / ${population.toLocaleString()}` : `${input.toLocaleString()} LC chờ nạp`}
          sub={hasFeatures ? `${percent(emitted, population)} đã hoàn tất` : 'Hàng đợi đệm sẵn sàng'}
          highlight={hasFeatures ? 'emerald' : undefined}
        />
        <MetricCard
          icon={<Layers className="size-3.5 text-indigo-500" />}
          label="Không Gian Đặc Trưng"
          value="16 Chiều (Dimensions)"
          sub="Vector vật lý thiên văn"
        />
        <MetricCard
          icon={<Activity className="size-3.5 text-amber-500" />}
          label="Nhóm Chỉ Số Trích Xuất"
          value="4 Tán Xạ · 4 Thời Gian · 8 Dạng"
          sub="Dispersion · Temporal · Shape"
        />
        <MetricCard
          icon={<ShieldCheck className="size-3.5 text-emerald-500" />}
          label="Cổng Thực Thi (Execution Gate)"
          value={hasFeatures ? 'COMMITTED' : 'AWAITING BATCH'}
          sub={hasFeatures ? `${activeEvidence.snapshot_count} snapshot đã cam kết` : 'Đủ điều kiện kích hoạt'}
          highlight={hasFeatures ? 'emerald' : undefined}
        />
      </div>

      {/* 2 Clean Visual Comparison Charts */}
      <div className="grid gap-3 xl:grid-cols-2">
        {/* Panel 1: Cấu Trúc Vector Đặc Trưng */}
        <section className="border border-border/70 bg-background/40">
          <div className="border-b border-border/60 px-3 py-2">
            <p className="font-medium text-xs text-foreground">
              Cấu Trúc Vector Đặc Trưng Thiên Văn (16 Chiều)
            </p>
            <p className="text-[10px] text-muted-foreground">
              Phân rã số lượng thuộc tính trích xuất theo 3 nhóm vật lý cốt lõi.
            </p>
          </div>
          <div className="h-64 p-3 flex flex-col justify-between">
            <div className="h-44">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={vectorTaxonomyData} layout="vertical" margin={{ left: 24, right: 32, top: 10, bottom: 10 }}>
                  <CartesianGrid horizontal={false} strokeDasharray="3 3" opacity={0.18} />
                  <XAxis type="number" domain={[0, 10]} ticks={[0, 2, 4, 6, 8, 10]} tick={{ fontSize: 10 }} />
                  <YAxis type="category" dataKey="name" width={140} tick={{ fontSize: 10 }} />
                  <Tooltip formatter={(val) => [`${Number(val)} đặc trưng`, 'Số lượng thuộc tính']} />
                  <Bar dataKey="count" radius={[0, 4, 4, 0]} isAnimationActive={false}>
                    {vectorTaxonomyData.map((item) => (
                      <Cell key={item.name} fill={item.fill} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* Feature parameter tags */}
            <div className="border-t border-border/50 pt-2 grid grid-cols-3 gap-1.5 text-[9px] font-mono text-muted-foreground">
              <div className="rounded bg-muted/20 border border-border/60 p-1 truncate" title="flux_std, amplitude, RMS, flux_err">
                <span className="text-sky-500 font-semibold">Tán Xạ:</span> 4 thông số
              </div>
              <div className="rounded bg-muted/20 border border-border/60 p-1 truncate" title="time_span, cadence, max_gap, cadences">
                <span className="text-emerald-500 font-semibold">Thời Gian:</span> 4 thông số
              </div>
              <div className="rounded bg-muted/20 border border-border/60 p-1 truncate" title="skewness, kurtosis, clip ratios, outliers">
                <span className="text-purple-500 font-semibold">Hình Thái:</span> 8 thông số
              </div>
            </div>
          </div>
        </section>

        {/* Panel 2: Đối Soát Nạp & Tiến Độ Trích Xuất */}
        <section className="flex flex-col border border-border/70 bg-background/40">
          <div className="border-b border-border/60 px-3 py-2">
            <p className="font-medium text-xs text-foreground">
              Đối Soát Nạp & Tiến Độ Trích Xuất
            </p>
            <p className="text-[10px] text-muted-foreground">
              Đối chiếu số lượng LC nạp vào và trạng thái xuất dữ liệu của Worker.
            </p>
          </div>
          <div className="flex-1 p-3 flex flex-col justify-between">
            <div className="h-44">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={dispositionData} layout="vertical" margin={{ left: 24, right: 32, top: 10, bottom: 10 }}>
                  <CartesianGrid horizontal={false} strokeDasharray="3 3" opacity={0.18} />
                  <XAxis type="number" domain={[0, maxDispositionDomain]} tick={{ fontSize: 10 }} />
                  <YAxis type="category" dataKey="name" width={140} tick={{ fontSize: 10 }} />
                  <Tooltip formatter={(val) => [`${Number(val).toLocaleString()} LC`, 'Số lượng']} />
                  <Bar dataKey="count" radius={[0, 4, 4, 0]} isAnimationActive={false}>
                    {dispositionData.map((item) => (
                      <Cell key={item.name} fill={item.fill} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* Buffer progress indicator */}
            <div className="border-t border-border/50 pt-2">
              <div className="flex items-center justify-between text-xs">
                <span className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium">
                  Trạng Thái Đệm Đầu Vào (Intake Buffer)
                </span>
                <span className="font-mono text-xs font-semibold text-foreground">
                  {input > 0 ? '100% SẴN SÀNG' : '0%'} ({input.toLocaleString()} LC nạp đệm)
                </span>
              </div>
              <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-muted/40 border border-border/60">
                <div
                  className="h-full bg-emerald-500 rounded-full transition-all duration-300"
                  style={{ width: input > 0 ? '100%' : '0%' }}
                />
              </div>
            </div>
          </div>
        </section>
      </div>

      {/* Scientific Quantile Profiles when evidence is populated */}
      {hasFeatures && (
        <div className="grid gap-3 xl:grid-cols-2 pt-1">
          <section className="border border-border/70 bg-background/40">
            <div className="border-b border-border/60 px-3 py-2">
              <p className="font-medium text-xs text-foreground">Phân Bố Độ Phân Tán Thông Lượng (ppm Quantiles)</p>
              <p className="text-[10px] text-muted-foreground">So sánh σ, biên độ, RMS và độ không đảm bảo theo quantile P05-P95.</p>
            </div>
            <div className="h-64 p-3">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={fluxProfile} margin={{ top: 12, right: 18, bottom: 8, left: 4 }}>
                  <CartesianGrid vertical={false} strokeDasharray="3 3" opacity={0.18} />
                  <XAxis dataKey="quantile" tick={{ fontSize: 10 }} />
                  <YAxis tickFormatter={(item) => compact(Number(item))} width={52} tick={{ fontSize: 10 }} />
                  <Tooltip formatter={(item, name) => [`${Number(item).toLocaleString(undefined, { maximumFractionDigits: 2 })} ppm`, String(name)]} />
                  <Legend />
                  <Line type="monotone" dataKey="std" name="Flux σ" stroke="#0ea5e9" strokeWidth={2} dot={{ r: 3 }} isAnimationActive={false} />
                  <Line type="monotone" dataKey="amplitude" name="Biên độ P95−P05" stroke="#a855f7" strokeWidth={2} dot={{ r: 3 }} isAnimationActive={false} />
                  <Line type="monotone" dataKey="rms" name="Flux RMS" stroke="#10b981" strokeWidth={2} dot={{ r: 3 }} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </section>

          <section className="border border-border/70 bg-background/40">
            <div className="border-b border-border/60 px-3 py-2">
              <p className="font-medium text-xs text-foreground">Phân Bố Lấy Mẫu Thời Gian (Temporal Quantiles)</p>
              <p className="text-[10px] text-muted-foreground">Thời lượng baseline (ngày) và chu kỳ nhịp lấy mẫu (phút).</p>
            </div>
            <div className="h-64 p-3">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={samplingProfile} margin={{ top: 12, right: 20, bottom: 8, left: 4 }}>
                  <CartesianGrid vertical={false} strokeDasharray="3 3" opacity={0.18} />
                  <XAxis dataKey="quantile" tick={{ fontSize: 10 }} />
                  <YAxis yAxisId="days" tickFormatter={(item) => compact(Number(item))} width={44} tick={{ fontSize: 10 }} />
                  <YAxis yAxisId="minutes" orientation="right" tickFormatter={(item) => compact(Number(item))} width={50} tick={{ fontSize: 10 }} />
                  <Tooltip formatter={(item, name) => [Number(item).toLocaleString(undefined, { maximumFractionDigits: 3 }), String(name)]} />
                  <Legend />
                  <Area yAxisId="days" type="monotone" dataKey="baseline" name="Baseline (ngày)" stroke="#0ea5e9" fill="#0ea5e9" fillOpacity={0.15} isAnimationActive={false} />
                  <Line yAxisId="minutes" type="monotone" dataKey="cadence" name="Nhịp lấy mẫu (phút)" stroke="#10b981" strokeWidth={2} dot={{ r: 3 }} isAnimationActive={false} />
                </ComposedChart>
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
