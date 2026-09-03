import { useCallback, useEffect, useRef, useState } from 'react';
import type { JSX } from 'react';
import { useParams } from 'react-router-dom';
import { BrainCircuit, CircleAlert, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { apiBase, apiFetch } from '@/lib/api';

import { InferenceJobsTable } from './components/InferenceJobsTable';
import { LabelingWorkspace } from './components/LabelingWorkspace';
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
  ModelPromotionState,
  ModelRecord,
  ModelResponse,
  GoldSnapshotInventoryResponse,
  TaskType,
  TrainingResponse,
} from './types';

export type AIModelView = 'training' | 'labeling' | 'evaluation' | 'evidence' | 'registry' | 'inference' | 'detail' | 'overview';

const viewCopy: Record<AIModelView, { eyebrow: string; title: string; description: string }> = {
  training: { eyebrow: 'AI Factory / Experimental ML', title: 'Training Lab', description: 'Thiết kế experiment từ immutable Gold snapshots, kiểm tra cohort, khóa cấu hình tái lập và quan sát tài nguyên huấn luyện.' },
  labeling: { eyebrow: 'AI Factory / Scientific supervision', title: 'Labeling Studio', description: 'Kiểm tra Gold evidence, xử lý hàng đợi unresolved và ghi quyết định của con người với model suggestion khi khả dụng.' },
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
  const [deploying, setDeploying] = useState(false);
  const [promotion, setPromotion] = useState<ModelPromotionState>();
  const promotionEventsRef = useRef<EventSource>();

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

  useEffect(() => () => promotionEventsRef.current?.close(), []);

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
    if (view === 'training' || view === 'labeling') void loadAvailableSnapshots();
  }, [view, loadAvailableSnapshots]);

  // Live training events and local elapsed timer.
  useEffect(() => {
    if (!activeTraining) return;
    const timer = setInterval(() => {
      setTrainingElapsed(Math.floor((Date.now() - activeTraining.startedAt) / 1000));
    }, 1000);

    const eventSource = new EventSource(`${apiBase}/v1/events?workflow=ml`);
    eventSource.addEventListener('workflow', (event) => {
      const message = event as MessageEvent<string>;
      try {
        const update = JSON.parse(message.data) as {
          job_id?: string;
          status?: string;
          payload?: {
            error?: string;
            status?: string;
            phase?: string;
            progress_percent?: number;
            current_epoch?: number;
            total_epochs?: number;
            best_epoch?: number;
            best_val_loss?: number;
            occurred_at?: string;
          };
        };
        if (update.job_id !== activeTraining.jobId) return;

        if (update.status === 'failed') {
          setActiveTraining((current) => current?.jobId === update.job_id ? {
            ...current,
            status: 'failed',
            phase: 'failed',
            updatedAt: update.payload?.occurred_at,
          } : current);
          setError(`Huấn luyện thất bại: ${update.payload?.error || 'ML Worker không trả về chi tiết lỗi.'}`);
          return;
        }

        if (update.status === 'completed') {
          void apiFetch<ModelResponse>('/v1/models')
            .then((res) => setModels(res.models ?? []))
            .catch(() => undefined);
          setActiveTraining((current) => current?.jobId === update.job_id ? {
            ...current,
            status: 'completed',
            phase: 'completed',
            progressPercent: 100,
            currentEpoch: current.totalEpochs ?? current.epochs,
            updatedAt: update.payload?.occurred_at,
          } : current);
          toast.success('Huấn luyện đã hoàn tất', {
            description: 'Runtime package đang chờ parity verification và phê duyệt trong Model Registry.',
          });
          void loadAvailableSnapshots();
          return;
        }

        if (update.status === 'progress' && update.payload?.status === 'running') {
          setActiveTraining((current) => current?.jobId === update.job_id ? {
            ...current,
            status: 'running',
            phase: update.payload?.phase ?? current.phase,
            progressPercent: update.payload?.progress_percent ?? current.progressPercent,
            currentEpoch: update.payload?.current_epoch ?? current.currentEpoch,
            totalEpochs: update.payload?.total_epochs ?? current.totalEpochs,
            bestEpoch: update.payload?.best_epoch ?? current.bestEpoch,
            bestValidationLoss: update.payload?.best_val_loss ?? current.bestValidationLoss,
            updatedAt: update.payload?.occurred_at,
          } : current);
        }
      } catch {
        // Ignore malformed workflow events.
      }
    });

    return () => {
      clearInterval(timer);
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
      toast.success('Đã tạo training job', {
        description: `${res.job_id} · ${params.computeTarget.toUpperCase()} · ${snapshotIds.length} Gold snapshot`,
      });

      setActiveTraining({
        jobId: res.job_id,
        task: params.task,
        snapshotCount: snapshotIds.length,
        baseModel: params.baseModelId,
        epochs: params.epochs,
        computeTarget: params.computeTarget,
        startedAt: Date.now(),
        status: res.status === 'queued' ? 'queued' : 'running',
        phase: 'queued',
        progressPercent: 0,
        currentEpoch: 0,
        totalEpochs: params.epochs,
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
    let events: EventSource | undefined;
    try {
      const ticketId = crypto.randomUUID();
      if (active) {
        setPromotion({
          ticketId,
          runtimePackageId: modelId,
          status: 'running',
          phase: 'connecting_observer',
          progressPercent: 2,
          message: 'Connecting to promotion telemetry…',
        });
        promotionEventsRef.current?.close();
        events = new EventSource(`${apiBase}/v1/events?workflow=ml&ticket=${encodeURIComponent(ticketId)}`);
        promotionEventsRef.current = events;
        events.addEventListener('workflow', (event) => {
          try {
            const envelope = JSON.parse((event as MessageEvent<string>).data) as {
              ticket_id?: string;
              payload?: {
                ticket_id?: string;
                runtime_package_id?: string;
                status?: 'running' | 'completed' | 'failed';
                phase?: string;
                progress_percent?: number;
                message?: string;
                parity_cases?: number;
                runtime_validation_id?: string;
                engine?: string;
                max_absolute_error?: number;
                max_relative_error?: number;
                error?: string;
              };
            };
            const update = envelope.payload;
            if (!update || (update.ticket_id ?? envelope.ticket_id) !== ticketId) return;
            setPromotion((current) => current?.ticketId === ticketId ? {
              ...current,
              status: update.status ?? current.status,
              phase: update.phase ?? current.phase,
              progressPercent: update.progress_percent ?? current.progressPercent,
              message: update.message ?? current.message,
              parityCases: update.parity_cases ?? current.parityCases,
              runtimeValidationId: update.runtime_validation_id ?? current.runtimeValidationId,
              engine: update.engine ?? current.engine,
              maxAbsoluteError: update.max_absolute_error ?? current.maxAbsoluteError,
              maxRelativeError: update.max_relative_error ?? current.maxRelativeError,
              error: update.error ?? current.error,
            } : current);
          } catch {
            // Ignore malformed or unrelated workflow events.
          }
        });
        await new Promise<void>((resolve, reject) => {
          const timeout = window.setTimeout(() => reject(new Error('Không thể mở promotion telemetry SSE.')), 5000);
          events?.addEventListener('ready', () => {
            window.clearTimeout(timeout);
            resolve();
          }, { once: true });
          events?.addEventListener('error', () => {
            window.clearTimeout(timeout);
            reject(new Error('Promotion telemetry SSE bị ngắt trước khi đăng ký ticket.'));
          }, { once: true });
        });
      }
      const response = await apiFetch<ModelDeployResponse>('/v1/models/deploy', {
        method: 'POST',
        body: JSON.stringify({
          model_id: modelId,
          task,
          active,
          ticket_id: ticketId,
        }),
      });
      if (active) {
        setPromotion((current) => current?.ticketId === ticketId ? {
          ...current,
          status: 'completed',
          phase: 'completed',
          progressPercent: 100,
          message: 'Champion is serving after a successful Rust runtime canary.',
          runtimeValidationId: response.runtime_validation_id ?? current.runtimeValidationId,
          engine: response.engine ?? current.engine,
          maxAbsoluteError: response.max_absolute_error ?? current.maxAbsoluteError,
          maxRelativeError: response.max_relative_error ?? current.maxRelativeError,
        } : current);
        toast.success('Đã kích hoạt Champion', {
          description: `Runtime canary PASS · ${modelId}`,
        });
      } else {
        toast.warning('Đã vô hiệu hóa Champion', {
          description: `Model ${modelId} không còn phục vụ suy luận tự động.`,
        });
      }
      await loadData(true);
    } catch (deployErr) {
      const message = deployErr instanceof Error ? deployErr.message : 'Không thể cập nhật trạng thái triển khai model';
      setPromotion((current) => current && current.runtimePackageId === modelId ? {
        ...current,
        status: 'failed',
        progressPercent: 100,
        message,
        error: message,
      } : current);
      setError(message);
    } finally {
      events?.close();
      if (promotionEventsRef.current === events) promotionEventsRef.current = undefined;
      setDeploying(false);
    }
  };

  async function queueJob(job: InferenceJob): Promise<void> {
    setQueueingJob(job.job_id);
    try {
      const response = await apiFetch<{ status: string }>(`/v1/inference/jobs/${encodeURIComponent(job.job_id)}/retry`, { method: 'POST' });
      setJobs((current) => current.map((item) => item.job_id === job.job_id ? { ...item, status: response.status } : item));
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
      <div className={`flex flex-col justify-between gap-4 md:flex-row md:items-end ${view === 'training' ? 'relative overflow-hidden border border-border/70 bg-card px-4 py-5 shadow-sm sm:px-6' : ''}`}>
        {view === 'training' && <div className="pointer-events-none absolute inset-0 opacity-[0.18] [background-image:linear-gradient(to_right,var(--border)_1px,transparent_1px),linear-gradient(to_bottom,var(--border)_1px,transparent_1px)] [background-size:28px_28px]" />}
        <div className="relative">
          <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
            <BrainCircuit className="size-4 text-primary" />
            {copy.eyebrow}
          </div>
          <h2 className="font-heading text-2xl font-semibold tracking-tight md:text-3xl">{copy.title}</h2>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            {copy.description}
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
        <div className="flex items-start gap-3 rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
          <CircleAlert className="mt-0.5 size-4 shrink-0" />
          <div>
            <p className="font-medium">Lỗi kết nối / Model Registry</p>
            <p className="mt-1 opacity-90">{error}</p>
          </div>
        </div>
      )}

      {/* Live GPU Training Active Monitor Banner */}
      {activeTraining && (activeTraining.status === 'queued' || activeTraining.status === 'running') && (
        <LiveTrainingBanner
          activeTraining={activeTraining}
          trainingElapsed={trainingElapsed}
        />
      )}

      {view === 'overview' && (
        <MetricCards
          totalModels={models.length}
          validatedCount={validatedCount}
          championCount={championCount}
          plannedCount={plannedCount}
        />
      )}

      {view === 'training' && <>
        <section aria-label="Training laboratory summary" className="grid gap-px overflow-hidden border border-border/70 bg-border/70 sm:grid-cols-2 xl:grid-cols-4">
          <TrainingStat label="Committed Gold inputs" value={availableSnapshots.length || '—'} detail={snapshotsLoading ? 'Reading inventory…' : `${untrainedSnapshots} snapshots unused`} />
          <TrainingStat label="Registered models" value={models.length} detail={`${validatedCount} validated · ${championCount} champion`} />
          <TrainingStat label="Current experiment" value={activeTraining ? activeTraining.status.toUpperCase() : 'NONE'} detail={activeTraining ? `${activeTraining.computeTarget?.toUpperCase()} · ${activeTraining.jobId}` : 'No active experiment in this view'} />
          <TrainingStat label="Task contract" value="VETTING" detail="Light Curve + Target Pixel evidence" />
        </section>
        <TrainingLabControl models={models} availableSnapshots={availableSnapshots} snapshotsLoading={snapshotsLoading} onRefreshSnapshots={() => void loadAvailableSnapshots()} onSubmitTraining={handleStartTraining} submitting={trainingSubmitting} trainingProgress={activeTraining} />
        <TrainingRuntimePanel />
      </>}

      {view === 'labeling' && <LabelingWorkspace models={models} availableSnapshots={availableSnapshots} snapshotsLoading={snapshotsLoading} onRefreshSnapshots={() => void loadAvailableSnapshots()} />}

      {view === 'evaluation' && <>
        <ModelEvaluationBoard models={models} selectedRuntimeId={selectedRuntimeId} onSelect={setSelectedRuntimeId} />
      </>}

      {view === 'evidence' && <ModelEvolutionEvidence models={models} model={selectedModel} jobs={jobs} selectedRuntimeId={selectedRuntimeId} onSelectRuntimeId={setSelectedRuntimeId} />}

      {showRegistry && <>
      <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1.45fr)_minmax(320px,0.55fr)]">
        <ModelRegistryTable
          models={models}
          selectedRuntimeId={selectedRuntimeId}
          onSelectRuntimeId={setSelectedRuntimeId}
          taskFilter={taskFilter}
          onTaskFilterChange={setTaskFilter}
          loading={loading}
          onDeployModel={handleDeployModel}
          isDeploying={deploying}
          promotion={promotion}
        />

        <SelectedModelDetails
          selectedModel={selectedModel}
          onDeployModel={handleDeployModel}
          isDeploying={deploying}
        />
      </div>
      </>}

      {showDetail && <>
        <div className="grid gap-6 xl:grid-cols-2"><SelectedModelDetails selectedModel={selectedModel} onDeployModel={handleDeployModel} isDeploying={deploying} /><ModelEvolutionEvidence model={selectedModel} jobs={jobs} compact /></div>
      </>}

      {view === 'inference' && <InferenceJobsTable
          models={models}
          selectedRuntimeId={selectedRuntimeId}
          onSelectRuntimeId={setSelectedRuntimeId}
          selectedModel={selectedModel}
          jobs={jobs}
          onQueueJob={queueJob}
          queueingJobId={queueingJob}
        />}
    </div>
  );
}

function TrainingStat({ label, value, detail }: { label: string; value: string | number; detail: string }): JSX.Element {
  return <div className="min-w-0 bg-card p-3.5"><p className="font-mono text-[9px] uppercase tracking-[0.12em] text-muted-foreground">{label}</p><p className="mt-1 font-mono text-lg font-semibold text-foreground">{value}</p><p className="mt-0.5 truncate text-[10px] text-muted-foreground" title={detail}>{detail}</p></div>;
}
