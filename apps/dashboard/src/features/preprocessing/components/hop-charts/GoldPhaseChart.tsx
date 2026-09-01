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

import { TelemetryUnavailable } from './TelemetryUnavailable';
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
  'gold-pairing': { input: 'LC + TPF inputs', output: 'Eligible target pairs', indexed: 'Indexed rows', comparison: 'pairing', interpretation: 'Pair coverage accounts for two required modalities per eligible target.' },
  'gold-catalog': { input: 'Target identities', output: 'Catalog-enriched targets', indexed: 'Indexed rows', comparison: 'retention', interpretation: 'Resolution yield measures targets with durable TIC/TOI context.' },
  'gold-lc-features': { input: 'Light curves evaluated', output: 'Feature rows', indexed: 'Indexed rows', comparison: 'retention', interpretation: 'Feature yield compares evaluated light curves with emitted scientific records.' },
  'gold-bls': { input: 'Feature rows searched', output: 'BLS evidence rows', indexed: 'Indexed rows', comparison: 'retention', interpretation: 'BLS availability is evidence coverage, not a planet-detection probability.' },
  'gold-tpf-evidence': { input: 'TPF contexts evaluated', output: 'Spatial evidence rows', indexed: 'Indexed rows', comparison: 'retention', interpretation: 'Spatial evidence yield shows where a valid transit-window measurement was possible.' },
  'gold-candidate': { input: 'Evidence rows assembled', output: 'Candidate rows', indexed: 'Indexed rows', comparison: 'assembly', interpretation: 'Multiple LC, BLS, TPF and catalog records may assemble into one candidate row.' },
  'gold-parquet': { input: 'Candidate rows', output: 'Parquet artifacts', indexed: 'Indexed rows', comparison: 'materialization', interpretation: 'Rows and artifacts use different units; they are never plotted on a shared quantitative axis.' },
  'gold-index': { input: 'Gold rows projected', output: 'Projection rows', indexed: 'Indexed rows', comparison: 'commit', interpretation: 'Index coverage compares durable Gold rows with queryable analytical rows.' },
  'gold-commit': { input: 'Gold rows', output: 'Committed rows', indexed: 'Indexed rows', comparison: 'commit', interpretation: 'Commit evidence is complete only when the durable rows and analytical projection agree.' },
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

function relation(definition: PhaseDefinition, input: number, output: number, indexed: number): { label: string; value: string } {
  if (definition.comparison === 'pairing') return { label: 'Pair coverage', value: input > 0 ? `${Math.min(100, (output * 2 / input) * 100).toFixed(1)}%` : '—' };
  if (definition.comparison === 'assembly') return { label: 'Evidence density', value: output > 0 ? `${(input / output).toFixed(2)} rows/candidate` : '—' };
  if (definition.comparison === 'materialization') return { label: 'Artifact density', value: output > 0 ? `${(input / output).toFixed(1)} rows/artifact` : '—' };
  if (definition.comparison === 'commit') return { label: 'Index coverage', value: input > 0 ? `${(indexed / input * 100).toFixed(1)}%` : '—' };
  return { label: 'Evidence yield', value: input > 0 ? `${(output / input * 100).toFixed(1)}%` : '—' };
}

export function GoldPhaseChart({ metrics, telemetry, phase = 'gold-commit' }: { metrics?: Record<string, number>; telemetry?: Telemetry; phase?: string }): JSX.Element {
  const definition = definitions[phase] ?? definitions['gold-commit'];
  const input = value(metrics, 'input_records', 'pending_inputs');
  const output = value(metrics, 'output_rows', 'gold_rows');
  const indexed = value(metrics, 'indexed_rows');
  const batches = value(metrics, 'completed_batches');
  const relationship = relation(definition, input, output, indexed);
  const observations = mergedSeries(telemetry, ['input_records', 'output_rows', 'indexed_rows']).map((point, index) => ({
    ...point,
    label: `B${index + 1}`,
  }));

  if (input === 0 && output === 0 && indexed === 0 && batches === 0) {
    return <TelemetryUnavailable detail="Phase chưa có durable component event hoặc snapshot evidence." />;
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-px border border-border/70 bg-border/70 text-xs lg:grid-cols-4">
        <Metric label={definition.input} observed={input} />
        <Metric label={definition.output} observed={output} />
        <Metric label={relationship.label} observed={relationship.value} />
        <Metric label="Durable batches" observed={batches || observations.length} />
      </div>

      {observations.length >= 2 ? (
        <BatchTrend observations={observations} definition={definition} />
      ) : definition.comparison === 'materialization' ? (
        <IndependentMeasures input={input} output={output} definition={definition} />
      ) : (
        <RecordFlow input={input} output={output} indexed={indexed} definition={definition} />
      )}

      <div className="flex items-start justify-between gap-4 border-l-2 border-primary/50 bg-background/40 px-3 py-2 text-[11px] text-muted-foreground">
        <span>{definition.interpretation}</span>
        <span className="shrink-0 font-mono uppercase">{observations.length >= 2 ? `${observations.length} observations` : 'single durable observation'}</span>
      </div>
    </div>
  );
}

function BatchTrend({ observations, definition }: { observations: Array<Record<string, number | string>>; definition: PhaseDefinition }): JSX.Element {
  const materialization = definition.comparison === 'materialization';
  return (
    <section className="border border-border/70 bg-background/40">
      <div className="border-b border-border/60 px-3 py-2"><p className="font-medium">Batch evidence trend</p><p className="text-[10px] text-muted-foreground">Mỗi điểm là một phase observation bền vững; không nội suy batch bị thiếu.</p></div>
      <div className="h-[300px] p-2">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={observations} margin={{ top: 12, right: materialization ? 30 : 12, bottom: 4, left: 4 }}>
            <CartesianGrid vertical={false} strokeDasharray="3 3" opacity={0.2} />
            <XAxis dataKey="label" tick={{ fontSize: 10 }} />
            <YAxis yAxisId="records" tickFormatter={(item) => compact(Number(item))} width={48} tick={{ fontSize: 10 }} />
            {materialization && <YAxis yAxisId="artifacts" orientation="right" allowDecimals={false} width={38} tick={{ fontSize: 10 }} />}
            <Tooltip labelFormatter={(_, payload) => payload?.[0]?.payload?.timestamp ? clock(Number(payload[0].payload.timestamp)) : ''} formatter={(item, name) => [Number(item).toLocaleString(), String(name)]} />
            <Legend />
            <Bar yAxisId="records" dataKey="input_records" name={definition.input} fill="#22d3ee" opacity={0.72} isAnimationActive={false} />
            {materialization
              ? <Line yAxisId="artifacts" dataKey="output_rows" name={definition.output} stroke="#a855f7" strokeWidth={2.2} dot={{ r: 3 }} isAnimationActive={false} />
              : <Bar yAxisId="records" dataKey="output_rows" name={definition.output} fill="#10b981" opacity={0.78} isAnimationActive={false} />}
            {!materialization && <Line yAxisId="records" dataKey="indexed_rows" name={definition.indexed} stroke="#f59e0b" strokeWidth={2} dot={{ r: 2.5 }} isAnimationActive={false} />}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}

function RecordFlow({ input, output, indexed, definition }: { input: number; output: number; indexed: number; definition: PhaseDefinition }): JSX.Element {
  const rows = [
    { label: definition.input, observed: input, color: '#22d3ee' },
    { label: definition.output, observed: output, color: '#10b981' },
    ...(indexed > 0 ? [{ label: definition.indexed, observed: indexed, color: '#f59e0b' }] : []),
  ];
  const maximum = Math.max(...rows.map((row) => row.observed), 1);
  return (
    <section className="border border-border/70 bg-background/40">
      <div className="border-b border-border/60 px-3 py-2"><p className="font-medium">Observed record flow</p><p className="text-[10px] text-muted-foreground">Độ dài biểu diễn số record trong cùng observation, gồm cả output bằng 0.</p></div>
      <div className="space-y-4 p-4">
        {rows.map((row) => <div key={row.label} className="grid items-center gap-3 sm:grid-cols-[170px_minmax(0,1fr)_90px]"><span className="text-[10px] uppercase tracking-wide text-muted-foreground">{row.label}</span><div className="h-6 border border-border/70 bg-muted/30 p-0.5"><div className="h-full min-w-[2px]" style={{ width: `${Math.max(0.4, row.observed / maximum * 100)}%`, backgroundColor: row.color }} /></div><span className="text-right font-mono font-semibold tabular-nums">{row.observed.toLocaleString()}</span></div>)}
      </div>
    </section>
  );
}

function IndependentMeasures({ input, output, definition }: { input: number; output: number; definition: PhaseDefinition }): JSX.Element {
  return (
    <section className="border border-border/70 bg-background/40">
      <div className="border-b border-border/60 px-3 py-2"><p className="font-medium">Materialization evidence</p><p className="text-[10px] text-muted-foreground">Hai đại lượng khác đơn vị được giữ trên thang độc lập.</p></div>
      <div className="grid gap-px bg-border/70 sm:grid-cols-2">
        <div className="bg-background p-5"><p className="font-mono text-[10px] uppercase text-cyan-500">Records</p><p className="mt-2 font-mono text-3xl font-semibold tabular-nums">{input.toLocaleString()}</p><p className="mt-1 text-xs text-muted-foreground">{definition.input}</p></div>
        <div className="bg-background p-5"><p className="font-mono text-[10px] uppercase text-purple-500">Artifacts</p><p className="mt-2 font-mono text-3xl font-semibold tabular-nums">{output.toLocaleString()}</p><p className="mt-1 text-xs text-muted-foreground">{definition.output}</p></div>
      </div>
    </section>
  );
}

function Metric({ label, observed }: { label: string; observed: number | string }): JSX.Element {
  return <div className="min-w-0 bg-background p-3"><p className="truncate text-[9px] uppercase tracking-wide text-muted-foreground" title={label}>{label}</p><p className="mt-1 truncate font-mono text-sm font-semibold tabular-nums">{typeof observed === 'number' ? observed.toLocaleString() : observed}</p></div>;
}
