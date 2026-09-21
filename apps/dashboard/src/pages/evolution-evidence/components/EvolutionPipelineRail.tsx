import type { JSX, ElementType } from 'react';
import {
  ArrowRight,
  BadgeCheck,
  Box,
  BrainCircuit,
  Database,
  ShieldCheck,
} from 'lucide-react';
import { formatBytes, type ModelRecord } from '@/pages/model-registry/types';
import type { InferenceJob } from '@/pages/inference-engine/types';
import type { EvolutionEvaluation } from '../types';

interface EvolutionPipelineRailProps {
  model: ModelRecord;
  evaluation: EvolutionEvaluation;
  jobs: InferenceJob[];
}

function formatScore(value?: number): string {
  return value === undefined ? '—' : `${(value * 100).toFixed(2)}%`;
}

interface StageCardProps {
  icon: ElementType;
  step: string;
  title: string;
  primary: string;
  secondary: string;
  badge?: string;
  tone: 'cyan' | 'violet' | 'emerald' | 'sky' | 'amber';
}

const toneStyles: Record<
  StageCardProps['tone'],
  { border: string; badge: string; icon: string; dot: string }
> = {
  cyan: {
    border: 'border-cyan-500/30 hover:border-cyan-500/60 bg-cyan-500/[0.03]',
    badge: 'bg-cyan-500/10 text-cyan-600 dark:text-cyan-400 border-cyan-500/20',
    icon: 'text-cyan-500',
    dot: 'bg-cyan-500',
  },
  violet: {
    border: 'border-violet-500/30 hover:border-violet-500/60 bg-violet-500/[0.03]',
    badge: 'bg-violet-500/10 text-violet-600 dark:text-violet-400 border-violet-500/20',
    icon: 'text-violet-500',
    dot: 'bg-violet-500',
  },
  emerald: {
    border: 'border-emerald-500/30 hover:border-emerald-500/60 bg-emerald-500/[0.03]',
    badge: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20',
    icon: 'text-emerald-500',
    dot: 'bg-emerald-500',
  },
  sky: {
    border: 'border-sky-500/30 hover:border-sky-500/60 bg-sky-500/[0.03]',
    badge: 'bg-sky-500/10 text-sky-600 dark:text-sky-400 border-sky-500/20',
    icon: 'text-sky-500',
    dot: 'bg-sky-500',
  },
  amber: {
    border: 'border-amber-500/30 hover:border-amber-500/60 bg-amber-500/[0.03]',
    badge: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20',
    icon: 'text-amber-500',
    dot: 'bg-amber-500',
  },
};

function StageCard({
  icon: Icon,
  step,
  title,
  primary,
  secondary,
  badge,
  tone,
}: StageCardProps): JSX.Element {
  const styles = toneStyles[tone];

  return (
    <div
      className={`relative flex min-w-0 flex-col justify-between border p-3.5 transition-colors ${styles.border}`}
    >
      <div>
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            <span className={`inline-block size-1.5 rounded-full ${styles.dot}`} />
            {step}
          </div>
          {badge && (
            <span
              className={`border px-1.5 py-0.2 font-mono text-[9px] uppercase font-semibold ${styles.badge}`}
            >
              {badge}
            </span>
          )}
        </div>

        <div className="mt-2.5 flex items-center gap-2">
          <Icon className={`size-4 shrink-0 ${styles.icon}`} />
          <h4 className="text-xs font-semibold text-foreground tracking-tight">{title}</h4>
        </div>

        <p
          className="mt-2 truncate font-mono text-[11px] font-medium text-foreground selection:bg-primary/20"
          title={primary}
        >
          {primary}
        </p>
      </div>

      <p className="mt-2 truncate text-[10px] text-muted-foreground" title={secondary}>
        {secondary}
      </p>
    </div>
  );
}

function RailConnector(): JSX.Element {
  return (
    <div className="hidden items-center justify-center text-muted-foreground/40 xl:flex">
      <ArrowRight className="size-4" />
    </div>
  );
}

export function EvolutionPipelineRail({
  model,
  evaluation,
  jobs,
}: EvolutionPipelineRailProps): JSX.Element {
  const completedJobs = jobs.filter((job) => job.status.toLowerCase() === 'completed').length;
  const totalPredictions = jobs.reduce((sum, job) => sum + (job.expected_prediction_count || 0), 0);

  return (
    <section className="border-b border-border/60 bg-muted/5 p-4 sm:p-5">
      <div className="mb-3 flex items-center justify-between">
        <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
          Lineage Pipeline Verification
        </span>
        <span className="font-mono text-[10px] text-muted-foreground">5 deterministic stages</span>
      </div>

      <div className="grid gap-3 xl:grid-cols-[1fr_auto_1fr_auto_1fr_auto_1fr_auto_1fr] xl:items-stretch">
        <StageCard
          icon={Database}
          step="01 / DATA"
          title="Gold Snapshot"
          primary={evaluation.gold_snapshot_id || 'Binding unavailable'}
          secondary={evaluation.dataset_view_version || 'Dataset view not recorded'}
          tone="cyan"
        />

        <RailConnector />

        <StageCard
          icon={BrainCircuit}
          step="02 / TRAIN"
          title="Training Run"
          primary={evaluation.training_run_id || 'Run ID unavailable'}
          secondary={`${evaluation.split_id || 'split-main'} · ${
            evaluation.feature_count ?? model.feature_count
          } features`}
          tone="violet"
        />

        <RailConnector />

        <StageCard
          icon={BadgeCheck}
          step="03 / EVALUATE"
          title="Frozen Cohorts"
          primary={evaluation.evaluation_run_id || 'Evaluation run unavailable'}
          secondary={`PR-AUC ${formatScore(evaluation.golden?.pr_auc)} · Recall ${formatScore(
            evaluation.golden?.recall,
          )}`}
          badge={evaluation.gate_passed ? 'PASSED' : 'FLAGGED'}
          tone="emerald"
        />

        <RailConnector />

        <StageCard
          icon={Box}
          step="04 / PACKAGE"
          title="ONNX Runtime"
          primary={evaluation.runtime_package_id || model.runtime_package_id}
          secondary={`${formatBytes(
            evaluation.onnx_size_bytes ?? model.onnx_size_bytes,
          )} · Parity ${evaluation.parity_status || model.parity_status}`}
          badge={evaluation.parity_status || model.parity_status}
          tone="sky"
        />

        <RailConnector />

        <StageCard
          icon={ShieldCheck}
          step="05 / SERVE"
          title="Inference Reach"
          primary={`${completedJobs}/${jobs.length} jobs completed`}
          secondary={`${model.status.toUpperCase()} · ${totalPredictions.toLocaleString()} expected rows`}
          badge={model.status.toUpperCase()}
          tone="amber"
        />
      </div>
    </section>
  );
}
