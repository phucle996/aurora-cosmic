export type MonitoringPoint = {
  timestamp: number;
  value: number;
  labels?: Record<string, string>;
};

export type MonitoringMetric = {
  key: string;
  name: string;
  unit: string;
  kind: string;
  points: MonitoringPoint[];
};

export type MonitoringStatus = 'up' | 'degraded' | 'no_data';

export type MonitoringComponent = {
  id: string;
  name: string;
  group: string;
  container: string;
  status: MonitoringStatus;
  metrics: MonitoringMetric[];
};

export type MonitoringResponse = {
  component: string;
  tab?: string;
  source?: string;
  range: string;
  start: string;
  end: string;
  step_seconds: number;
  components: MonitoringComponent[];
};

export const components = [
  { id: 'go-ingester', label: 'Ingester', group: 'Pipeline' },
  { id: 'rust-preprocessor', label: 'Preprocessor', group: 'Pipeline' },
  { id: 'python-ml-worker', label: 'ML worker', group: 'Pipeline' },
  { id: 'rust-inference', label: 'Inference', group: 'Pipeline' },
  { id: 'enrichment', label: 'Enrichment', group: 'Pipeline' },
  { id: 'go-api', label: 'Go API', group: 'Platform' },
  { id: 'minio', label: 'MinIO', group: 'Platform' },
  { id: 'nats', label: 'NATS', group: 'Platform' },
  { id: 'clickhouse', label: 'ClickHouse', group: 'Platform' },
] as const;

export const timeRanges = [
  { id: '15m', label: '15m', step: 15 },
  { id: '1h', label: '1h', step: 60 },
  { id: '6h', label: '6h', step: 300 },
  { id: '24h', label: '24h', step: 900 },
] as const;

export const capacityPairs = [
  { usedKey: 'gpu_memory_used', totalKey: 'gpu_memory_total', title: 'Shared GPU device memory', usedLabel: 'Device used', totalLabel: 'Device total' },
] as const;

export const resourceMetricKeys = new Set([
  'gpu_utilization',
  'gpu_memory_used',
]);

export function compactNumber(value: number): string {
  if (!Number.isFinite(value)) return '—';
  const absolute = Math.abs(value);
  if (absolute >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(1)}G`;
  if (absolute >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (absolute >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  if (absolute < 0.01 && value !== 0) return value.toExponential(1);
  return value.toFixed(value % 1 === 0 ? 0 : 2);
}

export function formatBytes(value: number): string {
  if (!Number.isFinite(value)) return '—';
  if (Math.abs(value) < 1024) return `${compactNumber(value)} B`;
  if (Math.abs(value) < 1024 ** 2) return `${(value / 1024).toFixed(1)} KiB`;
  if (Math.abs(value) < 1024 ** 3) return `${(value / 1024 ** 2).toFixed(1)} MiB`;
  return `${(value / 1024 ** 3).toFixed(2)} GiB`;
}

export function formatMetricValue(value: number, unit: string): string {
  if (!Number.isFinite(value)) return '—';
  if (unit === 'bytes') return formatBytes(value);
  if (unit === 'bytes/s') return `${formatBytes(value)}/s`;
  if (unit === 'seconds') {
    if (value > 0 && value < 0.001) return `${(value * 1_000_000).toFixed(0)} µs`;
    if (value > 0 && value < 1) return `${(value * 1000).toFixed(value < 0.01 ? 2 : 1)} ms`;
    return `${compactNumber(value)} s`;
  }
  if (unit === 'percent') return `${compactNumber(value)}%`;
  if (unit === 'up') return value >= 1 ? 'UP' : 'DOWN';
  return `${compactNumber(value)} ${unit}`.trim();
}

export function formatCapacityValue(value: number, unit: string): string {
  if (unit === 'cores') {
    const digits = Math.abs(value) < 0.01 ? 3 : Math.abs(value) < 1 ? 2 : value % 1 === 0 ? 0 : 1;
    return `${value.toFixed(digits)} cores`;
  }
  return formatMetricValue(value, unit);
}

export function formatTime(timestamp: number | string | undefined | null): string {
  if (timestamp === undefined || timestamp === null || timestamp === '') return '—';
  const num = typeof timestamp === 'number' ? timestamp : Number(timestamp);
  if (!Number.isFinite(num) || num <= 0) return '—';
  // Convert seconds (Prometheus Unix epoch ~1.7e9) to milliseconds
  const ms = num < 1e11 ? num * 1000 : num;
  const date = new Date(ms);
  if (Number.isNaN(date.valueOf())) return '—';
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export function metricColor(metric: MonitoringMetric): string {
  if (/error|failed|offline/.test(metric.key)) return '#e11d48';
  if (/queue|pending/.test(metric.key)) return '#f59e0b';
  if (/availability/.test(metric.key)) return '#10b981';
  return '#159dcc';
}
