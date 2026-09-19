import { useMemo, type JSX } from 'react';
import { AlertCircle, Clock3 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';

import { CapacityChart } from './CapacityChart';
import { MetricChart } from './MetricChart';
import {
  capacityPairs,
  resourceMetricKeys,
  type MonitoringComponent,
  type MonitoringMetric,
} from '../types';

type MetricDisplayItem =
  | {
      kind: 'capacity';
      group: 'resource';
      used: MonitoringMetric;
      total: MonitoringMetric;
      pair: (typeof capacityPairs)[number];
      detail: string;
    }
  | {
      kind: 'metric';
      group: 'resource' | 'workload';
      metric: MonitoringMetric;
      detail?: string;
      idle?: boolean;
    };

interface TelemetryGridProps {
  selected?: MonitoringComponent;
  loading: boolean;
  error: string | null;
  componentLabel: string;
  onRetry: () => void;
}

export function TelemetryGrid({
  selected,
  loading,
  error,
  componentLabel,
  onRetry,
}: TelemetryGridProps): JSX.Element {
  const metricDisplays = useMemo((): MetricDisplayItem[] => {
    if (!selected) return [];
    const byKey = new Map(selected.metrics.map((metric) => [metric.key, metric]));
    const totalKeys = new Set(capacityPairs.map((pair) => pair.totalKey));
    const hiddenMetricKeys = new Set(['gpu_available']);
    const gpuAvailable = (byKey.get('gpu_available')?.points.at(-1)?.value ?? 0) > 0;
    if (selected.id === 'python-ml-worker' && !gpuAvailable) {
      hiddenMetricKeys.add('gpu_utilization');
      hiddenMetricKeys.add('gpu_memory_used');
      hiddenMetricKeys.add('gpu_memory_total');
    }
    const trafficIdle = byKey.get('throughput')?.points.at(-1)?.value === 0;
    return selected.metrics.flatMap((metric): MetricDisplayItem[] => {
      if (!metric.key || metric.points.length === 0 || hiddenMetricKeys.has(metric.key) || totalKeys.has(metric.key as typeof capacityPairs[number]['totalKey'])) return [];
      const pair = capacityPairs.find((candidate) => candidate.usedKey === metric.key);
      const total = pair ? byKey.get(pair.totalKey) : undefined;
      if (pair && total && total.points.length > 0) {
        return [{
          kind: 'capacity' as const,
          group: 'resource' as const,
          used: metric,
          total,
          pair,
          detail: pair.usedKey === 'gpu_memory_used'
            ? 'Dedicated GPU VRAM telemetry from NVML'
            : 'Hardware device telemetry',
        }];
      }
      return [{
        kind: 'metric' as const,
        group: resourceMetricKeys.has(metric.key) ? 'resource' as const : 'workload' as const,
        metric,
        detail: metric.key === 'errors' && metric.points.at(-1)?.value === 0
          ? 'Zero failures observed across window'
          : metric.key === 'throughput' && trafficIdle
            ? 'Awaiting upstream pipeline events'
            : undefined,
        idle: metric.kind === 'histogram p95' && trafficIdle,
      }];
    });
  }, [selected]);

  const workloadDisplays = metricDisplays.filter((display) => display.group === 'workload');
  const resourceDisplays = metricDisplays.filter((display) => display.group === 'resource');

  if (loading && !selected) {
    return (
      <div className="grid gap-4 md:grid-cols-2">
        {[0, 1, 2, 3].map((item) => (
          <Skeleton key={item} className="h-64 rounded-none" />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col gap-4 border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <AlertCircle className="mt-0.5 size-4 shrink-0" />
          <div>
            <p className="font-medium">Prometheus query interrupted</p>
            <p className="mt-0.5 text-xs">{error}</p>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={onRetry} className="rounded-none">
          Retry query
        </Button>
      </div>
    );
  }

  if (selected && metricDisplays.length > 0) {
    return (
      <div className="space-y-6">
        {[
          {
            id: 'workload',
            title: 'Operational Telemetry',
            description: 'Throughput, latency, queue depth, and domain-specific operational signals.',
            displays: workloadDisplays,
          },
          {
            id: 'resource',
            title: 'Hardware & Accelerator Telemetry',
            description: 'NVIDIA GPU device compute utilization and physical VRAM allocation via NVML.',
            displays: resourceDisplays,
          },
        ]
          .filter((sec) => sec.displays.length > 0)
          .map((sec) => (
            <section key={sec.id} className="space-y-3">
              <div className="border-l-2 border-primary pl-3">
                <h3 className="text-sm font-medium">{sec.title}</h3>
                <p className="mt-0.5 text-xs text-muted-foreground">{sec.description}</p>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                {sec.displays.map((display) =>
                  display.kind === 'capacity' ? (
                    <CapacityChart
                      key={display.used.key}
                      used={display.used}
                      total={display.total}
                      title={display.pair.title}
                      usedLabel={display.pair.usedLabel}
                      totalLabel={display.pair.totalLabel}
                      detail={display.detail}
                    />
                  ) : (
                    <MetricChart key={display.metric.key} metric={display.metric} idle={display.idle} />
                  ),
                )}
              </div>
            </section>
          ))}
      </div>
    );
  }

  return (
    <div className="flex min-h-40 items-center justify-center border border-dashed border-border/70 px-5 text-center text-sm text-muted-foreground">
      <Clock3 className="mr-2 size-4 text-primary" /> No telemetry signals available for {componentLabel}; verify
      component scrape health and target status.
    </div>
  );
}
