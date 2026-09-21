import type { JSX } from 'react';
import { ShieldCheck } from 'lucide-react';
import { formatDate } from '@/pages/model-registry/types';
import type { ModelEvaluation } from '../types';

type Props = {
  evaluation: ModelEvaluation;
};

function ProvenanceItem({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="min-w-0 bg-background p-3">
      <dt className="font-mono text-[9px] uppercase text-muted-foreground">{label}</dt>
      <dd className="mt-1 truncate font-mono text-xs" title={value}>
        {value || '—'}
      </dd>
    </div>
  );
}

export function EvaluationProvenanceCard({ evaluation }: Props): JSX.Element {
  return (
    <section className="p-4 sm:p-5">
      <div className="flex items-center gap-2">
        <ShieldCheck className="size-4 text-primary" />
        <p className="text-sm font-medium">Immutable evaluation provenance</p>
      </div>

      <dl className="mt-3 grid gap-px border border-border/70 bg-border/70 sm:grid-cols-2 xl:grid-cols-3">
        <ProvenanceItem label="Evaluation run" value={evaluation.evaluation_run_id} />
        <ProvenanceItem label="Training run" value={evaluation.training_run_id} />
        <ProvenanceItem label="Golden cohort" value={evaluation.golden_cohort_id} />
        <ProvenanceItem
          label="Recent cohort"
          value={evaluation.recent_cohort_id || 'not attached'}
        />
        <ProvenanceItem
          label="Evaluation policy"
          value={evaluation.evaluation_policy_version}
        />
        <ProvenanceItem label="Metrics SHA-256" value={evaluation.metrics_sha256} />
      </dl>

      <p
        className="mt-2 truncate font-mono text-[10px] text-muted-foreground"
        title={evaluation.evaluation_manifest_key}
      >
        {evaluation.evaluation_manifest_key} · {formatDate(evaluation.created_at)}
      </p>
    </section>
  );
}
