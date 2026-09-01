import type { JSX } from 'react';
import {
  Area,
  AreaChart,
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  Pie,
  PieChart,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from 'recharts';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import type { FactoryRun, FactoryRunDetail } from '@/features/factory-history/types';

const colors = {
  primary: '#159dcc',
  cyan: '#06b6d4',
  emerald: '#10b981',
  amber: '#f59e0b',
  rose: '#e11d48',
  slate: '#64748b',
};

function timestamp(value?: string): number | undefined {
  if (!value) return undefined;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : undefined;
}

function durationSeconds(start?: string, end?: string): number | undefined {
  const startAt = timestamp(start);
  const endAt = timestamp(end);
  if (startAt === undefined || endAt === undefined || endAt < startAt) return undefined;
  return (endAt - startAt) / 1000;
}

function compact(value: number): string {
  if (!Number.isFinite(value)) return '—';
  if (Math.abs(value) >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (Math.abs(value) >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return value.toFixed(value % 1 === 0 ? 0 : 1);
}

function formatDuration(value: number): string {
  if (value < 60) return `${value.toFixed(value < 10 ? 1 : 0)}s`;
  if (value < 3600) return `${(value / 60).toFixed(1)}m`;
  return `${(value / 3600).toFixed(1)}h`;
}

function shortDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' });
}

function chartCard(title: string, description: string, body: JSX.Element): JSX.Element {
  return (
    <Card className="min-w-0 rounded-none border-border/80 shadow-none">
      <CardHeader className="border-b border-border/60 pb-3">
        <CardTitle className="text-sm">{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="p-3 sm:p-4">{body}</CardContent>
    </Card>
  );
}

function EmptyChart({ children }: { children: string }): JSX.Element {
  return <div className="flex h-64 items-center justify-center border border-dashed border-border/70 px-4 text-center text-xs text-muted-foreground">{children}</div>;
}

export function RunAnalysisCharts({ runs, detail }: { runs: FactoryRun[]; detail?: FactoryRunDetail }): JSX.Element {
  const phaseNames = [...new Set((detail?.components ?? []).map((event) => event.component_id))];
  const runStart = timestamp(detail?.run.started_at);
  const phasePoints = (detail?.components ?? []).flatMap((event) => {
    const occurredAt = timestamp(event.occurred_at);
    const phaseIndex = phaseNames.indexOf(event.component_id);
    if (occurredAt === undefined || runStart === undefined || phaseIndex < 0) return [];
    return [{
      elapsed: Math.max(0, (occurredAt - runStart) / 1000),
      phaseIndex,
      component: event.component_id,
      status: event.status,
      input: event.input_records,
      output: event.output_rows,
    }];
  });
  const statusGroups = [
    { id: 'success', color: colors.emerald, points: phasePoints.filter((point) => /COMPLETED/.test(point.status.toUpperCase())) },
    { id: 'active', color: colors.primary, points: phasePoints.filter((point) => /RUNNING|SYNCING|DRAINING/.test(point.status.toUpperCase())) },
    { id: 'error', color: colors.rose, points: phasePoints.filter((point) => /FAILED|ERROR/.test(point.status.toUpperCase())) },
    { id: 'state', color: colors.slate, points: phasePoints.filter((point) => !/COMPLETED|RUNNING|SYNCING|DRAINING|FAILED|ERROR/.test(point.status.toUpperCase())) },
  ];

  const batches = (detail?.batches ?? []).map((batch, index) => ({
    label: `B${index + 1}`,
    input: batch.input_records,
    output: batch.candidate_rows,
    indexed: batch.indexed_rows,
    duration: durationSeconds(batch.started_at, batch.completed_at),
    snapshot: batch.snapshot_id ?? batch.batch_id,
  }));

  const runTrend = [...runs].reverse().slice(-24).map((run) => ({
    label: shortDate(run.started_at),
    runID: run.run_id,
    input: run.input_records,
    output: run.output_rows,
    indexed: run.indexed_rows,
  }));

  const statusCounts = new Map<string, number>();
  for (const run of runs) {
    const status = run.status.toUpperCase();
    statusCounts.set(status, (statusCounts.get(status) ?? 0) + 1);
  }
  const statusData = [...statusCounts].map(([name, value]) => ({ name, value }));
  const statusColor = (status: string): string => {
    if (/COMPLETED/.test(status)) return colors.emerald;
    if (/FAILED|ERROR/.test(status)) return colors.rose;
    if (/RUNNING|DRAINING/.test(status)) return colors.primary;
    return colors.slate;
  };

  return (
    <section className="space-y-3">
      <div className="border-l-2 border-primary pl-3">
        <h3 className="text-sm font-medium">Run analytics</h3>
        <p className="mt-0.5 text-xs text-muted-foreground">Biểu đồ dùng timestamp và record counts từ durable history; không nội suy phase bị thiếu.</p>
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        {chartCard('Phase event timeline', 'Scatter timeline của component state trong run đang chọn.', phasePoints.length === 0 ? <EmptyChart>Chọn một run có component events để phân tích phase timeline.</EmptyChart> : (
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <ScatterChart margin={{ top: 10, right: 14, bottom: 8, left: 18 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis type="number" dataKey="elapsed" name="Elapsed" unit="s" tickFormatter={(value) => formatDuration(Number(value))} />
                <YAxis type="number" dataKey="phaseIndex" domain={[-0.5, Math.max(0.5, phaseNames.length - 0.5)]} ticks={phaseNames.map((_, index) => index)} tickFormatter={(value) => phaseNames[Number(value)] ?? ''} width={92} />
                <ZAxis range={[70, 70]} />
                <Tooltip cursor={{ strokeDasharray: '3 3' }} formatter={(value, name) => name === 'Elapsed' ? formatDuration(Number(value)) : String(value)} />
                {statusGroups.filter((group) => group.points.length > 0).map((group) => <Scatter key={group.id} name={group.id} data={group.points} fill={group.color} isAnimationActive={false} />)}
              </ScatterChart>
            </ResponsiveContainer>
          </div>
        ))}

        {chartCard('Batch volume + latency', 'Bar biểu diễn records; line biểu diễn thời lượng commit thực tế.', batches.length === 0 ? <EmptyChart>Run này chưa có batch đã ghi vào durable ledger.</EmptyChart> : (
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={batches} margin={{ top: 10, right: 12, bottom: 8, left: 4 }}>
                <CartesianGrid vertical={false} strokeDasharray="3 3" />
                <XAxis dataKey="label" />
                <YAxis yAxisId="records" tickFormatter={(value) => compact(Number(value))} width={48} />
                <YAxis yAxisId="duration" orientation="right" tickFormatter={(value) => formatDuration(Number(value))} width={48} />
                <Tooltip formatter={(value, name) => name === 'duration' ? formatDuration(Number(value)) : compact(Number(value))} />
                <Legend />
                <Bar yAxisId="records" dataKey="input" name="Silver input" fill={colors.cyan} opacity={0.75} />
                <Bar yAxisId="records" dataKey="output" name="Gold rows" fill={colors.emerald} opacity={0.75} />
                <Line yAxisId="duration" type="monotone" dataKey="duration" name="Duration" stroke={colors.amber} strokeWidth={2} dot={{ r: 3 }} connectNulls={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        ))}

        {chartCard('Run record trend', 'Area trend giữa các run: Silver input, Gold output và ClickHouse indexed rows.', runTrend.length === 0 ? <EmptyChart>Chưa có historical run để dựng trend.</EmptyChart> : (
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={runTrend} margin={{ top: 10, right: 12, bottom: 8, left: 4 }}>
                <defs>
                  <linearGradient id="run-input" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor={colors.cyan} stopOpacity={0.35} /><stop offset="95%" stopColor={colors.cyan} stopOpacity={0.02} /></linearGradient>
                  <linearGradient id="run-output" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor={colors.emerald} stopOpacity={0.32} /><stop offset="95%" stopColor={colors.emerald} stopOpacity={0.02} /></linearGradient>
                </defs>
                <CartesianGrid vertical={false} strokeDasharray="3 3" />
                <XAxis dataKey="label" minTickGap={24} />
                <YAxis tickFormatter={(value) => compact(Number(value))} width={48} />
                <Tooltip formatter={(value) => compact(Number(value))} />
                <Legend />
                <Area type="monotone" dataKey="input" name="Silver input" stroke={colors.cyan} fill="url(#run-input)" isAnimationActive={false} />
                <Area type="monotone" dataKey="output" name="Gold output" stroke={colors.emerald} fill="url(#run-output)" isAnimationActive={false} />
                <Line type="monotone" dataKey="indexed" name="Indexed" stroke={colors.amber} strokeWidth={1.8} dot={false} isAnimationActive={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        ))}

        {chartCard('Historical run states', 'Donut phân bố trạng thái thật của các run trong history window.', statusData.length === 0 ? <EmptyChart>Chưa có run state để phân tích.</EmptyChart> : (
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={statusData} dataKey="value" nameKey="name" innerRadius={58} outerRadius={92} paddingAngle={2} stroke="none" label={({ name, value }) => `${name} · ${value}`}>
                  {statusData.map((entry) => <Cell key={entry.name} fill={statusColor(entry.name)} />)}
                </Pie>
                <Tooltip formatter={(value) => `${value} runs`} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        ))}
      </div>
    </section>
  );
}
