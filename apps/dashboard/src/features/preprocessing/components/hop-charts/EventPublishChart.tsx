import { type JSX } from 'react';
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

function value(metrics: Record<string, number> | undefined, key: string): number {
  return Math.max(0, Number(metrics?.[key] ?? 0));
}

export function EventPublishChart({ metrics }: { metrics?: Record<string, number> }): JSX.Element {
  const observed = value(metrics, 'stream_observed') === 1;
  const eligible = value(metrics, 'eligible_artifacts');
  const emissions = value(metrics, 'event_emissions');
  const replay = value(metrics, 'event_replay_emissions');
  const eventBytes = value(metrics, 'event_bytes');
  const consumers = value(metrics, 'event_consumers');
  const firstAt = value(metrics, 'event_first_timestamp') * 1_000;
  const lastAt = value(metrics, 'event_last_timestamp') * 1_000;
  const durationSeconds = firstAt > 0 && lastAt >= firstAt ? (lastAt - firstAt) / 1_000 : 0;
  const amplification = eligible > 0 ? emissions / eligible : 0;
  const averagePayload = emissions > 0 ? eventBytes / emissions : 0;
  const kinds = [
    {
      kind: 'Light Curve',
      eligible: value(metrics, 'eligible_lightcurves'),
      emissions: value(metrics, 'lightcurve_emissions'),
    },
    {
      kind: 'Target Pixel',
      eligible: value(metrics, 'eligible_target_pixels'),
      emissions: value(metrics, 'target_pixel_emissions'),
    },
  ].map((item) => ({ ...item, baseline: Math.min(item.eligible, item.emissions), replay: Math.max(0, item.emissions - item.eligible) }));

  if (!observed) {
    return <div className="border border-dashed border-border/70 bg-background/40 p-8 text-center text-xs text-muted-foreground">AURORA_SILVER chưa trả stream metadata; UI không suy diễn event publication từ checkpoint.</div>;
  }

  return <div className="space-y-3">
    <div className="grid gap-px border border-border/70 bg-border/70 sm:grid-cols-4 xl:grid-cols-8">
      <Metric label="Eligible artifacts" value={eligible.toLocaleString()} detail="verified Silver inputs" />
      <Metric label="Durable emissions" value={emissions.toLocaleString()} detail="retained JetStream msgs" />
      <Metric label="Replay emissions" value={replay.toLocaleString()} detail={percent(replay, emissions)} tone={replay > 0 ? 'warning' : 'positive'} />
      <Metric label="Amplification" value={amplification > 0 ? `${amplification.toFixed(2)}×` : '—'} detail="emissions / artifacts" />
      <Metric label="Stream storage" value={formatBytes(eventBytes)} detail="AURORA_SILVER" />
      <Metric label="Mean envelope" value={formatBytes(averagePayload)} detail="bytes / emission" />
      <Metric label="Consumers" value={consumers.toLocaleString()} detail="attached downstream" />
      <Metric label="Publish window" value={formatDuration(durationSeconds)} detail={durationSeconds > 0 ? `${(emissions / durationSeconds).toFixed(2)} msg/s avg` : 'single timestamp'} />
    </div>

    <div className="border border-primary/30 bg-primary/5 px-4 py-3">
      <p className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">Publication answer</p>
      <p className="mt-1 text-sm text-foreground">
        <strong className="font-mono">{emissions.toLocaleString()}</strong> durable Silver-ready emissions đã được giữ cho
        {' '}<strong className="font-mono">{eligible.toLocaleString()}</strong> artifact;
        {' '}<strong className="font-mono text-amber-600 dark:text-amber-300">{replay.toLocaleString()}</strong> emission là publish lại trong recovery/redelivery.
      </p>
    </div>

    <div className="grid gap-3 xl:grid-cols-2">
      <ChartPanel title="Artifact identity vs event emissions" subtitle="So sánh số artifact duy nhất với tổng message thực sự được giữ trong JetStream theo LC/TPF.">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={kinds} margin={{ left: 2, right: 12, top: 8, bottom: 8 }}>
            <CartesianGrid vertical={false} strokeDasharray="3 3" opacity={0.18} />
            <XAxis dataKey="kind" tick={{ fontSize: 10 }} />
            <YAxis allowDecimals={false} tick={{ fontSize: 9 }} width={48} />
            <Tooltip formatter={(item) => `${Number(item).toLocaleString()} records`} />
            <Legend wrapperStyle={{ fontSize: 10 }} />
            <Bar dataKey="eligible" name="Eligible artifacts" fill="#22d3ee" isAnimationActive={false} />
            <Bar dataKey="emissions" name="Durable emissions" fill="#a855f7" isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </ChartPanel>

      <ChartPanel title="Publication disposition" subtitle="Baseline là một ready-event cho mỗi artifact; phần vượt baseline là recovery/redelivery replay.">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={kinds} layout="vertical" margin={{ left: 18, right: 16, top: 8, bottom: 8 }}>
            <CartesianGrid horizontal={false} strokeDasharray="3 3" opacity={0.18} />
            <XAxis type="number" allowDecimals={false} tick={{ fontSize: 9 }} />
            <YAxis type="category" dataKey="kind" width={82} tick={{ fontSize: 9 }} />
            <Tooltip formatter={(item) => `${Number(item).toLocaleString()} emissions`} />
            <Legend wrapperStyle={{ fontSize: 10 }} />
            <Bar dataKey="baseline" name="First publication" stackId="publication" fill="#10b981" isAnimationActive={false} />
            <Bar dataKey="replay" name="Recovery replay" stackId="publication" fill="#f59e0b" isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </ChartPanel>
    </div>

    <section className="border border-border/70 bg-background/40">
      <div className="border-b border-border/60 px-3 py-2"><p className="font-medium">Durable publish envelope</p><p className="text-[10px] text-muted-foreground">Khoảng thời gian và payload lấy từ AURORA_SILVER stream state.</p></div>
      <div className="grid gap-px bg-border/60 sm:grid-cols-4">
        <Metric label="First retained emission" value={formatTimestamp(firstAt)} detail="stream first timestamp" />
        <Metric label="Last retained emission" value={formatTimestamp(lastAt)} detail="stream last timestamp" />
        <Metric label="Elapsed" value={formatDuration(durationSeconds)} detail="first → last emission" />
        <Metric label="Mean durable rate" value={durationSeconds > 0 ? `${(emissions / durationSeconds).toFixed(2)} msg/s` : '—'} detail="whole publish window" />
      </div>
    </section>
  </div>;
}

function ChartPanel({ title, subtitle, children }: { title: string; subtitle: string; children: JSX.Element }): JSX.Element {
  return <section className="border border-border/70 bg-background/40"><div className="border-b border-border/60 px-3 py-2"><p className="font-medium">{title}</p><p className="text-[10px] text-muted-foreground">{subtitle}</p></div><div className="h-64 p-2">{children}</div></section>;
}

function Metric({ label, value: metricValue, detail, tone = 'default' }: { label: string; value: string; detail: string; tone?: 'default' | 'positive' | 'warning' }): JSX.Element {
  const color = tone === 'positive' ? 'text-emerald-600 dark:text-emerald-300' : tone === 'warning' ? 'text-amber-600 dark:text-amber-300' : 'text-foreground';
  return <div className="bg-background p-3"><p className="text-[9px] uppercase tracking-wide text-muted-foreground">{label}</p><p className={`mt-1 font-mono text-sm font-semibold ${color}`}>{metricValue}</p><p className="mt-0.5 text-[9px] text-muted-foreground">{detail}</p></div>;
}

function percent(part: number, total: number): string {
  return total > 0 ? `${((part / total) * 100).toFixed(2)}%` : '—';
}

function formatBytes(bytes: number): string {
  if (bytes < 1_000) return `${Math.round(bytes)} B`;
  if (bytes < 1_000_000) return `${(bytes / 1_000).toFixed(2)} KB`;
  return `${(bytes / 1_000_000).toFixed(2)} MB`;
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds.toFixed(1)} s`;
  return `${(seconds / 60).toFixed(1)} min`;
}

function formatTimestamp(timestamp: number): string {
  return timestamp > 0 ? new Date(timestamp).toLocaleString() : '—';
}
