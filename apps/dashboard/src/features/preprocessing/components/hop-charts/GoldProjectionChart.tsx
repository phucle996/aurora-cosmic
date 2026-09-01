import type { JSX } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import type { GoldProjectionEvidence } from '@/features/factory-history/types';

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
  return observed.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

export function GoldProjectionChart({ metrics, evidence }: { metrics?: Record<string, number>; evidence?: GoldProjectionEvidence }): JSX.Element {
  const input = value(metrics, 'input_records');
  const ledgerIndexed = value(metrics, 'indexed_rows');
  if (!evidence || evidence.snapshot_count === 0) {
    return <section className={`border border-dashed px-5 py-12 text-center ${ledgerIndexed > 0 ? 'border-red-500/60 bg-red-500/5' : 'border-border/70 bg-background/40'}`}>
      <p className="font-mono text-sm font-semibold uppercase">{ledgerIndexed > 0 ? 'Projection evidence mismatch' : 'Analytical projection not executed'}</p>
      <p className="mx-auto mt-2 max-w-2xl text-[11px] leading-5 text-muted-foreground">
        {ledgerIndexed > 0
          ? `Run ledger reports ${ledgerIndexed.toLocaleString()} indexed rows, but no completed snapshot registry/marker evidence is available. No parity chart is synthesized.`
          : `${input.toLocaleString()} Gold rows are visible upstream, but G08 has no completed analytical projection in this view.`}
      </p>
    </section>;
  }

  const snapshots = evidence.snapshots.map((snapshot) => ({
    ...snapshot,
    label: snapshot.snapshot_id.slice(0, 10),
    samplesPerCandidate: snapshot.actual_candidate_rows > 0 ? snapshot.lightcurve_sample_rows / snapshot.actual_candidate_rows : 0,
  }));
  const cohort = [{
    scope: 'Review cohort',
    positive: evidence.snapshots.reduce((sum, snapshot) => sum + snapshot.training_positive_rows, 0),
    negative: evidence.snapshots.reduce((sum, snapshot) => sum + snapshot.training_negative_rows, 0),
    unresolved: evidence.snapshots.reduce((sum, snapshot) => sum + snapshot.training_unresolved_rows, 0),
  }];
  const gates = [
    { label: 'Registry READY', observed: evidence.registry_ready_snapshots },
    { label: 'Projection marker bound', observed: evidence.marker_verified_snapshots },
    { label: 'Five-way row parity', observed: evidence.row_parity_snapshots },
  ];

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-px border border-border/70 bg-border/70 text-xs lg:grid-cols-3 2xl:grid-cols-6">
        <Metric label="Expected rows" observed={evidence.expected_rows.toLocaleString()} detail="manifest / registry" />
        <Metric label="Registry indexed" observed={evidence.indexed_rows.toLocaleString()} detail={percent(evidence.indexed_rows, evidence.expected_rows)} warning={evidence.indexed_rows !== evidence.expected_rows} />
        <Metric label="Actual queryable rows" observed={evidence.actual_candidate_rows.toLocaleString()} detail={percent(evidence.actual_candidate_rows, evidence.expected_rows)} warning={evidence.actual_candidate_rows !== evidence.expected_rows} />
        <Metric label="Row parity" observed={percent(evidence.row_parity_snapshots, evidence.snapshot_count)} detail={`${evidence.row_parity_snapshots}/${evidence.snapshot_count} snapshots`} warning={evidence.row_parity_snapshots !== evidence.snapshot_count} />
        <Metric label="LC plot samples" observed={compact(evidence.lightcurve_sample_rows)} detail={evidence.actual_candidate_rows > 0 ? `${compact(evidence.lightcurve_sample_rows / evidence.actual_candidate_rows)} / candidate` : 'no candidates'} />
        <Metric label="Review cohort rows" observed={evidence.training_cohort_rows.toLocaleString()} detail="derived projection overlay" />
      </div>

      <section className="border border-border/70 bg-background/40">
        <div className="border-b border-border/60 px-3 py-2"><p className="font-medium">Candidate row parity by snapshot</p><p className="text-[10px] text-muted-foreground">Ba series phải chồng khít: manifest expected, registry indexed và actual rows query trực tiếp trong candidate_features.</p></div>
        <div className="h-[300px] p-3"><ResponsiveContainer width="100%" height="100%"><BarChart data={snapshots} margin={{ top: 12, right: 12, bottom: 8, left: 4 }}><CartesianGrid vertical={false} strokeDasharray="3 3" opacity={0.2} /><XAxis dataKey="label" tick={{ fontSize: 9 }} /><YAxis width={48} tickFormatter={(item) => compact(Number(item))} tick={{ fontSize: 10 }} /><Tooltip formatter={(item, name) => [Number(item).toLocaleString(), String(name)]} /><Legend /><Bar dataKey="expected_rows" name="Expected rows" fill="#64748b" isAnimationActive={false} /><Bar dataKey="registry_indexed_rows" name="Registry indexed" fill="#22d3ee" isAnimationActive={false} /><Bar dataKey="actual_candidate_rows" name="Actual queryable" fill="#10b981" isAnimationActive={false} /></BarChart></ResponsiveContainer></div>
      </section>

      <section className="border border-border/70 bg-background/40">
        <div className="border-b border-border/60 px-3 py-2"><p className="font-medium">Projection integrity gates</p><p className="text-[10px] text-muted-foreground">Row parity yêu cầu đồng thời batch ledger, manifest/registry expected, registry indexed, marker indexed và actual table rows bằng nhau.</p></div>
        <div className="grid gap-px bg-border/60 sm:grid-cols-3">{gates.map((gate) => <div key={gate.label} className="bg-background p-3"><div className="flex items-center justify-between gap-2"><span className="text-[10px] font-medium">{gate.label}</span><span className="font-mono text-[10px] font-semibold">{percent(gate.observed, evidence.snapshot_count)}</span></div><div className="mt-2 h-3 border border-border/70 bg-muted/30 p-0.5"><div className={`h-full ${gate.observed === evidence.snapshot_count ? 'bg-emerald-500' : 'bg-red-500'}`} style={{ width: `${evidence.snapshot_count > 0 ? gate.observed / evidence.snapshot_count * 100 : 0}%` }} /></div><p className="mt-1 font-mono text-[9px] text-muted-foreground">{gate.observed}/{evidence.snapshot_count} snapshots</p></div>)}</div>
      </section>

      <div className="grid gap-3 xl:grid-cols-2">
        <section className="border border-border/70 bg-background/40">
          <div className="border-b border-border/60 px-3 py-2"><p className="font-medium">Queryable candidates and LC sample density</p><p className="text-[10px] text-muted-foreground">Candidate rows dùng trục trái; exact visualization samples per candidate dùng trục phải.</p></div>
          <div className="h-[300px] p-3"><ResponsiveContainer width="100%" height="100%"><ComposedChart data={snapshots} margin={{ top: 12, right: 20, bottom: 8, left: 4 }}><CartesianGrid vertical={false} strokeDasharray="3 3" opacity={0.2} /><XAxis dataKey="label" tick={{ fontSize: 9 }} /><YAxis yAxisId="rows" width={48} tickFormatter={(item) => compact(Number(item))} tick={{ fontSize: 10 }} /><YAxis yAxisId="density" orientation="right" width={52} tickFormatter={(item) => compact(Number(item))} tick={{ fontSize: 10 }} /><Tooltip formatter={(item, name) => [Number(item).toLocaleString(undefined, { maximumFractionDigits: 2 }), String(name)]} /><Legend /><Bar yAxisId="rows" dataKey="actual_candidate_rows" name="Queryable candidates" fill="#22d3ee" isAnimationActive={false} /><Line yAxisId="density" dataKey="samplesPerCandidate" name="LC samples / candidate" stroke="#a855f7" strokeWidth={2.2} dot={{ r: 3 }} isAnimationActive={false} /></ComposedChart></ResponsiveContainer></div>
        </section>

        <section className="border border-border/70 bg-background/40">
          <div className="border-b border-border/60 px-3 py-2"><p className="font-medium">Derived training-cohort disposition</p><p className="text-[10px] text-muted-foreground">Đây là review overlay có thể rebuild, không phải nhãn được ghi ngược vào immutable Candidate Gold.</p></div>
          {evidence.training_cohort_rows > 0 ? <div className="h-[300px] p-3"><ResponsiveContainer width="100%" height="100%"><BarChart data={cohort} layout="vertical" margin={{ top: 12, right: 24, bottom: 8, left: 12 }}><CartesianGrid horizontal={false} strokeDasharray="3 3" opacity={0.2} /><XAxis type="number" allowDecimals={false} tick={{ fontSize: 10 }} /><YAxis type="category" dataKey="scope" width={90} tick={{ fontSize: 10 }} /><Tooltip formatter={(item, name) => [`${Number(item).toLocaleString()} rows`, String(name)]} /><Legend /><Bar dataKey="positive" name="Positive" stackId="cohort" fill="#10b981" isAnimationActive={false} /><Bar dataKey="negative" name="Negative" stackId="cohort" fill="#ef4444" isAnimationActive={false} /><Bar dataKey="unresolved" name="Unresolved" stackId="cohort" fill="#f59e0b" isAnimationActive={false} /></BarChart></ResponsiveContainer></div> : <div className="flex h-[300px] items-center justify-center p-6 text-center text-[11px] text-muted-foreground">Projection marker chưa ghi cohort rows cho các snapshot này.</div>}
        </section>
      </div>

      {evidence.issues.length > 0 && <div className="border-l-2 border-red-500 bg-red-500/5 px-3 py-2 text-[11px] text-red-700 dark:text-red-300">{evidence.issues.join(' · ')}</div>}
    </div>
  );
}

function Metric({ label, observed, detail, warning = false }: { label: string; observed: string; detail: string; warning?: boolean }): JSX.Element {
  return <div className="min-w-0 bg-background p-3"><p className="truncate text-[9px] uppercase tracking-wide text-muted-foreground" title={label}>{label}</p><p className={`mt-1 truncate font-mono text-sm font-semibold tabular-nums ${warning ? 'text-red-600 dark:text-red-400' : ''}`}>{observed}</p><p className="mt-0.5 truncate font-mono text-[9px] text-muted-foreground" title={detail}>{detail}</p></div>;
}
