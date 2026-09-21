import type { JSX } from 'react';
import { Binary } from 'lucide-react';
import type { ModelEvaluation } from '../types';

type Props = {
  evaluation: ModelEvaluation;
};

function percent(value?: number): string {
  return value === undefined ? '—' : `${(value * 100).toFixed(2)}%`;
}

function MatrixLabel({ label }: { label: string }): JSX.Element {
  return (
    <div className="grid place-items-center bg-muted/30 p-2 font-mono text-[10px] uppercase">
      {label}
    </div>
  );
}

function MatrixCell({
  label,
  value,
  positive = false,
}: {
  label: string;
  value: number;
  positive?: boolean;
}): JSX.Element {
  return (
    <div className={`p-4 ${positive ? 'bg-emerald-500/8' : 'bg-red-500/8'}`}>
      <p
        className={`font-mono text-[10px] ${
          positive ? 'text-emerald-600 dark:text-emerald-300' : 'text-red-600 dark:text-red-300'
        }`}
      >
        {label}
      </p>
      <p className="mt-1 font-mono text-xl font-semibold">{value.toLocaleString()}</p>
    </div>
  );
}

function Rate({ label, value }: { label: string; value?: number }): JSX.Element {
  return (
    <div className="bg-background p-3">
      <p className="text-[10px] text-muted-foreground">{label}</p>
      <p className="mt-1 font-mono text-sm font-semibold">{percent(value)}</p>
    </div>
  );
}

export function ConfusionMatrixCard({ evaluation }: Props): JSX.Element {
  const matrix = evaluation.golden.confusion_matrix;
  const matrixObserved = matrix?.length === 2 && matrix[0]?.length === 2 && matrix[1]?.length === 2;
  const tn = matrixObserved ? matrix[0][0] : 0;
  const fp = matrixObserved ? matrix[0][1] : 0;
  const fn = matrixObserved ? matrix[1][0] : 0;
  const tp = matrixObserved ? matrix[1][1] : 0;
  const falsePositiveRate = tn + fp > 0 ? fp / (tn + fp) : undefined;
  const falseNegativeRate = tp + fn > 0 ? fn / (tp + fn) : undefined;

  return (
    <article className="min-w-0 bg-background/95">
      <header className="border-b border-border/60 px-4 py-3">
        <p className="flex items-center gap-2 text-sm font-medium">
          <Binary className="size-4" />
          Golden confusion matrix
        </p>
        <p className="mt-0.5 text-[11px] text-muted-foreground">
          Rows are true labels; columns are predictions at the decision threshold.
        </p>
      </header>

      {matrixObserved ? (
        <div className="p-4">
          <div className="grid grid-cols-[92px_1fr_1fr] gap-px bg-border/70 text-center text-xs">
            <div className="bg-background p-2" />
            <div className="bg-muted/30 p-2 font-mono text-[10px] uppercase">Pred negative</div>
            <div className="bg-muted/30 p-2 font-mono text-[10px] uppercase">Pred positive</div>
            <MatrixLabel label="Actual negative" />
            <MatrixCell label="TN" value={tn} positive />
            <MatrixCell label="FP" value={fp} />
            <MatrixLabel label="Actual positive" />
            <MatrixCell label="FN" value={fn} />
            <MatrixCell label="TP" value={tp} positive />
          </div>

          <div className="mt-3 grid grid-cols-2 gap-px border border-border/70 bg-border/70">
            <Rate label="False-positive rate" value={falsePositiveRate} />
            <Rate label="False-negative rate" value={falseNegativeRate} />
          </div>
        </div>
      ) : (
        <div className="grid min-h-[230px] place-items-center p-6 text-center text-xs text-muted-foreground">
          <p className="max-w-md">
            Evaluator has not written a confusion matrix for the Golden cohort.
          </p>
        </div>
      )}
    </article>
  );
}
