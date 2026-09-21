import { useCallback, useEffect, useState, type JSX } from 'react';
import { CircleAlert, RefreshCw, Zap } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { apiFetch } from '@/lib/api';
import type { ModelRecord, ModelResponse } from '@/pages/model-registry/types';
import { InferenceJobsTable } from './components/InferenceJobsTable';
import type { InferenceJob, JobResponse } from './types';

export default function InferenceEnginePage(): JSX.Element {
  const [models, setModels] = useState<ModelRecord[]>([]);
  const [jobs, setJobs] = useState<InferenceJob[]>([]);
  const [selectedRuntimeId, setSelectedRuntimeId] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string>();
  const [queueingJob, setQueueingJob] = useState<string>();

  const loadData = useCallback(async (isRefresh = false) => {
    setError(undefined);
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
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
      setError(loadError instanceof Error ? loadError.message : 'Unable to load inference jobs');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  async function queueJob(job: InferenceJob): Promise<void> {
    setQueueingJob(job.job_id);
    try {
      const response = await apiFetch<{ status: string }>(`/v1/inference/jobs/${encodeURIComponent(job.job_id)}/retry`, {
        method: 'POST',
      });
      setJobs((current) =>
        current.map((item) => (item.job_id === job.job_id ? { ...item, status: response.status } : item)),
      );
      toast.info('Đã đưa job vào hàng đợi inference', {
        description: job.job_id,
      });
    } catch (queueError) {
      setError(queueError instanceof Error ? queueError.message : 'Unable to queue inference job');
    } finally {
      setQueueingJob(undefined);
    }
  }

  const selectedModel = models.find((model) => model.runtime_package_id === selectedRuntimeId) ?? models[0];

  return (
    <div className="space-y-6">
      {/* Blueprint Hero Banner */}
      <div className="relative flex flex-col justify-between gap-4 overflow-hidden border border-border/70 bg-card px-4 py-5 shadow-sm sm:px-6 md:flex-row md:items-end">
        <div className="pointer-events-none absolute inset-0 opacity-[0.18] [background-image:linear-gradient(to_right,var(--border)_1px,transparent_1px),linear-gradient(to_bottom,var(--border)_1px,transparent_1px)] [background-size:28px_28px]" />
        <div className="relative">
          <div className="mb-2 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-primary">
            <Zap className="size-4 text-primary" />
            AI Factory / Inference Engine
          </div>
          <h2 className="font-heading text-2xl font-semibold tracking-tight md:text-3xl">Inference Engine</h2>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            Monitor and retry batch scoring on the Rust GPU runtime; each job is pinned to a specific model and Gold artifact.
          </p>
        </div>
        <div className="relative flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => void loadData(true)} disabled={loading || refreshing}>
            <RefreshCw className={`size-3.5 ${refreshing ? 'animate-spin' : ''}`} />
            Refresh evidence
          </Button>
        </div>
      </div>

      {/* Error Alert */}
      {error && (
        <div className="flex items-start gap-3 border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
          <CircleAlert className="mt-0.5 size-4 shrink-0" />
          <div>
            <p className="font-medium">Connection / Inference Engine Error</p>
            <p className="mt-1 opacity-90">{error}</p>
          </div>
        </div>
      )}

      <InferenceJobsTable
        models={models}
        selectedRuntimeId={selectedRuntimeId}
        onSelectRuntimeId={setSelectedRuntimeId}
        selectedModel={selectedModel}
        jobs={jobs}
        onQueueJob={queueJob}
        queueingJobId={queueingJob}
      />
    </div>
  );
}
