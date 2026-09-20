import type { JSX } from 'react';
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { clock, mergedSeries, type Telemetry } from './telemetry';

type Comparison = 'pairing' | 'retention' | 'assembly' | 'materialization' | 'commit';
type PhaseDefinition = {
  input: string;
  output: string;
  indexed: string;
  comparison: Comparison;
  interpretation: string;
};

const definitions: Record<string, PhaseDefinition> = {
  'gold-pairing': {
    input: 'Silver LC + TPF inputs',
    output: 'Multimodal Paired Targets',
    indexed: 'Indexed Rows',
    comparison: 'pairing',
    interpretation: 'Pairing coverage accounts for 1:1 Light-Curve and Target Pixel File context matching.',
  },
  'gold-catalog': {
    input: 'Target Identities',
    output: 'Catalog-enriched Targets',
    indexed: 'Indexed Rows',
    comparison: 'retention',
    interpretation: 'Resolution yield measures candidate targets with verified TIC stellar params and TOI ephemerides.',
  },
  'gold-lc-features': {
    input: 'Light Curves Evaluated',
    output: 'Morphology Vectors',
    indexed: 'Indexed Rows',
    comparison: 'retention',
    interpretation: 'Measures flux variance, skewness, kurtosis, and MAD variability indicators before search.',
  },
  'gold-bls': {
    input: 'LC Vectors Evaluated',
    output: 'BLS Transit Ephemerides',
    indexed: 'Indexed Rows',
    comparison: 'retention',
    interpretation: 'Box Least Squares detection yield for periodic box-shaped planetary transit dips.',
  },
  'gold-tpf-evidence': {
    input: 'TPF Contexts Evaluated',
    output: 'Spatial Vetting Evidence',
    indexed: 'Indexed Rows',
    comparison: 'retention',
    interpretation: 'Measures in-transit pixel deficit centroid shifts to reject background eclipsing binaries.',
  },
  'gold-candidate': {
    input: 'Scientific Evidence Rows',
    output: 'Canonical Candidate Rows',
    indexed: 'Indexed Rows',
    comparison: 'assembly',
    interpretation: 'Combines LC features, BLS ephemeris, TPF vetting, and TIC context into canonical Arrow schema.',
  },
  'gold-parquet': {
    input: 'Candidate Rows',
    output: 'Sector Parquet Bytes',
    indexed: 'Indexed Rows',
    comparison: 'materialization',
    interpretation: 'Serializes Snappy-compressed columnar Parquet partitions to object storage.',
  },
  'gold-index': {
    input: 'Candidate Gold Rows',
    output: 'Indexed Analytical Rows',
    indexed: 'Indexed Rows',
    comparison: 'commit',
    interpretation: 'Index coverage compares durable Gold rows with queryable ReplacingMergeTree projections.',
  },
  'gold-commit': {
    input: 'Gold Rows',
    output: 'Committed Snapshots',
    indexed: 'Indexed Rows',
    comparison: 'commit',
    interpretation: 'Manifest release seal committed to MinIO and broadcast via NATS JetStream.',
  },
};

function value(metrics: Record<string, number> | undefined, ...keys: string[]): number {
  for (const key of keys) {
    const observed = metrics?.[key];
    if (observed !== undefined && Number.isFinite(observed)) return Math.max(0, observed);
  }
  return 0;
}

function compact(observed: number): string {
  if (observed >= 1_000_000) return `${(observed / 1_000_000).toFixed(1)}M`;
  if (observed >= 1_000) return `${(observed / 1_000).toFixed(1)}k`;
  return observed.toLocaleString();
}

function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '—';
  if (ms < 1) return `${(ms * 1000).toFixed(0)} µs`;
  if (ms < 1000) return `${ms.toFixed(1)} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function relation(definition: PhaseDefinition, input: number, output: number, indexed: number): { label: string; value: string } {
  if (definition.comparison === 'pairing') {
    return { label: 'Pairing yield', value: input > 0 ? `${Math.min(100, (output * 2 / input) * 100).toFixed(1)}%` : '—' };
  }
  if (definition.comparison === 'assembly') {
    return { label: 'Evidence density', value: output > 0 ? `${(input / output).toFixed(2)} evid/cand` : '—' };
  }
  if (definition.comparison === 'materialization') {
    return { label: 'Density', value: output > 0 && input > 0 ? `${(input / Math.max(1, output / 1024)).toFixed(1)} rows/KB` : '—' };
  }
  if (definition.comparison === 'commit') {
    return { label: 'Index parity', value: input > 0 ? `${(indexed / input * 100).toFixed(1)}%` : '—' };
  }
  return { label: 'Yield ratio', value: input > 0 ? `${(output / input * 100).toFixed(1)}%` : '—' };
}

export function GoldPhaseChart({
  metrics,
  telemetry,
  phase = 'gold-commit',
}: {
  metrics?: Record<string, number>;
  telemetry?: Telemetry;
  phase?: string;
}): JSX.Element {
  const definition = definitions[phase] ?? definitions['gold-commit'];
  const input = value(metrics, 'input_records', 'pending_inputs', 'ready_lightcurves');
  const output = value(metrics, 'output_rows', 'gold_rows');
  const indexed = value(metrics, 'indexed_rows');
  const batches = value(metrics, 'completed_batches');
  const durationMs = value(metrics, 'duration_ms', 'latency_ms');
  const parquetBytes = value(metrics, 'parquet_bytes');

  const relationship = relation(definition, input, output, indexed);

  const observations = mergedSeries(telemetry, ['input_records', 'output_rows', 'indexed_rows', 'duration_ms']).map(
    (point, index) => ({
      ...point,
      label: `T${index + 1}`,
    })
  );

  const isBaseline = !(input > 0 || output > 0 || indexed > 0 || batches > 0 || durationMs > 0 || observations.length > 0);

  return (
    <div className="space-y-3">
      {isBaseline && (
        <div className="flex items-center justify-between border border-border/70 bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5 font-medium">
            <span className="size-2 rounded-full bg-amber-500" />
            Khung phân tích cơ sở: phase chưa có Prometheus telemetry hoặc event observation (hiển thị mức nền 0).
          </span>
        </div>
      )}
      {/* 4 Primary KPI Cards */}
      <div className="grid grid-cols-2 gap-px border border-border/70 bg-border/70 text-xs lg:grid-cols-4">
        <Metric label={definition.input} observed={input} />
        <Metric
          label={phase === 'gold-parquet' && parquetBytes > 0 ? 'Parquet Size' : definition.output}
          observed={phase === 'gold-parquet' && parquetBytes > 0 ? formatBytes(parquetBytes) : output}
        />
        <Metric label="Phase Latency" observed={durationMs > 0 ? formatDuration(durationMs) : relationship.value} />
        <Metric label={relationship.label} observed={relationship.value} />
      </div>

      {/* Latency & Processing Trend from Prometheus */}
      {observations.length >= 2 ? (
        <BatchTrend observations={observations} definition={definition} />
      ) : (
        <RecordFlow
          input={input}
          output={output}
          indexed={indexed}
          durationMs={durationMs}
          definition={definition}
        />
      )}

      {/* Interpretation Footer */}
      <div className="flex items-start justify-between gap-4 border-l-2 border-primary/50 bg-background/40 px-3 py-2 text-[11px] text-muted-foreground">
        <span>{definition.interpretation}</span>
        <span className="shrink-0 font-mono uppercase">
          {observations.length >= 2 ? `${observations.length} telemetry points` : 'Prometheus verified phase'}
        </span>
      </div>
    </div>
  );
}

function BatchTrend({
  observations,
  definition,
}: {
  observations: Array<Record<string, number | string>>;
  definition: PhaseDefinition;
}): JSX.Element {
  const hasDuration = observations.some((point) => Number(point.duration_ms || 0) > 0);

  return (
    <section className="border border-border/70 bg-background/40">
      <div className="flex items-center justify-between border-b border-border/60 px-3 py-2">
        <div>
          <p className="text-xs font-medium">Prometheus Phase Telemetry & Throughput</p>
          <p className="text-[10px] text-muted-foreground">
            Lưu lượng bản ghi và độ trễ thực thi từng observation từ Prometheus scraper.
          </p>
        </div>
        {hasDuration && (
          <span className="rounded bg-primary/10 px-2 py-0.5 font-mono text-[10px] text-primary">
            Wall-clock instrumented
          </span>
        )}
      </div>
      <div className="h-[260px] p-2">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={observations} margin={{ top: 12, right: hasDuration ? 36 : 12, bottom: 4, left: 4 }}>
            <CartesianGrid vertical={false} strokeDasharray="3 3" opacity={0.2} />
            <XAxis dataKey="label" tick={{ fontSize: 10 }} />
            <YAxis
              yAxisId="records"
              tickFormatter={(item) => compact(Number(item))}
              width={48}
              tick={{ fontSize: 10 }}
            />
            {hasDuration && (
              <YAxis
                yAxisId="duration"
                orientation="right"
                tickFormatter={(val) => formatDuration(Number(val))}
                width={50}
                tick={{ fontSize: 10 }}
              />
            )}
            <Tooltip
              labelFormatter={(_, payload) =>
                payload?.[0]?.payload?.timestamp ? clock(Number(payload[0].payload.timestamp)) : ''
              }
              formatter={(item, name) => [
                name === 'Phase Latency' ? formatDuration(Number(item)) : Number(item).toLocaleString(),
                String(name),
              ]}
            />
            <Legend wrapperStyle={{ fontSize: '11px' }} />
            <Bar
              yAxisId="records"
              dataKey="input_records"
              name={definition.input}
              fill="#22d3ee"
              opacity={0.65}
              isAnimationActive={false}
            />
            <Bar
              yAxisId="records"
              dataKey="output_rows"
              name={definition.output}
              fill="#10b981"
              opacity={0.8}
              isAnimationActive={false}
            />
            {hasDuration && (
              <Line
                yAxisId="duration"
                type="monotone"
                dataKey="duration_ms"
                name="Phase Latency"
                stroke="#ec4899"
                strokeWidth={2}
                dot={{ r: 3 }}
                isAnimationActive={false}
              />
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}

function RecordFlow({
  input,
  output,
  indexed,
  durationMs,
  definition,
}: {
  input: number;
  output: number;
  indexed: number;
  durationMs: number;
  definition: PhaseDefinition;
}): JSX.Element {
  const rows = [
    { label: definition.input, observed: input, color: '#22d3ee' },
    { label: definition.output, observed: output, color: '#10b981' },
    ...(indexed > 0 ? [{ label: definition.indexed, observed: indexed, color: '#f59e0b' }] : []),
  ];
  const maximum = Math.max(...rows.map((row) => row.observed), 1);

  return (
    <section className="border border-border/70 bg-background/40">
      <div className="flex items-center justify-between border-b border-border/60 px-3 py-2">
        <div>
          <p className="text-xs font-medium">Phase Evidence Funnel & Latency Profile</p>
          <p className="text-[10px] text-muted-foreground">
            Tỷ lệ chuyển đổi khối lượng dữ liệu qua phase và độ trễ CPU/IO.
          </p>
        </div>
        {durationMs > 0 && (
          <span className="font-mono text-xs font-semibold text-primary">
            ⏱ {formatDuration(durationMs)}
          </span>
        )}
      </div>
      <div className="space-y-3.5 p-4">
        {rows.map((row) => (
          <div key={row.label} className="grid items-center gap-3 sm:grid-cols-[180px_minmax(0,1fr)_90px]">
            <span className="text-[10px] uppercase tracking-wide text-muted-foreground">{row.label}</span>
            <div className="h-5 border border-border/70 bg-muted/20 p-0.5">
              <div
                className="h-full min-w-[2px] transition-all"
                style={{
                  width: `${Math.max(0.5, (row.observed / maximum) * 100)}%`,
                  backgroundColor: row.color,
                }}
              />
            </div>
            <span className="text-right font-mono text-xs font-semibold tabular-nums">
              {row.observed.toLocaleString()}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

function Metric({ label, observed }: { label: string; observed: number | string }): JSX.Element {
  return (
    <div className="min-w-0 bg-background p-3">
      <p className="truncate text-[9px] uppercase tracking-wide text-muted-foreground" title={label}>
        {label}
      </p>
      <p className="mt-1 truncate font-mono text-sm font-semibold tabular-nums">
        {typeof observed === 'number' ? observed.toLocaleString() : observed}
      </p>
    </div>
  );
}
