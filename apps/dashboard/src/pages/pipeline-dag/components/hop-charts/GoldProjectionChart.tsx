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

import type { GoldProjectionEvidence } from '../../types';

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
  const isBaseline = !evidence || evidence.snapshot_count === 0;

  const activeEvidence: GoldProjectionEvidence = isBaseline
    ? {
        snapshot_count: 0,
        registry_ready_snapshots: 0,
        marker_verified_snapshots: 0,
        row_parity_snapshots: 0,
        expected_rows: input,
        indexed_rows: ledgerIndexed,
        actual_candidate_rows: 0,
        lightcurve_sample_rows: 0,
        training_cohort_rows: 0,
        snapshots: [],
        issues: [],
      }
    : evidence;

  const snapshots = activeEvidence.snapshots.length > 0
    ? activeEvidence.snapshots.map((snapshot) => ({
        ...snapshot,
        label: snapshot.snapshot_id.slice(0, 10),
        samplesPerCandidate: snapshot.actual_candidate_rows > 0 ? snapshot.lightcurve_sample_rows / snapshot.actual_candidate_rows : 0,
      }))
    : [{
        snapshot_id: 'baseline',
        label: 'Baseline',
        expected_rows: 0,
        ledger_indexed_rows: 0,
        registry_indexed_rows: 0,
        actual_candidate_rows: 0,
        lightcurve_sample_rows: 0,
        samplesPerCandidate: 0,
        training_positive_rows: 0,
        training_negative_rows: 0,
        training_unresolved_rows: 0,
        registry_status: 'NONE',
        marker_status: 'NONE',
        manifest_binding_valid: false,
        row_parity_valid: false,
      }];

  const cohort = [{
    scope: 'Review cohort',
    positive: activeEvidence.snapshots.reduce((sum, snapshot) => sum + snapshot.training_positive_rows, 0),
    negative: activeEvidence.snapshots.reduce((sum, snapshot) => sum + snapshot.training_negative_rows, 0),
    unresolved: activeEvidence.snapshots.reduce((sum, snapshot) => sum + snapshot.training_unresolved_rows, 0),
  }];
  const gates = [
    { label: 'Registry READY', observed: activeEvidence.registry_ready_snapshots },
    { label: 'Projection marker bound', observed: activeEvidence.marker_verified_snapshots },
    { label: 'Five-way row parity', observed: activeEvidence.row_parity_snapshots },
  ];

  return (
    <div className="space-y-3">
      {isBaseline && (
        <div className="flex items-center justify-between border border-border/70 bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5 font-medium">
            <span className="size-2 rounded-full bg-amber-500" />
            Khung phân tích cơ sở: G08 chưa có committed analytical projection (hiển thị mức nền 0).
          </span>
          <span className="font-mono text-[10px] uppercase">
            {input > 0 ? `${input.toLocaleString()} inputs upstream` : 'Sẵn sàng ghi nhận'}
          </span>
        </div>
      )}

      <div className="grid grid-cols-2 gap-px border border-border/70 bg-border/70 text-xs lg:grid-cols-3 2xl:grid-cols-6">
        <Metric label="Projection engine" observed="ReplacingMergeTree" detail="ClickHouse analytical store" />
        <Metric label="Target table" observed="candidate_features_v1" detail="partition by sector" />
        <Metric label="Primary sort key" observed="(sector, tic_id)" detail="sub-second range index" />
        <Metric label="Indexed rows" observed={activeEvidence.indexed_rows.toLocaleString()} detail={!isBaseline ? percent(activeEvidence.indexed_rows, activeEvidence.expected_rows) : 'awaiting batch indexing'} />
        <Metric label="Visualization store" observed="candidate_samples_v1" detail="fast scatter cache" />
        <Metric label="Parity gate" observed="5-way parity" detail={isBaseline ? 'spec enforced' : `${activeEvidence.row_parity_snapshots}/${activeEvidence.snapshot_count} verified`} />
      </div>

      {!isBaseline ? (
        <>
          <section className="border border-border/70 bg-background/40">
            <div className="border-b border-border/60 px-3 py-2"><p className="font-medium">Candidate row parity by snapshot</p><p className="text-[10px] text-muted-foreground">Ba series phải chồng khít: manifest expected, registry indexed và actual rows query trực tiếp trong candidate_features.</p></div>
            <div className="h-[300px] p-3"><ResponsiveContainer width="100%" height="100%"><BarChart data={snapshots} margin={{ top: 12, right: 12, bottom: 8, left: 4 }}><CartesianGrid vertical={false} strokeDasharray="3 3" opacity={0.2} /><XAxis dataKey="label" tick={{ fontSize: 9 }} /><YAxis width={48} tickFormatter={(item) => compact(Number(item))} tick={{ fontSize: 10 }} /><Tooltip formatter={(item, name) => [Number(item).toLocaleString(), String(name)]} /><Legend /><Bar dataKey="expected_rows" name="Expected rows" fill="#64748b" isAnimationActive={false} /><Bar dataKey="registry_indexed_rows" name="Registry indexed" fill="#22d3ee" isAnimationActive={false} /><Bar dataKey="actual_candidate_rows" name="Actual queryable" fill="#10b981" isAnimationActive={false} /></BarChart></ResponsiveContainer></div>
          </section>

          <section className="border border-border/70 bg-background/40">
            <div className="border-b border-border/60 px-3 py-2"><p className="font-medium">Projection integrity gates</p><p className="text-[10px] text-muted-foreground">Row parity yêu cầu đồng thời batch ledger, manifest/registry expected, registry indexed, marker indexed và actual table rows bằng nhau.</p></div>
            <div className="grid gap-px bg-border/60 sm:grid-cols-3">{gates.map((gate) => <div key={gate.label} className="bg-background p-3"><div className="flex items-center justify-between gap-2"><span className="text-[10px] font-medium">{gate.label}</span><span className="font-mono text-[10px] font-semibold">{percent(gate.observed, activeEvidence.snapshot_count)}</span></div><div className="mt-2 h-3 border border-border/70 bg-muted/30 p-0.5"><div className={`h-full ${gate.observed === activeEvidence.snapshot_count && !isBaseline ? 'bg-emerald-500' : 'bg-amber-500'}`} style={{ width: `${activeEvidence.snapshot_count > 0 ? gate.observed / activeEvidence.snapshot_count * 100 : 0}%` }} /></div><p className="mt-1 font-mono text-[9px] text-muted-foreground">{gate.observed}/{activeEvidence.snapshot_count} snapshots</p></div>)}</div>
          </section>

          <div className="grid gap-3 xl:grid-cols-2">
            <section className="border border-border/70 bg-background/40">
              <div className="border-b border-border/60 px-3 py-2"><p className="font-medium">Queryable candidates and LC sample density</p><p className="text-[10px] text-muted-foreground">Candidate rows dùng trục trái; exact visualization samples per candidate dùng trục phải.</p></div>
              <div className="h-[300px] p-3"><ResponsiveContainer width="100%" height="100%"><ComposedChart data={snapshots} margin={{ top: 12, right: 20, bottom: 8, left: 4 }}><CartesianGrid vertical={false} strokeDasharray="3 3" opacity={0.2} /><XAxis dataKey="label" tick={{ fontSize: 9 }} /><YAxis yAxisId="rows" width={48} tickFormatter={(item) => compact(Number(item))} tick={{ fontSize: 10 }} /><YAxis yAxisId="density" orientation="right" width={52} tickFormatter={(item) => compact(Number(item))} tick={{ fontSize: 10 }} /><Tooltip formatter={(item, name) => [Number(item).toLocaleString(undefined, { maximumFractionDigits: 2 }), String(name)]} /><Legend /><Bar yAxisId="rows" dataKey="actual_candidate_rows" name="Queryable candidates" fill="#22d3ee" isAnimationActive={false} /><Line yAxisId="density" dataKey="samplesPerCandidate" name="LC samples / candidate" stroke="#a855f7" strokeWidth={2.2} dot={{ r: 3 }} isAnimationActive={false} /></ComposedChart></ResponsiveContainer></div>
            </section>

            <section className="border border-border/70 bg-background/40">
              <div className="border-b border-border/60 px-3 py-2"><p className="font-medium">Derived training-cohort disposition</p><p className="text-[10px] text-muted-foreground">Đây là review overlay có thể rebuild, không phải nhãn được ghi ngược vào immutable Candidate Gold.</p></div>
              <div className="h-[300px] p-3"><ResponsiveContainer width="100%" height="100%"><BarChart data={cohort} layout="vertical" margin={{ top: 12, right: 24, bottom: 8, left: 12 }}><CartesianGrid horizontal={false} strokeDasharray="3 3" opacity={0.2} /><XAxis type="number" domain={[0, Math.max(activeEvidence.training_cohort_rows, 1)]} allowDecimals={false} tick={{ fontSize: 10 }} /><YAxis type="category" dataKey="scope" width={90} tick={{ fontSize: 10 }} /><Tooltip formatter={(item, name) => [`${Number(item).toLocaleString()} rows`, String(name)]} /><Legend /><Bar dataKey="positive" name="Positive" stackId="cohort" fill="#10b981" isAnimationActive={false} /><Bar dataKey="negative" name="Negative" stackId="cohort" fill="#ef4444" isAnimationActive={false} /><Bar dataKey="unresolved" name="Unresolved" stackId="cohort" fill="#f59e0b" isAnimationActive={false} /></BarChart></ResponsiveContainer></div>
            </section>
          </div>
        </>
      ) : (
        <div className="grid gap-3 xl:grid-cols-2">
          <section className="border border-border/70 bg-background/40 p-4">
            <h4 className="font-mono text-xs font-semibold uppercase tracking-wider text-primary">Cấu hình ClickHouse Projection & Bảng tra cứu (Projection Spec)</h4>
            <p className="mt-1 text-[11px] text-muted-foreground">
              Toán tử chiếu chỉ mục nạp dữ liệu từ Parquet Gold vào kho phân tích tốc độ cao:
            </p>
            <div className="mt-3 space-y-2 text-xs">
              <div className="flex items-start justify-between border-b border-border/50 py-1.5">
                <span className="text-muted-foreground">Bảng chính (Primary Analytical Table)</span>
                <span className="font-mono font-medium">candidate_features_v1 (ReplacingMergeTree)</span>
              </div>
              <div className="flex items-start justify-between border-b border-border/50 py-1.5">
                <span className="text-muted-foreground">Khóa sắp xếp chính (Sorting Key)</span>
                <span className="font-mono font-medium">ORDER BY (sector, tic_id, camera, ccd)</span>
              </div>
              <div className="flex items-start justify-between border-b border-border/50 py-1.5">
                <span className="text-muted-foreground">Bảng phụ trợ vẽ đồ thị (Light Curve Samples)</span>
                <span className="font-mono font-medium">candidate_lightcurve_samples_v1</span>
              </div>
              <div className="flex items-start justify-between py-1.5">
                <span className="text-muted-foreground">Độ trễ truy vấn mục tiêu</span>
                <span className="font-mono font-medium">&lt; 50 ms cho truy vấn lọc đa chiều</span>
              </div>
            </div>
          </section>

          <section className="border border-border/70 bg-background/40 p-4">
            <h4 className="font-mono text-xs font-semibold uppercase tracking-wider text-primary">Quy chuẩn đối soát số dòng 5 chiều (Five-Way Parity Gate)</h4>
            <p className="mt-1 text-[11px] text-muted-foreground">
              Cam kết không thất thoát hay trùng lặp bản ghi trên toàn bộ luồng lưu trữ:
            </p>
            <div className="mt-3 space-y-2 text-xs">
              <div className="flex items-start justify-between border-b border-border/50 py-1.5">
                <span className="text-muted-foreground">Chiểu 1 & 2: Batch Ledger ↔ Manifest</span>
                <span className="font-mono font-medium text-emerald-600 dark:text-emerald-400">N_batch == N_manifest</span>
              </div>
              <div className="flex items-start justify-between border-b border-border/50 py-1.5">
                <span className="text-muted-foreground">Chiều 3: Registry Indexed Count</span>
                <span className="font-mono font-medium text-emerald-600 dark:text-emerald-400">N_registry == N_manifest</span>
              </div>
              <div className="flex items-start justify-between border-b border-border/50 py-1.5">
                <span className="text-muted-foreground">Chiều 4: ClickHouse Table Count</span>
                <span className="font-mono font-medium text-emerald-600 dark:text-emerald-400">COUNT(*) in candidate_features == N</span>
              </div>
              <div className="flex items-start justify-between py-1.5">
                <span className="text-muted-foreground">Chiều 5: Khử trùng lặp qua ReplacingMergeTree</span>
                <span className="font-mono font-medium">Deduplication versioning by updated_at</span>
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
