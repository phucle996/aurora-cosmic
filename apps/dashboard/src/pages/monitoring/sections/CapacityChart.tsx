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
  formatCapacityValue,
  formatTime,
  type MonitoringMetric,
} from '../types';

interface CapacityChartProps {
  used: MonitoringMetric;
  total: MonitoringMetric;
  title: string;
  usedLabel: string;
  totalLabel: string;
  detail?: string;
}

export function CapacityChart({
  used,
  total,
  title,
  usedLabel,
  totalLabel,
  detail,
}: CapacityChartProps): JSX.Element {
  const latestTotal = total.points.at(-1)?.value;
  const totalByTimestamp = new Map(total.points.map((point) => [point.timestamp, point.value]));
  const points = used.points.flatMap((point) => {
    const totalValue = totalByTimestamp.get(point.timestamp) ?? latestTotal;
    if (totalValue === undefined || totalValue <= 0) return [];
    return [{ timestamp: point.timestamp, utilization: Math.min(100, Math.max(0, (point.value / totalValue) * 100)) }];
  });
  const latestUsed = used.points.at(-1)?.value;
  const utilization =
    latestUsed !== undefined && latestTotal !== undefined && latestTotal > 0
      ? Math.min(100, Math.max(0, (latestUsed / latestTotal) * 100))
      : undefined;

  const chartConfig: ChartConfig = {
    utilization: { label: 'Utilization', color: '#159dcc' },
  };

  return (
    <Card className="min-w-0 rounded-none border-border/80 shadow-none">
      <CardHeader className="border-b border-border/60 pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate font-mono text-[9px] uppercase tracking-[0.12em] text-muted-foreground">
              Capacity / {used.key}
            </p>
            <CardTitle className="mt-1 truncate text-sm" title={title}>
              {title}
            </CardTitle>
          </div>
          <div className="shrink-0 text-right">
            <p className="font-mono text-sm font-medium tabular-nums text-foreground">
              {latestUsed === undefined ? '—' : formatCapacityValue(latestUsed, used.unit)}
              <span className="mx-1 text-muted-foreground">/</span>
              {latestTotal === undefined ? '—' : formatCapacityValue(latestTotal, total.unit)}
            </p>
            <p className="mt-1 font-mono text-[9px] uppercase text-muted-foreground">
              {utilization === undefined ? 'ratio unavailable' : `${utilization.toFixed(1)}% utilized`}
            </p>
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-3 sm:p-4">
        {points.length === 0 ? (
          <div className="flex h-44 items-center justify-center border border-dashed border-border/70 px-4 text-center text-xs text-muted-foreground">
            Capacity signal unavailable
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
                <linearGradient id={`fill-capacity-${used.key}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#159dcc" stopOpacity={0.32} />
                  <stop offset="95%" stopColor="#159dcc" stopOpacity={0.02} />
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
                domain={[0, 100]}
                tickLine={false}
                axisLine={false}
                width={48}
                padding={{ top: 8, bottom: 8 }}
                tickFormatter={(value) => `${compactNumber(Number(value))}%`}
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
                    formatter={(value) => `${Number(value).toFixed(1)}%`}
                  />
                }
              />
              <Area
                type="monotone"
                dataKey="utilization"
                stroke="#159dcc"
                strokeWidth={1.5}
                fill={`url(#fill-capacity-${used.key})`}
                dot={false}
                isAnimationActive={false}
              />
            </AreaChart>
          </ChartContainer>
        )}
        <div className="mt-2 border-t border-border/50 pt-2 font-mono text-[9px] text-muted-foreground">
          <p className="uppercase">
            Utilization = {usedLabel} / {totalLabel}
          </p>
          {detail ? (
            <p className="mt-1 truncate" title={detail}>
              {detail}
            </p>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
