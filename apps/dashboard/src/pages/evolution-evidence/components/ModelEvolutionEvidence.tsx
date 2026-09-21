import { useEffect, useMemo, useState, type JSX } from 'react';
import { CircleAlert, GitBranch, LoaderCircle, Network } from 'lucide-react';
import { apiFetch } from '@/lib/api';
import { formatDate, taskLabel } from '@/pages/model-registry/types';
import type { EvolutionEvaluation, ModelEvolutionEvidenceProps } from '../types';
import { EvolutionPipelineRail } from './EvolutionPipelineRail';
import { InferenceFootprintChart } from './InferenceFootprintChart';
import { ArtifactBindingLedger } from './ArtifactBindingLedger';
import { GenerationLedgerTable } from './GenerationLedgerTable';
import { CompactEvolution } from './CompactEvolution';

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
      className={`grid min-h-[460px] place-items-center p-6 text-center ${destructive ? 'text-destructive' : 'text-muted-foreground'
        }`}
    >
      <div>
        <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-muted/40">
          {icon}
        </div>
        <p className="mt-3 text-sm font-medium text-foreground">{title}</p>
        <p className="mt-1 max-w-lg text-xs opacity-80">{detail}</p>
      </div>
    </div>
  );
}

export function ModelEvolutionEvidence({
  model,
  models = [],
  jobs = [],
  selectedRuntimeId,
  onSelectRuntimeId,
  compact = false,
}: ModelEvolutionEvidenceProps): JSX.Element {
  const subjects = models.length > 0 ? models : model ? [model] : [];
  const selected =
    subjects.find((item) => item.runtime_package_id === selectedRuntimeId) ??
    model ??
    subjects[0];

  const [evaluation, setEvaluation] = useState<EvolutionEvaluation>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    let active = true;
    if (!selected?.runtime_package_id) {
      setEvaluation(undefined);
      return () => {
        active = false;
      };
    }

    setLoading(true);
    setError(undefined);
    setEvaluation(undefined);

    void apiFetch<EvolutionEvaluation>(
      `/v1/models/${encodeURIComponent(selected.runtime_package_id)}/evolution`,
    )
      .then((value) => {
        if (active) setEvaluation(value);
      })
      .catch((cause) => {
        if (active) {
          setError(
            cause instanceof Error ? cause.message : 'Evolution evidence is unavailable',
          );
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [selected?.runtime_package_id]);

  const linkedJobs = useMemo(
    () =>
      selected
        ? jobs.filter(
          (job) =>
            job.runtime_package_id === selected.runtime_package_id ||
            job.model_id === selected.model_id,
        )
        : [],
    [jobs, selected],
  );

  // Compact mode for ModelDetailPage
  if (compact && selected) {
    return (
      <CompactEvolution
        model={selected}
        evaluation={evaluation}
        jobs={linkedJobs}
        loading={loading}
      />
    );
  }

  // Empty state if no model generation exists
  if (!selected) {
    return (
      <section className="border border-border/80 bg-card shadow-sm">
        <header className="border-b border-border/60 p-5">
          <p className="flex items-center gap-2 font-mono text-xs uppercase tracking-[0.14em] text-primary">
            <GitBranch className="size-4" />
            Evolution Evidence
          </p>
          <h3 className="mt-1 text-lg font-semibold text-foreground">
            No Model Generation Registered
          </h3>
        </header>
        <div className="grid min-h-72 place-items-center p-6 text-center">
          <div>
            <Network className="mx-auto size-8 text-muted-foreground/40" />
            <p className="mt-3 text-sm font-medium text-foreground">
              No Registered Runtime Package Found
            </p>
            <p className="mt-1 max-w-md text-xs text-muted-foreground">
              Training, evaluation and runtime provenance will automatically appear after the first
              model package is committed.
            </p>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="overflow-hidden border border-border/80 bg-card shadow-sm">
      {/* Top Header */}
      <header className="border-b border-border/60 p-4 sm:p-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="flex items-center gap-2 font-mono text-xs uppercase tracking-[0.14em] text-primary">
              <GitBranch className="size-4" />
              Model Evolution Console
            </p>
            <h3 className="mt-1 text-lg font-semibold text-foreground">
              Deterministic Generation Lineage
            </h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Trace an immutable model generation from Gold evidence snapshot to production inference footprint.
            </p>
          </div>

          {subjects.length > 0 && (
            <label className="block">
              <span className="mb-1 block font-mono text-[10px] uppercase text-muted-foreground">
                Generation Subject
              </span>
              <select
                value={selected.runtime_package_id}
                onChange={(event) => onSelectRuntimeId?.(event.target.value)}
                className="h-10 w-full min-w-0 border border-input bg-background px-3 font-mono text-xs outline-none focus:border-primary sm:w-[430px]"
              >
                {subjects.map((item) => (
                  <option key={item.runtime_package_id} value={item.runtime_package_id}>
                    {item.model_id} · {item.model_version || 'unversioned'} · {item.status}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
      </header>

      {/* Body States */}
      {loading ? (
        <EvidenceState
          icon={<LoaderCircle className="size-6 animate-spin text-primary" />}
          title="Resolving Provenance Bindings"
          detail={`Inspecting cryptographic bindings for runtime package ${selected.runtime_package_id}…`}
        />
      ) : error || !evaluation ? (
        <EvidenceState
          icon={<CircleAlert className="size-6 text-destructive" />}
          title="Incomplete Evolution Chain"
          detail={
            error || 'The runtime package has no readable or valid evaluation evidence run.'
          }
          destructive
        />
      ) : (
        <div className="min-w-0">
          {/* 5-stage Lineage Rail */}
          <EvolutionPipelineRail
            model={selected}
            evaluation={evaluation}
            jobs={linkedJobs}
          />

          {/* Split Section: Inference Footprint & Artifact Ledger */}
          <section className="grid min-w-0 gap-px border-b border-border/60 bg-border/60 xl:grid-cols-2">
            <InferenceFootprintChart jobs={linkedJobs} />
            <ArtifactBindingLedger model={selected} evaluation={evaluation} />
          </section>

          {/* Generation Ledger Table */}
          {subjects.length > 1 && (
            <GenerationLedgerTable
              models={subjects}
              selectedRuntimeId={selected.runtime_package_id}
              onSelect={onSelectRuntimeId}
            />
          )}

          {/* Metadata Footer */}
          <footer className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5 border-t border-border/60 bg-muted/10 px-4 py-3 font-mono text-[10px] text-muted-foreground">
            <span className="font-semibold text-foreground">
              {taskLabel[selected.task] ?? selected.task}
            </span>
            <span>·</span>
            <span>Policy: {evaluation.evaluation_policy_version}</span>
            <span>·</span>
            <span>Created: {formatDate(selected.created_at)}</span>
            <span>·</span>
            <span className="truncate" title={evaluation.runtime_manifest_key ?? selected.runtime_manifest_key}>
              Manifest: {evaluation.runtime_manifest_key ?? selected.runtime_manifest_key}
            </span>
          </footer>
        </div>
      )}
    </section>
  );
}
