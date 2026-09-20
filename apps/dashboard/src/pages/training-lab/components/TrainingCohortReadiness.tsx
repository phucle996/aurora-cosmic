import type { JSX } from 'react';
import { LoaderCircle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import type { TrainingReadiness } from '../types';

interface TrainingCohortReadinessProps {
  readiness: TrainingReadiness | null;
  loading: boolean;
  selectedCount: number;
}

export function TrainingCohortReadiness({
  readiness,
  loading,
  selectedCount,
}: TrainingCohortReadinessProps): JSX.Element {
  if (selectedCount === 0) {
    return (
      <div className="border border-dashed border-border/70 px-3 py-4 text-center text-[11px] text-muted-foreground">
        Select snapshots to calculate cohort qualification.
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 border border-dashed border-border/70 px-3 py-4 text-[11px] text-muted-foreground">
        <LoaderCircle className="size-3.5 animate-spin" />
        Calculating cohort readiness…
      </div>
    );
  }

  if (!readiness) {
    return (
      <div className="border border-destructive/40 bg-destructive/5 px-3 py-3 text-[11px] text-destructive">
        Cohort data is not ready; run launch is locked.
      </div>
    );
  }

  const total = readiness.total_rows;
  const ratio = (val: number) => (total > 0 ? (val / total) * 100 : 0);
  const isReady = readiness.ready ?? (readiness.tier !== 'BLOCKED');

  return (
    <div
      className={`border px-3.5 py-3 ${
        isReady ? 'border-emerald-500/40 bg-emerald-500/5' : 'border-amber-500/40 bg-amber-500/5'
      }`}
    >
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-semibold">Training cohort · {readiness.tier.replaceAll('_', ' ')}</p>
        {readiness.policy_version && (
          <Badge variant="outline" className="rounded-none font-mono text-[9px]">
            {readiness.policy_version}
          </Badge>
        )}
      </div>

      <div className="mt-3 flex h-2 overflow-hidden bg-muted">
        <span className="bg-emerald-500" style={{ width: `${ratio(readiness.positive_rows)}%` }} />
        <span className="bg-sky-500" style={{ width: `${ratio(readiness.negative_rows)}%` }} />
        <span className="bg-amber-500" style={{ width: `${ratio(readiness.unresolved_rows)}%` }} />
      </div>

      <div className="mt-2 grid grid-cols-3 gap-2 text-[10px]">
        <CohortValue
          label="Positive"
          value={readiness.positive_rows}
          percent={ratio(readiness.positive_rows)}
          tone="bg-emerald-500"
        />
        <CohortValue
          label="Negative"
          value={readiness.negative_rows}
          percent={ratio(readiness.negative_rows)}
          tone="bg-sky-500"
        />
        <CohortValue
          label="Unresolved"
          value={readiness.unresolved_rows}
          percent={ratio(readiness.unresolved_rows)}
          tone="bg-amber-500"
        />
      </div>

      <p className="mt-2 text-[10px] text-muted-foreground">
        {readiness.positive_targets.toLocaleString()} positive and {readiness.negative_targets.toLocaleString()} negative independent TIC targets.
      </p>

      <div className="mt-2 grid gap-px border border-border/70 bg-border/70 sm:grid-cols-3">
        <CohortGate
          label="Experimental"
          current={`${readiness.positive_targets}/${readiness.negative_targets}`}
          target={`${readiness.experimental_minimum_positive_targets}/${readiness.experimental_minimum_negative_targets}`}
          met={isReady}
        />
        <CohortGate
          label="Production candidate"
          current={`${readiness.positive_targets}/${readiness.negative_targets}`}
          target={`${readiness.production_candidate_minimum_positive_targets}/${readiness.production_candidate_minimum_negative_targets}`}
          met={readiness.tier === 'PRODUCTION_CANDIDATE'}
        />
        <CohortGate
          label="Negative diversity"
          current={readiness.negative_targets.toLocaleString()}
          target={readiness.negative_diversity_target.toLocaleString()}
          met={readiness.negative_diversity_target_met ?? (readiness.negative_targets >= readiness.negative_diversity_target)}
          advisory
        />
      </div>

      {!isReady && readiness.blocker && (
        <p className="mt-1.5 text-[10px] text-amber-700 dark:text-amber-300">{readiness.blocker}</p>
      )}
    </div>
  );
}

function CohortValue({
  label,
  value,
  percent,
  tone,
}: {
  label: string;
  value: number;
  percent: number;
  tone: string;
}): JSX.Element {
  return (
    <div>
      <p className="flex items-center gap-1.5 text-muted-foreground">
        <span className={`size-1.5 ${tone}`} />
        {label}
      </p>
      <p className="mt-0.5 font-mono font-medium">
        {value.toLocaleString()} · {percent.toFixed(1)}%
      </p>
    </div>
  );
}

function CohortGate({
  label,
  current,
  target,
  met,
  advisory = false,
}: {
  label: string;
  current: string;
  target: string;
  met: boolean;
  advisory?: boolean;
}): JSX.Element {
  return (
    <div className="bg-background/80 p-2">
      <p className="font-mono text-[9px] uppercase text-muted-foreground">{label}</p>
      <p
        className={`mt-1 font-mono text-xs font-semibold ${
          met
            ? 'text-emerald-600 dark:text-emerald-300'
            : advisory
              ? 'text-muted-foreground'
              : 'text-amber-700 dark:text-amber-300'
        }`}
      >
        {current} <span className="font-normal text-muted-foreground">/ {target}</span>
      </p>
      <p className="mt-0.5 text-[9px] text-muted-foreground">
        {met ? 'gate met' : advisory ? 'advisory · non-blocking' : 'gate not met'}
      </p>
    </div>
  );
}
