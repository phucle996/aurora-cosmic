import { type JSX } from 'react';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

import { clock, mergedSeries, type Telemetry } from './telemetry';

function formatBytes(value: number): string {
  if (value <= 0) return '0 B';
  if (value < 1024 ** 3) return `${(value / 1024 ** 2).toFixed(2)} MB`;
  return `${(value / 1024 ** 3).toFixed(2)} GiB`;
}

export function CadenceTimelineChart({
  metrics,
  telemetry,
}: {
  mode?: 'stream' | 'batch';
  metrics?: Record<string, number>;
  telemetry?: Telemetry;
  totalFiles?: number;
}): JSX.Element {
  const observed = metrics?.inventory_observed === 1 || (metrics?.total_files ?? 0) > 0 || (metrics?.bronze_bytes ?? 0) > 0;
  const isBaseline = !observed;

  const total = Math.max(0, metrics?.total_files ?? 0);
  const pending = Math.max(0, metrics?.pending_files ?? 0);
  const failed = Math.max(0, metrics?.failed_files ?? 0);
  const verified = Math.max(0, total - pending - failed);

  const data = mergedSeries(telemetry, ['throughput', 'bronze_bytes_rate']);
  const hasActiveRate = data.some((point) => Number(point.throughput ?? 0) > 0);

  const integrityStates = [
    { name: 'Verified & Staged', value: verified, fill: '#10b981' },
    { name: 'Awaiting Checkpoint', value: pending, fill: '#f59e0b' },
    ...(failed > 0 ? [{ name: 'Integrity / Checksum Failed', value: failed, fill: '#ef4444' }] : []),
  ].filter((item) => item.value > 0);

  const disposition = [{ scope: 'Bronze Ingest', verified, pending, failed }];

  return (
    <div className="space-y-3">
      {isBaseline && (
        <div className="flex items-center justify-between border border-border/70 bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5 font-medium">
            <span className="size-2 rounded-full bg-amber-500" />
            Khung phân tích cơ sở: MinIO Bronze inventory chưa sẵn sàng (hiển thị mức nền 0).
          </span>
        </div>
      )}

      {/* Top Metric Cards */}
      <div className="grid gap-px border border-border/70 bg-border/70 sm:grid-cols-4 text-xs">
        <Metric label="Bronze Ingested FITS" value={total.toLocaleString()} subtext="Objects staged in MinIO" />
        <Metric label="Awaiting Checkpoint" value={pending.toLocaleString()} subtext="Uncommitted to Silver" highlightColor="#f59e0b" />
        <Metric label="Stored Footprint" value={formatBytes(metrics?.bronze_bytes ?? 0)} subtext="Durable Bronze partition" />
        <Metric
          label="Integrity Gate"
          value={failed === 0 ? '100% Valid' : `${failed} Failures`}
          subtext={failed === 0 ? 'SHA-256 verified intact' : 'Checksum mismatch'}
          highlightColor={failed === 0 ? '#10b981' : '#ef4444'}
        />
      </div>

      {/* Middle Charts */}
      <div className="grid gap-3 lg:grid-cols-[minmax(260px,0.42fr)_minmax(0,0.58fr)]">
        {/* Verification Breakdown */}
        <section className="border border-border/70 bg-background/40">
          <div className="border-b border-border/60 px-3 py-2">
            <p className="font-medium text-xs">Ingestion & Verification State</p>
            <p className="text-[10px] text-muted-foreground">Integrity gate status of source MAST FITS artifacts.</p>
          </div>
          <div className="h-60">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={integrityStates}
                  dataKey="value"
                  nameKey="name"
                  innerRadius={46}
                  outerRadius={78}
                  paddingAngle={2}
                  stroke="none"
                  label={({ name, percent }: { name: string; percent?: number }) =>
                    `${name.split(' ')[0]} · ${((percent ?? 0) * 100).toFixed(0)}%`
                  }
                >
                  {integrityStates.map((item) => (
                    <Cell key={item.name} fill={item.fill} />
                  ))}
                </Pie>
                <Tooltip formatter={(item) => [`${Number(item).toLocaleString()} FITS`, 'Count']} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </section>

        {/* Inventory Disposition */}
        <section className="border border-border/70 bg-background/40">
          <div className="border-b border-border/60 px-3 py-2">
            <p className="font-medium text-xs">Inventory Disposition</p>
            <p className="text-[10px] text-muted-foreground">Checkpointed, pending and terminal failure mutually exclusive.</p>
          </div>
          <div className="h-60 p-3">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={disposition} layout="vertical" margin={{ left: 24, right: 12 }}>
                <CartesianGrid horizontal={false} strokeDasharray="3 3" opacity={0.18} />
                <XAxis type="number" allowDecimals={false} tick={{ fontSize: 10 }} />
                <YAxis type="category" dataKey="scope" width={96} tick={{ fontSize: 10 }} />
                <Tooltip formatter={(item) => Number(item).toLocaleString()} />
                <Legend wrapperStyle={{ fontSize: '11px' }} />
                <Bar dataKey="verified" name="Verified" stackId="state" fill="#10b981" isAnimationActive={false} />
                <Bar dataKey="pending" name="Pending" stackId="state" fill="#f59e0b" isAnimationActive={false} />
                <Bar dataKey="failed" name="Failed" stackId="state" fill="#ef4444" isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>
      </div>

      {/* Observed Processing Rate */}
      {hasActiveRate ? (
        <section className="border border-border/70 bg-background/40">
          <div className="border-b border-border/60 px-3 py-2">
            <p className="font-medium text-xs">Observed Ingestion Throughput</p>
            <p className="text-[10px] text-muted-foreground">Staging and verification rate from MAST/MinIO over time.</p>
          </div>
          <div className="h-44 p-2">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={data}>
                <defs>
                  <linearGradient id="bronze-rate" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#10b981" stopOpacity={0.35} />
                    <stop offset="95%" stopColor="#10b981" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid vertical={false} strokeDasharray="3 3" opacity={0.18} />
                <XAxis dataKey="timestamp" tickFormatter={clock} minTickGap={28} tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} width={40} />
                <Tooltip labelFormatter={(item) => clock(Number(item))} formatter={(item) => [`${Number(item).toFixed(3)} file/s`, 'Rate']} />
                <Area dataKey="throughput" stroke="#10b981" fill="url(#bronze-rate)" dot={false} isAnimationActive={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </section>
      ) : (
        <p className="border-l-2 border-muted-foreground/40 bg-background/40 px-3 py-2 text-[11px] text-muted-foreground">
          Không có activity trong observation window hiện tại; durable inventory phía trên vẫn là evidence của run đã hoàn tất.
        </p>
      )}
    </div>
  );
}

function Metric({
  label,
  value,
  subtext,
  highlightColor,
}: {
  label: string;
  value: string;
  subtext?: string;
  highlightColor?: string;
}): JSX.Element {
  return (
    <div className="bg-background p-3">
      <p className="text-[10px] uppercase text-muted-foreground">{label}</p>
      <p className="mt-1 font-mono font-semibold text-foreground text-sm" style={highlightColor ? { color: highlightColor } : undefined}>
        {value}
      </p>
      {subtext && <p className="mt-0.5 text-[10px] text-muted-foreground">{subtext}</p>}
    </div>
  );
}
