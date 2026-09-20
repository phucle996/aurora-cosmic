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

import type { QuantileSummary, TPFSpatialEvidence } from '../../types';

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
  return observed.toLocaleString(undefined, { maximumFractionDigits: 4 });
}

export function TPFSpatialEvidenceChart({ metrics, evidence }: { metrics?: Record<string, number>; evidence?: TPFSpatialEvidence }): JSX.Element {
  const input = value(metrics, 'input_records');
  const output = value(metrics, 'output_rows');
  const isBaseline = !evidence;
  const zeroQuantile: QuantileSummary = { min: 0, p05: 0, p25: 0, p50: 0, p75: 0, p95: 0, max: 0 };
  const activeEvidence: TPFSpatialEvidence = evidence ?? {
    evaluated: input,
    available: output,
    unavailable: Math.max(0, input - output),
    pixel_mad: zeroQuantile,
    variability_peak_percent: zeroQuantile,
    transit_deficit_sum: zeroQuantile,
    centroid_offset_pixels: zeroQuantile,
    centroid_offset_histogram: [
      { label: '< 0.5 px', count: 0 },
      { label: '0.5–1.5 px', count: 0 },
      { label: '1.5–3.0 px', count: 0 },
      { label: '> 3.0 px', count: 0 },
    ],
  };

  const availability = [{ population: 'TPF contexts', available: activeEvidence.available, unavailable: activeEvidence.unavailable }];
  const variabilityProfile = quantiles.map(({ key, label }) => ({ quantile: label, pixelMAD: activeEvidence.pixel_mad[key] ?? 0, peak: activeEvidence.variability_peak_percent[key] ?? 0 }));
  const transitProfile = quantiles.map(({ key, label }) => ({ quantile: label, offset: activeEvidence.centroid_offset_pixels[key] ?? 0, deficit: activeEvidence.transit_deficit_sum[key] ?? 0 }));
  const hasTransitEvidence = activeEvidence.available > 0;

  return (
    <div className="space-y-3">
      {isBaseline && (
        <div className="flex items-center justify-between border border-border/70 bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5 font-medium">
            <span className="size-2 rounded-full bg-amber-500" />
            Khung phân tích cơ sở: G05 chưa có committed spatial evidence (hiển thị mức nền 0).
          </span>
          <span className="font-mono text-[10px] uppercase">
            {input > 0 ? `${input.toLocaleString()} TPF inputs upstream` : 'Sẵn sàng ghi nhận'}
          </span>
        </div>
      )}

      <div className="grid grid-cols-2 gap-px border border-border/70 bg-border/70 text-xs lg:grid-cols-3 2xl:grid-cols-6">
        <Metric label="TPF evaluated" observed={activeEvidence.evaluated.toLocaleString()} detail="paired spatial contexts" />
        <Metric label="Transit evidence" observed={activeEvidence.available.toLocaleString()} detail={percent(activeEvidence.available, activeEvidence.evaluated)} />
        <Metric label="Evidence unavailable" observed={activeEvidence.unavailable.toLocaleString()} detail={percent(activeEvidence.unavailable, activeEvidence.evaluated)} warning={activeEvidence.unavailable > 0} />
        <Metric label="Centroid offset · P50" observed={hasTransitEvidence ? `${compact(activeEvidence.centroid_offset_pixels.p50)} px` : '0 px'} detail={hasTransitEvidence ? `P95 ${compact(activeEvidence.centroid_offset_pixels.p95)} px` : 'mức nền baseline'} />
        <Metric label="Variability peak · P50" observed={`${compact(activeEvidence.variability_peak_percent.p50)}%`} detail="fraction in strongest pixel" />
        <Metric label="Transit deficit · P50" observed={hasTransitEvidence ? compact(activeEvidence.transit_deficit_sum.p50) : '0'} detail="summed relative flux" />
      </div>

      <section className="border border-border/70 bg-background/40">
        <div className="border-b border-border/60 px-3 py-2">
          <p className="font-medium">Spatial transit-evidence availability</p>
          <p className="text-[10px] text-muted-foreground">Unavailable thường phản ánh thiếu BLS ephemeris hoặc thiếu cadence trong/ngoài transit; không đồng nghĩa TPF processing failed.</p>
        </div>
        <div className="h-[180px] p-3">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={availability} layout="vertical" margin={{ top: 12, right: 28, bottom: 8, left: 12 }}>
              <CartesianGrid horizontal={false} strokeDasharray="3 3" opacity={0.2} />
              <XAxis type="number" domain={[0, Math.max(activeEvidence.evaluated, 1)]} allowDecimals={false} tick={{ fontSize: 10 }} />
              <YAxis type="category" dataKey="population" width={100} tick={{ fontSize: 10 }} />
              <Tooltip formatter={(item, name) => [`${Number(item).toLocaleString()} TPF`, String(name)]} />
              <Legend />
              <Bar dataKey="available" name="Transit evidence available" stackId="availability" fill="#10b981" isAnimationActive={false} />
              <Bar dataKey="unavailable" name="Evidence unavailable" stackId="availability" fill="#f59e0b" isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </section>

      <section className="border border-border/70 bg-background/40">
        <div className="border-b border-border/60 px-3 py-2">
          <p className="font-medium">Pixel variability concentration</p>
          <p className="text-[10px] text-muted-foreground">Pixel MAD dùng relative-flux units; peak fraction cho biết tỷ trọng variability tập trung ở pixel mạnh nhất.</p>
        </div>
        <div className="h-[290px] p-3">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={variabilityProfile} margin={{ top: 12, right: 20, bottom: 8, left: 4 }}>
              <CartesianGrid vertical={false} strokeDasharray="3 3" opacity={0.2} />
              <XAxis dataKey="quantile" tick={{ fontSize: 10 }} />
              <YAxis yAxisId="mad" width={54} tickFormatter={(item) => compact(Number(item))} tick={{ fontSize: 10 }} label={{ value: 'relative flux', angle: -90, position: 'insideLeft', fontSize: 9 }} />
              <YAxis yAxisId="peak" orientation="right" domain={[0, 100]} width={42} tick={{ fontSize: 10 }} label={{ value: '%', angle: 90, position: 'insideRight', fontSize: 9 }} />
              <Tooltip formatter={(item, name) => [Number(item).toLocaleString(undefined, { maximumFractionDigits: 5 }), String(name)]} />
              <Legend />
              <Area yAxisId="mad" type="monotone" dataKey="pixelMAD" name="Median pixel MAD" stroke="#a855f7" fill="#a855f7" fillOpacity={0.18} isAnimationActive={false} />
              <Line yAxisId="peak" type="monotone" dataKey="peak" name="Strongest-pixel variability · %" stroke="#22d3ee" strokeWidth={2.2} dot={{ r: 3 }} isAnimationActive={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </section>

      <div className="grid gap-3 xl:grid-cols-2">
        <section className="border border-border/70 bg-background/40">
          <div className="border-b border-border/60 px-3 py-2">
            <p className="font-medium">Transit-deficit centroid offset</p>
            <p className="text-[10px] text-muted-foreground">Khoảng cách từ centroid của deficit map tới tâm hình học của TPF cutout.</p>
          </div>
          <div className="h-[280px] p-3">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={activeEvidence.centroid_offset_histogram} margin={{ top: 12, right: 12, bottom: 8, left: 4 }}>
                <CartesianGrid vertical={false} strokeDasharray="3 3" opacity={0.2} />
                <XAxis dataKey="label" tick={{ fontSize: 10 }} />
                <YAxis allowDecimals={false} width={42} tick={{ fontSize: 10 }} />
                <Tooltip formatter={(item) => [`${Number(item).toLocaleString()} targets`, 'Spatial evidence']} />
                <Bar dataKey="count" name="Spatial evidence" fill="#22d3ee" isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>

        <section className="border border-border/70 bg-background/40">
          <div className="border-b border-border/60 px-3 py-2">
            <p className="font-medium">Transit localization quantile profile</p>
            <p className="text-[10px] text-muted-foreground">Offset dùng trục trái (pixel); summed positive deficit dùng trục phải (relative flux).</p>
          </div>
          <div className="h-[280px] p-3">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={transitProfile} margin={{ top: 12, right: 20, bottom: 8, left: 4 }}>
                <CartesianGrid vertical={false} strokeDasharray="3 3" opacity={0.2} />
                <XAxis dataKey="quantile" tick={{ fontSize: 10 }} />
                <YAxis yAxisId="offset" width={42} tick={{ fontSize: 10 }} label={{ value: 'pixels', angle: -90, position: 'insideLeft', fontSize: 9 }} />
                <YAxis yAxisId="deficit" orientation="right" width={52} tickFormatter={(item) => compact(Number(item))} tick={{ fontSize: 10 }} label={{ value: 'deficit', angle: 90, position: 'insideRight', fontSize: 9 }} />
                <Tooltip formatter={(item, name) => [Number(item).toLocaleString(undefined, { maximumFractionDigits: 5 }), String(name)]} />
                <Legend />
                <Line yAxisId="offset" type="monotone" dataKey="offset" name="Centroid offset · px" stroke="#f97316" strokeWidth={2.2} dot={{ r: 3 }} isAnimationActive={false} />
                <Line yAxisId="deficit" type="monotone" dataKey="deficit" name="Positive deficit sum" stroke="#10b981" strokeWidth={2.2} dot={{ r: 3 }} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </section>
      </div>

      <div className="border-l-2 border-primary/50 bg-background/40 px-3 py-2 text-[11px] text-muted-foreground">
        Offset nhỏ hỗ trợ giả thuyết tín hiệu nằm gần tâm cutout; offset lớn là dấu hiệu cần kiểm tra nguồn lân cận, không tự động kết luận contamination.
      </div>
    </div>
  );
}

function Metric({ label, observed, detail, warning = false }: { label: string; observed: string; detail: string; warning?: boolean }): JSX.Element {
  return <div className="min-w-0 bg-background p-3"><p className="truncate text-[9px] uppercase tracking-wide text-muted-foreground" title={label}>{label}</p><p className={`mt-1 truncate font-mono text-sm font-semibold tabular-nums ${warning ? 'text-amber-600 dark:text-amber-400' : ''}`}>{observed}</p><p className="mt-0.5 truncate font-mono text-[9px] text-muted-foreground" title={detail}>{detail}</p></div>;
}
