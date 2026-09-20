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

import type { GoldCommitEvidence } from '../../types';

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

export function GoldCommitChart({ metrics, evidence }: { metrics?: Record<string, number>; evidence?: GoldCommitEvidence }): JSX.Element {
  const input = value(metrics, 'input_records');
  const isBaseline = !evidence || evidence.snapshot_count === 0;

  const activeEvidence: GoldCommitEvidence = isBaseline
    ? {
        snapshot_count: 0,
        committed_snapshots: 0,
        end_to_end_verified_snapshots: 0,
        active_current_snapshots: 0,
        rows: 0,
        artifacts: 0,
        snapshots: [],
        issues: [],
      }
    : evidence;

  const reconciliation = activeEvidence.snapshots.length > 0
    ? activeEvidence.snapshots.map((snapshot) => ({
        snapshot: snapshot.snapshot_id.slice(0, 10),
        batch: snapshot.batch_rows,
        manifest: snapshot.manifest_rows,
        projection: snapshot.projected_rows,
      }))
    : [{ snapshot: 'Baseline', batch: 0, manifest: 0, projection: 0 }];

  const gates = [
    { key: 'manifest', label: 'Manifest COMMITTED', valid: (index: number) => activeEvidence.snapshots[index]?.manifest_status.toUpperCase() === 'COMMITTED' },
    { key: 'sha', label: 'Manifest SHA', valid: (index: number) => activeEvidence.snapshots[index]?.manifest_sha_valid ?? false },
    { key: 'fingerprint', label: 'Snapshot binding', valid: (index: number) => activeEvidence.snapshots[index]?.fingerprint_valid ?? false },
    { key: 'artifact', label: 'Artifact integrity', valid: (index: number) => activeEvidence.snapshots[index]?.artifact_integrity_valid ?? false },
    { key: 'rows', label: 'Row accounting', valid: (index: number) => activeEvidence.snapshots[index]?.row_accounting_valid ?? false },
    { key: 'projection', label: 'Projection READY', valid: (index: number) => activeEvidence.snapshots[index]?.projection_ready ?? false },
    { key: 'complete', label: 'End-to-end', valid: (index: number) => activeEvidence.snapshots[index]?.end_to_end_valid ?? false },
  ];
  const disposition = [{
    scope: 'Committed snapshots',
    verified: activeEvidence.end_to_end_verified_snapshots,
    incomplete: Math.max(0, activeEvidence.snapshot_count - activeEvidence.end_to_end_verified_snapshots),
  }];

  return (
    <div className="space-y-3">
      {isBaseline && (
        <div className="flex items-center justify-between border border-border/70 bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5 font-medium">
            <span className="size-2 rounded-full bg-amber-500" />
            Khung phân tích cơ sở: G09 chưa có committed snapshot evidence (hiển thị mức nền 0).
          </span>
          <span className="font-mono text-[10px] uppercase">
            {input > 0 ? `${input.toLocaleString()} inputs upstream` : 'Sẵn sàng ghi nhận'}
          </span>
        </div>
      )}

      <div className="grid grid-cols-2 gap-px border border-border/70 bg-border/70 text-xs lg:grid-cols-3 2xl:grid-cols-6">
        <Metric label="Committed manifests" observed={`${activeEvidence.committed_snapshots}/${activeEvidence.snapshot_count}`} detail={percent(activeEvidence.committed_snapshots, activeEvidence.snapshot_count)} warning={activeEvidence.committed_snapshots !== activeEvidence.snapshot_count && !isBaseline} />
        <Metric label="End-to-end verified" observed={`${activeEvidence.end_to_end_verified_snapshots}/${activeEvidence.snapshot_count}`} detail={percent(activeEvidence.end_to_end_verified_snapshots, activeEvidence.snapshot_count)} warning={activeEvidence.end_to_end_verified_snapshots !== activeEvidence.snapshot_count && !isBaseline} />
        <Metric label="Committed rows" observed={activeEvidence.rows.toLocaleString()} detail="immutable manifest total" />
        <Metric label="Gold artifacts" observed={activeEvidence.artifacts.toLocaleString()} detail="bound by manifest" />
        <Metric label="Active current" observed={activeEvidence.active_current_snapshots.toLocaleString()} detail="mutable activation pointer" />
        <Metric label="Integrity issues" observed={activeEvidence.issues.length.toLocaleString()} detail={activeEvidence.issues.length === 0 ? 'no mismatch observed' : 'inspect evidence below'} warning={activeEvidence.issues.length > 0} />
      </div>

      <section className="border border-border/70 bg-background/40">
        <div className="border-b border-border/60 px-3 py-2"><p className="font-medium">Commit gate matrix</p><p className="text-[10px] text-muted-foreground">Mỗi hàng là một snapshot; chỉ “End-to-end” xanh khi manifest, object, row accounting và analytical projection cùng hợp lệ.</p></div>
        <div className="overflow-x-auto p-3">
          <div className="min-w-[780px] border border-border/60">
            <div className="grid grid-cols-[minmax(150px,1.4fr)_repeat(7,minmax(82px,1fr))_minmax(90px,0.8fr)] gap-px bg-border/60 text-[9px] uppercase tracking-wide text-muted-foreground">
              <div className="bg-background p-2">Snapshot</div>
              {gates.map((gate) => <div key={gate.key} className="bg-background p-2 text-center">{gate.label}</div>)}
              <div className="bg-background p-2 text-center">Current</div>
            </div>
            {activeEvidence.snapshots.length > 0 ? (
              activeEvidence.snapshots.map((snapshot, index) => (
                <div key={snapshot.snapshot_id} className="grid grid-cols-[minmax(150px,1.4fr)_repeat(7,minmax(82px,1fr))_minmax(90px,0.8fr)] gap-px border-t border-border/60 bg-border/60 text-[10px]">
                  <div className="min-w-0 bg-background p-2"><p className="truncate font-mono font-semibold" title={snapshot.snapshot_id}>{snapshot.snapshot_id}</p><p className="mt-0.5 font-mono text-[9px] text-muted-foreground">{snapshot.artifact_count.toLocaleString()} artifacts</p></div>
                  {gates.map((gate) => <div key={gate.key} className={`flex items-center justify-center p-2 font-mono font-semibold ${gate.valid(index) ? 'bg-emerald-500/12 text-emerald-700 dark:text-emerald-300' : 'bg-red-500/12 text-red-700 dark:text-red-300'}`}>{gate.valid(index) ? 'PASS' : 'FAIL'}</div>)}
                  <div className={`flex items-center justify-center p-2 font-mono font-semibold ${snapshot.current ? 'bg-sky-500/15 text-sky-700 dark:text-sky-300' : 'bg-background text-muted-foreground'}`}>{snapshot.current ? 'ACTIVE' : 'HISTORY'}</div>
                </div>
              ))
            ) : (
              <div className="grid grid-cols-[minmax(150px,1.4fr)_repeat(7,minmax(82px,1fr))_minmax(90px,0.8fr)] gap-px border-t border-border/60 bg-border/60 text-[10px]">
                <div className="min-w-0 bg-background p-2"><p className="truncate font-mono font-semibold">baseline</p><p className="mt-0.5 font-mono text-[9px] text-muted-foreground">0 artifacts</p></div>
                {gates.map((gate) => <div key={gate.key} className="flex items-center justify-center p-2 font-mono font-semibold bg-background text-muted-foreground">—</div>)}
                <div className="flex items-center justify-center p-2 font-mono font-semibold bg-background text-muted-foreground">—</div>
              </div>
            )}
          </div>
        </div>
      </section>

      <div className="grid gap-3 xl:grid-cols-[1.35fr_0.65fr]">
        <section className="border border-border/70 bg-background/40">
          <div className="border-b border-border/60 px-3 py-2"><p className="font-medium">Row provenance reconciliation</p><p className="text-[10px] text-muted-foreground">Ba cột phải bằng nhau cho từng snapshot: durable batch ledger, immutable manifest và số row query trực tiếp từ projection.</p></div>
          <div className="h-[290px] p-3"><ResponsiveContainer width="100%" height="100%"><BarChart data={reconciliation} margin={{ top: 12, right: 12, bottom: 8, left: 4 }}><CartesianGrid vertical={false} strokeDasharray="3 3" opacity={0.2} /><XAxis dataKey="snapshot" tick={{ fontSize: 9 }} /><YAxis width={52} tickFormatter={(item) => compact(Number(item))} tick={{ fontSize: 10 }} /><Tooltip formatter={(item, name) => [`${Number(item).toLocaleString()} rows`, String(name)]} /><Legend /><Bar dataKey="batch" name="Batch ledger" fill="#64748b" isAnimationActive={false} /><Bar dataKey="manifest" name="Manifest" fill="#22d3ee" isAnimationActive={false} /><Bar dataKey="projection" name="Queryable projection" fill="#10b981" isAnimationActive={false} /></BarChart></ResponsiveContainer></div>
        </section>

        <section className="border border-border/70 bg-background/40">
          <div className="border-b border-border/60 px-3 py-2"><p className="font-medium">Commit disposition</p><p className="text-[10px] text-muted-foreground">Snapshot incomplete không được tính là end-to-end verified dù batch ledger đã ghi completed.</p></div>
          <div className="h-[290px] p-3"><ResponsiveContainer width="100%" height="100%"><BarChart data={disposition} layout="vertical" margin={{ top: 18, right: 18, bottom: 8, left: 8 }}><CartesianGrid horizontal={false} strokeDasharray="3 3" opacity={0.2} /><XAxis type="number" domain={[0, Math.max(activeEvidence.snapshot_count, 1)]} allowDecimals={false} tick={{ fontSize: 10 }} /><YAxis type="category" dataKey="scope" width={112} tick={{ fontSize: 10 }} /><Tooltip formatter={(item, name) => [`${Number(item).toLocaleString()} snapshots`, String(name)]} /><Legend /><Bar dataKey="verified" name="End-to-end verified" stackId="status" fill="#10b981" isAnimationActive={false} /><Bar dataKey="incomplete" name="Incomplete gates" stackId="status" fill="#ef4444" isAnimationActive={false} /></BarChart></ResponsiveContainer></div>
        </section>
      </div>

      <div className="border-l-2 border-sky-500 bg-sky-500/5 px-3 py-2 text-[10px] leading-4 text-muted-foreground">`current` là pointer activation có thể thay đổi sang snapshot mới. Snapshot ở trạng thái HISTORY vẫn hợp lệ nếu toàn bộ commit gate bất biến đều PASS.</div>
      {activeEvidence.issues.length > 0 && <div className="border-l-2 border-red-500 bg-red-500/5 px-3 py-2 text-[11px] text-red-700 dark:text-red-300">{activeEvidence.issues.join(' · ')}</div>}
    </div>
  );
}

function Metric({ label, observed, detail, warning = false }: { label: string; observed: string; detail: string; warning?: boolean }): JSX.Element {
  return <div className="min-w-0 bg-background p-3"><p className="truncate text-[9px] uppercase tracking-wide text-muted-foreground" title={label}>{label}</p><p className={`mt-1 truncate font-mono text-sm font-semibold tabular-nums ${warning ? 'text-red-600 dark:text-red-400' : ''}`}>{observed}</p><p className="mt-0.5 truncate font-mono text-[9px] text-muted-foreground" title={detail}>{detail}</p></div>;
}
