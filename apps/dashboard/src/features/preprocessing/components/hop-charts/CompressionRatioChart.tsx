import { type JSX } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import type { Hop } from '../../types';

const gigabyte = 1_000_000_000;

function metric(metrics: Record<string, number> | undefined, key: string): number {
  return Math.max(0, Number(metrics?.[key] ?? 0));
}

export function CompressionRatioChart({
  mode = 'batch',
  metrics,
  scope = 'bronze-silver',
  materializationPoints = [],
}: {
  mode?: 'stream' | 'batch';
  metrics?: Record<string, number>;
  scope?: 'bronze-silver' | 'gold';
  totalFiles?: number;
  materializationPoints?: Hop['materialization_points'];
}): JSX.Element {
  const inventoryObserved = metric(metrics, 'inventory_observed') === 1;
  const bronzeBytes = metric(metrics, 'bronze_bytes');
  const silverBytes = metric(metrics, 'silver_bytes');
  const goldBytes = metric(metrics, 'gold_bytes');
  const bronzeObjects = metric(metrics, 'bronze_objects');
  const silverObjects = metric(metrics, 'silver_objects');
  const goldObjects = metric(metrics, 'gold_objects');

  if (!inventoryObserved) {
    return <div className="border border-dashed border-border/70 bg-background/40 p-6 text-center text-xs text-muted-foreground">Chưa có MinIO inventory snapshot để thực hiện byte accounting.</div>;
  }
  if (scope === 'gold') {
    return <GoldFootprint bytes={goldBytes} objects={goldObjects} />;
  }

  const savedBytes = bronzeBytes - silverBytes;
  const reduction = bronzeBytes > 0 ? savedBytes / bronzeBytes : 0;
  const compressionFactor = silverBytes > 0 ? bronzeBytes / silverBytes : 0;
  const observed = materializationPoints.filter((point) => point.source_bytes > 0 && point.size_bytes > 0);
  const lightCurve = summarize(observed, 'lightcurve', 'Light Curve');
  const targetPixel = summarize(observed, 'target_pixel', 'Target Pixel');
  const total = {
    kind: 'Total',
    sourceBytes: bronzeBytes,
    outputBytes: silverBytes,
    savedBytes,
    objects: silverObjects,
  };
  const classes = [lightCurve, targetPixel].filter((item) => item.objects > 0);
  const comparison = [...classes, total].map((item) => ({
    kind: item.kind,
    bronzeGB: item.sourceBytes / gigabyte,
    silverGB: item.outputBytes / gigabyte,
  }));
  const disposition = [...classes, total].map((item) => ({
    kind: item.kind,
    storedGB: item.outputBytes / gigabyte,
    savedGB: Math.max(0, item.savedBytes) / gigabyte,
  }));
  const savingContribution = classes
    .filter((item) => item.savedBytes > 0)
    .map((item, index) => ({ name: item.kind, value: item.savedBytes / gigabyte, fill: index === 0 ? '#22d3ee' : '#a855f7' }));
  const coverage = silverObjects > 0 ? observed.length / silverObjects : 0;

  return <div className="space-y-3">
    <div className="grid gap-px border border-border/70 bg-border/70 sm:grid-cols-3 xl:grid-cols-6">
      <Metric label="Bronze input" value={formatGB(bronzeBytes)} detail={`${bronzeObjects.toLocaleString()} FITS objects`} />
      <Metric label="Silver output" value={formatGB(silverBytes)} detail={`${silverObjects.toLocaleString()} Parquet objects`} />
      <Metric label="Storage saved" value={formatSignedGB(savedBytes)} detail="Bronze − Silver" tone={savedBytes >= 0 ? 'positive' : 'warning'} />
      <Metric label="Reduction" value={formatPercent(reduction)} detail="saved / Bronze" tone={reduction >= 0 ? 'positive' : 'warning'} />
      <Metric label="Compression factor" value={compressionFactor > 0 ? `${compressionFactor.toFixed(2)}×` : '—'} detail="Bronze / Silver" />
      <Metric label="Accounting coverage" value={formatPercent(coverage)} detail={`${observed.length.toLocaleString()} linked artifacts`} />
    </div>

    <div className="border border-primary/30 bg-primary/5 px-4 py-3">
      <p className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">Direct answer · {mode === 'batch' ? 'batch snapshot' : 'stream snapshot'}</p>
      <p className="mt-1 text-sm text-foreground">
        Silver đang dùng ít hơn Bronze <strong className="font-mono text-emerald-600 dark:text-emerald-300">{formatSignedGB(savedBytes)}</strong>,
        từ <strong className="font-mono">{formatGB(bronzeBytes)}</strong> xuống <strong className="font-mono">{formatGB(silverBytes)}</strong>
        {' '}({formatPercent(reduction)} reduction).
      </p>
    </div>

    <div className="grid gap-3 xl:grid-cols-2">
      <ChartPanel title="Stored footprint by product class" subtitle="So sánh byte nguồn FITS và byte Parquet thực tế; không lấy dữ liệu giải nén trong RAM.">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={comparison} margin={{ left: 2, right: 12, top: 8, bottom: 8 }}>
            <CartesianGrid vertical={false} strokeDasharray="3 3" opacity={0.18} />
            <XAxis dataKey="kind" tick={{ fontSize: 10 }} />
            <YAxis tickFormatter={(value) => `${Number(value).toFixed(1)} GB`} tick={{ fontSize: 9 }} width={58} />
            <Tooltip formatter={(value) => `${Number(value).toFixed(3)} GB`} />
            <Legend wrapperStyle={{ fontSize: 10 }} />
            <Bar dataKey="bronzeGB" name="Bronze FITS" fill="#64748b" isAnimationActive={false} />
            <Bar dataKey="silverGB" name="Silver Parquet" fill="#10b981" isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </ChartPanel>

      <ChartPanel title="Byte disposition after preprocessing" subtitle="Mỗi thanh tách phần byte còn lưu trong Silver và phần dung lượng đã loại bỏ nhờ biểu diễn Parquet/ZSTD.">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={disposition} layout="vertical" margin={{ left: 18, right: 16, top: 8, bottom: 8 }}>
            <CartesianGrid horizontal={false} strokeDasharray="3 3" opacity={0.18} />
            <XAxis type="number" tickFormatter={(value) => `${Number(value).toFixed(1)} GB`} tick={{ fontSize: 9 }} />
            <YAxis type="category" dataKey="kind" width={82} tick={{ fontSize: 9 }} />
            <Tooltip formatter={(value) => `${Number(value).toFixed(3)} GB`} />
            <Legend wrapperStyle={{ fontSize: 10 }} />
            <Bar dataKey="storedGB" name="Stored as Silver" stackId="bytes" fill="#10b981" isAnimationActive={false} />
            <Bar dataKey="savedGB" name="Storage saved" stackId="bytes" fill="#38bdf8" isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </ChartPanel>
    </div>

    <div className="grid gap-3 xl:grid-cols-[0.7fr_1.3fr]">
      <ChartPanel title="Contribution to total saving" subtitle="LC và TPF đóng góp bao nhiêu GB vào tổng dung lượng tiết kiệm.">
        {savingContribution.length > 0 ? <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={savingContribution} dataKey="value" nameKey="name" innerRadius={48} outerRadius={82} paddingAngle={2} stroke="none" isAnimationActive={false}>
              {savingContribution.map((item) => <Cell key={item.name} fill={item.fill} />)}
            </Pie>
            <Tooltip formatter={(value) => `${Number(value).toFixed(3)} GB saved`} />
            <Legend wrapperStyle={{ fontSize: 10 }} />
          </PieChart>
        </ResponsiveContainer> : <div className="flex h-full items-center justify-center text-xs text-muted-foreground">Không có positive storage saving.</div>}
      </ChartPanel>

      <section className="border border-border/70 bg-background/40">
        <div className="border-b border-border/60 px-3 py-2"><p className="font-medium">Attributable byte ledger</p><p className="text-[10px] text-muted-foreground">Tổng hợp trực tiếp từ source_bytes và size_bytes của từng artifact đã nối lineage.</p></div>
        <div className="overflow-x-auto p-3">
          <table className="w-full min-w-[560px] text-left text-[10px]">
            <thead className="border-b border-border/70 uppercase tracking-wide text-muted-foreground"><tr><th className="px-2 py-2">Product</th><th className="px-2 py-2 text-right">Objects</th><th className="px-2 py-2 text-right">Bronze</th><th className="px-2 py-2 text-right">Silver</th><th className="px-2 py-2 text-right">Saved</th><th className="px-2 py-2 text-right">Reduction</th><th className="px-2 py-2 text-right">Factor</th></tr></thead>
            <tbody className="divide-y divide-border/50">{[...classes, total].map((row) => <tr key={row.kind}><td className="px-2 py-2 font-medium">{row.kind}</td><td className="px-2 py-2 text-right font-mono">{row.objects.toLocaleString()}</td><td className="px-2 py-2 text-right font-mono">{formatGB(row.sourceBytes)}</td><td className="px-2 py-2 text-right font-mono">{formatGB(row.outputBytes)}</td><td className="px-2 py-2 text-right font-mono text-emerald-600 dark:text-emerald-300">{formatSignedGB(row.savedBytes)}</td><td className="px-2 py-2 text-right font-mono">{formatPercent(ratio(row.savedBytes, row.sourceBytes))}</td><td className="px-2 py-2 text-right font-mono">{row.outputBytes > 0 ? `${(row.sourceBytes / row.outputBytes).toFixed(2)}×` : '—'}</td></tr>)}</tbody>
          </table>
        </div>
      </section>
    </div>
  </div>;
}

function summarize(points: NonNullable<Hop['materialization_points']>, kind: string, label: string) {
  const selected = points.filter((point) => normalizeKind(point.product_kind) === kind);
  const sourceBytes = selected.reduce((sum, point) => sum + point.source_bytes, 0);
  const outputBytes = selected.reduce((sum, point) => sum + point.size_bytes, 0);
  return { kind: label, sourceBytes, outputBytes, savedBytes: sourceBytes - outputBytes, objects: selected.length };
}

function normalizeKind(kind: string): string {
  const normalized = kind.toLowerCase().replaceAll('-', '_');
  if (normalized === 'light_curve') return 'lightcurve';
  if (normalized === 'targetpixel') return 'target_pixel';
  return normalized;
}

function GoldFootprint({ bytes, objects }: { bytes: number; objects: number }): JSX.Element {
  return <div className="grid gap-px border border-border/70 bg-border/70 sm:grid-cols-2"><Metric label="Gold footprint" value={formatGB(bytes)} detail="MinIO ObjectInfo.Size" /><Metric label="Gold objects" value={objects.toLocaleString()} detail="artifact + manifest" /></div>;
}

function ChartPanel({ title, subtitle, children }: { title: string; subtitle: string; children: JSX.Element }): JSX.Element {
  return <section className="border border-border/70 bg-background/40"><div className="border-b border-border/60 px-3 py-2"><p className="font-medium">{title}</p><p className="text-[10px] text-muted-foreground">{subtitle}</p></div><div className="h-64 p-2">{children}</div></section>;
}

function Metric({ label, value, detail, tone = 'default' }: { label: string; value: string; detail: string; tone?: 'default' | 'positive' | 'warning' }): JSX.Element {
  const color = tone === 'positive' ? 'text-emerald-600 dark:text-emerald-300' : tone === 'warning' ? 'text-amber-600 dark:text-amber-300' : 'text-foreground';
  return <div className="bg-background p-3"><p className="text-[9px] uppercase tracking-wide text-muted-foreground">{label}</p><p className={`mt-1 font-mono text-sm font-semibold ${color}`}>{value}</p><p className="mt-0.5 text-[9px] text-muted-foreground">{detail}</p></div>;
}

function formatGB(bytes: number): string {
  return `${(Math.max(0, bytes) / gigabyte).toFixed(2)} GB`;
}

function formatSignedGB(bytes: number): string {
  const prefix = bytes < 0 ? '−' : '';
  return `${prefix}${(Math.abs(bytes) / gigabyte).toFixed(2)} GB`;
}

function formatPercent(value: number): string {
  return Number.isFinite(value) ? `${(value * 100).toFixed(2)}%` : '—';
}

function ratio(numerator: number, denominator: number): number {
  return denominator > 0 ? numerator / denominator : 0;
}
