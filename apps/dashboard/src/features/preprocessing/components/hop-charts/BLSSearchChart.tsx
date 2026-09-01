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

import type { BLSSearchEvidence, QuantileSummary } from '@/features/factory-history/types';

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
  if (!evidence) {
    return <section className={`border border-dashed px-5 py-12 text-center ${output > 0 ? 'border-red-500/60 bg-red-500/5' : 'border-border/70 bg-background/40'}`}>
      <p className="font-mono text-sm font-semibold uppercase">{output > 0 ? 'BLS evidence mismatch' : 'BLS search not executed'}</p>
      <p className="mx-auto mt-2 max-w-2xl text-[11px] leading-5 text-muted-foreground">
        {output > 0
          ? `Run ledger reports ${output.toLocaleString()} BLS outputs, but no BLS rows were found in its committed snapshots. No distribution is synthesized.`
          : `${input.toLocaleString()} upstream feature rows are visible, but G04 has no committed BLS search evidence in this view.`}
      </p>
    </section>;
  }

  const disposition = [{ population: 'Evaluated Light Curves', available: evidence.available, unavailable: evidence.unavailable }];
  const parameterProfile = quantiles.map(({ key, label }) => ({ quantile: label, period: evidence.period_days[key], duration: evidence.duration_hours[key] }));
  const signalProfile = quantiles.map(({ key, label }) => ({ quantile: label, depth: evidence.depth_ppm[key], power: evidence.power[key] }));
  const hasBLS = evidence.available > 0;

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-px border border-border/70 bg-border/70 text-xs lg:grid-cols-3 2xl:grid-cols-6">
        <Metric label="LC evaluated" observed={evidence.evaluated.toLocaleString()} detail="feature rows inspected" />
        <Metric label="BLS available" observed={evidence.available.toLocaleString()} detail={percent(evidence.available, evidence.evaluated)} />
        <Metric label="BLS unavailable" observed={evidence.unavailable.toLocaleString()} detail={percent(evidence.unavailable, evidence.evaluated)} warning={evidence.unavailable > 0} />
        <Metric label="Best period · P50" observed={hasBLS ? `${compact(evidence.period_days.p50)} d` : '—'} detail={hasBLS ? `P05–P95 ${compact(evidence.period_days.p05)}–${compact(evidence.period_days.p95)} d` : 'no available search'} />
        <Metric label="Duration · P50" observed={hasBLS ? `${compact(evidence.duration_hours.p50)} h` : '—'} detail={hasBLS ? `P05–P95 ${compact(evidence.duration_hours.p05)}–${compact(evidence.duration_hours.p95)} h` : 'no available search'} />
        <Metric label="Transit depth · P50" observed={hasBLS ? `${compact(evidence.depth_ppm.p50)} ppm` : '—'} detail={hasBLS ? `power P50 ${compact(evidence.power.p50)}` : 'no available search'} />
      </div>

      <section className="border border-border/70 bg-background/40">
        <div className="border-b border-border/60 px-3 py-2">
          <p className="font-medium">BLS execution availability</p>
          <p className="text-[10px] text-muted-foreground">Unavailable nghĩa là search không tạo được periodogram hợp lệ; không đồng nghĩa pipeline failure hay non-planet.</p>
        </div>
        <div className="h-[180px] p-3">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={disposition} layout="vertical" margin={{ top: 12, right: 28, bottom: 8, left: 12 }}>
              <CartesianGrid horizontal={false} strokeDasharray="3 3" opacity={0.2} />
              <XAxis type="number" domain={[0, Math.max(evidence.evaluated, 1)]} allowDecimals={false} tick={{ fontSize: 10 }} />
              <YAxis type="category" dataKey="population" width={125} tick={{ fontSize: 10 }} />
              <Tooltip formatter={(item, name) => [`${Number(item).toLocaleString()} LC`, String(name)]} />
              <Legend />
              <Bar dataKey="available" name="BLS available" stackId="availability" fill="#10b981" isAnimationActive={false} />
              <Bar dataKey="unavailable" name="BLS unavailable" stackId="availability" fill="#f59e0b" isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </section>

      {hasBLS ? <>
        <section className="border border-border/70 bg-background/40">
          <div className="border-b border-border/60 px-3 py-2">
            <p className="font-medium">Best-period distribution</p>
            <p className="text-[10px] text-muted-foreground">Histogram đếm nghiệm BLS tốt nhất theo dải chu kỳ; đây chưa phải phân bố chu kỳ hành tinh đã xác nhận.</p>
          </div>
          <div className="h-[260px] p-3">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={evidence.period_histogram} margin={{ top: 12, right: 12, bottom: 8, left: 4 }}>
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
      </> : <div className="border border-dashed border-border/70 bg-background/40 px-4 py-8 text-center text-[11px] text-muted-foreground">Không có periodogram BLS khả dụng trong run này; parameter distributions được giữ trống thay vì vẽ các giá trị 0.</div>}

      <div className="border-l-2 border-primary/50 bg-background/40 px-3 py-2 text-[11px] text-muted-foreground">
        BLS chọn nghiệm có power lớn nhất trên lưới period–duration. Một peak mạnh là bằng chứng tuần hoàn cần vetting tiếp, không phải xác suất hoặc xác nhận ngoại hành tinh.
      </div>
    </div>
  );
}

function Metric({ label, observed, detail, warning = false }: { label: string; observed: string; detail: string; warning?: boolean }): JSX.Element {
  return <div className="min-w-0 bg-background p-3"><p className="truncate text-[9px] uppercase tracking-wide text-muted-foreground" title={label}>{label}</p><p className={`mt-1 truncate font-mono text-sm font-semibold tabular-nums ${warning ? 'text-amber-600 dark:text-amber-400' : ''}`}>{observed}</p><p className="mt-0.5 truncate font-mono text-[9px] text-muted-foreground" title={detail}>{detail}</p></div>;
}
