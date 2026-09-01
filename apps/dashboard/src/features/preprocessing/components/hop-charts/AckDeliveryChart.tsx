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

function value(metrics: Record<string, number> | undefined, key: string): number {
  return Math.max(0, Number(metrics?.[key] ?? 0));
}

export function AckDeliveryChart({ metrics }: { metrics?: Record<string, number> }): JSX.Element {
  const observed = value(metrics, 'consumer_observed') === 1;
  const streamMessages = value(metrics, 'stream_messages');
  const deliveryAttempts = value(metrics, 'delivery_attempts');
  const deliveredPositions = value(metrics, 'delivered_stream_positions');
  const acknowledgedDeliveries = value(metrics, 'acknowledged_deliveries');
  const acknowledgedPositions = value(metrics, 'acknowledged_stream_positions');
  const historicalRedeliveries = value(metrics, 'historical_redeliveries');
  const ackPending = value(metrics, 'ack_pending');
  const pending = value(metrics, 'pending');
  const currentRedelivered = value(metrics, 'current_redelivered');
  const terminal = value(metrics, 'terminal_checkpoints');
  const waiting = value(metrics, 'waiting_fetches');
  const lastDeliveredAt = value(metrics, 'last_delivered_timestamp') * 1_000;
  const lastAckAt = value(metrics, 'last_ack_timestamp') * 1_000;
  const lastAckLag = value(metrics, 'last_delivery_to_ack_seconds');
  const coverage = streamMessages > 0 ? acknowledgedPositions / streamMessages : 0;
  const deliveryAmplification = deliveredPositions > 0 ? deliveryAttempts / deliveredPositions : 0;
  const disposition = [
    { state: 'ACKed stream positions', count: acknowledgedPositions, fill: '#10b981' },
    { state: 'ACK pending', count: ackPending, fill: '#f59e0b' },
    { state: 'Not delivered', count: pending, fill: '#64748b' },
  ];
  const reconciliation = [
    { stage: 'Stream messages', positions: streamMessages, attempts: streamMessages },
    { stage: 'Delivered', positions: deliveredPositions, attempts: deliveryAttempts },
    { stage: 'ACK floor', positions: acknowledgedPositions, attempts: acknowledgedDeliveries },
  ];

  if (!observed) {
    return <div className="border border-dashed border-border/70 bg-background/40 p-8 text-center text-xs text-muted-foreground">Durable Bronze consumer chưa trả ACK metadata; UI không suy diễn ACK từ checkpoint hay Silver event.</div>;
  }

  return <div className="space-y-3">
    <div className="grid gap-px border border-border/70 bg-border/70 sm:grid-cols-4 xl:grid-cols-8">
      <Metric label="Stream messages" metricValue={streamMessages.toLocaleString()} detail="unique Bronze positions" />
      <Metric label="ACK coverage" metricValue={percent(coverage)} detail={`${acknowledgedPositions.toLocaleString()} positions`} tone={coverage >= 1 ? 'positive' : 'warning'} />
      <Metric label="Delivery attempts" metricValue={deliveryAttempts.toLocaleString()} detail={`${deliveryAmplification.toFixed(2)}× amplification`} />
      <Metric label="Historical redelivery" metricValue={historicalRedeliveries.toLocaleString()} detail={percentOf(historicalRedeliveries, deliveryAttempts)} tone={historicalRedeliveries > 0 ? 'warning' : 'positive'} />
      <Metric label="ACK pending" metricValue={ackPending.toLocaleString()} detail="delivered, not ACKed" tone={ackPending > 0 ? 'warning' : 'positive'} />
      <Metric label="Pending delivery" metricValue={pending.toLocaleString()} detail="not delivered" tone={pending > 0 ? 'warning' : 'positive'} />
      <Metric label="Current redelivery" metricValue={currentRedelivered.toLocaleString()} detail="consumer live state" tone={currentRedelivered > 0 ? 'warning' : 'positive'} />
      <Metric label="Terminal" metricValue={terminal.toLocaleString()} detail="TERM decisions" tone={terminal > 0 ? 'warning' : 'positive'} />
    </div>

    <div className="border border-primary/30 bg-primary/5 px-4 py-3">
      <p className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">ACK answer</p>
      <p className="mt-1 text-sm text-foreground">
        ACK floor đã xác nhận <strong className="font-mono text-emerald-600 dark:text-emerald-300">{acknowledgedPositions.toLocaleString()}/{streamMessages.toLocaleString()}</strong> Bronze stream positions;
        {' '}còn <strong className="font-mono">{ackPending.toLocaleString()}</strong> ACK-pending và <strong className="font-mono">{pending.toLocaleString()}</strong> chưa delivery.
      </p>
    </div>

    <div className="grid gap-3 xl:grid-cols-2">
      <ChartPanel title="Stream position reconciliation" subtitle="Đối chiếu identity của message với số delivery attempt; redelivery không được tính thành dữ liệu Bronze mới.">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={reconciliation} margin={{ left: 2, right: 12, top: 8, bottom: 8 }}>
            <CartesianGrid vertical={false} strokeDasharray="3 3" opacity={0.18} />
            <XAxis dataKey="stage" tick={{ fontSize: 10 }} />
            <YAxis allowDecimals={false} tick={{ fontSize: 9 }} width={52} />
            <Tooltip formatter={(item) => `${Number(item).toLocaleString()} messages`} />
            <Legend wrapperStyle={{ fontSize: 10 }} />
            <Bar dataKey="positions" name="Unique stream positions" fill="#22d3ee" isAnimationActive={false} />
            <Bar dataKey="attempts" name="Delivery attempts" fill="#a855f7" isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </ChartPanel>

      <ChartPanel title="Current consumer disposition" subtitle="Ba trạng thái loại trừ lẫn nhau tại thời điểm observer đọc durable consumer.">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={disposition} layout="vertical" margin={{ left: 32, right: 16, top: 8, bottom: 8 }}>
            <CartesianGrid horizontal={false} strokeDasharray="3 3" opacity={0.18} />
            <XAxis type="number" allowDecimals={false} tick={{ fontSize: 9 }} />
            <YAxis type="category" dataKey="state" width={126} tick={{ fontSize: 9 }} />
            <Tooltip formatter={(item) => `${Number(item).toLocaleString()} messages`} />
            <Bar dataKey="count" name="Messages" isAnimationActive={false}>
              {disposition.map((item) => <Cell key={item.state} fill={item.fill} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </ChartPanel>
    </div>

    <section className="border border-border/70 bg-background/40">
      <div className="border-b border-border/60 px-3 py-2"><p className="font-medium">Last delivery → ACK evidence</p><p className="text-[10px] text-muted-foreground">Timestamp từ durable consumer sequence state, không phải thời gian render trên browser.</p></div>
      <div className="grid gap-px bg-border/60 sm:grid-cols-4">
        <Metric label="Last delivery" metricValue={formatTimestamp(lastDeliveredAt)} detail="consumer delivered.last_active" />
        <Metric label="Last ACK" metricValue={formatTimestamp(lastAckAt)} detail="consumer ack_floor.last_active" />
        <Metric label="Observed lag" metricValue={formatDuration(lastAckLag)} detail="last ACK − last delivery" />
        <Metric label="Waiting fetches" metricValue={waiting.toLocaleString()} detail="idle pull requests" />
      </div>
    </section>

    {ackPending === 0 && pending === 0 && currentRedelivered === 0
      ? <div className="border border-emerald-500/30 bg-emerald-500/5 px-3 py-2 text-[11px] text-emerald-700 dark:text-emerald-300">Durable consumer đã hội tụ: ACK floor bắt kịp stream, không còn in-flight ACK hoặc redelivery hiện hành.</div>
      : <div className="border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-[11px] text-amber-700 dark:text-amber-300">Consumer chưa hội tụ; xem ACK pending, pending delivery và current redelivery phía trên.</div>}
  </div>;
}

function ChartPanel({ title, subtitle, children }: { title: string; subtitle: string; children: JSX.Element }): JSX.Element {
  return <section className="border border-border/70 bg-background/40"><div className="border-b border-border/60 px-3 py-2"><p className="font-medium">{title}</p><p className="text-[10px] text-muted-foreground">{subtitle}</p></div><div className="h-64 p-2">{children}</div></section>;
}

function Metric({ label, metricValue, detail, tone = 'default' }: { label: string; metricValue: string; detail: string; tone?: 'default' | 'positive' | 'warning' }): JSX.Element {
  const color = tone === 'positive' ? 'text-emerald-600 dark:text-emerald-300' : tone === 'warning' ? 'text-amber-600 dark:text-amber-300' : 'text-foreground';
  return <div className="bg-background p-3"><p className="text-[9px] uppercase tracking-wide text-muted-foreground">{label}</p><p className={`mt-1 font-mono text-sm font-semibold ${color}`}>{metricValue}</p><p className="mt-0.5 text-[9px] text-muted-foreground">{detail}</p></div>;
}

function percent(value: number): string {
  return Number.isFinite(value) ? `${(value * 100).toFixed(2)}%` : '—';
}

function percentOf(part: number, total: number): string {
  return total > 0 ? percent(part / total) : '—';
}

function formatTimestamp(timestamp: number): string {
  return timestamp > 0 ? new Date(timestamp).toLocaleString() : '—';
}

function formatDuration(seconds: number): string {
  if (seconds < 1) return `${(seconds * 1_000).toFixed(0)} ms`;
  return `${seconds.toFixed(2)} s`;
}
