import { useCallback, useEffect, useMemo, useState } from 'react';
import type { JSX } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Area,
  AreaChart,
  CartesianGrid,
  XAxis,
  YAxis,
} from 'recharts';

import { apiFetch } from '@/lib/api';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';

type MonitoringPoint = { timestamp: number; value: number };
type MonitoringMetric = {
  key: string;
  name: string;
  unit: string;
  kind: string;
  points: MonitoringPoint[];
};
type MonitoringComponent = {
  id: string;
  name: string;
  group: string;
  container: string;
  status: 'up' | 'degraded' | 'no_data';
  metrics: MonitoringMetric[];
};
type MonitoringResponse = {
  source: string;
  tab: string;
  range: string;
  start: string;
  end: string;
  step_seconds: number;
  components: MonitoringComponent[];
};

const tabs = [
  { id: 'go-ingester', label: 'Ingester', group: 'Pipeline' },
  { id: 'rust-preprocessor', label: 'Preprocessor', group: 'Pipeline' },
  { id: 'python-ml-worker', label: 'ML worker', group: 'Pipeline' },
  { id: 'rust-inference', label: 'Inference', group: 'Pipeline' },
  { id: 'go-api', label: 'Go API', group: 'Platform' },
  { id: 'minio', label: 'MinIO', group: 'Platform' },
  { id: 'nats', label: 'NATS', group: 'Platform' },
  { id: 'clickhouse', label: 'ClickHouse', group: 'Platform' },
] as const;

const chartColors = ['#159dcc', '#0ea5e9', '#38bdf8', '#0284c7', '#67e8f9', '#0369a1'];

function formatValue(value: number): string {
  if (!Number.isFinite(value)) return '—';
  if (Math.abs(value) >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (Math.abs(value) >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  if (Math.abs(value) < 0.01 && value !== 0) return value.toExponential(1);
  return value.toFixed(value % 1 === 0 ? 0 : 2);
}

function formatTime(timestamp: number): string {
  return new Date(timestamp * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function MetricChart({ metric, index }: { metric: MonitoringMetric; index: number }): JSX.Element {
  const color = chartColors[index % chartColors.length];
  const chartConfig: ChartConfig = { value: { label: metric.name, color } };
  const points = metric.points.map((point) => ({ timestamp: point.timestamp, value: point.value }));
  const latest = points.at(-1)?.value;

  return (
    <Card className="min-w-0 rounded-md border-border/60 bg-card/70">
      <CardHeader className="border-b border-border/50 pb-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="text-sm">{metric.name}</CardTitle>
            <CardDescription className="mt-1 font-mono text-[11px]">{metric.unit}</CardDescription>
          </div>
          <span className="font-mono text-sm tabular-nums text-foreground">
            {latest === undefined ? '—' : formatValue(latest)}
          </span>
        </div>
      </CardHeader>
      <CardContent className="pt-4">
        {points.length === 0 ? (
          <div className="flex h-48 items-center justify-center rounded-md border border-dashed border-border/60 text-xs text-muted-foreground">
            Prometheus chưa có dữ liệu trong khoảng thời gian này
          </div>
        ) : (
          <ChartContainer config={chartConfig} className="h-48 w-full aspect-auto">
            <AreaChart data={points} margin={{ left: 0, right: 8, top: 8, bottom: 0 }}>
              <defs>
                <linearGradient id={`fill-${metric.key}-${index}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={color} stopOpacity={0.35} />
                  <stop offset="95%" stopColor={color} stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid vertical={false} strokeDasharray="3 3" />
              <XAxis dataKey="timestamp" tickLine={false} axisLine={false} tickMargin={8} minTickGap={28} tickFormatter={formatTime} />
              <YAxis tickLine={false} axisLine={false} width={48} tickFormatter={formatValue} />
              <ChartTooltip cursor={false} content={<ChartTooltipContent labelFormatter={(value) => formatTime(Number(value))} />} />
              <Area type="monotone" dataKey="value" stroke={color} strokeWidth={2} fill={`url(#fill-${metric.key}-${index})`} dot={false} isAnimationActive={false} />
            </AreaChart>
          </ChartContainer>
        )}
      </CardContent>
    </Card>
  );
}

export default function HealthSection(): JSX.Element {
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedTab = searchParams.get('tab') ?? tabs[0].id;
  const activeTab = tabs.some((tab) => tab.id === requestedTab) ? requestedTab : tabs[0].id;
  const [response, setResponse] = useState<MonitoringResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const selected = response?.components[0];

  const tabMeta = useMemo(() => tabs.find((tab) => tab.id === activeTab) ?? tabs[0], [activeTab]);

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const payload = await apiFetch<MonitoringResponse>(`/v1/monitoring?tab=${encodeURIComponent(activeTab)}&range=1h&step=60`);
      setResponse(payload);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Không thể tải monitoring');
    } finally {
      setLoading(false);
    }
  }, [activeTab]);

  useEffect(() => {
    void load();
  }, [load]);

  const changeTab = (value: string): void => {
    const next = new URLSearchParams(searchParams);
    next.set('tab', value);
    setSearchParams(next);
  };

  return (
    <section className="space-y-5">
      <Tabs value={activeTab} onValueChange={changeTab} className="w-full">
        <TabsList variant="line" className="w-full justify-start gap-1 overflow-x-auto overflow-y-hidden rounded-none border-b border-border/60 pb-0">
          {tabs.map((tab) => (
            <TabsTrigger key={tab.id} value={tab.id} className="shrink-0 rounded-sm px-3 py-2 text-xs">
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {loading ? (
        <div className="grid gap-4 md:grid-cols-2">
          {[0, 1, 2, 3].map((item) => <Skeleton key={item} className="h-72 rounded-md" />)}
        </div>
      ) : error ? (
        <div className="rounded-md border border-rose-400/30 bg-rose-400/10 p-5 text-sm text-rose-300">{error}</div>
      ) : selected && selected.metrics.length > 0 ? (
        <div className="grid gap-4 md:grid-cols-2">
          {selected.metrics.map((metric, index) => <MetricChart key={metric.key} metric={metric} index={index} />)}
        </div>
      ) : (
        <div className="rounded-md border border-dashed border-border/60 p-10 text-center text-sm text-muted-foreground">
          Chưa có metric cho component {tabMeta.label}.
        </div>
      )}
    </section>
  );
}
