import type { JSX } from 'react';
import { Activity } from 'lucide-react';
import type { ModelEvaluation } from '../types';

type Props = {
  evaluation: ModelEvaluation;
};

function DriftMetric({ label, value }: { label: string; value?: number }): JSX.Element {
  const observed = value !== undefined;
  const negative = observed && value < 0;

  return (
    <div className="bg-background p-4">
      <p className="font-mono text-[10px] uppercase text-muted-foreground">{label}</p>
      <p
        className={`mt-1 font-mono text-xl font-semibold ${
          !observed
            ? ''
            : negative
              ? 'text-red-600 dark:text-red-300'
              : 'text-emerald-600 dark:text-emerald-300'
        }`}
      >
        {observed ? `${value >= 0 ? '+' : ''}${(value * 100).toFixed(2)} pp` : '—'}
      </p>
    </div>
  );
}

function CohortCount({
  label,
  cohort,
}: {
  label: string;
  cohort: ModelEvaluation['golden'];
}): JSX.Element {
  return (
    <div className="bg-background p-4">
      <p className="font-mono text-[10px] uppercase text-muted-foreground">{label}</p>
      <p className="mt-1 font-mono text-sm font-semibold">
        {cohort.row_count.toLocaleString()} rows
      </p>
      <p className="mt-1 text-[10px] text-muted-foreground">
        {cohort.positive_count.toLocaleString()} positive ·{' '}
        {cohort.negative_count.toLocaleString()} negative
      </p>
    </div>
  );
}

export function CohortStabilityPanel({ evaluation }: Props): JSX.Element {
  return (
    <article className="min-w-0 bg-background/95">
      <header className="border-b border-border/60 px-4 py-3">
        <p className="flex items-center gap-2 text-sm font-medium">
          <Activity className="size-4" />
          Cohort stability
        </p>
        <p className="mt-0.5 text-[11px] text-muted-foreground">
          Delta = Recent − Golden; negative values indicate quality degradation on recent data.
        </p>
      </header>

      {evaluation.recent ? (
        <div className="grid gap-px bg-border/60 p-px sm:grid-cols-2">
          <DriftMetric label="PR-AUC drift" value={evaluation.pr_auc_drift} />
          <DriftMetric label="Recall drift" value={evaluation.recall_drift} />
          <CohortCount label="Golden composition" cohort={evaluation.golden} />
          <CohortCount label="Recent composition" cohort={evaluation.recent} />
        </div>
      ) : (
        <div className="grid min-h-[230px] place-items-center p-6 text-center text-xs text-muted-foreground">
          <p className="max-w-md">
            No Recent cohort in evaluation manifest; drift cannot be determined.
          </p>
        </div>
      )}
    </article>
  );
}
