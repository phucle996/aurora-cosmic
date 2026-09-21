import { type JSX } from 'react';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

import { clock, mergedSeries, type Telemetry } from './telemetry';

export function ProductDemuxChart({
  metrics,
  telemetry,
}: {
  mode?: 'stream' | 'batch';
  metrics?: Record<string, number>;
  telemetry?: Telemetry;
  totalFiles?: number;
}): JSX.Element {
  const observed = metrics?.inventory_observed === 1 || (metrics?.total_files ?? 0) > 0;
  const isBaseline = !observed;

  const total = Math.max(0, metrics?.total_files ?? 0);
  const lightCurves = Math.max(0, metrics?.lightcurve_files ?? 0);
  const targetPixels = Math.max(0, metrics?.target_pixel_files ?? 0);
  const unknown = Math.max(0, metrics?.unknown_files ?? 0);
  const errors = Math.max(0, metrics?.routing_errors ?? 0);
  const queueDepth = Math.max(0, metrics?.queue_depth ?? 0);
  const inflight = Math.max(0, metrics?.inflight_workers ?? 0);

  const effectiveTotal = Math.max(total, lightCurves + targetPixels + unknown);
  const lcPercent = effectiveTotal > 0 ? (lightCurves / effectiveTotal) * 100 : 0;
  const tpfPercent = effectiveTotal > 0 ? (targetPixels / effectiveTotal) * 100 : 0;

  const streams = [
    { name: 'Light Curve (1D Series)', value: lightCurves, fill: '#22d3ee', route: 'Stream 03A' },
    { name: 'Target Pixel (11×11 Cutouts)', value: targetPixels, fill: '#a855f7', route: 'Stream 03B' },
    ...(unknown > 0 ? [{ name: 'Unknown / Rejected', value: unknown, fill: '#ef4444', route: 'Rejection' }] : []),
  ].filter((item) => item.value > 0);

  const channelComparison = [
    { channel: 'Light Curve', routed: lightCurves, fill: '#22d3ee' },
    { channel: 'Target Pixel', routed: targetPixels, fill: '#a855f7' },
  ];

  const seriesData = mergedSeries(telemetry, ['throughput', 'lc_dispatch_rate', 'tpf_dispatch_rate']);
  const hasActiveRate = seriesData.some(
    (point) =>
      Number(point.throughput ?? 0) > 0 ||
      Number(point.lc_dispatch_rate ?? 0) > 0 ||
      Number(point.tpf_dispatch_rate ?? 0) > 0,
  );

  return (
    <div className="space-y-3">
      {isBaseline && (
        <div className="flex items-center justify-between border border-border/70 bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5 font-medium">
            <span className="size-2 rounded-full bg-amber-500" />
            Khung phân tích cơ sở: Router demux inventory chưa sẵn sàng (hiển thị mức nền 0).
          </span>
        </div>
      )}

      {/* KPI Cards */}
      <div className="grid gap-px border border-border/70 bg-border/70 sm:grid-cols-4 text-xs">
        <Metric label="Demuxed Products" value={effectiveTotal.toLocaleString()} subtext="Verified FITS classified" />
        <Metric
          label="Light Curve (03A)"
          value={lightCurves.toLocaleString()}
          subtext={`${lcPercent.toFixed(1)}% of routed volume`}
          highlightClass="text-cyan-600 dark:text-cyan-400"
        />
        <Metric
          label="Target Pixel (03B)"
          value={targetPixels.toLocaleString()}
          subtext={`${tpfPercent.toFixed(1)}% of routed volume`}
          highlightClass="text-purple-600 dark:text-purple-400"
        />
        <Metric
          label="Queue & Status"
          value={`${queueDepth} in queue`}
          subtext={`${inflight} workers inflight · ${errors} errors`}
        />
      </div>

      {/* Middle Visualizations */}
      <div className="grid gap-3 lg:grid-cols-[minmax(260px,0.42fr)_minmax(0,0.58fr)]">
        {/* Stream Fork Distribution */}
        <section className="border border-border/70 bg-background/40">
          <div className="border-b border-border/60 px-3 py-2">
            <p className="font-medium text-xs">Demux Branching Split</p>
            <p className="text-[10px] text-muted-foreground">
              Fork point dividing raw FITS into parallel 1D vs 2D pipelines.
            </p>
          </div>
          <div className="h-60">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={streams}
                  dataKey="value"
                  nameKey="name"
                  innerRadius={46}
                  outerRadius={78}
                  paddingAngle={2}
                  stroke="none"
                  label={(props: { name?: string | number; percent?: number }) =>
                    `${String(props.name ?? '').split(' ')[0]} · ${((props.percent ?? 0) * 100).toFixed(0)}%`
                  }
                >
                  {streams.map((item) => (
                    <Cell key={item.name} fill={item.fill} />
                  ))}
                </Pie>
                <Tooltip
                  formatter={(val, name) => [
                    `${Number(val).toLocaleString()} products`,
                    String(name),
                  ]}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </section>

        {/* Dispatched Volume Breakdown */}
        <section className="border border-border/70 bg-background/40">
          <div className="border-b border-border/60 px-3 py-2">
            <p className="font-medium text-xs">Routed Volume by Modality</p>
            <p className="text-[10px] text-muted-foreground">
              Verified count dispatched to LC vs TPF calibration workers.
            </p>
          </div>
          <div className="h-60 p-3">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={channelComparison} margin={{ left: 16, right: 16, top: 12, bottom: 8 }}>
                <CartesianGrid vertical={false} strokeDasharray="3 3" opacity={0.18} />
                <XAxis dataKey="channel" tick={{ fontSize: 11 }} />
                <YAxis allowDecimals={false} tick={{ fontSize: 10 }} />
                <Tooltip formatter={(item) => [`${Number(item).toLocaleString()} files`, 'Dispatched']} />
                <Bar dataKey="routed" name="Dispatched to Worker" isAnimationActive={false}>
                  {channelComparison.map((entry) => (
                    <Cell key={entry.channel} fill={entry.fill} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>
      </div>

      {/* Concurrent Stream Dispatch Rates */}
      {hasActiveRate ? (
        <section className="border border-border/70 bg-background/40">
          <div className="border-b border-border/60 px-3 py-2 flex items-center justify-between">
            <div>
              <p className="font-medium text-xs">Concurrent Demux Dispatch Rate</p>
              <p className="text-[10px] text-muted-foreground">
                Parallel feed rate into LC (03A) and TPF (03B) pipelines over time.
              </p>
            </div>
            <div className="flex items-center gap-3 text-[10px]">
              <span className="flex items-center gap-1">
                <span className="size-2 rounded-full bg-[#22d3ee]" /> LC Stream
              </span>
              <span className="flex items-center gap-1">
                <span className="size-2 rounded-full bg-[#a855f7]" /> TPF Stream
              </span>
            </div>
          </div>
          <div className="h-48 p-2">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={seriesData}>
                <defs>
                  <linearGradient id="lc-rate-grad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#22d3ee" stopOpacity={0.4} />
                    <stop offset="95%" stopColor="#22d3ee" stopOpacity={0.02} />
                  </linearGradient>
                  <linearGradient id="tpf-rate-grad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#a855f7" stopOpacity={0.4} />
                    <stop offset="95%" stopColor="#a855f7" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid vertical={false} strokeDasharray="3 3" opacity={0.18} />
                <XAxis dataKey="timestamp" tickFormatter={clock} minTickGap={28} tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} width={42} />
                <Tooltip
                  labelFormatter={(item) => clock(Number(item))}
                  formatter={(val, name) => [
                    `${Number(val).toFixed(3)} file/s`,
                    name === 'lc_dispatch_rate' ? 'LC Rate' : name === 'tpf_dispatch_rate' ? 'TPF Rate' : 'Total Rate',
                  ]}
                />
                <Legend
                  wrapperStyle={{ fontSize: '11px', paddingTop: '4px' }}
                  formatter={(value: string) =>
                    value === 'lc_dispatch_rate'
                      ? 'Light Curve Stream (03A)'
                      : value === 'tpf_dispatch_rate'
                        ? 'Target Pixel Stream (03B)'
                        : 'Combined Rate'
                  }
                />
                <Area
                  type="monotone"
                  dataKey="lc_dispatch_rate"
                  name="lc_dispatch_rate"
                  stroke="#22d3ee"
                  fill="url(#lc-rate-grad)"
                  strokeWidth={1.5}
                  dot={false}
                  isAnimationActive={false}
                />
                <Area
                  type="monotone"
                  dataKey="tpf_dispatch_rate"
                  name="tpf_dispatch_rate"
                  stroke="#a855f7"
                  fill="url(#tpf-rate-grad)"
                  strokeWidth={1.5}
                  dot={false}
                  isAnimationActive={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </section>
      ) : (
        <p className="border-l-2 border-muted-foreground/40 bg-background/40 px-3 py-2 text-[11px] text-muted-foreground">
          Không có activity trong observation window hiện tại; durable demux inventory phía trên là evidence của run đã hoàn tất.
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
  highlightClass,
}: {
  label: string;
  value: string;
  subtext?: string;
  highlightColor?: string;
  highlightClass?: string;
}): JSX.Element {
  return (
    <div className="bg-background p-3">
      <p className="text-[10px] uppercase font-medium text-muted-foreground">{label}</p>
      <p
        className={`mt-1 font-mono font-semibold text-sm ${highlightClass ?? 'text-foreground'}`}
        style={highlightColor ? { color: highlightColor } : undefined}
      >
        {value}
      </p>
      {subtext && <p className="mt-0.5 text-[10px] text-muted-foreground">{subtext}</p>}
    </div>
  );
}
