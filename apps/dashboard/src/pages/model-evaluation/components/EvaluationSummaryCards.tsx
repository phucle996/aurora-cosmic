import type { JSX } from 'react';
import type { ModelEvaluation } from '../types';

type Props = {
  evaluation: ModelEvaluation;
};

function percent(value?: number): string {
  return value === undefined ? '—' : `${(value * 100).toFixed(2)}%`;
}

function statusPass(value: string): boolean {
  return ['PASS', 'PASSED'].includes(value.toUpperCase());
}

type SummaryItemProps = {
  label: string;
  value: string;
  detail: string;
  tone?: 'neutral' | 'positive' | 'negative';
};

function SummaryItem({ label, value, detail, tone = 'neutral' }: SummaryItemProps): JSX.Element {
  return (
    <div className="min-w-0 bg-background/95 p-3">
      <p className="font-mono text-[9px] uppercase tracking-[0.12em] text-muted-foreground">
        {label}
      </p>
      <p
        className={`mt-1 truncate font-mono text-base font-semibold ${
          tone === 'positive'
            ? 'text-emerald-600 dark:text-emerald-300'
            : tone === 'negative'
              ? 'text-red-600 dark:text-red-300'
              : ''
        }`}
      >
        {value}
      </p>
      <p className="mt-1 truncate text-[10px] text-muted-foreground">{detail}</p>
    </div>
  );
}

export function EvaluationSummaryCards({ evaluation }: Props): JSX.Element {
  const matrix = evaluation.golden.confusion_matrix;
  const matrixObserved = matrix?.length === 2 && matrix[0]?.length === 2 && matrix[1]?.length === 2;
  const fn = matrixObserved ? matrix[1][0] : 0;
  const tp = matrixObserved ? matrix[1][1] : 0;
  const falseNegativeRate = tp + fn > 0 ? fn / (tp + fn) : undefined;

  const parityPass = statusPass(evaluation.parity_status);
  const integrityPass = statusPass(evaluation.integrity_status);

  return (
    <section className="grid gap-px border-b border-border/60 bg-border/60 sm:grid-cols-2 2xl:grid-cols-5">
      <SummaryItem
        label="Golden PR-AUC"
        value={percent(evaluation.golden.pr_auc)}
        detail={`${evaluation.golden.row_count.toLocaleString()} frozen rows`}
      />
      <SummaryItem
        label="Golden recall"
        value={percent(evaluation.golden.recall)}
        detail={
          falseNegativeRate === undefined
            ? 'false-negative rate unavailable'
            : `${percent(falseNegativeRate)} false-negative rate`
        }
      />
      <SummaryItem
        label="Decision threshold"
        value={evaluation.decision_threshold.toFixed(4)}
        detail={`${evaluation.validation_row_count.toLocaleString()} validation rows`}
      />
      <SummaryItem
        label="Runtime parity"
        value={evaluation.parity_status || '—'}
        detail="PyTorch ↔ ONNX"
        tone={parityPass ? 'positive' : 'negative'}
      />
      <SummaryItem
        label="Artifact integrity"
        value={evaluation.integrity_status || '—'}
        detail="manifest-bound hashes"
        tone={integrityPass ? 'positive' : 'negative'}
      />
    </section>
  );
}
