import type { JSX } from 'react';
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from 'recharts';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart';
import {
  compactNumber,
  formatMetricValue,
  formatTime,
  metricColor,
  type MonitoringMetric,
} from '../types';

interface MetricChartProps {
  metric: MonitoringMetric;
  idle?: boolean;
}

export function MetricChart({ metric, idle = false }: MetricChartProps): JSX.Element {
  const color = metricColor(metric);
  const chartConfig: ChartConfig = { value: { label: metric.name, color } };
  const points = metric.points.map((point) => ({ timestamp: point.timestamp, value: point.value }));
  const latest = points.at(-1)?.value;

  return (
    <Card className="min-w-0 rounded-none border-border/80 shadow-none">
      <CardHeader className="border-b border-border/60 pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate font-mono text-[9px] uppercase tracking-[0.12em] text-muted-foreground">
              {metric.kind} / {metric.key}
            </p>
            <CardTitle className="mt-1 truncate text-sm" title={metric.name}>
              {metric.name}
            </CardTitle>
          </div>
          <div className="shrink-0 text-right">
            <p className="font-mono text-sm font-medium tabular-nums text-foreground">
              {idle ? 'IDLE' : latest === undefined ? '—' : formatMetricValue(latest, metric.unit)}
            </p>
            <p className="mt-1 font-mono text-[9px] uppercase text-muted-foreground">
              {idle ? 'no observations' : `${points.length} samples`}
            </p>
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-3 sm:p-4">
        {points.length === 0 ? (
          <div className="flex h-44 items-center justify-center border border-dashed border-border/70 px-4 text-center text-xs text-muted-foreground">
            Metric signal unavailable
          </div>
        ) : (
          <ChartContainer
            config={chartConfig}
            className="aspect-auto w-full"
            style={{ height: 176, minHeight: 176 }}
            initialDimension={{ width: 640, height: 176 }}
          >
            <AreaChart data={points} margin={{ left: 0, right: 8, top: 8, bottom: 0 }}>
              <defs>
                <linearGradient id={`fill-${metric.key}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={color} stopOpacity={0.32} />
                  <stop offset="95%" stopColor={color} stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid vertical={false} strokeDasharray="3 3" />
              <XAxis
                dataKey="timestamp"
                tickLine={false}
                axisLine={false}
                tickMargin={8}
                minTickGap={28}
                tickFormatter={formatTime}
              />
              <YAxis
                tickLine={false}
                axisLine={false}
                width={48}
                padding={{ top: 8, bottom: 8 }}
                tickFormatter={(value) => compactNumber(Number(value))}
              />
              <ChartTooltip
                cursor={false}
                content={
                  <ChartTooltipContent
                    labelFormatter={(_value, payload) => {
                      const item = payload?.[0]?.payload;
                      const ts = item?.timestamp ?? (typeof _value === 'number' ? _value : Number(_value));
                      return formatTime(ts);
                    }}
                    formatter={(value) => formatMetricValue(Number(value), metric.unit)}
                  />
                }
              />
              <Area
                type="monotone"
                dataKey="value"
                stroke={color}
                strokeWidth={1.5}
                fill={`url(#fill-${metric.key})`}
                dot={false}
                isAnimationActive={false}
              />
            </AreaChart>
          </ChartContainer>
        )}
      </CardContent>
    </Card>
  );
}
