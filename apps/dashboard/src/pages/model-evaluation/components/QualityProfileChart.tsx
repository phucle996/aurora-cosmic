import { useMemo, type JSX } from 'react';
import { GitCompareArrows } from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { ModelEvaluation } from '../types';

type Props = {
  evaluation: ModelEvaluation;
};

const metricDefinitions = [
  { key: 'pr_auc', label: 'PR-AUC' },
  { key: 'roc_auc', label: 'ROC-AUC' },
  { key: 'precision', label: 'Precision' },
  { key: 'recall', label: 'Recall' },
  { key: 'f1', label: 'F1' },
] as const;

export function QualityProfileChart({ evaluation }: Props): JSX.Element {
  const comparison = useMemo(
    () =>
      metricDefinitions.map(({ key, label }) => ({
        metric: label,
        golden: evaluation.golden[key] === undefined ? undefined : evaluation.golden[key]! * 100,
        recent: evaluation.recent?.[key] === undefined ? undefined : evaluation.recent[key]! * 100,
      })),
    [evaluation],
  );

  return (
    <article className="min-w-0 bg-background/95">
      <header className="border-b border-border/60 px-4 py-3">
        <p className="flex items-center gap-2 text-sm font-medium">
          <GitCompareArrows className="size-4" />
          Golden vs recent quality profile
        </p>
        <p className="mt-0.5 text-[11px] text-muted-foreground">
          {evaluation.recent
            ? 'Same metric scale 0–100%; deltas reflect cohort shift.'
            : 'Golden cohort measured; evaluator has not written a Recent holdout for this run.'}
        </p>
      </header>
      <div className="h-[330px] p-3">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={comparison} margin={{ top: 12, right: 18, bottom: 8, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} opacity={0.25} />
            <XAxis dataKey="metric" tick={{ fontSize: 11 }} />
            <YAxis
              domain={[0, 100]}
              tickFormatter={(value) => `${value}%`}
              width={42}
              tick={{ fontSize: 10 }}
            />
            <Tooltip formatter={(value) => `${Number(value).toFixed(2)}%`} />
            <Legend />
            <ReferenceLine y={50} stroke="var(--muted-foreground)" strokeDasharray="4 4" />
            <Bar dataKey="golden" name="Golden" fill="#06b6d4" maxBarSize={48} />
            <Bar dataKey="recent" name="Recent" fill="#f59e0b" maxBarSize={48} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </article>
  );
}
