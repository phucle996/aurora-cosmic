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

import type { GoldMaterializationEvidence } from '@/features/factory-history/types';

function value(metrics: Record<string, number> | undefined, key: string): number {
  const observed = metrics?.[key];
  return observed !== undefined && Number.isFinite(observed) ? Math.max(0, observed) : 0;
}

function percent(numerator: number, denominator: number): string {
  return denominator > 0 ? `${(numerator / denominator * 100).toFixed(2)}%` : '—';
}

function mib(bytes: number): number {
  return bytes / 1024 / 1024;
}

function compact(observed: number): string {
  if (Math.abs(observed) >= 1_000_000) return `${(observed / 1_000_000).toFixed(1)}M`;
  if (Math.abs(observed) >= 1_000) return `${(observed / 1_000).toFixed(1)}k`;
  return observed.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

export function GoldMaterializationChart({ metrics, evidence }: { metrics?: Record<string, number>; evidence?: GoldMaterializationEvidence }): JSX.Element {
  const input = value(metrics, 'input_records');
  const ledgerArtifacts = value(metrics, 'output_rows');
  if (!evidence || evidence.batch_count === 0) {
    return <section className={`border border-dashed px-5 py-12 text-center ${ledgerArtifacts > 0 ? 'border-red-500/60 bg-red-500/5' : 'border-border/70 bg-background/40'}`}>
      <p className="font-mono text-sm font-semibold uppercase">{ledgerArtifacts > 0 ? 'Materialization evidence mismatch' : 'Gold materialization not executed'}</p>
      <p className="mx-auto mt-2 max-w-2xl text-[11px] leading-5 text-muted-foreground">
        {ledgerArtifacts > 0
          ? `Run ledger reports ${ledgerArtifacts.toLocaleString()} Gold artifacts, but no batch manifest evidence is available. No storage chart is synthesized.`
          : `${input.toLocaleString()} candidate rows are visible upstream, but G07 has no durable materialization batch in this view.`}
      </p>
    </section>;
  }

  const inProgress = Math.max(0, evidence.batch_count - evidence.completed_batches - evidence.failed_batches);
  const batchStatus = [{ scope: 'Run batches', completed: evidence.completed_batches, failed: evidence.failed_batches, inProgress }];
  const integrity = [
    { gate: 'Manifest SHA', verified: evidence.manifest_verified_batches, missing: Math.max(0, evidence.completed_batches - evidence.manifest_verified_batches), denominator: evidence.completed_batches },
    { gate: 'Row accounting', verified: evidence.row_accounting_verified_batches, missing: Math.max(0, evidence.completed_batches - evidence.row_accounting_verified_batches), denominator: evidence.completed_batches },
    { gate: 'Object size', verified: evidence.object_verified_artifacts, missing: Math.max(0, evidence.artifact_count - evidence.object_verified_artifacts), denominator: evidence.artifact_count },
    { gate: 'Checksum fields', verified: evidence.checksum_declared_artifacts, missing: Math.max(0, evidence.artifact_count - evidence.checksum_declared_artifacts), denominator: evidence.artifact_count },
  ];
  const batchMap = new Map<string, { snapshot: string; rows: number; bytes: number; artifacts: number }>();
  for (const artifact of evidence.artifacts) {
    const current = batchMap.get(artifact.snapshot_id) ?? { snapshot: artifact.snapshot_id.slice(0, 10), rows: 0, bytes: 0, artifacts: 0 };
    current.rows += artifact.row_count;
    current.bytes += artifact.size_bytes;
    current.artifacts += 1;
    batchMap.set(artifact.snapshot_id, current);
  }
  const batches = [...batchMap.values()].map((batch) => ({ ...batch, sizeMiB: mib(batch.bytes), bytesPerRow: batch.rows > 0 ? batch.bytes / batch.rows : 0 }));
  const sectors = [...new Map(evidence.artifacts.map((artifact) => [artifact.sector, artifact.sector])).values()].sort((a, b) => a - b).map((sector) => {
    const artifacts = evidence.artifacts.filter((artifact) => artifact.sector === sector);
    const rows = artifacts.reduce((sum, artifact) => sum + artifact.row_count, 0);
    const bytes = artifacts.reduce((sum, artifact) => sum + artifact.size_bytes, 0);
    return { sector: `S${sector}`, rows, sizeMiB: mib(bytes), bytesPerRow: rows > 0 ? bytes / rows : 0, artifacts: artifacts.length };
  });
  const meanArtifactMiB = evidence.artifact_count > 0 ? mib(evidence.total_bytes) / evidence.artifact_count : 0;
  const meanBytesPerRow = evidence.rows > 0 ? evidence.total_bytes / evidence.rows : 0;

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-px border border-border/70 bg-border/70 text-xs lg:grid-cols-3 2xl:grid-cols-6">
        <Metric label="Rows materialized" observed={evidence.rows.toLocaleString()} detail={input > 0 ? `${percent(evidence.rows, input)} of candidate input` : 'manifest accounted'} />
        <Metric label="Gold artifacts" observed={evidence.artifact_count.toLocaleString()} detail={`${meanArtifactMiB.toFixed(3)} MiB mean`} />
        <Metric label="Stored footprint" observed={`${mib(evidence.total_bytes).toFixed(3)} MiB`} detail={`${meanBytesPerRow.toFixed(1)} bytes / row`} />
        <Metric label="Manifest integrity" observed={percent(evidence.manifest_verified_batches, evidence.completed_batches)} detail={`${evidence.manifest_verified_batches}/${evidence.completed_batches} completed batches`} warning={evidence.manifest_verified_batches < evidence.completed_batches} />
        <Metric label="Object size verified" observed={percent(evidence.object_verified_artifacts, evidence.artifact_count)} detail={`${evidence.object_verified_artifacts}/${evidence.artifact_count} artifacts`} warning={evidence.object_verified_artifacts < evidence.artifact_count} />
        <Metric label="Failed batches" observed={evidence.failed_batches.toLocaleString()} detail={`${evidence.completed_batches.toLocaleString()} completed`} warning={evidence.failed_batches > 0} />
      </div>

      <section className="border border-border/70 bg-background/40">
        <div className="border-b border-border/60 px-3 py-2"><p className="font-medium">Batch materialization disposition</p><p className="text-[10px] text-muted-foreground">Trạng thái lấy từ durable batch ledger; completed chỉ được xem là intact khi các integrity gate bên dưới khớp.</p></div>
        <div className="h-[170px] p-3">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={batchStatus} layout="vertical" margin={{ top: 12, right: 24, bottom: 8, left: 12 }}>
              <CartesianGrid horizontal={false} strokeDasharray="3 3" opacity={0.2} />
              <XAxis type="number" domain={[0, Math.max(evidence.batch_count, 1)]} allowDecimals={false} tick={{ fontSize: 10 }} />
              <YAxis type="category" dataKey="scope" width={80} tick={{ fontSize: 10 }} />
              <Tooltip formatter={(item, name) => [`${Number(item).toLocaleString()} batches`, String(name)]} /><Legend />
              <Bar dataKey="completed" name="Completed" stackId="status" fill="#10b981" isAnimationActive={false} />
              <Bar dataKey="failed" name="Failed" stackId="status" fill="#ef4444" isAnimationActive={false} />
              <Bar dataKey="inProgress" name="Other / in progress" stackId="status" fill="#f59e0b" isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </section>

      <section className="border border-border/70 bg-background/40">
        <div className="border-b border-border/60 px-3 py-2"><p className="font-medium">Durable integrity gates</p><p className="text-[10px] text-muted-foreground">Manifest SHA được tính lại; object size đối chiếu inventory MinIO; checksum fields là khai báo provenance, không phải đọc lại toàn bộ Parquet body.</p></div>
        <div className="grid gap-px bg-border/60 sm:grid-cols-2 xl:grid-cols-4">
          {integrity.map((gate) => <div key={gate.gate} className="bg-background p-3"><div className="flex items-center justify-between gap-2"><span className="text-[10px] font-medium">{gate.gate}</span><span className="font-mono text-[10px] font-semibold">{percent(gate.verified, gate.denominator)}</span></div><div className="mt-2 h-3 border border-border/70 bg-muted/30 p-0.5"><div className={`h-full ${gate.missing > 0 ? 'bg-amber-500' : 'bg-emerald-500'}`} style={{ width: `${gate.denominator > 0 ? gate.verified / gate.denominator * 100 : 0}%` }} /></div><p className="mt-1 font-mono text-[9px] text-muted-foreground">{gate.verified}/{gate.denominator} verified</p></div>)}
        </div>
      </section>

      {batches.length > 0 && <div className="grid gap-3 xl:grid-cols-2">
        <section className="border border-border/70 bg-background/40">
          <div className="border-b border-border/60 px-3 py-2"><p className="font-medium">Rows and footprint by snapshot</p><p className="text-[10px] text-muted-foreground">Rows dùng trục trái; stored MiB dùng trục phải. Không diễn giải thành compression ratio vì chưa có logical input bytes.</p></div>
          <div className="h-[300px] p-3"><ResponsiveContainer width="100%" height="100%"><ComposedChart data={batches} margin={{ top: 12, right: 20, bottom: 8, left: 4 }}><CartesianGrid vertical={false} strokeDasharray="3 3" opacity={0.2} /><XAxis dataKey="snapshot" tick={{ fontSize: 9 }} /><YAxis yAxisId="rows" width={48} tickFormatter={(item) => compact(Number(item))} tick={{ fontSize: 10 }} /><YAxis yAxisId="size" orientation="right" width={44} tick={{ fontSize: 10 }} /><Tooltip formatter={(item, name) => [Number(item).toLocaleString(undefined, { maximumFractionDigits: 3 }), String(name)]} /><Legend /><Bar yAxisId="rows" dataKey="rows" name="Rows" fill="#22d3ee" isAnimationActive={false} /><Line yAxisId="size" dataKey="sizeMiB" name="Stored MiB" stroke="#a855f7" strokeWidth={2.2} dot={{ r: 3 }} isAnimationActive={false} /></ComposedChart></ResponsiveContainer></div>
        </section>
        <section className="border border-border/70 bg-background/40">
          <div className="border-b border-border/60 px-3 py-2"><p className="font-medium">Storage efficiency by sector</p><p className="text-[10px] text-muted-foreground">Footprint và bytes/row được aggregate theo sector, không chấm từng file Parquet.</p></div>
          <div className="h-[300px] p-3"><ResponsiveContainer width="100%" height="100%"><ComposedChart data={sectors} margin={{ top: 12, right: 20, bottom: 8, left: 4 }}><CartesianGrid vertical={false} strokeDasharray="3 3" opacity={0.2} /><XAxis dataKey="sector" tick={{ fontSize: 10 }} /><YAxis yAxisId="size" width={44} tick={{ fontSize: 10 }} /><YAxis yAxisId="density" orientation="right" width={50} tickFormatter={(item) => compact(Number(item))} tick={{ fontSize: 10 }} /><Tooltip formatter={(item, name) => [Number(item).toLocaleString(undefined, { maximumFractionDigits: 3 }), String(name)]} /><Legend /><Bar yAxisId="size" dataKey="sizeMiB" name="Stored MiB" fill="#10b981" isAnimationActive={false} /><Line yAxisId="density" dataKey="bytesPerRow" name="Bytes / row" stroke="#f97316" strokeWidth={2.2} dot={{ r: 3 }} isAnimationActive={false} /></ComposedChart></ResponsiveContainer></div>
        </section>
      </div>}

      {evidence.issues.length > 0 && <div className="border-l-2 border-red-500 bg-red-500/5 px-3 py-2 text-[11px] text-red-700 dark:text-red-300">{evidence.issues.join(' · ')}</div>}
    </div>
  );
}

function Metric({ label, observed, detail, warning = false }: { label: string; observed: string; detail: string; warning?: boolean }): JSX.Element {
  return <div className="min-w-0 bg-background p-3"><p className="truncate text-[9px] uppercase tracking-wide text-muted-foreground" title={label}>{label}</p><p className={`mt-1 truncate font-mono text-sm font-semibold tabular-nums ${warning ? 'text-red-600 dark:text-red-400' : ''}`}>{observed}</p><p className="mt-0.5 truncate font-mono text-[9px] text-muted-foreground" title={detail}>{detail}</p></div>;
}
