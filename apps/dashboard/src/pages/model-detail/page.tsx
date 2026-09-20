import { useCallback, useEffect, useState, type JSX } from 'react';
import { useParams } from 'react-router-dom';
import { BrainCircuit, CircleAlert, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { apiFetch } from '@/lib/api';
import { SelectedModelDetails } from '@/pages/model-registry/components/SelectedModelDetails';
import { ModelEvolutionEvidence } from '@/pages/evolution-evidence/components/ModelEvolutionEvidence';
import type { ModelDeployResponse, ModelRecord, ModelResponse } from '@/pages/model-registry/types';
import type { InferenceJob, JobResponse } from '@/pages/inference-engine/types';

export default function ModelDetailPage(): JSX.Element {
  const { modelId } = useParams<{ modelId: string }>();
  const [models, setModels] = useState<ModelRecord[]>([]);
  const [jobs, setJobs] = useState<InferenceJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string>();
  const [deploying, setDeploying] = useState(false);

  const loadData = useCallback(async (isRefresh = false) => {
    setError(undefined);
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    try {
      const [modelResponse, jobResponse] = await Promise.all([
        apiFetch<ModelResponse>('/v1/models'),
        apiFetch<JobResponse>('/v1/inference/jobs'),
      ]);
      setModels(modelResponse.models ?? []);
      setJobs(jobResponse.jobs ?? []);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Unable to load model detail');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const handleDeployModel = async (id: string, task: string, active: boolean) => {
    setDeploying(true);
    setError(undefined);
    try {
      await apiFetch<ModelDeployResponse>('/v1/models/deploy', {
        method: 'POST',
        body: JSON.stringify({
          model_id: id,
          task,
          active,
        }),
      });
      if (active) {
        toast.success('Đã kích hoạt Champion', { description: `Model ${id}` });
      } else {
        toast.warning('Đã vô hiệu hóa Champion', { description: `Model ${id}` });
      }
      await loadData(true);
    } catch (deployErr) {
      const message = deployErr instanceof Error ? deployErr.message : 'Không thể cập nhật trạng thái triển khai model';
      setError(message);
    } finally {
      setDeploying(false);
    }
  };

  const selectedModel = models.find((m) => m.model_id === modelId || m.runtime_package_id === modelId) ?? models[0];

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
        <div>
          <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
            <BrainCircuit className="size-4 text-primary" />
            AI Factory · Model Detail
          </div>
          <h2 className="font-heading text-2xl font-semibold tracking-tight md:text-3xl">Model Detail</h2>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            Metadata, evaluation evidence, artifact hashes và history inference của một model.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => void loadData(true)} disabled={loading || refreshing}>
            <RefreshCw className={`size-3.5 ${refreshing ? 'animate-spin' : ''}`} />
            Refresh evidence
          </Button>
        </div>
      </div>

      {/* Error Alert */}
      {error && (
        <div className="flex items-start gap-3 rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
          <CircleAlert className="mt-0.5 size-4 shrink-0" />
          <div>
            <p className="font-medium">Lỗi kết nối / Model Registry</p>
            <p className="mt-1 opacity-90">{error}</p>
          </div>
        </div>
      )}

      <div className="grid gap-6 xl:grid-cols-2">
        <SelectedModelDetails
          selectedModel={selectedModel}
          onDeployModel={handleDeployModel}
          isDeploying={deploying}
        />
        <ModelEvolutionEvidence model={selectedModel} jobs={jobs} compact />
      </div>
    </div>
  );
}
