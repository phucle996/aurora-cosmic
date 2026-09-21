import type { JSX } from 'react';
import { GitBranch } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { statusVariant, type ModelRecord } from '@/pages/model-registry/types';
import type { InferenceJob } from '@/pages/inference-engine/types';
import type { EvolutionEvaluation } from '../types';

interface CompactEvolutionProps {
  model: ModelRecord;
  evaluation?: EvolutionEvaluation;
  jobs: InferenceJob[];
  loading: boolean;
}

function truncate(value?: string, size = 14): string {
  if (!value) return '—';
  return value.length > size ? `${value.slice(0, size)}…` : value;
}

function CompactMetric({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="min-w-0 bg-background/80 p-3">
      <p className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="mt-1 truncate font-mono text-xs font-semibold text-foreground" title={value}>
        {value}
      </p>
    </div>
  );
}

export function CompactEvolution({
  model,
  evaluation,
  jobs,
  loading,
}: CompactEvolutionProps): JSX.Element {
  const completedCount = jobs.filter((job) => job.status.toLowerCase() === 'completed').length;

  return (
    <section className="overflow-hidden border border-border/80 bg-card shadow-sm">
      <header className="flex items-center justify-between gap-3 border-b border-border/60 p-4">
        <div>
          <p className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <GitBranch className="size-4 text-primary" />
            Evolution Evidence
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Gold evidence → evaluation metrics → ONNX runtime → inference reach
          </p>
        </div>
        <Badge
          variant={statusVariant(model.status)}
          className="rounded-none font-mono text-[9px] uppercase tracking-wider"
        >
          {model.status}
        </Badge>
      </header>

      <div className="grid grid-cols-2 gap-px bg-border/60 sm:grid-cols-4">
        <CompactMetric
          label="Gold Snapshot"
          value={loading ? 'loading…' : truncate(evaluation?.gold_snapshot_id) || '—'}
        />
        <CompactMetric
          label="Evaluation Run"
          value={truncate(model.evaluation_run_id) || '—'}
        />
        <CompactMetric
          label="Runtime Package"
          value={truncate(model.runtime_package_id) || '—'}
        />
        <CompactMetric
          label="Inference Reach"
          value={`${completedCount}/${jobs.length} jobs`}
        />
      </div>
    </section>
  );
}
