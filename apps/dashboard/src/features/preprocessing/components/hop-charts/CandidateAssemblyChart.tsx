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

import type { CandidateAssemblyEvidence } from '@/features/factory-history/types';

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
  if (!evidence) {
    return <section className={`border border-dashed px-5 py-12 text-center ${output > 0 ? 'border-red-500/60 bg-red-500/5' : 'border-border/70 bg-background/40'}`}>
      <p className="font-mono text-sm font-semibold uppercase">{output > 0 ? 'Candidate assembly mismatch' : 'Candidate assembly not executed'}</p>
      <p className="mx-auto mt-2 max-w-2xl text-[11px] leading-5 text-muted-foreground">
        {output > 0
          ? `Run ledger reports ${output.toLocaleString()} candidate rows, but no candidate evidence was found in its committed snapshots. No coverage chart is synthesized.`
          : `${input.toLocaleString()} upstream evidence records are visible, but G06 has no committed candidate rows in this view.`}
      </p>
    </section>;
  }

  const rows = evidence.rows;
  const pairedInputExpectation = rows * 2;
  const assemblyCoverage = input > 0 ? Math.min(100, pairedInputExpectation / input * 100) : 0;
  const layerCoverage = [
    { layer: 'LC feature row', present: rows, absent: 0 },
    { layer: 'Paired TPF', present: rows, absent: 0 },
    { layer: 'TIC context', present: evidence.tic_available, absent: evidence.tic_unavailable },
    { layer: 'BLS evidence', present: evidence.bls_available, absent: Math.max(0, rows - evidence.bls_available) },
    { layer: 'Spatial transit', present: evidence.transit_evidence, absent: Math.max(0, rows - evidence.transit_evidence) },
    { layer: 'TOI association', present: evidence.toi_matched, absent: Math.max(0, rows - evidence.toi_matched) },
  ];
  const toiStatuses = evidence.toi_match_status_histogram.filter((item) => item.count > 0);

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-px border border-border/70 bg-border/70 text-xs lg:grid-cols-3 2xl:grid-cols-6">
        <Metric label="Candidate rows" observed={rows.toLocaleString()} detail="canonical assembled rows" />
        <Metric label="Assembly coverage" observed={input > 0 ? `${assemblyCoverage.toFixed(2)}%` : '—'} detail={`${pairedInputExpectation.toLocaleString()} LC + TPF records represented`} />
        <Metric label="TIC context" observed={percent(evidence.tic_available, rows)} detail={`${evidence.tic_available.toLocaleString()} rows`} warning={evidence.tic_unavailable > 0} />
        <Metric label="BLS evidence" observed={percent(evidence.bls_available, rows)} detail={`${evidence.bls_available.toLocaleString()} rows`} />
        <Metric label="Spatial evidence" observed={percent(evidence.transit_evidence, rows)} detail={`${evidence.transit_evidence.toLocaleString()} rows`} />
        <Metric label="TOI associated" observed={percent(evidence.toi_matched, rows)} detail={`${evidence.toi_matched.toLocaleString()} rows · optional`} />
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
              <BarChart data={evidence.evidence_tier_histogram} layout="vertical" margin={{ top: 12, right: 20, bottom: 8, left: 12 }}>
                <CartesianGrid horizontal={false} strokeDasharray="3 3" opacity={0.2} />
                <XAxis type="number" allowDecimals={false} tick={{ fontSize: 10 }} />
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
          {toiStatuses.length > 0 ? <div className="h-[300px] p-3">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={toiStatuses} layout="vertical" margin={{ top: 12, right: 20, bottom: 8, left: 12 }}>
                <CartesianGrid horizontal={false} strokeDasharray="3 3" opacity={0.2} />
                <XAxis type="number" allowDecimals={false} tick={{ fontSize: 10 }} />
                <YAxis type="category" dataKey="label" width={125} tick={{ fontSize: 10 }} />
                <Tooltip formatter={(item) => [`${Number(item).toLocaleString()} candidates`, 'Rows']} />
                <Bar dataKey="count" name="Candidate rows" fill="#a855f7" isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          </div> : <div className="flex h-[300px] items-center justify-center p-6 text-center text-[11px] text-muted-foreground">Không có TOI match status trong snapshot.</div>}
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
