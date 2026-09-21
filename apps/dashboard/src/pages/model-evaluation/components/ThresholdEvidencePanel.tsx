import type { JSX } from 'react';
import { Gauge } from 'lucide-react';
import type { ModelEvaluation } from '../types';

type Props = {
  evaluation: ModelEvaluation;
};

function percent(value?: number): string {
  return value === undefined ? '—' : `${(value * 100).toFixed(2)}%`;
}

function MetricBar({ label, value }: { label: string; value?: number }): JSX.Element {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-xs">
        <span>{label}</span>
        <span className="font-mono font-medium">{percent(value)}</span>
      </div>
      <div className="h-2 bg-muted">
        <div
          className="h-full bg-cyan-500 transition-all duration-300"
          style={{ width: `${Math.max(0, Math.min(100, (value ?? 0) * 100))}%` }}
        />
      </div>
    </div>
  );
}

export function ThresholdEvidencePanel({ evaluation }: Props): JSX.Element {
  const thresholdPercent = Math.max(0, Math.min(100, evaluation.decision_threshold * 100));

  return (
    <article className="min-w-0 bg-background/95">
      <header className="border-b border-border/60 px-4 py-3">
        <p className="flex items-center gap-2 text-sm font-medium">
          <Gauge className="size-4" />
          Validation threshold evidence
        </p>
        <p className="mt-0.5 text-[11px] text-muted-foreground">
          Threshold selected by {evaluation.threshold_policy_version || 'recorded policy'}; not
          re-optimized in the browser.
        </p>
      </header>

      <div className="space-y-4 p-4">
        <div>
          <div className="flex justify-between font-mono text-[10px] text-muted-foreground">
            <span>0.00</span>
            <span>decision boundary · {evaluation.decision_threshold.toFixed(4)}</span>
            <span>1.00</span>
          </div>
          <div className="relative mt-2 h-3 bg-muted">
            <span
              className="absolute inset-y-0 left-0 bg-primary/30"
              style={{ width: `${thresholdPercent}%` }}
            />
            <span
              className="absolute -top-1 h-5 w-0.5 bg-primary"
              style={{ left: `${thresholdPercent}%` }}
            />
          </div>
        </div>

        <MetricBar label="Validation precision" value={evaluation.validation_precision} />
        <MetricBar label="Validation recall" value={evaluation.validation_recall} />
        <MetricBar label="Validation F1" value={evaluation.validation_f1} />

        <p className="border-l-2 border-primary/50 pl-3 text-xs text-muted-foreground">
          {evaluation.validation_row_count.toLocaleString()} validation rows selected the threshold;
          Golden metrics above remain out-of-selection evidence.
        </p>
      </div>
    </article>
  );
}
