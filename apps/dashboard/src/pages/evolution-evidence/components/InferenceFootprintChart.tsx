import { useMemo, type JSX } from 'react';
import { Activity } from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { InferenceJob } from '@/pages/inference-engine/types';
import type { InferenceChartItem } from '../types';

interface InferenceFootprintChartProps {
  jobs: InferenceJob[];
}

const statusColors: Record<string, string> = {
  completed: '#10b981',
  running: '#06b6d4',
  planned: '#f59e0b',
  failed: '#ef4444',
};

function truncateId(value?: string, size = 10): string {
  if (!value) return '—';
  return value.length > size ? `${value.slice(0, size)}…` : value;
}

export function InferenceFootprintChart({ jobs }: InferenceFootprintChartProps): JSX.Element {
  const chartData = useMemo<InferenceChartItem[]>(() => {
    return [...jobs]
      .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
      .slice(-16)
      .map((job, index) => ({
        label: jobs.length > 8 ? `#${index + 1}` : truncateId(job.job_id, 8),
        rows: job.expected_prediction_count || 0,
        status: job.status.toLowerCase(),
        job,
      }));
  }, [jobs]);

  return (
    <article className="min-w-0 bg-card">
      <header className="flex flex-col gap-2 border-b border-border/60 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2 text-sm font-medium text-foreground">
            <Activity className="size-4 text-primary" />
            Inference Footprint by Job
          </div>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            Expected prediction rows from immutable inference manifests; colored by execution state.
          </p>
        </div>

        {/* Legend */}
        <div className="flex items-center gap-2.5 font-mono text-[9px] uppercase">
          {Object.entries(statusColors).map(([status, color]) => (
            <span key={status} className="flex items-center gap-1 text-muted-foreground">
              <span className="inline-block size-2 rounded-full" style={{ backgroundColor: color }} />
              {status}
            </span>
          ))}
        </div>
      </header>

      {chartData.length === 0 ? (
        <div className="grid min-h-[300px] place-items-center p-6 text-center text-xs text-muted-foreground">
          <div>
            <Activity className="mx-auto size-8 text-muted-foreground/40" />
            <p className="mt-2 font-medium">No linked inference jobs</p>
            <p className="mt-1 text-muted-foreground/70">
              This runtime package has not executed or queued any inference manifests yet.
            </p>
          </div>
        </div>
      ) : (
        <div className="h-[300px] p-3">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} margin={{ top: 12, right: 16, bottom: 8, left: 4 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} opacity={0.15} />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 10, fill: 'var(--muted-foreground)' }}
                axisLine={{ stroke: 'var(--border)' }}
                tickLine={false}
              />
              <YAxis
                tick={{ fontSize: 10, fill: 'var(--muted-foreground)' }}
                axisLine={{ stroke: 'var(--border)' }}
                tickLine={false}
                width={55}
                tickFormatter={(value: number) => (value >= 1000 ? `${(value / 1000).toFixed(0)}k` : `${value}`)}
              />
              <Tooltip
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null;
                  const data = payload[0].payload as InferenceChartItem;
                  return (
                    <div className="border border-border/80 bg-popover/95 p-2.5 text-xs shadow-md backdrop-blur-sm">
                      <p className="font-mono text-[10px] text-muted-foreground uppercase">
                        Job: {data.job.job_id}
                      </p>
                      <p className="mt-1 font-semibold text-popover-foreground">
                        {data.rows.toLocaleString()} expected predictions
                      </p>
                      <div className="mt-1 flex items-center gap-1.5">
                        <span
                          className="size-1.5 rounded-full"
                          style={{ backgroundColor: statusColors[data.status] ?? '#64748b' }}
                        />
                        <span className="font-mono text-[10px] uppercase text-muted-foreground">
                          Status: {data.status}
                        </span>
                      </div>
                    </div>
                  );
                }}
              />
              <Bar dataKey="rows" name="Expected predictions" maxBarSize={38} radius={[2, 2, 0, 0]}>
                {chartData.map((entry) => (
                  <Cell
                    key={entry.job.job_id}
                    fill={statusColors[entry.status] ?? '#64748b'}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </article>
  );
}
