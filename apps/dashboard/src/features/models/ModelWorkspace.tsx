import { useCallback, useEffect, useState } from 'react';
import type { JSX } from 'react';
import { useParams } from 'react-router-dom';
import { BrainCircuit, CheckCircle2, CircleAlert, RefreshCw, Workflow } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { apiBase, apiFetch } from '@/lib/api';

import { InferenceJobsTable } from './components/InferenceJobsTable';
import { LiveTrainingBanner } from './components/LiveTrainingBanner';
import { MetricCards } from './components/MetricCards';
import { ModelEvaluationBoard } from './components/ModelEvaluationBoard';
import { ModelEvolutionEvidence } from './components/ModelEvolutionEvidence';
import { ModelRegistryTable } from './components/ModelRegistryTable';
import { SelectedModelDetails } from './components/SelectedModelDetails';
import { TrainingLabControl } from './components/TrainingLabControl';
import { TrainingRuntimePanel } from './components/TrainingRuntimePanel';
import type {
  ActiveTrainingState,
  GoldSnapshotItem,
  InferenceJob,
  JobResponse,
  ModelDeployResponse,
  ModelRecord,
  ModelResponse,
  GoldSnapshotInventoryResponse,
  TaskType,
  TrainingResponse,
} from './types';

export type AIModelView = 'training' | 'evaluation' | 'evidence' | 'registry' | 'inference' | 'detail' | 'overview';

const viewCopy: Record<AIModelView, { eyebrow: string; title: string; description: string }> = {
  training: { eyebrow: 'AI Factory · Training Lab', title: 'Training Lab', description: 'Chọn Train New hoặc Evolve, pin CPU/GPU target và theo dõi tài nguyên runtime trong lúc huấn luyện.' },
  evaluation: { eyebrow: 'AI Factory · Model Evaluation', title: 'Model Evaluation', description: 'Kiểm tra evaluation run, parity PyTorch–ONNX và trạng thái quality gate trước promotion.' },
  evidence: { eyebrow: 'AI Factory · Evolution Evidence', title: 'Evolution Evidence', description: 'Truy vết Gold input → training/evaluation → runtime package → inference của từng thế hệ model.' },
  registry: { eyebrow: 'AI Factory · Model Registry', title: 'Model Registry', description: 'Quản lý version, candidate/validated/champion và deployment có thể rollback.' },
  inference: { eyebrow: 'AI Factory · Inference Engine', title: 'Inference Engine', description: 'Theo dõi và retry batch scoring trên Rust GPU runtime; mỗi job được pin vào model và Gold artifact cụ thể.' },
  detail: { eyebrow: 'AI Factory · Model Detail', title: 'Model Detail', description: 'Metadata, evaluation evidence, artifact hashes và history inference của một model.' },
  overview: { eyebrow: 'AI Factory', title: 'AI Factory', description: 'Control plane thống nhất cho training, evidence, registry và inference.' },
};

export default function ModelWorkspace({ view = 'overview' }: { view?: AIModelView }): JSX.Element {
  const { modelId } = useParams<{ modelId: string }>();
  const [models, setModels] = useState<ModelRecord[]>([]);
  const [jobs, setJobs] = useState<InferenceJob[]>([]);
  const [selectedRuntimeId, setSelectedRuntimeId] = useState<string>();
  const [taskFilter, setTaskFilter] = useState<TaskType>('all');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string>();
  const [queueingJob, setQueueingJob] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [deploying, setDeploying] = useState(false);

  // Training Dialog state & Snapshots
  const [availableSnapshots, setAvailableSnapshots] = useState<GoldSnapshotItem[]>([]);
  const [snapshotsLoading, setSnapshotsLoading] = useState(false);
  const [trainingSubmitting, setTrainingSubmitting] = useState(false);

  // Live GPU Training Monitor State
  const [activeTraining, setActiveTraining] = useState<ActiveTrainingState | null>(null);
  const [trainingElapsed, setTrainingElapsed] = useState(0);

  // Load Model Registry and Inference Jobs
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
      setSelectedRuntimeId((current) =>
        modelId && modelResponse.models.some((model) => model.model_id === modelId)
          ? modelResponse.models.find((model) => model.model_id === modelId)?.runtime_package_id
          :
        current && modelResponse.models.some((model) => model.runtime_package_id === current)
          ? current
          : modelResponse.models[0]?.runtime_package_id,
      );
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Unable to load model registry');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [modelId]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  // The API reads only manifest metadata; the browser never scans every Gold object.
  const loadAvailableSnapshots = useCallback(async () => {
    setSnapshotsLoading(true);
    try {
      const inventory = await apiFetch<GoldSnapshotInventoryResponse>('/v1/gold/snapshots?limit=200');

      const trainedSnapshotSet = new Map<string, string>();
      for (const m of models) {
        if (m.gold_snapshot_id) {
          trainedSnapshotSet.set(m.gold_snapshot_id, m.model_id);
        }
      }

      const list = inventory.snapshots.filter((snapshot) => snapshot.status === 'COMMITTED').map((snapshot): GoldSnapshotItem => {
        const trainedModelID = trainedSnapshotSet.get(snapshot.snapshot_id);
        return {
          snapshot_id: snapshot.snapshot_id,
          key: snapshot.manifest_key,
          size_bytes: snapshot.size_bytes,
          last_modified: snapshot.last_modified || snapshot.created_at,
          is_trained: trainedModelID !== undefined,
          ...(trainedModelID ? { trained_model_id: trainedModelID } : {}),
        };
      }).sort((a, b) => {
        if (a.is_trained !== b.is_trained) {
          return a.is_trained ? 1 : -1;
        }
        return new Date(b.last_modified).getTime() - new Date(a.last_modified).getTime();
      });

      setAvailableSnapshots(list);
    } catch {
      setAvailableSnapshots([]);
    } finally {
      setSnapshotsLoading(false);
    }
  }, [models]);

  useEffect(() => {
    if (view === 'training') void loadAvailableSnapshots();
  }, [view, loadAvailableSnapshots]);

  // Live Training Polling & Elapsed Timer
  useEffect(() => {
    if (!activeTraining) return;
    const timer = setInterval(() => {
      setTrainingElapsed(Math.floor((Date.now() - activeTraining.startedAt) / 1000));
    }, 1000);

    const poll = setInterval(async () => {
      try {
        const res = await apiFetch<ModelResponse>('/v1/models');
        setModels(res.models ?? []);
      } catch {
        // ignore network error while polling
      }
    }, 2000);

    const eventSource = new EventSource(`${apiBase}/v1/events?workflow=ml`);
    eventSource.addEventListener('workflow', (event) => {
      const message = event as MessageEvent<string>;
      try {
        const update = JSON.parse(message.data) as {
          job_id?: string;
          status?: string;
          payload?: { error?: string };
        };
        if (update.job_id !== activeTraining.jobId) return;

        if (update.status === 'failed') {
          setActiveTraining(null);
          setError(`Huấn luyện thất bại: ${update.payload?.error || 'ML Worker không trả về chi tiết lỗi.'}`);
          return;
        }

        if (update.status === 'completed') {
          void apiFetch<ModelResponse>('/v1/models')
            .then((res) => setModels(res.models ?? []))
            .catch(() => undefined);
          setActiveTraining(null);
          setNotice(`Huấn luyện đã hoàn tất. Runtime package đang chờ Rust xác minh parity; promotion chỉ diễn ra khi người vận hành duyệt trong Model Registry.`);
          void loadAvailableSnapshots();
        }
      } catch {
        // Ignore malformed events and keep polling the registry.
      }
    });

    return () => {
      clearInterval(timer);
      clearInterval(poll);
      eventSource.close();
    };
  }, [activeTraining, loadAvailableSnapshots]);

  const handleStartTraining = async (params: {
    task: 'candidate_vetting';
    baseModelId: string;
    mode: 'fine_tune' | 'scratch';
    snapshotIds: string[];
    epochs: number;
    learningRate: number;
    batchSize: number;
    seed: number;
    computeTarget: 'cpu' | 'gpu';
  }) => {
    setTrainingSubmitting(true);
    setError(undefined);
    setNotice(undefined);
    try {
      const snapshotIds = [...new Set(params.snapshotIds.map((value) => value.trim()).filter(Boolean))];
      if (snapshotIds.length === 0) {
        throw new Error('Chọn ít nhất một committed Gold Snapshot trước khi huấn luyện.');
      }

      const res = await apiFetch<TrainingResponse>('/v1/models/train', {
        method: 'POST',
        body: JSON.stringify({
          task: params.task,
          gold_snapshot_ids: snapshotIds,
          base_model_id: params.baseModelId,
          training_mode: params.mode,
          epochs: params.epochs,
          learning_rate: params.learningRate,
          batch_size: params.batchSize,
          seed: params.seed,
          compute_target: params.computeTarget,
        }),
      });
      setNotice(`🚀 Training Job ${res.job_id} đã được gửi tới nhánh ${params.computeTarget.toUpperCase()} với ${snapshotIds.length} Gold snapshot. Promotion cần được duyệt thủ công trong Model Registry.`);

      setActiveTraining({
        jobId: res.job_id,
        task: params.task,
        snapshotCount: snapshotIds.length,
        baseModel: params.baseModelId,
        epochs: params.epochs,
        computeTarget: params.computeTarget,
        startedAt: Date.now(),
      });
      setTrainingElapsed(0);
    } catch (trainError) {
      setError(trainError instanceof Error ? trainError.message : 'Không thể khởi chạy training job');
    } finally {
      setTrainingSubmitting(false);
    }
  };

  // Đổi trạng thái triển khai suy luận Champion
  const handleDeployModel = async (modelId: string, task: string, active: boolean) => {
    setDeploying(true);
    setError(undefined);
    setNotice(undefined);
    try {
      await apiFetch<ModelDeployResponse>('/v1/models/deploy', {
        method: 'POST',
        body: JSON.stringify({
          model_id: modelId,
          task,
          active,
        }),
      });
      if (active) {
        setNotice(`🚀 Đã chuyển quyền phục vụ suy luận chính (Champion) sang model [${modelId}] thành công!`);
      } else {
        setNotice(`⏹️ Đã hủy triển khai mô hình [${modelId}]. Hệ thống tạm dừng suy luận tự động.`);
      }
      await loadData(true);
    } catch (deployErr) {
      setError(deployErr instanceof Error ? deployErr.message : 'Không thể cập nhật trạng thái triển khai model');
    } finally {
      setDeploying(false);
    }
  };

  async function queueJob(job: InferenceJob): Promise<void> {
    setQueueingJob(job.job_id);
    setNotice(undefined);
    try {
      await apiFetch(`/v1/inference/jobs/${encodeURIComponent(job.job_id)}/retry`, { method: 'POST' });
      setNotice(`Job ${job.job_id} đã được đưa vào hàng đợi GPU.`);
    } catch (queueError) {
      setError(queueError instanceof Error ? queueError.message : 'Unable to queue inference job');
    } finally {
      setQueueingJob(undefined);
    }
  }

  const selectedModel = models.find((model) => model.runtime_package_id === selectedRuntimeId) ?? models[0];
  const validatedCount = models.filter((model) => model.status === 'validated' || model.status === 'champion').length;
  const championCount = models.filter((model) => model.status === 'champion').length;
  const plannedCount = jobs.filter((job) => job.status === 'planned').length;
  const copy = viewCopy[view];
  const untrainedSnapshots = availableSnapshots.filter((snapshot) => !snapshot.is_trained).length;
  const showRegistry = view === 'registry' || view === 'overview';
  const showDetail = view === 'detail';

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
        <div>
          <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
            <BrainCircuit className="size-4 text-primary" />
            {copy.eyebrow}
          </div>
          <h2 className="font-heading text-2xl font-semibold tracking-tight md:text-3xl">{copy.title}</h2>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            {copy.description}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => void loadData(true)} disabled={loading || refreshing}>
            <RefreshCw className={`size-3.5 ${refreshing ? 'animate-spin' : ''}`} />
            Refresh Registry
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

      {/* Notice / Success Alert */}
      {notice && (
        <div className="flex items-start gap-3 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm text-emerald-300">
          <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-400" />
          <p>{notice}</p>
        </div>
      )}

      {/* Live GPU Training Active Monitor Banner */}
      {activeTraining && (
        <LiveTrainingBanner
          activeTraining={activeTraining}
          trainingElapsed={trainingElapsed}
        />
      )}

      {(view === 'registry' || view === 'evaluation' || view === 'overview') && (
        <MetricCards
          totalModels={models.length}
          validatedCount={validatedCount}
          championCount={championCount}
          plannedCount={plannedCount}
        />
      )}

      {view === 'training' && <>
        <TrainingRuntimePanel />
        <Card className="border-primary/25 bg-primary/[0.03]">
          <CardHeader><CardTitle className="flex items-center gap-2 text-base"><Workflow className="size-4 text-primary" /> Gold-to-model control plane</CardTitle><CardDescription>Chọn rõ “new” hay “evolve”; toàn bộ option nằm trên trang và được pin vào training lineage.</CardDescription></CardHeader>
          <CardContent className="grid gap-3 text-sm sm:grid-cols-3">
            <TrainingStat label="Gold snapshots available" value={availableSnapshots.length || '—'} detail={snapshotsLoading ? 'Loading MinIO…' : `${untrainedSnapshots} chưa dùng để train`} />
            <TrainingStat label="Registered base models" value={models.length} detail={`${championCount} đang Champion`} />
            <TrainingStat label="Active training" value={activeTraining ? '1' : '0'} detail={activeTraining ? `${activeTraining.computeTarget?.toUpperCase()} · ${activeTraining.jobId}` : 'Không có job đang chạy'} />
          </CardContent>
        </Card>
        <TrainingLabControl models={models} availableSnapshots={availableSnapshots} snapshotsLoading={snapshotsLoading} onRefreshSnapshots={() => void loadAvailableSnapshots()} onSubmitTraining={handleStartTraining} submitting={trainingSubmitting} />
      </>}

      {view === 'evaluation' && <>
        <ModelEvaluationBoard models={models} onSelect={setSelectedRuntimeId} />
        <SelectedModelDetails selectedModel={selectedModel} onDeployModel={handleDeployModel} isDeploying={deploying} />
      </>}

      {view === 'evidence' && <>
        <ModelContextPicker
          title="Evidence subject"
          description="Chọn một thế hệ model để lần theo provenance khoa học và serving evidence."
          models={models}
          selectedRuntimeId={selectedRuntimeId}
          onSelectRuntimeId={setSelectedRuntimeId}
        />
        <ModelEvolutionEvidence model={selectedModel} jobs={jobs} />
      </>}

      {showRegistry && <>
      <div className="grid min-w-0 gap-6 2xl:grid-cols-[minmax(0,1.25fr)_minmax(0,0.75fr)]">
        <ModelRegistryTable
          models={models}
          selectedRuntimeId={selectedRuntimeId}
          onSelectRuntimeId={setSelectedRuntimeId}
          taskFilter={taskFilter}
          onTaskFilterChange={setTaskFilter}
          loading={loading}
          onDeployModel={handleDeployModel}
          isDeploying={deploying}
        />

        <SelectedModelDetails
          selectedModel={selectedModel}
          onDeployModel={handleDeployModel}
          isDeploying={deploying}
        />
      </div>
      </>}

      {showDetail && <>
        <div className="grid gap-6 xl:grid-cols-2"><SelectedModelDetails selectedModel={selectedModel} onDeployModel={handleDeployModel} isDeploying={deploying} /><ModelEvolutionEvidence model={selectedModel} jobs={jobs} /></div>
      </>}

      {view === 'inference' && <>
        <ModelContextPicker
          title="Runtime package"
          description="Chọn runtime package để xem Gold artifact đang chờ, đã chạy hoặc có thể retry trên Rust inference worker."
          models={models}
          selectedRuntimeId={selectedRuntimeId}
          onSelectRuntimeId={setSelectedRuntimeId}
        />
        <InferenceJobsTable
          selectedModel={selectedModel}
          jobs={jobs}
          onQueueJob={queueJob}
          queueingJobId={queueingJob}
        />
      </>}
    </div>
  );
}

function TrainingStat({ label, value, detail }: { label: string; value: string | number; detail: string }): JSX.Element {
  return <div className="rounded-md border border-border/70 bg-background/40 p-3"><p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p><p className="mt-1 font-mono text-xl font-semibold text-foreground">{value}</p><p className="mt-1 truncate text-xs text-muted-foreground" title={detail}>{detail}</p></div>;
}

function ModelContextPicker({ title, description, models, selectedRuntimeId, onSelectRuntimeId }: {
  title: string;
  description: string;
  models: ModelRecord[];
  selectedRuntimeId?: string;
  onSelectRuntimeId: (runtimePackageId: string) => void;
}): JSX.Element {
  return (
    <Card className="min-w-0">
      <CardHeader className="gap-3 md:flex-row md:items-center md:justify-between">
        <div><CardTitle className="text-base">{title}</CardTitle><CardDescription>{description}</CardDescription></div>
        <select
          aria-label={title}
          className="w-full max-w-xl rounded-md border border-input bg-background px-3 py-2 font-mono text-xs md:w-[32rem]"
          value={selectedRuntimeId ?? ''}
          onChange={(event) => onSelectRuntimeId(event.target.value)}
          disabled={models.length === 0}
        >
          {models.length === 0 ? <option value="">No runtime package</option> : models.map((model) => (
            <option key={model.runtime_package_id} value={model.runtime_package_id}>{model.model_id} · {model.runtime_package_id}</option>
          ))}
        </select>
      </CardHeader>
    </Card>
  );
}
