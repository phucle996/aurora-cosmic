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

import type { BLSSearchEvidence, QuantileSummary } from '../../types';

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
  return observed.toLocaleString(undefined, { maximumFractionDigits: 3 });
}

export function BLSSearchChart({ metrics, evidence }: { metrics?: Record<string, number>; evidence?: BLSSearchEvidence }): JSX.Element {
  const input = value(metrics, 'input_records');
  const output = value(metrics, 'output_rows');
  const isBaseline = !evidence;
  const zeroQuantile: QuantileSummary = { min: 0, p05: 0, p25: 0, p50: 0, p75: 0, p95: 0, max: 0 };
  const activeEvidence: BLSSearchEvidence = evidence ?? {
    evaluated: input,
    available: output,
    unavailable: Math.max(0, input - output),
    period_days: zeroQuantile,
    duration_hours: zeroQuantile,
    depth_ppm: zeroQuantile,
    power: zeroQuantile,
    period_histogram: [
      { label: '< 1 d', count: 0 },
      { label: '1–3 d', count: 0 },
      { label: '3–10 d', count: 0 },
      { label: '10–30 d', count: 0 },
      { label: '> 30 d', count: 0 },
    ],
  };

  const disposition = [{ population: 'Evaluated Light Curves', available: activeEvidence.available, unavailable: activeEvidence.unavailable }];
  const parameterProfile = quantiles.map(({ key, label }) => ({ quantile: label, period: activeEvidence.period_days[key] ?? 0, duration: activeEvidence.duration_hours[key] ?? 0 }));
  const signalProfile = quantiles.map(({ key, label }) => ({ quantile: label, depth: activeEvidence.depth_ppm[key] ?? 0, power: activeEvidence.power[key] ?? 0 }));
  const hasBLS = activeEvidence.available > 0;

  return (
    <div className="space-y-3">
      {isBaseline && (
        <div className="flex items-center justify-between border border-border/70 bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5 font-medium">
            <span className="size-2 rounded-full bg-amber-500" />
            Khung phân tích cơ sở: G04 chưa có committed BLS evidence (hiển thị mức nền 0).
          </span>
          <span className="font-mono text-[10px] uppercase">
            {input > 0 ? `${input.toLocaleString()} inputs upstream` : 'Sẵn sàng ghi nhận'}
          </span>
        </div>
      )}

      <div className="grid grid-cols-2 gap-px border border-border/70 bg-border/70 text-xs lg:grid-cols-3 2xl:grid-cols-6">
        <Metric label="LC evaluated" observed={activeEvidence.evaluated.toLocaleString()} detail="ready LC inputs" />
        <Metric label="BLS available" observed={activeEvidence.available.toLocaleString()} detail={hasBLS ? percent(activeEvidence.available, activeEvidence.evaluated) : 'unrun / standby'} />
        <Metric label="Search status" observed={hasBLS ? 'COMPLETED' : 'QUEUED'} detail={hasBLS ? 'evidence recorded' : 'awaiting batch trigger'} />
        <Metric label="Period grid" observed="0.5–30.0 d" detail="frequency step 1e-4 d⁻¹" />
        <Metric label="Duration grid" observed="0.5–12.0 h" detail="fractional width 0.01–0.10" />
        <Metric label="Detection gate" observed="≥ 7.1 σ" detail="BLS SDE threshold" />
      </div>

      {hasBLS ? (
        <>
          <section className="border border-border/70 bg-background/40">
            <div className="border-b border-border/60 px-3 py-2">
              <p className="font-medium">BLS execution availability</p>
              <p className="text-[10px] text-muted-foreground">Unavailable nghĩa là search không tạo được periodogram hợp lệ; không đồng nghĩa pipeline failure hay non-planet.</p>
            </div>
            <div className="h-[180px] p-3">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={disposition} layout="vertical" margin={{ top: 12, right: 28, bottom: 8, left: 12 }}>
                  <CartesianGrid horizontal={false} strokeDasharray="3 3" opacity={0.2} />
                  <XAxis type="number" domain={[0, Math.max(activeEvidence.evaluated, 1)]} allowDecimals={false} tick={{ fontSize: 10 }} />
                  <YAxis type="category" dataKey="population" width={125} tick={{ fontSize: 10 }} />
                  <Tooltip formatter={(item, name) => [`${Number(item).toLocaleString()} LC`, String(name)]} />
                  <Legend />
                  <Bar dataKey="available" name="BLS available" stackId="availability" fill="#10b981" isAnimationActive={false} />
                  <Bar dataKey="unavailable" name="BLS unavailable" stackId="availability" fill="#f59e0b" isAnimationActive={false} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </section>

          <section className="border border-border/70 bg-background/40">
            <div className="border-b border-border/60 px-3 py-2">
              <p className="font-medium">Best-period distribution</p>
              <p className="text-[10px] text-muted-foreground">Histogram đếm nghiệm BLS tốt nhất theo dải chu kỳ; đây chưa phải phân bố chu kỳ hành tinh đã xác nhận.</p>
            </div>
            <div className="h-[260px] p-3">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={activeEvidence.period_histogram} margin={{ top: 12, right: 12, bottom: 8, left: 4 }}>
                  <CartesianGrid vertical={false} strokeDasharray="3 3" opacity={0.2} />
                  <XAxis dataKey="label" tick={{ fontSize: 10 }} />
                  <YAxis allowDecimals={false} width={42} tick={{ fontSize: 10 }} />
                  <Tooltip formatter={(item) => [`${Number(item).toLocaleString()} LC`, 'Best-period solutions']} />
                  <Bar dataKey="count" name="Best-period solutions" fill="#22d3ee" isAnimationActive={false} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </section>

          <div className="grid gap-3 xl:grid-cols-2">
            <section className="border border-border/70 bg-background/40">
              <div className="border-b border-border/60 px-3 py-2">
                <p className="font-medium">Period and duration quantile profile</p>
                <p className="text-[10px] text-muted-foreground">Period dùng trục trái (days), fitted box duration dùng trục phải (hours).</p>
              </div>
              <div className="h-[300px] p-3">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={parameterProfile} margin={{ top: 12, right: 20, bottom: 8, left: 4 }}>
                    <CartesianGrid vertical={false} strokeDasharray="3 3" opacity={0.2} />
                    <XAxis dataKey="quantile" tick={{ fontSize: 10 }} />
                    <YAxis yAxisId="period" width={42} tick={{ fontSize: 10 }} label={{ value: 'days', angle: -90, position: 'insideLeft', fontSize: 9 }} />
                    <YAxis yAxisId="duration" orientation="right" width={42} tick={{ fontSize: 10 }} label={{ value: 'hours', angle: 90, position: 'insideRight', fontSize: 9 }} />
                    <Tooltip formatter={(item, name) => [Number(item).toLocaleString(undefined, { maximumFractionDigits: 4 }), String(name)]} />
                    <Legend />
                    <Area yAxisId="period" type="monotone" dataKey="period" name="Best period · days" stroke="#22d3ee" fill="#22d3ee" fillOpacity={0.18} isAnimationActive={false} />
                    <Line yAxisId="duration" type="monotone" dataKey="duration" name="Box duration · hours" stroke="#a855f7" strokeWidth={2.2} dot={{ r: 3 }} isAnimationActive={false} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </section>

            <section className="border border-border/70 bg-background/40">
              <div className="border-b border-border/60 px-3 py-2">
                <p className="font-medium">Signal evidence quantile profile</p>
                <p className="text-[10px] text-muted-foreground">Depth dùng trục trái (ppm); BLS power dùng trục phải và chỉ có ý nghĩa tương đối trong search.</p>
              </div>
              <div className="h-[300px] p-3">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={signalProfile} margin={{ top: 12, right: 20, bottom: 8, left: 4 }}>
                    <CartesianGrid vertical={false} strokeDasharray="3 3" opacity={0.2} />
                    <XAxis dataKey="quantile" tick={{ fontSize: 10 }} />
                    <YAxis yAxisId="depth" width={52} tickFormatter={(item) => compact(Number(item))} tick={{ fontSize: 10 }} label={{ value: 'ppm', angle: -90, position: 'insideLeft', fontSize: 9 }} />
                    <YAxis yAxisId="power" orientation="right" width={48} tickFormatter={(item) => compact(Number(item))} tick={{ fontSize: 10 }} label={{ value: 'power', angle: 90, position: 'insideRight', fontSize: 9 }} />
                    <Tooltip formatter={(item, name) => [Number(item).toLocaleString(undefined, { maximumFractionDigits: 5 }), String(name)]} />
                    <Legend />
                    <Line yAxisId="depth" type="monotone" dataKey="depth" name="Transit depth · ppm" stroke="#10b981" strokeWidth={2.2} dot={{ r: 3 }} isAnimationActive={false} />
                    <Line yAxisId="power" type="monotone" dataKey="power" name="BLS power" stroke="#f97316" strokeWidth={2.2} dot={{ r: 3 }} isAnimationActive={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </section>
          </div>
        </>
      ) : (
        <div className="grid gap-3 xl:grid-cols-2">
          <section className="border border-border/70 bg-background/40 p-4">
            <h4 className="font-mono text-xs font-semibold uppercase tracking-wider text-primary">Cấu hình lưới tìm kiếm tuần hoàn (BLS Grid Spec)</h4>
            <p className="mt-1 text-[11px] text-muted-foreground">
              Toán tử BLS (Box Least Squares) quét lưới chu kỳ và bề rộng transit trên các đường cong ánh sáng đã chuẩn hóa:
            </p>
            <div className="mt-3 space-y-2 text-xs">
              <div className="flex items-start justify-between border-b border-border/50 py-1.5">
                <span className="text-muted-foreground">Dải chu kỳ tìm kiếm (Period Range)</span>
                <span className="font-mono font-medium">0.5 d ≤ P ≤ 30.0 d</span>
              </div>
              <div className="flex items-start justify-between border-b border-border/50 py-1.5">
                <span className="text-muted-foreground">Độ phân giải tần số (Frequency Step)</span>
                <span className="font-mono font-medium">Δf = 1.0 × 10⁻⁴ d⁻¹ (~10,000 bins)</span>
              </div>
              <div className="flex items-start justify-between border-b border-border/50 py-1.5">
                <span className="text-muted-foreground">Tỷ lệ thời lượng transit (Fractional Duration q)</span>
                <span className="font-mono font-medium">q ∈ [0.01, 0.10] (0.5 h ≤ τ ≤ 12.0 h)</span>
              </div>
              <div className="flex items-start justify-between py-1.5">
                <span className="text-muted-foreground">Độ nhạy phân giải pha (Phase Binning)</span>
                <span className="font-mono font-medium">200 bins / cycle (adaptive sampling)</span>
              </div>
            </div>
          </section>

          <section className="border border-border/70 bg-background/40 p-4">
            <h4 className="font-mono text-xs font-semibold uppercase tracking-wider text-primary">Tiêu chí chấp nhận & Bộ lọc giả tín hiệu</h4>
            <p className="mt-1 text-[11px] text-muted-foreground">
              Quy tắc vetting sơ bộ nhằm loại bỏ sao đôi che khuất (EB) và biến quang sao trước khi sang G05/G06:
            </p>
            <div className="mt-3 space-y-2 text-xs">
              <div className="flex items-start justify-between border-b border-border/50 py-1.5">
                <span className="text-muted-foreground">Ngưỡng phát hiện SDE (Signal Detection Eff.)</span>
                <span className="font-mono font-medium text-emerald-600 dark:text-emerald-400">SDE ≥ 7.1 σ</span>
              </div>
              <div className="flex items-start justify-between border-b border-border/50 py-1.5">
                <span className="text-muted-foreground">Khử điều hòa (Harmonic Suppression)</span>
                <span className="font-mono font-medium">Loại trừ đỉnh giả tại P/2, 2P, 3P</span>
              </div>
              <div className="flex items-start justify-between border-b border-border/50 py-1.5">
                <span className="text-muted-foreground">Kiểm tra Odd-Even Transit Depth</span>
                <span className="font-mono font-medium">Δdepth &lt; 3.0 σ (khử sao đôi phụ)</span>
              </div>
              <div className="flex items-start justify-between py-1.5">
                <span className="text-muted-foreground">Phân tích Anti-transit (Inverted BLS)</span>
                <span className="font-mono font-medium">Power_pos / Power_neg &gt; 1.5</span>
              </div>
            </div>
          </section>
        </div>
      )}

      <div className="border-l-2 border-primary/50 bg-background/40 px-3 py-2 text-[11px] text-muted-foreground">
        BLS chọn nghiệm có power lớn nhất trên lưới period–duration. Một peak mạnh là bằng chứng tuần hoàn cần vetting tiếp, không phải xác suất hoặc xác nhận ngoại hành tinh.
      </div>
    </div>
  );
}

function Metric({ label, observed, detail, warning = false }: { label: string; observed: string; detail: string; warning?: boolean }): JSX.Element {
  return <div className="min-w-0 bg-background p-3"><p className="truncate text-[9px] uppercase tracking-wide text-muted-foreground" title={label}>{label}</p><p className={`mt-1 truncate font-mono text-sm font-semibold tabular-nums ${warning ? 'text-amber-600 dark:text-amber-400' : ''}`}>{observed}</p><p className="mt-0.5 truncate font-mono text-[9px] text-muted-foreground" title={detail}>{detail}</p></div>;
}
