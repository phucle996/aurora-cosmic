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

import type { GoldMaterializationEvidence } from '../../types';

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
  const isBaseline = !evidence || evidence.batch_count === 0;

  const activeEvidence: GoldMaterializationEvidence = isBaseline
    ? {
        batch_count: 0,
        completed_batches: 0,
        failed_batches: 0,
        manifest_verified_batches: 0,
        row_accounting_verified_batches: 0,
        rows: ledgerArtifacts,
        artifact_count: ledgerArtifacts,
        total_bytes: 0,
        object_verified_artifacts: 0,
        checksum_declared_artifacts: 0,
        artifacts: [],
        issues: [],
      }
    : evidence;

  const inProgress = Math.max(0, activeEvidence.batch_count - activeEvidence.completed_batches - activeEvidence.failed_batches);
  const batchStatus = [{ scope: 'Run batches', completed: activeEvidence.completed_batches, failed: activeEvidence.failed_batches, inProgress }];
  const integrity = [
    { gate: 'Manifest SHA', verified: activeEvidence.manifest_verified_batches, missing: Math.max(0, activeEvidence.completed_batches - activeEvidence.manifest_verified_batches), denominator: activeEvidence.completed_batches },
    { gate: 'Row accounting', verified: activeEvidence.row_accounting_verified_batches, missing: Math.max(0, activeEvidence.completed_batches - activeEvidence.row_accounting_verified_batches), denominator: activeEvidence.completed_batches },
    { gate: 'Object size', verified: activeEvidence.object_verified_artifacts, missing: Math.max(0, activeEvidence.artifact_count - activeEvidence.object_verified_artifacts), denominator: activeEvidence.artifact_count },
    { gate: 'Checksum fields', verified: activeEvidence.checksum_declared_artifacts, missing: Math.max(0, activeEvidence.artifact_count - activeEvidence.checksum_declared_artifacts), denominator: activeEvidence.artifact_count },
  ];
  const batchMap = new Map<string, { snapshot: string; rows: number; bytes: number; artifacts: number }>();
  for (const artifact of activeEvidence.artifacts) {
    const current = batchMap.get(artifact.snapshot_id) ?? { snapshot: artifact.snapshot_id.slice(0, 10), rows: 0, bytes: 0, artifacts: 0 };
    current.rows += artifact.row_count;
    current.bytes += artifact.size_bytes;
    current.artifacts += 1;
    batchMap.set(artifact.snapshot_id, current);
  }
  const batches = batchMap.size > 0
    ? [...batchMap.values()].map((batch) => ({ ...batch, sizeMiB: mib(batch.bytes), bytesPerRow: batch.rows > 0 ? batch.bytes / batch.rows : 0 }))
    : [{ snapshot: 'Baseline', rows: 0, bytes: 0, artifacts: 0, sizeMiB: 0, bytesPerRow: 0 }];
  const sectorsData = [...new Map(activeEvidence.artifacts.map((artifact) => [artifact.sector, artifact.sector])).values()].sort((a, b) => a - b).map((sector) => {
    const artifacts = activeEvidence.artifacts.filter((artifact) => artifact.sector === sector);
    const rows = artifacts.reduce((sum, artifact) => sum + artifact.row_count, 0);
    const bytes = artifacts.reduce((sum, artifact) => sum + artifact.size_bytes, 0);
    return { sector: `S${sector}`, rows, sizeMiB: mib(bytes), bytesPerRow: rows > 0 ? bytes / rows : 0, artifacts: artifacts.length };
  });
  const sectors = sectorsData.length > 0 ? sectorsData : [{ sector: 'S--', rows: 0, sizeMiB: 0, bytesPerRow: 0, artifacts: 0 }];
  const meanArtifactMiB = activeEvidence.artifact_count > 0 ? mib(activeEvidence.total_bytes) / activeEvidence.artifact_count : 0;
  const meanBytesPerRow = activeEvidence.rows > 0 ? activeEvidence.total_bytes / activeEvidence.rows : 0;

  return (
    <div className="space-y-3">
      {isBaseline && (
        <div className="flex items-center justify-between border border-border/70 bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5 font-medium">
            <span className="size-2 rounded-full bg-amber-500" />
            Khung phân tích cơ sở: G07 chưa có committed materialization evidence (hiển thị mức nền 0).
          </span>
          <span className="font-mono text-[10px] uppercase">
            {input > 0 ? `${input.toLocaleString()} inputs upstream` : 'Sẵn sàng ghi nhận'}
          </span>
        </div>
      )}

      <div className="grid grid-cols-2 gap-px border border-border/70 bg-border/70 text-xs lg:grid-cols-3 2xl:grid-cols-6">
        <Metric label="Rows materialized" observed={activeEvidence.rows.toLocaleString()} detail={input > 0 && !isBaseline ? `${percent(activeEvidence.rows, input)} of candidate input` : 'manifest accounted'} />
        <Metric label="Gold artifacts" observed={activeEvidence.artifact_count.toLocaleString()} detail={!isBaseline ? `${meanArtifactMiB.toFixed(3)} MiB mean` : 'candidate_features_v1'} />
        <Metric label="Compression codec" observed={!isBaseline ? `${mib(activeEvidence.total_bytes).toFixed(3)} MiB` : 'ZSTD · Level 7'} detail={!isBaseline ? `${meanBytesPerRow.toFixed(1)} bytes / row` : 'high-entropy compression'} />
        <Metric label="Partition layout" observed="sector=<sector>" detail="sub-bucketed by TIC" />
        <Metric label="Storage target" observed="aurora-gold" detail="s3://aurora-gold/candidates/" />
        <Metric label="Integrity status" observed={isBaseline ? 'STANDBY' : activeEvidence.failed_batches === 0 ? 'INTACT' : 'INVESTIGATE'} detail={isBaseline ? 'awaiting materialization' : `${activeEvidence.completed_batches} completed`} warning={activeEvidence.failed_batches > 0} />
      </div>

      {!isBaseline ? (
        <>
          <section className="border border-border/70 bg-background/40">
            <div className="border-b border-border/60 px-3 py-2"><p className="font-medium">Batch materialization disposition</p><p className="text-[10px] text-muted-foreground">Trạng thái lấy từ durable batch ledger; completed chỉ được xem là intact khi các integrity gate bên dưới khớp.</p></div>
            <div className="h-[170px] p-3">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={batchStatus} layout="vertical" margin={{ top: 12, right: 24, bottom: 8, left: 12 }}>
                  <CartesianGrid horizontal={false} strokeDasharray="3 3" opacity={0.2} />
                  <XAxis type="number" domain={[0, Math.max(activeEvidence.batch_count, 1)]} allowDecimals={false} tick={{ fontSize: 10 }} />
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

          <div className="grid gap-3 xl:grid-cols-2">
            <section className="border border-border/70 bg-background/40">
              <div className="border-b border-border/60 px-3 py-2"><p className="font-medium">Rows and footprint by snapshot</p><p className="text-[10px] text-muted-foreground">Rows dùng trục trái; stored MiB dùng trục phải. Không diễn giải thành compression ratio vì chưa có logical input bytes.</p></div>
              <div className="h-[300px] p-3"><ResponsiveContainer width="100%" height="100%"><ComposedChart data={batches} margin={{ top: 12, right: 20, bottom: 8, left: 4 }}><CartesianGrid vertical={false} strokeDasharray="3 3" opacity={0.2} /><XAxis dataKey="snapshot" tick={{ fontSize: 9 }} /><YAxis yAxisId="rows" width={48} tickFormatter={(item) => compact(Number(item))} tick={{ fontSize: 10 }} /><YAxis yAxisId="size" orientation="right" width={44} tick={{ fontSize: 10 }} /><Tooltip formatter={(item, name) => [Number(item).toLocaleString(undefined, { maximumFractionDigits: 3 }), String(name)]} /><Legend /><Bar yAxisId="rows" dataKey="rows" name="Rows" fill="#22d3ee" isAnimationActive={false} /><Line yAxisId="size" dataKey="sizeMiB" name="Stored MiB" stroke="#a855f7" strokeWidth={2.2} dot={{ r: 3 }} isAnimationActive={false} /></ComposedChart></ResponsiveContainer></div>
            </section>
            <section className="border border-border/70 bg-background/40">
              <div className="border-b border-border/60 px-3 py-2"><p className="font-medium">Storage efficiency by sector</p><p className="text-[10px] text-muted-foreground">Footprint và bytes/row được aggregate theo sector, không chấm từng file Parquet.</p></div>
              <div className="h-[300px] p-3"><ResponsiveContainer width="100%" height="100%"><ComposedChart data={sectors} margin={{ top: 12, right: 20, bottom: 8, left: 4 }}><CartesianGrid vertical={false} strokeDasharray="3 3" opacity={0.2} /><XAxis dataKey="sector" tick={{ fontSize: 10 }} /><YAxis yAxisId="size" width={44} tick={{ fontSize: 10 }} /><YAxis yAxisId="density" orientation="right" width={50} tickFormatter={(item) => compact(Number(item))} tick={{ fontSize: 10 }} /><Tooltip formatter={(item, name) => [Number(item).toLocaleString(undefined, { maximumFractionDigits: 3 }), String(name)]} /><Legend /><Bar yAxisId="size" dataKey="sizeMiB" name="Stored MiB" fill="#10b981" isAnimationActive={false} /><Line yAxisId="density" dataKey="bytesPerRow" name="Bytes / row" stroke="#f97316" strokeWidth={2.2} dot={{ r: 3 }} isAnimationActive={false} /></ComposedChart></ResponsiveContainer></div>
            </section>
          </div>
        </>
      ) : (
        <div className="grid gap-3 xl:grid-cols-2">
          <section className="border border-border/70 bg-background/40 p-4">
            <h4 className="font-mono text-xs font-semibold uppercase tracking-wider text-primary">Quy chuẩn lưu trữ Parquet Gold (Materialization Spec)</h4>
            <p className="mt-1 text-[11px] text-muted-foreground">
              Toán tử vật lý hóa Parquet ghi các bảng ứng viên hoàn chỉnh xuống hệ thống lưu trữ MinIO:
            </p>
            <div className="mt-3 space-y-2 text-xs">
              <div className="flex items-start justify-between border-b border-border/50 py-1.5">
                <span className="text-muted-foreground">Định dạng & Bộ mã hóa nén</span>
                <span className="font-mono font-medium">Apache Parquet v2.0 (Zstandard Level 7)</span>
              </div>
              <div className="flex items-start justify-between border-b border-border/50 py-1.5">
                <span className="text-muted-foreground">Chiến lược phân vùng dữ liệu</span>
                <span className="font-mono font-medium">Partitioned by sector (e.g. sector=54)</span>
              </div>
              <div className="flex items-start justify-between border-b border-border/50 py-1.5">
                <span className="text-muted-foreground">Đích lưu trữ MinIO bền vững</span>
                <span className="font-mono font-medium">s3://aurora-gold/candidates/</span>
              </div>
              <div className="flex items-start justify-between py-1.5">
                <span className="text-muted-foreground">Row Group Sizing & Bounded Memory</span>
                <span className="font-mono font-medium">10,000 rows / row-group (~32 MiB chunks)</span>
              </div>
            </div>
          </section>

          <section className="border border-border/70 bg-background/40 p-4">
            <h4 className="font-mono text-xs font-semibold uppercase tracking-wider text-primary">Cổng kiểm định toàn vẹn Bất biến (Integrity Gates)</h4>
            <p className="mt-1 text-[11px] text-muted-foreground">
              Các tiêu chí bất biến phải được xác minh trước khi snapshot được phát hành:
            </p>
            <div className="mt-3 space-y-2 text-xs">
              <div className="flex items-start justify-between border-b border-border/50 py-1.5">
                <span className="text-muted-foreground">Xác thực Checksum SHA256</span>
                <span className="font-mono font-medium text-emerald-600 dark:text-emerald-400">Khớp từng byte theo header manifest</span>
              </div>
              <div className="flex items-start justify-between border-b border-border/50 py-1.5">
                <span className="text-muted-foreground">Kế toán số dòng (Row Accounting)</span>
                <span className="font-mono font-medium">N_materialized == N_manifest_declared</span>
              </div>
              <div className="flex items-start justify-between border-b border-border/50 py-1.5">
                <span className="text-muted-foreground">Ghi nguyên tử (Atomic Commit Staging)</span>
                <span className="font-mono font-medium">Staged upload → Final key promotion</span>
              </div>
              <div className="flex items-start justify-between py-1.5">
                <span className="text-muted-foreground">Cơ chế phục hồi lỗi</span>
                <span className="font-mono font-medium">Quarantine corrupt parts, idempotent retry</span>
              </div>
            </div>
          </section>
        </div>
      )}

      {activeEvidence.issues.length > 0 && <div className="border-l-2 border-red-500 bg-red-500/5 px-3 py-2 text-[11px] text-red-700 dark:text-red-300">{activeEvidence.issues.join(' · ')}</div>}
    </div>
  );
}

function Metric({ label, observed, detail, warning = false }: { label: string; observed: string; detail: string; warning?: boolean }): JSX.Element {
  return <div className="min-w-0 bg-background p-3"><p className="truncate text-[9px] uppercase tracking-wide text-muted-foreground" title={label}>{label}</p><p className={`mt-1 truncate font-mono text-sm font-semibold tabular-nums ${warning ? 'text-red-600 dark:text-red-400' : ''}`}>{observed}</p><p className="mt-0.5 truncate font-mono text-[9px] text-muted-foreground" title={detail}>{detail}</p></div>;
}
