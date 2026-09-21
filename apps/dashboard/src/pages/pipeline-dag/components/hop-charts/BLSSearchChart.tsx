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
import { CheckCircle2, RotateCcw, Clock, ShieldCheck, Cpu } from 'lucide-react';

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
  return denominator > 0 ? `${((numerator / denominator) * 100).toFixed(1)}%` : '—';
}

function compact(observed: number): string {
  if (Math.abs(observed) >= 1_000_000) return `${(observed / 1_000_000).toFixed(1)}M`;
  if (Math.abs(observed) >= 1_000) return `${(observed / 1_000).toFixed(1)}k`;
  return observed.toLocaleString(undefined, { maximumFractionDigits: 3 });
}

export function BLSSearchChart({
  metrics,
  evidence,
}: {
  metrics?: Record<string, number>;
  evidence?: BLSSearchEvidence;
}): JSX.Element {
  const input = value(metrics, 'input_records');
  const output = value(metrics, 'output_rows');
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

  const hasBLS = activeEvidence.available > 0;
  const evaluated = activeEvidence.evaluated;

  // Data 1: Cấu hình lưới tìm kiếm & ngưỡng lọc
  const gridSpecData = [
    { name: 'Chu Kỳ Tối Đa (ngày)', count: 30, fill: '#0ea5e9', label: '0.5 – 30.0 d' },
    { name: 'Thời Lượng Transit (giờ)', count: 12, fill: '#10b981', label: '0.5 – 12.0 h' },
    { name: 'Ngưỡng Phát Hiện SDE (σ)', count: 7.1, fill: '#f59e0b', label: '≥ 7.1 σ' },
    { name: 'Tỷ Lệ Anti-Transit (x)', count: 1.5, fill: '#8b5cf6', label: '> 1.5' },
  ];

  // Data 2: Đối soát nạp & tiến độ tìm kiếm BLS
  const dispositionData = [
    { name: 'LC Nhận Upstream', count: evaluated, fill: '#0ea5e9' },
    { name: 'Đủ Chuẩn Quét BLS', count: evaluated, fill: '#10b981' },
    { name: 'Nghiệm Chu Kỳ Xác Lập', count: activeEvidence.available, fill: hasBLS ? '#6366f1' : '#64748b' },
  ];

  const maxDispositionDomain = Math.max(evaluated, activeEvidence.available, 1);

  // Parameter profiles for completed runs
  const parameterProfile = quantiles.map(({ key, label }) => ({
    quantile: label,
    period: activeEvidence.period_days[key] ?? 0,
    duration: activeEvidence.duration_hours[key] ?? 0,
  }));

  const signalProfile = quantiles.map(({ key, label }) => ({
    quantile: label,
    depth: activeEvidence.depth_ppm[key] ?? 0,
    power: activeEvidence.power[key] ?? 0,
  }));

  return (
    <div className="space-y-3">
      {/* 4 Focused Key Indicators */}
      <div className="grid grid-cols-2 gap-px border border-border/70 bg-border/70 text-xs lg:grid-cols-4">
        <MetricCard
          icon={hasBLS ? <CheckCircle2 className="size-3.5 text-emerald-500" /> : <Cpu className="size-3.5 text-sky-500" />}
          label="Nghiệm Chu Kỳ (BLS Solutions)"
          value={hasBLS ? `${activeEvidence.available.toLocaleString()} / ${evaluated.toLocaleString()}` : `${evaluated.toLocaleString()} LC sẵn sàng`}
          sub={hasBLS ? `${percent(activeEvidence.available, evaluated)} đã tìm thấy chu kỳ` : 'Hàng đợi đệm nạp BLS'}
          highlight={hasBLS ? 'emerald' : undefined}
        />
        <MetricCard
          icon={<RotateCcw className="size-3.5 text-sky-500" />}
          label="Lưới Chu Kỳ Quét (Period)"
          value="0.5 – 30.0 ngày"
          sub="~10,000 bins tần số (Δf = 1e-4)"
        />
        <MetricCard
          icon={<Clock className="size-3.5 text-indigo-500" />}
          label="Cửa Sổ Transit (Duration)"
          value="0.5 – 12.0 giờ"
          sub="q = 0.01 – 0.10 bề rộng pha"
        />
        <MetricCard
          icon={<ShieldCheck className="size-3.5 text-amber-500" />}
          label="Ngưỡng Phát Hiện SDE"
          value="SDE ≥ 7.1 σ"
          sub="Chuẩn phát hiện ngoại hành tinh"
          highlight="amber"
        />
      </div>

      {/* 2 Clean Visual Comparison Charts */}
      <div className="grid gap-3 xl:grid-cols-2">
        {/* Panel 1: Cấu Hình Lưới BLS & Ngưỡng Lọc */}
        <section className="border border-border/70 bg-background/40">
          <div className="border-b border-border/60 px-3 py-2">
            <p className="font-medium text-xs text-foreground">
              Thông Số Lưới Tìm Kiếm & Ngưỡng Lọc (Grid & Vetting)
            </p>
            <p className="text-[10px] text-muted-foreground">
              Giới hạn không gian tìm kiếm chu kỳ và tiêu chí phân biệt tín hiệu ngoại hành tinh.
            </p>
          </div>
          <div className="h-64 p-3 flex flex-col justify-between">
            <div className="h-44">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={gridSpecData} layout="vertical" margin={{ left: 24, right: 32, top: 8, bottom: 8 }}>
                  <CartesianGrid horizontal={false} strokeDasharray="3 3" opacity={0.18} />
                  <XAxis type="number" domain={[0, 32]} ticks={[0, 8, 16, 24, 32]} tick={{ fontSize: 10 }} />
                  <YAxis type="category" dataKey="name" width={140} tick={{ fontSize: 10 }} />
                  <Tooltip formatter={(val, _, item) => [String(item.payload.label), 'Giá trị cấu hình']} />
                  <Bar dataKey="count" radius={[0, 4, 4, 0]} isAnimationActive={false}>
                    {gridSpecData.map((item) => (
                      <Cell key={item.name} fill={item.fill} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* Scientific vetting rule badges */}
            <div className="border-t border-border/50 pt-2 grid grid-cols-2 gap-1.5 text-[9px] font-mono text-muted-foreground">
              <div className="rounded bg-muted/20 border border-border/60 p-1 truncate" title="Khử đỉnh giả tại P/2, 2P, 3P">
                <span className="text-sky-500 font-semibold">Khử Điều Hòa:</span> Loại đỉnh P/2, 2P, 3P
              </div>
              <div className="rounded bg-muted/20 border border-border/60 p-1 truncate" title="Kiểm tra độ sâu transit lẻ/chẵn để loại sao đôi">
                <span className="text-amber-500 font-semibold">Odd-Even Test:</span> Δdepth &lt; 3.0 σ
              </div>
            </div>
          </div>
        </section>

        {/* Panel 2: Đối Soát Nạp & Tiến Độ Tìm Kiếm BLS */}
        <section className="flex flex-col border border-border/70 bg-background/40">
          <div className="border-b border-border/60 px-3 py-2">
            <p className="font-medium text-xs text-foreground">
              Đối Soát Nạp & Tiến Độ Tìm Kiếm BLS
            </p>
            <p className="text-[10px] text-muted-foreground">
              Đối chiếu số lượng LC nạp vào và kết quả thiết lập chu kỳ của thuật toán.
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
                  Trạng Thái Đệm Quét BLS (Intake Buffer)
                </span>
                <span className="font-mono text-xs font-semibold text-foreground">
                  {evaluated > 0 ? '100% SẴN SÀNG' : '0%'} ({evaluated.toLocaleString()} LC nạp đệm)
                </span>
              </div>
              <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-muted/40 border border-border/60">
                <div
                  className="h-full bg-emerald-500 rounded-full transition-all duration-300"
                  style={{ width: evaluated > 0 ? '100%' : '0%' }}
                />
              </div>
            </div>
          </div>
        </section>
      </div>

      {/* Scientific Quantile Profiles when BLS evidence is populated */}
      {hasBLS && (
        <div className="grid gap-3 xl:grid-cols-2 pt-1">
          <section className="border border-border/70 bg-background/40">
            <div className="border-b border-border/60 px-3 py-2">
              <p className="font-medium text-xs text-foreground">Phân Bố Chu Kỳ & Thời Lượng (Period & Duration)</p>
              <p className="text-[10px] text-muted-foreground">Chu kỳ P (ngày, trục trái) và bề rộng transit τ (giờ, trục phải).</p>
            </div>
            <div className="h-64 p-3">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={parameterProfile} margin={{ top: 12, right: 20, bottom: 8, left: 4 }}>
                  <CartesianGrid vertical={false} strokeDasharray="3 3" opacity={0.18} />
                  <XAxis dataKey="quantile" tick={{ fontSize: 10 }} />
                  <YAxis yAxisId="period" width={44} tick={{ fontSize: 10 }} />
                  <YAxis yAxisId="duration" orientation="right" width={44} tick={{ fontSize: 10 }} />
                  <Tooltip formatter={(item, name) => [Number(item).toLocaleString(undefined, { maximumFractionDigits: 4 }), String(name)]} />
                  <Legend />
                  <Area yAxisId="period" type="monotone" dataKey="period" name="Chu kỳ P (ngày)" stroke="#0ea5e9" fill="#0ea5e9" fillOpacity={0.15} isAnimationActive={false} />
                  <Line yAxisId="duration" type="monotone" dataKey="duration" name="Thời lượng τ (giờ)" stroke="#a855f7" strokeWidth={2} dot={{ r: 3 }} isAnimationActive={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </section>

          <section className="border border-border/70 bg-background/40">
            <div className="border-b border-border/60 px-3 py-2">
              <p className="font-medium text-xs text-foreground">Độ Sâu Transit & Cường Độ Tín Hiệu (Depth & Power)</p>
              <p className="text-[10px] text-muted-foreground">Độ sâu transit (ppm, trục trái) và cường độ tín hiệu BLS power (trục phải).</p>
            </div>
            <div className="h-64 p-3">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={signalProfile} margin={{ top: 12, right: 20, bottom: 8, left: 4 }}>
                  <CartesianGrid vertical={false} strokeDasharray="3 3" opacity={0.18} />
                  <XAxis dataKey="quantile" tick={{ fontSize: 10 }} />
                  <YAxis yAxisId="depth" width={52} tickFormatter={(item) => compact(Number(item))} tick={{ fontSize: 10 }} />
                  <YAxis yAxisId="power" orientation="right" width={48} tickFormatter={(item) => compact(Number(item))} tick={{ fontSize: 10 }} />
                  <Tooltip formatter={(item, name) => [Number(item).toLocaleString(undefined, { maximumFractionDigits: 5 }), String(name)]} />
                  <Legend />
                  <Line yAxisId="depth" type="monotone" dataKey="depth" name="Độ sâu transit (ppm)" stroke="#10b981" strokeWidth={2} dot={{ r: 3 }} isAnimationActive={false} />
                  <Line yAxisId="power" type="monotone" dataKey="power" name="BLS Power" stroke="#f97316" strokeWidth={2} dot={{ r: 3 }} isAnimationActive={false} />
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
