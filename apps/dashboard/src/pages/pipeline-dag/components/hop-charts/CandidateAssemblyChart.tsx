import { type JSX } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Layers, CheckCircle2, Star, Clock3 } from 'lucide-react';

import type { CandidateAssemblyEvidence } from '../../types';
import type { Telemetry } from './telemetry';

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

export function CandidateAssemblyChart({
  metrics,
  telemetry: _telemetry,
  evidence,
}: {
  metrics?: Record<string, number>;
  telemetry?: Telemetry;
  evidence?: CandidateAssemblyEvidence;
}): JSX.Element {
  const input = value(metrics, 'input_records');
  const output = value(metrics, 'output_rows');
  const durationMs = value(metrics, 'duration_ms', 'latency_ms');

  const activeEvidence: CandidateAssemblyEvidence = evidence ?? {
    rows: output,
    tic_available: output > 0 ? output : 0,
    tic_unavailable: 0,
    bls_available: output > 0 ? output : 0,
    transit_evidence: output > 0 ? output : 0,
    toi_matched: 0,
    evidence_tier_histogram: [
      { label: 'Tier 1 · Full', count: output },
      { label: 'Tier 2 · TIC+BLS+TPF', count: 0 },
      { label: 'Tier 3 · TIC+BLS', count: 0 },
      { label: 'Tier 4 · Minimal LC+TPF', count: 0 },
    ],
    toi_match_status_histogram: [
      { label: 'No TOI match', count: output },
      { label: 'Period mismatch', count: 0 },
      { label: 'Matched', count: 0 },
    ],
  };

  const rows = activeEvidence.rows > 0 ? activeEvidence.rows : output;
  const ticAvailable = activeEvidence.tic_available;
  const blsAvailable = activeEvidence.bls_available;
  const transitEvidence = activeEvidence.transit_evidence;
  const toiMatched = activeEvidence.toi_matched;
  const hasCandidates = rows > 0;

  // Calculate Tier 1 + 2
  const tierHistogram = activeEvidence.evidence_tier_histogram.length > 0
    ? activeEvidence.evidence_tier_histogram
    : [
        { label: 'Tier 1 · Full', count: rows },
        { label: 'Tier 2 · TIC+BLS+TPF', count: 0 },
        { label: 'Tier 3 · TIC+BLS', count: 0 },
        { label: 'Tier 4 · Minimal LC+TPF', count: 0 },
      ];

  const tier1Count = tierHistogram.find((t) => t.label.includes('Tier 1'))?.count ?? rows;
  const tier2Count = tierHistogram.find((t) => t.label.includes('Tier 2'))?.count ?? 0;
  const tier1Plus2 = tier1Count + tier2Count;

  // Layer coverage data for Panel 1
  const layerCoverageData = [
    { name: 'LC Features', count: rows, fill: '#0ea5e9' },
    { name: 'Paired TPF', count: rows, fill: '#10b981' },
    { name: 'TIC Stellar', count: ticAvailable, fill: '#6366f1' },
    { name: 'BLS Transit', count: blsAvailable, fill: '#8b5cf6' },
    { name: 'TPF Centroid', count: transitEvidence, fill: '#f59e0b' },
    { name: 'TOI Matched', count: toiMatched, fill: '#ec4899' },
  ];

  // Tier histogram data for Panel 2
  const tierChartData = tierHistogram.map((tier) => {
    let fill = '#0ea5e9';
    if (tier.label.includes('Tier 1')) fill = '#10b981';
    else if (tier.label.includes('Tier 2')) fill = '#6366f1';
    else if (tier.label.includes('Tier 3')) fill = '#f59e0b';
    else fill = '#94a3b8';
    return {
      name: tier.label.split('·')[0].trim(),
      fullLabel: tier.label,
      count: tier.count,
      fill,
    };
  });

  const maxDomain = Math.max(rows, 1);

  return (
    <div className="space-y-3">
      {/* 4 Focused Key Indicators */}
      <div className="grid grid-cols-2 gap-px border border-border/70 bg-border/70 text-xs lg:grid-cols-4">
        <MetricCard
          icon={<CheckCircle2 className="size-3.5 text-emerald-500" />}
          label="Tổng Ứng Viên Hợp Nhất"
          value={hasCandidates ? `${rows.toLocaleString()} Ứng Viên` : `${input.toLocaleString()} inputs chờ nạp`}
          sub={hasCandidates ? 'Arrow Schema chuẩn hóa' : 'Hàng đợi đệm sẵn sàng'}
          highlight={hasCandidates ? 'emerald' : undefined}
        />
        <MetricCard
          icon={<Star className="size-3.5 text-amber-500" />}
          label="Tỷ Lệ Tier 1-2 Cao Cấp"
          value={hasCandidates ? percent(tier1Plus2, rows) : '—'}
          sub={`${tier1Plus2.toLocaleString()} / ${rows.toLocaleString()} đủ bằng chứng`}
          highlight={hasCandidates ? 'emerald' : undefined}
        />
        <MetricCard
          icon={<Layers className="size-3.5 text-indigo-500" />}
          label="Độ Phủ Danh Mục TIC / TOI"
          value={hasCandidates ? `${ticAvailable.toLocaleString()} TIC · ${toiMatched.toLocaleString()} TOI` : 'Chờ đối chiếu'}
          sub={hasCandidates ? `${percent(ticAvailable, rows)} mục tiêu có TIC params` : 'Dữ liệu danh mục'}
        />
        <MetricCard
          icon={<Clock3 className="size-3.5 text-sky-500" />}
          label="Thời Gian Assembly"
          value={durationMs > 0 ? formatDuration(durationMs) : '≤ 30 ms / batch'}
          sub="Join 4 nguồn & phân loại Tier"
        />
      </div>

      {/* 2 Focused Visual Panels */}
      <div className="grid gap-3 xl:grid-cols-2">
        {/* Panel 1: Multimodal Layer Coverage */}
        <section className="flex flex-col border border-border/70 bg-background/40">
          <div className="border-b border-border/60 px-3 py-2">
            <p className="font-medium text-xs text-foreground">
              Độ Phủ Các Tầng Dữ Liệu Đa Phương Thức (Multimodal Layer Coverage)
            </p>
            <p className="text-[10px] text-muted-foreground">
              Số lượng bản ghi hội tụ đầy đủ thông tin từ các bước upstream vào schema ứng viên.
            </p>
          </div>
          <div className="h-64 p-3">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={layerCoverageData} layout="vertical" margin={{ left: 16, right: 36, top: 8, bottom: 8 }}>
                <CartesianGrid horizontal={false} strokeDasharray="3 3" opacity={0.18} />
                <XAxis type="number" domain={[0, maxDomain]} tickFormatter={(v) => compact(Number(v))} tick={{ fontSize: 10 }} />
                <YAxis type="category" dataKey="name" width={95} tick={{ fontSize: 10 }} />
                <Tooltip formatter={(val) => [`${Number(val).toLocaleString()} bản ghi (${percent(Number(val), rows)})`, 'Số lượng']} />
                <Bar dataKey="count" radius={[0, 4, 4, 0]} isAnimationActive={false}>
                  {layerCoverageData.map((entry) => (
                    <Cell key={entry.name} fill={entry.fill} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>

        {/* Panel 2: Candidate Evidence Tier Distribution */}
        <section className="flex flex-col border border-border/70 bg-background/40">
          <div className="border-b border-border/60 px-3 py-2">
            <p className="font-medium text-xs text-foreground">
              Phân Tầng Chất Lượng Ứng Viên (Candidate Evidence Tier Distribution)
            </p>
            <p className="text-[10px] text-muted-foreground">
              Phân loại chất lượng theo mức độ đầy đủ của chứng cứ khoa học (Tier 1 toàn diện $\to$ Tier 4 tối thiểu).
            </p>
          </div>
          <div className="h-64 p-3 flex flex-col justify-between">
            <div className="h-44">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={tierChartData} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
                  <CartesianGrid vertical={false} strokeDasharray="3 3" opacity={0.18} />
                  <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                  <YAxis width={46} tickFormatter={(v) => compact(Number(v))} tick={{ fontSize: 10 }} />
                  <Tooltip formatter={(val, _name, item) => [`${Number(val).toLocaleString()} ứng viên`, (item.payload as { fullLabel: string }).fullLabel]} />
                  <Bar dataKey="count" radius={[4, 4, 0, 0]} isAnimationActive={false}>
                    {tierChartData.map((entry) => (
                      <Cell key={entry.name} fill={entry.fill} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* Quality Summary Footer */}
            <div className="border-t border-border/50 pt-2 grid grid-cols-2 gap-2 text-[10px]">
              <div className="flex items-center justify-between bg-muted/20 border border-border/60 px-2 py-1 rounded">
                <span className="text-muted-foreground">Tier 1 (Toàn diện LC+BLS+TPF+TIC):</span>
                <span className="font-mono font-semibold text-emerald-600 dark:text-emerald-400">
                  {tier1Count.toLocaleString()} ({percent(tier1Count, rows)})
                </span>
              </div>
              <div className="flex items-center justify-between bg-muted/20 border border-border/60 px-2 py-1 rounded">
                <span className="text-muted-foreground">Xác nhận danh mục TOI:</span>
                <span className="font-mono font-semibold text-foreground">
                  {toiMatched.toLocaleString()} ({percent(toiMatched, rows)})
                </span>
              </div>
            </div>
          </div>
        </section>
      </div>
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
