import { useEffect, useState, type JSX } from 'react';
import { AlertTriangle, Database, FlaskConical, LoaderCircle } from 'lucide-react';
import { apiFetch } from '@/lib/api';
import type { ModelRecord } from '@/pages/model-registry/types';
import type { ModelEvaluation } from '../types';
import { CohortStabilityPanel } from './CohortStabilityPanel';
import { ConfusionMatrixCard } from './ConfusionMatrixCard';
import { EvaluationPackageSidebar } from './EvaluationPackageSidebar';
import { EvaluationProvenanceCard } from './EvaluationProvenanceCard';
import { EvaluationSummaryCards } from './EvaluationSummaryCards';
import { QualityProfileChart } from './QualityProfileChart';
import { ThresholdEvidencePanel } from './ThresholdEvidencePanel';

type Props = {
  models: ModelRecord[];
  loading?: boolean;
  selectedRuntimeId?: string;
  onSelect: (runtimePackageId: string) => void;
};

function EvidenceState({
  icon,
  title,
  detail,
  destructive = false,
}: {
  icon: JSX.Element;
  title: string;
  detail: string;
  destructive?: boolean;
}): JSX.Element {
  return (
    <div
      className={`grid min-h-[480px] place-items-center p-6 text-center ${
        destructive ? 'text-destructive' : 'text-muted-foreground'
      }`}
    >
      <div>
        {icon}
        <p className="mt-3 text-sm font-medium">{title}</p>
        <p className="mt-1 max-w-xl text-xs opacity-80">{detail}</p>
      </div>
    </div>
  );
}

export function ModelEvaluationBoard({
  models,
  loading = false,
  selectedRuntimeId,
  onSelect,
}: Props): JSX.Element {
  const selected = models.find((model) => model.runtime_package_id === selectedRuntimeId) ?? models[0];
  const [evaluation, setEvaluation] = useState<ModelEvaluation>();
  const [evalLoading, setEvalLoading] = useState(false);
  const [evalError, setEvalError] = useState<string>();

  useEffect(() => {
    let active = true;
    if (!selected?.runtime_package_id) {
      setEvaluation(undefined);
      setEvalError(undefined);
      return () => {
        active = false;
      };
    }

    setEvalLoading(true);
    setEvaluation(undefined);
    setEvalError(undefined);

    void apiFetch<ModelEvaluation>(
      `/v1/models/${encodeURIComponent(selected.runtime_package_id)}/evaluation`,
    )
      .then((value) => {
        if (active) setEvaluation(value);
      })
      .catch((cause) => {
        if (active) {
          setEvalError(cause instanceof Error ? cause.message : 'Evaluation evidence is unavailable');
        }
      })
      .finally(() => {
        if (active) setEvalLoading(false);
      });

    return () => {
      active = false;
    };
  }, [selected?.runtime_package_id]);

  // Loading initial packages state
  if (loading && models.length === 0) {
    return (
      <section className="border border-border/80 bg-card">
        <header className="border-b border-border/60 p-5">
          <p className="flex items-center gap-2 font-mono text-xs uppercase tracking-[0.14em] text-primary">
            <FlaskConical className="size-4" />
            Evaluation console
          </p>
          <h3 className="mt-1 text-lg font-semibold">Loading registered packages…</h3>
        </header>
        <div className="grid min-h-80 place-items-center p-6 text-center">
          <div className="text-muted-foreground">
            <LoaderCircle className="mx-auto size-8 animate-spin text-primary" />
            <p className="mt-3 text-sm font-medium">Fetching candidate models from registry</p>
            <p className="mt-1 text-xs text-muted-foreground">Checking durable artifacts and parity metadata…</p>
          </div>
        </div>
      </section>
    );
  }

  // Empty state when registry has no models
  if (models.length === 0) {
    return (
      <section className="border border-border/80 bg-card">
        <header className="border-b border-border/60 p-5">
          <p className="flex items-center gap-2 font-mono text-xs uppercase tracking-[0.14em] text-primary">
            <FlaskConical className="size-4" />
            Evaluation console
          </p>
          <h3 className="mt-1 text-lg font-semibold">No registered evaluation subject</h3>
        </header>
        <div className="grid min-h-80 place-items-center p-6 text-center">
          <div>
            <Database className="mx-auto size-8 text-muted-foreground/50" />
            <p className="mt-3 text-sm font-medium">No runtime package in Model Registry</p>
            <p className="mt-1 max-w-lg text-xs text-muted-foreground">
              After training completes, the evaluator will write Golden/Recent cohort metrics, threshold
              evidence, and confusion matrix into an immutable evaluation run.
            </p>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="overflow-hidden border border-border/80 bg-card shadow-sm">
      <header className="border-b border-border/60 p-4 sm:p-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="flex items-center gap-2 font-mono text-xs uppercase tracking-[0.14em] text-primary">
              <FlaskConical className="size-4" />
              Evaluation console
            </p>
            <h3 className="mt-1 text-lg font-semibold">Frozen-cohort model evidence</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Threshold selection, classifier quality, error topology, cohort drift and runtime parity from
              durable evaluator artifacts.
            </p>
          </div>
          <label className="block">
            <span className="mb-1 block font-mono text-[10px] uppercase text-muted-foreground">
              Evaluation subject
            </span>
            <select
              value={selected?.runtime_package_id ?? ''}
              onChange={(event) => onSelect(event.target.value)}
              className="h-10 w-full min-w-0 border border-input bg-background px-3 font-mono text-xs outline-none focus:border-primary sm:w-[430px]"
            >
              {models.map((model) => (
                <option key={model.runtime_package_id} value={model.runtime_package_id}>
                  {model.model_id} · {model.model_version || 'unversioned'} · {model.status}
                </option>
              ))}
            </select>
          </label>
        </div>
      </header>

      <div className="grid min-w-0 xl:grid-cols-[300px_minmax(0,1fr)]">
        <EvaluationPackageSidebar
          models={models}
          selectedRuntimeId={selected?.runtime_package_id}
          onSelect={onSelect}
        />

        <main className="min-w-0">
          {evalLoading ? (
            <EvidenceState
              icon={<LoaderCircle className="size-5 animate-spin" />}
              title="Loading immutable evaluation evidence"
              detail={selected?.evaluation_run_id || selected?.runtime_package_id || ''}
            />
          ) : evalError || !evaluation ? (
            <EvidenceState
              icon={<AlertTriangle className="size-5" />}
              title="Evaluation evidence unavailable"
              detail={
                evalError || 'This runtime package does not reference a durable evaluation run.'
              }
              destructive
            />
          ) : (
            <div className="min-w-0">
              <EvaluationSummaryCards evaluation={evaluation} />

              <section className="grid min-w-0 gap-px border-b border-border/60 bg-border/60 2xl:grid-cols-[minmax(0,1.35fr)_minmax(360px,0.65fr)]">
                <QualityProfileChart evaluation={evaluation} />
                <ConfusionMatrixCard evaluation={evaluation} />
              </section>

              <section className="grid min-w-0 gap-px border-b border-border/60 bg-border/60 xl:grid-cols-2">
                <ThresholdEvidencePanel evaluation={evaluation} />
                <CohortStabilityPanel evaluation={evaluation} />
              </section>

              <EvaluationProvenanceCard evaluation={evaluation} />
            </div>
          )}
        </main>
      </div>
    </section>
  );
}
