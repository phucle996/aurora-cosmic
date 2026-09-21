import { useCallback, useEffect, useState, type JSX } from 'react';
import { CircleAlert, FlaskConical } from 'lucide-react';
import { apiFetch } from '@/lib/api';
import type { ModelRecord, ModelResponse } from '@/pages/model-registry/types';
import { ModelEvaluationBoard } from './components/ModelEvaluationBoard';

export default function ModelEvaluationPage(): JSX.Element {
  const [models, setModels] = useState<ModelRecord[]>([]);
  const [selectedRuntimeId, setSelectedRuntimeId] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();

  const loadData = useCallback(async () => {
    setError(undefined);
    setLoading(true);
    try {
      const modelResponse = await apiFetch<ModelResponse>('/v1/models');
      const items = modelResponse.models ?? [];
      setModels(items);
      setSelectedRuntimeId((current) =>
        current && items.some((m) => m.runtime_package_id === current)
          ? current
          : items[0]?.runtime_package_id,
      );
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Unable to load models for evaluation');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  return (
    <div className="space-y-6">
      {/* Blueprint Hero Banner */}
      <div className="relative flex flex-col justify-between gap-4 overflow-hidden border border-border/70 bg-card px-4 py-5 shadow-sm sm:px-6 md:flex-row md:items-end">
        <div className="pointer-events-none absolute inset-0 opacity-[0.18] [background-image:linear-gradient(to_right,var(--border)_1px,transparent_1px),linear-gradient(to_bottom,var(--border)_1px,transparent_1px)] [background-size:28px_28px]" />
        <div className="relative">
          <div className="mb-2 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-primary">
            <FlaskConical className="size-4 text-primary" />
            AI Factory / Model Evaluation
          </div>
          <h2 className="font-heading text-2xl font-semibold tracking-tight md:text-3xl">Model Evaluation</h2>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            Inspect frozen-cohort evaluation evidence, PyTorch–ONNX parity verification, and quality gate status before promotion.
          </p>
        </div>
      </div>

      {/* Error Alert */}
      {error && (
        <div className="flex items-start gap-3 border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
          <CircleAlert className="mt-0.5 size-4 shrink-0" />
          <div>
            <p className="font-medium">Connection / Model Evaluation Error</p>
            <p className="mt-1 opacity-90">{error}</p>
          </div>
        </div>
      )}

      <ModelEvaluationBoard
        models={models}
        loading={loading}
        selectedRuntimeId={selectedRuntimeId}
        onSelect={setSelectedRuntimeId}
      />
    </div>
  );
}
