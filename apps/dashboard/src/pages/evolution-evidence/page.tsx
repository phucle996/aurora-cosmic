import { useCallback, useEffect, useState, type JSX } from 'react';
import { CircleAlert, GitBranch } from 'lucide-react';
import { apiFetch } from '@/lib/api';
import { ModelEvolutionEvidence } from './components/ModelEvolutionEvidence';
import type { ModelRecord, ModelResponse } from '@/pages/model-registry/types';
import type { InferenceJob, JobResponse } from '@/pages/inference-engine/types';

export default function EvolutionEvidencePage(): JSX.Element {
  const [models, setModels] = useState<ModelRecord[]>([]);
  const [jobs, setJobs] = useState<InferenceJob[]>([]);
  const [selectedRuntimeId, setSelectedRuntimeId] = useState<string>();
  const [error, setError] = useState<string>();

  const loadData = useCallback(async () => {
    setError(undefined);
    try {
      const [modelResponse, jobResponse] = await Promise.all([
        apiFetch<ModelResponse>('/v1/models'),
        apiFetch<JobResponse>('/v1/inference/jobs'),
      ]);
      const modelItems = modelResponse.models ?? [];
      setModels(modelItems);
      setJobs(jobResponse.jobs ?? []);
      setSelectedRuntimeId((current) =>
        current && modelItems.some((m) => m.runtime_package_id === current)
          ? current
          : modelItems[0]?.runtime_package_id,
      );
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : 'Unable to load evolution evidence',
      );
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const selectedModel =
    models.find((m) => m.runtime_package_id === selectedRuntimeId) ?? models[0];

  return (
    <div className="space-y-6">
      {/* Blueprint Hero Banner */}
      <div className="relative flex flex-col justify-between gap-4 overflow-hidden border border-border/70 bg-card px-4 py-5 shadow-sm sm:px-6 md:flex-row md:items-end">
        <div className="pointer-events-none absolute inset-0 opacity-[0.18] [background-image:linear-gradient(to_right,var(--border)_1px,transparent_1px),linear-gradient(to_bottom,var(--border)_1px,transparent_1px)] [background-size:28px_28px]" />
        <div className="relative">
          <div className="mb-2 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-primary">
            <GitBranch className="size-4 text-primary" />
            AI Factory / Evolution Evidence
          </div>
          <h2 className="font-heading text-2xl font-semibold tracking-tight md:text-3xl">
            Evolution Evidence
          </h2>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            Deterministic lineage tracing from Gold dataset snapshot to trained model, evaluation
            evidence, ONNX runtime, and live inference footprint.
          </p>
        </div>
      </div>

      {/* Error Alert */}
      {error && (
        <div className="flex items-start gap-3 border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
          <CircleAlert className="mt-0.5 size-4 shrink-0" />
          <div>
            <p className="font-medium">Connection / Evolution Evidence Error</p>
            <p className="mt-1 opacity-90">{error}</p>
          </div>
        </div>
      )}

      <ModelEvolutionEvidence
        models={models}
        model={selectedModel}
        jobs={jobs}
        selectedRuntimeId={selectedRuntimeId}
        onSelectRuntimeId={setSelectedRuntimeId}
      />
    </div>
  );
}
