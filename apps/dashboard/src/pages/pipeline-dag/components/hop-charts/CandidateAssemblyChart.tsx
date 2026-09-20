import type { JSX } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import type { CandidateAssemblyEvidence } from '../../types';

function value(metrics: Record<string, number> | undefined, key: string): number {
  const observed = metrics?.[key];
  return observed !== undefined && Number.isFinite(observed) ? Math.max(0, observed) : 0;
}

function percent(numerator: number, denominator: number): string {
  return denominator > 0 ? `${(numerator / denominator * 100).toFixed(2)}%` : '—';
}

export function CandidateAssemblyChart({ metrics, evidence }: { metrics?: Record<string, number>; evidence?: CandidateAssemblyEvidence }): JSX.Element {
  const input = value(metrics, 'input_records');
  const output = value(metrics, 'output_rows');
  const isBaseline = !evidence;

  const activeEvidence: CandidateAssemblyEvidence = evidence ?? {
    rows: output,
    tic_available: 0,
    tic_unavailable: 0,
    bls_available: 0,
    transit_evidence: 0,
    toi_matched: 0,
    evidence_tier_histogram: [
      { label: 'Tier 1 · Full', count: 0 },
      { label: 'Tier 2 · TIC+BLS+TPF', count: 0 },
      { label: 'Tier 3 · TIC+BLS', count: 0 },
      { label: 'Tier 4 · Minimal LC+TPF', count: 0 },
    ],
    toi_match_status_histogram: [
      { label: 'No TOI match', count: 0 },
      { label: 'Period mismatch', count: 0 },
      { label: 'Matched', count: 0 },
    ],
  };

  const rows = activeEvidence.rows;
  const pairedInputExpectation = rows * 2;
  const assemblyCoverage = input > 0 ? Math.min(100, (pairedInputExpectation / input) * 100) : 0;
  const layerCoverage = [
    { layer: 'LC feature row', present: rows, absent: 0 },
    { layer: 'Paired TPF', present: rows, absent: 0 },
    { layer: 'TIC context', present: activeEvidence.tic_available, absent: activeEvidence.tic_unavailable },
    { layer: 'BLS evidence', present: activeEvidence.bls_available, absent: Math.max(0, rows - activeEvidence.bls_available) },
    { layer: 'Spatial transit', present: activeEvidence.transit_evidence, absent: Math.max(0, rows - activeEvidence.transit_evidence) },
    { layer: 'TOI association', present: activeEvidence.toi_matched, absent: Math.max(0, rows - activeEvidence.toi_matched) },
  ];
  const toiStatuses = activeEvidence.toi_match_status_histogram.length > 0
    ? activeEvidence.toi_match_status_histogram
    : [{ label: 'No TOI match', count: 0 }, { label: 'Period mismatch', count: 0 }, { label: 'Matched', count: 0 }];

  return (
    <div className="space-y-3">
      {isBaseline && (
        <div className="flex items-center justify-between border border-border/70 bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5 font-medium">
            <span className="size-2 rounded-full bg-amber-500" />
            Khung phân tích cơ sở: G06 chưa có committed candidate evidence (hiển thị mức nền 0).
          </span>
          <span className="font-mono text-[10px] uppercase">
            {input > 0 ? `${input.toLocaleString()} inputs upstream` : 'Sẵn sàng ghi nhận'}
          </span>
        </div>
      )}

      <div className="grid grid-cols-2 gap-px border border-border/70 bg-border/70 text-xs lg:grid-cols-3 2xl:grid-cols-6">
        <Metric label="Candidate rows" observed={rows.toLocaleString()} detail="canonical assembled rows" />
        <Metric label="Assembly coverage" observed={input > 0 ? `${assemblyCoverage.toFixed(2)}%` : '—'} detail={`${pairedInputExpectation.toLocaleString()} LC + TPF records represented`} />
        <Metric label="TIC context" observed={percent(activeEvidence.tic_available, rows)} detail={`${activeEvidence.tic_available.toLocaleString()} rows`} warning={activeEvidence.tic_unavailable > 0} />
        <Metric label="BLS evidence" observed={percent(activeEvidence.bls_available, rows)} detail={`${activeEvidence.bls_available.toLocaleString()} rows`} />
        <Metric label="Spatial evidence" observed={percent(activeEvidence.transit_evidence, rows)} detail={`${activeEvidence.transit_evidence.toLocaleString()} rows`} />
        <Metric label="TOI associated" observed={percent(activeEvidence.toi_matched, rows)} detail={`${activeEvidence.toi_matched.toLocaleString()} rows · optional`} />
      </div>

      <section className="border border-border/70 bg-background/40">
        <div className="border-b border-border/60 px-3 py-2">
          <p className="font-medium">Candidate evidence-layer coverage</p>
          <p className="text-[10px] text-muted-foreground">LC + TPF là assembly contract; BLS, spatial transit và TOI là coverage khoa học, nên phần absent không tự động là lỗi.</p>
        </div>
        <div className="h-[340px] p-3">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={layerCoverage} layout="vertical" margin={{ top: 12, right: 28, bottom: 8, left: 12 }}>
              <CartesianGrid horizontal={false} strokeDasharray="3 3" opacity={0.2} />
              <XAxis type="number" domain={[0, Math.max(rows, 1)]} allowDecimals={false} tick={{ fontSize: 10 }} />
              <YAxis type="category" dataKey="layer" width={105} tick={{ fontSize: 10 }} />
              <Tooltip formatter={(item, name) => [`${Number(item).toLocaleString()} candidates`, String(name)]} />
              <Legend />
              <Bar dataKey="present" name="Evidence present" stackId="coverage" fill="#10b981" isAnimationActive={false} />
              <Bar dataKey="absent" name="Unavailable / no association" stackId="coverage" fill="#cbd5e1" isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </section>

      <div className="grid gap-3 xl:grid-cols-2">
        <section className="border border-border/70 bg-background/40">
          <div className="border-b border-border/60 px-3 py-2">
            <p className="font-medium">Joint evidence tiers</p>
            <p className="text-[10px] text-muted-foreground">Các tier loại trừ nhau và cộng lại bằng candidate rows; TOI được giữ ngoài tier vì là association tùy chọn.</p>
          </div>
          <div className="h-[300px] p-3">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={activeEvidence.evidence_tier_histogram} layout="vertical" margin={{ top: 12, right: 20, bottom: 8, left: 12 }}>
                <CartesianGrid horizontal={false} strokeDasharray="3 3" opacity={0.2} />
                <XAxis type="number" domain={[0, Math.max(rows, 1)]} allowDecimals={false} tick={{ fontSize: 10 }} />
                <YAxis type="category" dataKey="label" width={125} tick={{ fontSize: 10 }} />
                <Tooltip formatter={(item) => [`${Number(item).toLocaleString()} candidates`, 'Rows']} />
                <Bar dataKey="count" name="Candidate rows" fill="#22d3ee" isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>

        <section className="border border-border/70 bg-background/40">
          <div className="border-b border-border/60 px-3 py-2">
            <p className="font-medium">TOI association disposition</p>
            <p className="text-[10px] text-muted-foreground">Phân biệt không có TOI, period mismatch, ambiguous và thiếu BLS; không gộp tất cả thành “unmatched”.</p>
          </div>
          <div className="h-[300px] p-3">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={toiStatuses} layout="vertical" margin={{ top: 12, right: 20, bottom: 8, left: 12 }}>
                <CartesianGrid horizontal={false} strokeDasharray="3 3" opacity={0.2} />
                <XAxis type="number" domain={[0, Math.max(rows, 1)]} allowDecimals={false} tick={{ fontSize: 10 }} />
                <YAxis type="category" dataKey="label" width={125} tick={{ fontSize: 10 }} />
                <Tooltip formatter={(item) => [`${Number(item).toLocaleString()} candidates`, 'Rows']} />
                <Bar dataKey="count" name="Candidate rows" fill="#a855f7" isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>
      </div>

      <div className="border-l-2 border-primary/50 bg-background/40 px-3 py-2 text-[11px] text-muted-foreground">
        Candidate row là container bằng chứng có provenance, không phải phát hiện hành tinh đã xác nhận. Evidence thiếu hoặc TOI không match phải được giữ thành trạng thái phân tích, không bị xoá khỏi tập candidate.
      </div>
    </div>
  );
}

function Metric({ label, observed, detail, warning = false }: { label: string; observed: string; detail: string; warning?: boolean }): JSX.Element {
  return <div className="min-w-0 bg-background p-3"><p className="truncate text-[9px] uppercase tracking-wide text-muted-foreground" title={label}>{label}</p><p className={`mt-1 truncate font-mono text-sm font-semibold tabular-nums ${warning ? 'text-red-600 dark:text-red-400' : ''}`}>{observed}</p><p className="mt-0.5 truncate font-mono text-[9px] text-muted-foreground" title={detail}>{detail}</p></div>;
}
