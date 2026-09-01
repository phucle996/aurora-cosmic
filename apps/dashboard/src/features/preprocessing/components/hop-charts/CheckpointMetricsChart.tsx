import { type JSX } from 'react';
import {
  Area,
  AreaChart,
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

import type { Hop } from '../../types';

type Checkpoint = NonNullable<Hop['checkpoint_points']>[number];

export function CheckpointMetricsChart({
  metrics,
  checkpoints = [],
}: {
  metrics?: Record<string, number>;
  checkpoints?: Hop['checkpoint_points'];
}): JSX.Element {
  const total = checkpoints.length || Math.max(0, metrics?.checkpoint_total ?? 0);
  const completed = checkpoints.length
    ? checkpoints.filter((point) => point.state === 'COMPLETED').length
    : Math.max(0, metrics?.checkpoint_completed ?? 0);
  const resumeReady = checkpoints.filter((point) => point.resume_action === 'reuse_and_ack').length;
  const retried = checkpoints.filter((point) => point.attempts > 1).length;
  const terminal = checkpoints.filter((point) => point.terminal).length;
  const elapsed = checkpoints.map((point) => point.lifecycle_elapsed_ms).filter((value) => value >= 0);
  const durationP50 = percentile(elapsed, 0.5);
  const durationP95 = percentile(elapsed, 0.95);
  const lifecycle = buildLifecycleHistogram(checkpoints);
  const completionTimeline = buildCompletionTimeline(checkpoints);
  const recoveryByKind = ['lightcurve', 'target_pixel'].map((kind) => {
    const points = checkpoints.filter((point) => normalizeKind(point.product_kind) === kind);
    return {
      kind: kind === 'lightcurve' ? 'Light Curve' : 'Target Pixel',
      reuse: points.filter((point) => point.resume_action === 'reuse_and_ack').length,
      verify: points.filter((point) => point.resume_action === 'verify_silver').length,
      reprocess: points.filter((point) => point.resume_action === 'reprocess').length,
      terminal: points.filter((point) => point.resume_action === 'terminal').length,
    };
  });
  const recoveryFunnel = [
    { stage: 'Persisted', count: total, fill: '#64748b' },
    { stage: 'Completed', count: completed, fill: '#38bdf8' },
    { stage: 'Silver verified', count: checkpoints.filter((point) => point.silver_verified).length, fill: '#22d3ee' },
    { stage: 'Resume-ready', count: resumeReady, fill: '#10b981' },
  ];
  const anomalies = checkpoints.filter((point) => point.resume_action !== 'reuse_and_ack');
  const schemaVersions = [...new Set(checkpoints.map((point) => point.schema_version).filter((value) => value > 0))];

  return <div className="space-y-3">
    <div className="grid gap-px border border-border/70 bg-border/70 sm:grid-cols-4 xl:grid-cols-8 text-xs">
      <Metric label="Persisted" value={total.toLocaleString()} detail="checkpoint objects" />
      <Metric label="Completed" value={percent(completed, total)} detail={`${completed.toLocaleString()} records`} />
      <Metric label="Resume-ready" value={percent(resumeReady, total)} detail={`${resumeReady.toLocaleString()} reuse & ACK`} />
      <Metric label="Retried" value={retried.toLocaleString()} detail={percent(retried, total)} />
      <Metric label="Lifecycle P50" value={formatDuration(durationP50)} detail="create → final state" />
      <Metric label="Lifecycle P95" value={formatDuration(durationP95)} detail="tail duration" />
      <Metric label="Terminal" value={terminal.toLocaleString()} detail="no reprocessing" />
      <Metric label="Schema" value={schemaVersions.length === 1 ? `v${schemaVersions[0]}` : `${schemaVersions.length} versions`} detail="checkpoint format" />
    </div>

    {checkpoints.length > 0 ? <>
      <div className="grid gap-3 xl:grid-cols-2">
        <ChartPanel title="Durable recovery funnel" subtitle="Mỗi tầng yêu cầu thêm bằng chứng trước khi một redelivery được phép bỏ qua xử lý khoa học.">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={recoveryFunnel} layout="vertical" margin={{ left: 18, right: 28, top: 8, bottom: 8 }}>
              <CartesianGrid horizontal={false} strokeDasharray="3 3" opacity={0.18} />
              <XAxis type="number" domain={[0, Math.max(total, 1)]} tick={{ fontSize: 10 }} />
              <YAxis type="category" dataKey="stage" width={96} tick={{ fontSize: 10 }} />
              <Tooltip formatter={(value) => `${Number(value).toLocaleString()} checkpoints`} />
              <Bar dataKey="count" radius={[0, 2, 2, 0]} isAnimationActive={false}>{recoveryFunnel.map((item) => <Cell key={item.stage} fill={item.fill} />)}</Bar>
            </BarChart>
          </ResponsiveContainer>
        </ChartPanel>

        <ChartPanel title="Lifecycle elapsed distribution" subtitle="Phân bố thời gian từ lúc tạo checkpoint đến trạng thái bền vững cuối cùng; tách LC và TPF.">
          {lifecycle.length > 1 ? <ResponsiveContainer width="100%" height="100%">
            <BarChart data={lifecycle} margin={{ left: 0, right: 12, top: 8, bottom: 8 }}>
              <CartesianGrid vertical={false} strokeDasharray="3 3" opacity={0.18} />
              <XAxis dataKey="band" tick={{ fontSize: 9 }} />
              <YAxis allowDecimals={false} tick={{ fontSize: 10 }} width={42} />
              <Tooltip formatter={(value) => `${Number(value).toLocaleString()} checkpoints`} />
              <Legend wrapperStyle={{ fontSize: 10 }} />
              <Bar dataKey="lightcurve" name="Light Curve" stackId="kind" fill="#22d3ee" isAnimationActive={false} />
              <Bar dataKey="target_pixel" name="Target Pixel" stackId="kind" fill="#a855f7" isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer> : <EvidenceNote>Lifecycle elapsed không có độ phân tán đủ để dựng histogram; P50/P95 phía trên vẫn là bằng chứng scalar.</EvidenceNote>}
        </ChartPanel>
      </div>

      <div className="grid gap-3 xl:grid-cols-[1.35fr_0.65fr]">
        <ChartPanel title="Durable completion history" subtitle="Checkpoint COMPLETED tích lũy theo thời điểm commit; không dùng throughput Prometheus đã về 0.">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={completionTimeline} margin={{ left: 0, right: 12, top: 8, bottom: 8 }}>
              <CartesianGrid vertical={false} strokeDasharray="3 3" opacity={0.18} />
              <XAxis dataKey="timestamp" tickFormatter={clock} minTickGap={32} tick={{ fontSize: 9 }} />
              <YAxis allowDecimals={false} tick={{ fontSize: 10 }} width={42} />
              <Tooltip labelFormatter={(value) => timestampLabel(Number(value))} formatter={(value) => `${Number(value).toLocaleString()} completed`} />
              <Legend wrapperStyle={{ fontSize: 10 }} />
              <Area dataKey="lightcurve" name="Light Curve" stackId="completion" stroke="#0891b2" fill="#22d3ee" fillOpacity={0.42} dot={false} isAnimationActive={false} />
              <Area dataKey="target_pixel" name="Target Pixel" stackId="completion" stroke="#7e22ce" fill="#a855f7" fillOpacity={0.35} dot={false} isAnimationActive={false} />
            </AreaChart>
          </ResponsiveContainer>
        </ChartPanel>

        <ChartPanel title="Recovery decision by product" subtitle="Quyết định do backend trả về sau khi join checkpoint với Silver inventory.">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={recoveryByKind} layout="vertical" margin={{ left: 18, right: 12, top: 8, bottom: 8 }}>
              <CartesianGrid horizontal={false} strokeDasharray="3 3" opacity={0.18} />
              <XAxis type="number" allowDecimals={false} tick={{ fontSize: 10 }} />
              <YAxis type="category" dataKey="kind" width={82} tick={{ fontSize: 9 }} />
              <Tooltip formatter={(value) => `${Number(value).toLocaleString()} checkpoints`} />
              <Legend wrapperStyle={{ fontSize: 10 }} />
              <Bar dataKey="reuse" name="Reuse & ACK" stackId="decision" fill="#10b981" isAnimationActive={false} />
              <Bar dataKey="verify" name="Verify Silver" stackId="decision" fill="#22d3ee" isAnimationActive={false} />
              <Bar dataKey="reprocess" name="Reprocess" stackId="decision" fill="#f59e0b" isAnimationActive={false} />
              <Bar dataKey="terminal" name="Terminal" stackId="decision" fill="#ef4444" isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
        </ChartPanel>
      </div>

      {retried > 0 && <AttemptDistribution checkpoints={checkpoints} />}
      {anomalies.length === 0
        ? <div className="border border-emerald-500/30 bg-emerald-500/5 px-3 py-2 text-[11px] text-emerald-700 dark:text-emerald-300">Mọi checkpoint quan sát được đều có verified Silver binding và sẵn sàng cho fast-path reuse & ACK.</div>
        : <CheckpointAnomalies points={anomalies} />}
    </> : <EvidenceNote>Checkpoint inventory chưa trả product-level evidence; các tổng số bền vững phía trên vẫn được giữ nguyên.</EvidenceNote>}
  </div>;
}

function AttemptDistribution({ checkpoints }: { checkpoints: Checkpoint[] }): JSX.Element {
  const buckets = ['1', '2', '3', '4+'].map((attempt) => ({
    attempt,
    lightcurve: checkpoints.filter((point) => normalizeKind(point.product_kind) === 'lightcurve' && attemptBucket(point.attempts) === attempt).length,
    target_pixel: checkpoints.filter((point) => normalizeKind(point.product_kind) === 'target_pixel' && attemptBucket(point.attempts) === attempt).length,
  }));
  return <section className="border border-border/70 bg-background/40">
    <div className="border-b border-border/60 px-3 py-2"><p className="font-medium">Recovery attempt distribution</p><p className="text-[10px] text-muted-foreground">Chỉ xuất hiện khi có checkpoint đã đi qua nhiều hơn một attempt.</p></div>
    <div className="h-52 p-2"><ResponsiveContainer width="100%" height="100%"><BarChart data={buckets}><CartesianGrid vertical={false} strokeDasharray="3 3" opacity={0.18} /><XAxis dataKey="attempt" tick={{ fontSize: 10 }} /><YAxis allowDecimals={false} tick={{ fontSize: 10 }} width={42} /><Tooltip formatter={(value) => `${Number(value).toLocaleString()} checkpoints`} /><Legend wrapperStyle={{ fontSize: 10 }} /><Bar dataKey="lightcurve" name="Light Curve" fill="#22d3ee" isAnimationActive={false} /><Bar dataKey="target_pixel" name="Target Pixel" fill="#a855f7" isAnimationActive={false} /></BarChart></ResponsiveContainer></div>
  </section>;
}

function CheckpointAnomalies({ points }: { points: Checkpoint[] }): JSX.Element {
  const reasons = [
    { label: 'Verify Silver', action: 'verify_silver' },
    { label: 'Reprocess required', action: 'reprocess' },
    { label: 'Terminal', action: 'terminal' },
  ].map((reason) => ({ ...reason, count: points.filter((point) => point.resume_action === reason.action).length })).filter((reason) => reason.count > 0);
  return <section className="border border-amber-500/35 bg-amber-500/5">
    <div className="border-b border-amber-500/25 px-3 py-2"><p className="font-medium text-amber-800 dark:text-amber-200">Recovery attention required</p><p className="text-[10px] text-muted-foreground">Các record này chưa được backend cho phép đi fast-path reuse.</p></div>
    <div className="grid gap-px bg-border/60 sm:grid-cols-3">{reasons.map((reason) => <Metric key={reason.action} label={reason.label} value={reason.count.toLocaleString()} detail={percent(reason.count, points.length)} />)}</div>
  </section>;
}

function ChartPanel({ title, subtitle, children }: { title: string; subtitle: string; children: JSX.Element }): JSX.Element {
  return <section className="border border-border/70 bg-background/40"><div className="border-b border-border/60 px-3 py-2"><p className="font-medium">{title}</p><p className="text-[10px] text-muted-foreground">{subtitle}</p></div><div className="h-64 p-2">{children}</div></section>;
}

function Metric({ label, value, detail }: { label: string; value: string; detail: string }): JSX.Element {
  return <div className="bg-background p-3"><p className="text-[9px] uppercase tracking-wide text-muted-foreground">{label}</p><p className="mt-1 font-mono text-sm font-semibold text-foreground">{value}</p><p className="mt-0.5 text-[9px] text-muted-foreground">{detail}</p></div>;
}

function EvidenceNote({ children }: { children: string }): JSX.Element {
  return <div className="flex min-h-28 items-center justify-center border border-dashed border-border/70 p-6 text-center text-xs text-muted-foreground">{children}</div>;
}

function buildLifecycleHistogram(points: Checkpoint[]): Array<{ band: string; lightcurve: number; target_pixel: number }> {
  const durations = points.map((point) => point.lifecycle_elapsed_ms).filter((value) => value >= 0);
  if (durations.length < 2) return [];
  const min = Math.min(...durations);
  const max = Math.max(...durations);
  if (max <= min) return [];
  const width = (max - min) / 6;
  return Array.from({ length: 6 }, (_, index) => {
    const lower = min + width * index;
    const upper = index === 5 ? max + 1 : min + width * (index + 1);
    const selected = points.filter((point) => point.lifecycle_elapsed_ms >= lower && point.lifecycle_elapsed_ms < upper);
    return {
      band: `${compactDuration(lower)}–${compactDuration(index === 5 ? max : upper)}`,
      lightcurve: selected.filter((point) => normalizeKind(point.product_kind) === 'lightcurve').length,
      target_pixel: selected.filter((point) => normalizeKind(point.product_kind) === 'target_pixel').length,
    };
  });
}

function buildCompletionTimeline(points: Checkpoint[]): Array<{ timestamp: number; lightcurve: number; target_pixel: number }> {
  const completed = points
    .filter((point) => point.state === 'COMPLETED')
    .map((point) => ({ ...point, timestamp: new Date(point.updated_at).getTime() }))
    .filter((point) => Number.isFinite(point.timestamp))
    .sort((a, b) => a.timestamp - b.timestamp);
  if (completed.length === 0) return [];
  const start = completed[0].timestamp;
  const end = completed[completed.length - 1].timestamp;
  const width = Math.max(1, (end - start) / 18);
  const buckets = new Map<number, Checkpoint[]>();
  for (const point of completed) {
    const bucket = Math.min(17, Math.floor((point.timestamp - start) / width));
    const existing = buckets.get(bucket) ?? [];
    existing.push(point);
    buckets.set(bucket, existing);
  }
  let lightcurve = 0;
  let targetPixel = 0;
  return [...buckets.entries()].sort(([a], [b]) => a - b).map(([bucket, bucketPoints]) => {
    lightcurve += bucketPoints.filter((point) => normalizeKind(point.product_kind) === 'lightcurve').length;
    targetPixel += bucketPoints.filter((point) => normalizeKind(point.product_kind) === 'target_pixel').length;
    return { timestamp: start + width * bucket, lightcurve, target_pixel: targetPixel };
  });
}

function percentile(values: number[], quantile: number): number {
  if (values.length === 0) return 0;
  const ordered = [...values].sort((a, b) => a - b);
  const position = quantile * (ordered.length - 1);
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return ordered[lower];
  return ordered[lower] * (upper - position) + ordered[upper] * (position - lower);
}

function normalizeKind(kind: string): 'lightcurve' | 'target_pixel' | 'other' {
  const normalized = kind.toLowerCase().replaceAll('-', '_');
  if (normalized === 'lightcurve' || normalized === 'light_curve') return 'lightcurve';
  if (normalized === 'target_pixel' || normalized === 'targetpixel') return 'target_pixel';
  return 'other';
}

function attemptBucket(attempts: number): string {
  if (attempts >= 4) return '4+';
  return String(Math.max(1, attempts));
}

function percent(value: number, total: number): string {
  return total > 0 ? `${((value / total) * 100).toFixed(2)}%` : '—';
}

function formatDuration(milliseconds: number): string {
  if (milliseconds < 1_000) return `${Math.round(milliseconds)} ms`;
  if (milliseconds < 60_000) return `${(milliseconds / 1_000).toFixed(1)} s`;
  return `${(milliseconds / 60_000).toFixed(1)} min`;
}

function compactDuration(milliseconds: number): string {
  if (milliseconds < 60_000) return `${Math.round(milliseconds / 1_000)}s`;
  return `${(milliseconds / 60_000).toFixed(1)}m`;
}

function clock(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function timestampLabel(timestamp: number): string {
  return new Date(timestamp).toLocaleString();
}
