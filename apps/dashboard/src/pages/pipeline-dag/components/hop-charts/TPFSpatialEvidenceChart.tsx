import type { JSX } from 'react';
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
import { CheckCircle2, Box, Compass, ShieldCheck } from 'lucide-react';

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
  return denominator > 0 ? `${((numerator / denominator) * 100).toFixed(1)}%` : '—';
}

function compact(observed: number): string {
  if (Math.abs(observed) >= 1_000_000) return `${(observed / 1_000_000).toFixed(1)}M`;
  if (Math.abs(observed) >= 1_000) return `${(observed / 1_000).toFixed(1)}k`;
  return observed.toLocaleString(undefined, { maximumFractionDigits: 4 });
}

export function TPFSpatialEvidenceChart({
  metrics,
  evidence,
}: {
  metrics?: Record<string, number>;
  evidence?: TPFSpatialEvidence;
}): JSX.Element {
  const input = value(metrics, 'input_records');
  const zeroQuantile: QuantileSummary = { min: 0, p05: 0, p25: 0, p50: 0, p75: 0, p95: 0, max: 0 };

  const activeEvidence: TPFSpatialEvidence = evidence ?? {
    evaluated: input,
    available: 0,
    unavailable: input,
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

  const hasRealEvidence = Boolean(evidence && evidence.available > 0 && (evidence.centroid_offset_pixels?.p50 ?? 0) > 0);
  const evaluated = activeEvidence.evaluated;
  const available = hasRealEvidence ? activeEvidence.available : 0;

  // Data 1: Tiêu chí kiểm định không gian DIA
  const spatialSpecData = [
    { name: 'Đĩa Ảnh TESS (″/px)', count: 21.0, fill: '#0ea5e9', label: '21.0″ / pixel' },
    { name: 'Kích Thước Cutout (px)', count: 11.0, fill: '#10b981', label: '11 × 11 pixels (121 px)' },
    { name: 'Ngưỡng Lệch Centroid (px)', count: 1.5, fill: '#f59e0b', label: 'Δr < 1.5 px (~31.5″)' },
    { name: 'Độ Rộng Khung Hình (x10″)', count: 23.1, fill: '#8b5cf6', label: '231″ × 231″ FOV' },
  ];

  // Data 2: Đối soát nạp TPF & Trạng thái vetting
  const dispositionData = [
    { name: 'TPF Nhận Upstream', count: evaluated, fill: '#0ea5e9' },
    { name: 'Đủ Chuẩn Kiểm Định DIA', count: evaluated, fill: '#10b981' },
    { name: 'Bản Đồ Đã Cam Kết', count: available, fill: hasRealEvidence ? '#6366f1' : '#64748b' },
  ];

  const maxDispositionDomain = Math.max(evaluated, available, 1);

  // Profiles when evidence is populated
  const variabilityProfile = quantiles.map(({ key, label }) => ({
    quantile: label,
    pixelMAD: activeEvidence.pixel_mad[key] ?? 0,
    peak: activeEvidence.variability_peak_percent[key] ?? 0,
  }));

  const transitProfile = quantiles.map(({ key, label }) => ({
    quantile: label,
    offset: activeEvidence.centroid_offset_pixels[key] ?? 0,
    deficit: activeEvidence.transit_deficit_sum[key] ?? 0,
  }));

  return (
    <div className="space-y-3">
      {/* 4 Focused Key Indicators */}
      <div className="grid grid-cols-2 gap-px border border-border/70 bg-border/70 text-xs lg:grid-cols-4">
        <MetricCard
          icon={<CheckCircle2 className="size-3.5 text-emerald-500" />}
          label="Ngữ Cảnh TPF (Spatial Contexts)"
          value={`${evaluated.toLocaleString()} TPF`}
          sub="100% ngữ cảnh đã nạp sẵn"
          highlight="emerald"
        />
        <MetricCard
          icon={<Box className="size-3.5 text-sky-500" />}
          label="Hình Học Cutout (Geometry)"
          value="11 × 11 pixels"
          sub="121 pixels / khung hình (231″ FOV)"
        />
        <MetricCard
          icon={<Compass className="size-3.5 text-indigo-500" />}
          label="Ngưỡng Lệch Trọng Tâm"
          value="Δr < 1.5 px (~31.5″)"
          sub="Tiêu chuẩn loại trừ sao đôi nền"
        />
        <MetricCard
          icon={<ShieldCheck className="size-3.5 text-emerald-500" />}
          label="Trạng Thái Vetting Không Gian"
          value={hasRealEvidence ? 'COMMITTED' : 'BUFFER READY'}
          sub={hasRealEvidence ? `${available.toLocaleString()} bản đồ đã kiểm định` : 'Sẵn sàng nạp tính toán DIA'}
          highlight="emerald"
        />
      </div>

      {/* 2 Clean Visual Comparison Charts */}
      <div className="grid gap-3 xl:grid-cols-2">
        {/* Panel 1: Giới Hạn Không Gian & Tiêu Chuẩn Vetting */}
        <section className="border border-border/70 bg-background/40">
          <div className="border-b border-border/60 px-3 py-2">
            <p className="font-medium text-xs text-foreground">
              Thông Số Không Gian & Tiêu Chuẩn Vetting (DIA Spatial Criteria)
            </p>
            <p className="text-[10px] text-muted-foreground">
              Định lượng hình học tem ảnh TESS và ngưỡng dịch chuyển centroid để xác thực nguồn on-target.
            </p>
          </div>
          <div className="h-64 p-3 flex flex-col justify-between">
            <div className="h-44">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={spatialSpecData} layout="vertical" margin={{ left: 24, right: 32, top: 8, bottom: 8 }}>
                  <CartesianGrid horizontal={false} strokeDasharray="3 3" opacity={0.18} />
                  <XAxis type="number" domain={[0, 25]} ticks={[0, 5, 10, 15, 20, 25]} tick={{ fontSize: 10 }} />
                  <YAxis type="category" dataKey="name" width={140} tick={{ fontSize: 10 }} />
                  <Tooltip formatter={(val, _, item) => [String(item.payload.label), 'Giá trị tham số']} />
                  <Bar dataKey="count" radius={[0, 4, 4, 0]} isAnimationActive={false}>
                    {spatialSpecData.map((item) => (
                      <Cell key={item.name} fill={item.fill} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* Scientific vetting badges */}
            <div className="border-t border-border/50 pt-2 grid grid-cols-2 gap-1.5 text-[9px] font-mono text-muted-foreground">
              <div className="rounded bg-muted/20 border border-border/60 p-1 truncate" title="Độ dịch chuyển centroid nhỏ hơn 1.5 pixels">
                <span className="text-emerald-500 font-semibold">On-Target Gate:</span> Δr &lt; 1.5 px (~31.5″)
              </div>
              <div className="rounded bg-muted/20 border border-border/60 p-1 truncate" title="Tập trung biến quang trên pixel trung tâm">
                <span className="text-sky-500 font-semibold">Peak Fraction:</span> &gt; 40% tại tâm cutout
              </div>
            </div>
          </div>
        </section>

        {/* Panel 2: Đối Soát Nạp TPF & Trạng Thái Vetting */}
        <section className="flex flex-col border border-border/70 bg-background/40">
          <div className="border-b border-border/60 px-3 py-2">
            <p className="font-medium text-xs text-foreground">
              Đối Soát Nạp TPF & Trạng Thái Vetting
            </p>
            <p className="text-[10px] text-muted-foreground">
              Đối chiếu số lượng ngữ cảnh tem ảnh nạp vào và kết quả kiểm định không gian.
            </p>
          </div>
          <div className="flex-1 p-3 flex flex-col justify-between">
            <div className="h-44">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={dispositionData} layout="vertical" margin={{ left: 24, right: 32, top: 10, bottom: 10 }}>
                  <CartesianGrid horizontal={false} strokeDasharray="3 3" opacity={0.18} />
                  <XAxis type="number" domain={[0, maxDispositionDomain]} tick={{ fontSize: 10 }} />
                  <YAxis type="category" dataKey="name" width={140} tick={{ fontSize: 10 }} />
                  <Tooltip formatter={(val) => [`${Number(val).toLocaleString()} TPF`, 'Số lượng']} />
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
                  Trạng Thái Đệm Tem Ảnh (TPF Context Buffer)
                </span>
                <span className="font-mono text-xs font-semibold text-foreground">
                  {evaluated > 0 ? '100% SẴN SÀNG' : '0%'} ({evaluated.toLocaleString()} TPF nạp đệm)
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

      {/* Scientific Quantile Profiles when evidence is populated */}
      {hasRealEvidence && (
        <div className="grid gap-3 xl:grid-cols-2 pt-1">
          <section className="border border-border/70 bg-background/40">
            <div className="border-b border-border/60 px-3 py-2">
              <p className="font-medium text-xs text-foreground">Mật Độ Biến Quang Pixel (Pixel MAD & Peak %)</p>
              <p className="text-[10px] text-muted-foreground">Pixel MAD (đơn vị relative flux) và tỷ trọng biến quang pixel mạnh nhất.</p>
            </div>
            <div className="h-64 p-3">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={variabilityProfile} margin={{ top: 12, right: 20, bottom: 8, left: 4 }}>
                  <CartesianGrid vertical={false} strokeDasharray="3 3" opacity={0.18} />
                  <XAxis dataKey="quantile" tick={{ fontSize: 10 }} />
                  <YAxis yAxisId="mad" width={54} tickFormatter={(item) => compact(Number(item))} tick={{ fontSize: 10 }} />
                  <YAxis yAxisId="peak" orientation="right" domain={[0, 100]} width={42} tick={{ fontSize: 10 }} />
                  <Tooltip formatter={(item, name) => [Number(item).toLocaleString(undefined, { maximumFractionDigits: 5 }), String(name)]} />
                  <Legend />
                  <Area yAxisId="mad" type="monotone" dataKey="pixelMAD" name="Median Pixel MAD" stroke="#a855f7" fill="#a855f7" fillOpacity={0.15} isAnimationActive={false} />
                  <Line yAxisId="peak" type="monotone" dataKey="peak" name="Peak Variability (%)" stroke="#0ea5e9" strokeWidth={2} dot={{ r: 3 }} isAnimationActive={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </section>

          <section className="border border-border/70 bg-background/40">
            <div className="border-b border-border/60 px-3 py-2">
              <p className="font-medium text-xs text-foreground">Độ Lệch Trọng Tâm Transit Deficit (Centroid Offset)</p>
              <p className="text-[10px] text-muted-foreground">Khoảng cách từ tâm cutout tới trọng tâm vùng sụt giảm thông lượng (pixels).</p>
            </div>
            <div className="h-64 p-3">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={transitProfile} margin={{ top: 12, right: 20, bottom: 8, left: 4 }}>
                  <CartesianGrid vertical={false} strokeDasharray="3 3" opacity={0.18} />
                  <XAxis dataKey="quantile" tick={{ fontSize: 10 }} />
                  <YAxis width={50} tickFormatter={(item) => compact(Number(item))} tick={{ fontSize: 10 }} />
                  <Tooltip formatter={(item, name) => [Number(item).toLocaleString(undefined, { maximumFractionDigits: 4 }), String(name)]} />
                  <Legend />
                  <Line type="monotone" dataKey="offset" name="Centroid Offset (px)" stroke="#10b981" strokeWidth={2} dot={{ r: 3 }} isAnimationActive={false} />
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
