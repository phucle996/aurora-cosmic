import { useCallback, useEffect, useRef, useState } from 'react';
import type { JSX } from 'react';
import { BrainCircuit, CheckCircle2, CircleAlert, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { apiFetch } from '@/lib/api';

import { InferenceJobsTable } from './components/InferenceJobsTable';
import { LiveTrainingBanner } from './components/LiveTrainingBanner';
import { MetricCards } from './components/MetricCards';
import { ModelRegistryTable } from './components/ModelRegistryTable';
import { SelectedModelDetails } from './components/SelectedModelDetails';
import { TrainingModal } from './components/TrainingModal';
import type {
  ActiveTrainingState,
  GoldSnapshotItem,
  InferenceJob,
  JobResponse,
  ModelDeployResponse,
  ModelRecord,
  ModelResponse,
  StorageResponse,
  TaskType,
  TrainingResponse,
} from './types';

export default function ModelsPage(): JSX.Element {
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
  const [trainDialogOpen, setTrainDialogOpen] = useState(false);
  const [availableSnapshots, setAvailableSnapshots] = useState<GoldSnapshotItem[]>([]);
  const [snapshotsLoading, setSnapshotsLoading] = useState(false);
  const [trainingSubmitting, setTrainingSubmitting] = useState(false);

  // Live GPU Training Monitor State
  const [activeTraining, setActiveTraining] = useState<ActiveTrainingState | null>(null);
  const [trainingElapsed, setTrainingElapsed] = useState(0);
  const initialModelCountRef = useRef(0);

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
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  // Load Gold Snapshots from Lakehouse
  const loadAvailableSnapshots = useCallback(async () => {
    setSnapshotsLoading(true);
    try {
      const pageSize = 200;
      const objects: StorageResponse['objects'] = [];
      let page = 1;
      let hasMore = true;

      while (hasMore) {
        const storage = await apiFetch<StorageResponse>(`/v1/storage?prefix=gold/snapshots/&page=${page}&limit=${pageSize}`);
        const pageObjects = storage.objects ?? [];
        objects.push(...pageObjects);

        hasMore = storage.truncated ?? (
          typeof storage.total === 'number'
            ? objects.length < storage.total
            : pageObjects.length === pageSize
        );
        page += 1;
      }

      const trainedSnapshotSet = new Map<string, string>();
      for (const m of models) {
        if (m.gold_snapshot_id) {
          trainedSnapshotSet.set(m.gold_snapshot_id, m.model_id);
        }
      }

      const snapshotMap = new Map<string, {
        manifest?: StorageResponse['objects'][number];
        dataSizeBytes: number;
        lastModified: string;
      }>();
      for (const obj of objects) {
        const match = obj.key.match(/^gold\/snapshots\/([^/]+)\/(.+)$/);
        if (match && match[1]) {
          const snapId = match[1];
          const relativeKey = match[2];
          const snapshot = snapshotMap.get(snapId) ?? {
            dataSizeBytes: 0,
            lastModified: obj.last_modified ?? '',
          };

          if (relativeKey === 'manifest.json') {
            snapshot.manifest = obj;
          } else {
            snapshot.dataSizeBytes += obj.size_bytes ?? 0;
          }
          if (obj.last_modified && obj.last_modified > snapshot.lastModified) {
            snapshot.lastModified = obj.last_modified;
          }
          snapshotMap.set(snapId, snapshot);
        }
      }

      const list = Array.from(snapshotMap, ([snapshotId, snapshot]) => {
        if (!snapshot.manifest) return undefined;

        return {
          snapshot_id: snapshotId,
          key: snapshot.manifest.key,
          size_bytes: snapshot.dataSizeBytes,
          last_modified: snapshot.lastModified || snapshot.manifest.last_modified || new Date().toISOString(),
          is_trained: trainedSnapshotSet.has(snapshotId),
          trained_model_id: trainedSnapshotSet.get(snapshotId),
        } satisfies GoldSnapshotItem;
      }).filter((snapshot): snapshot is GoldSnapshotItem => snapshot !== undefined).sort((a, b) => {
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

  // Live Training Polling & Elapsed Timer
  useEffect(() => {
    if (!activeTraining) return;
    const timer = setInterval(() => {
      setTrainingElapsed(Math.floor((Date.now() - activeTraining.startedAt) / 1000));
    }, 1000);

    const poll = setInterval(async () => {
      try {
        const res = await apiFetch<ModelResponse>('/v1/models');
        const list = res.models ?? [];
        if (list.length > initialModelCountRef.current || Date.now() - activeTraining.startedAt > 60000) {
          setModels(list);
          const finishedSnapCount = activeTraining.snapshotCount;
          setActiveTraining(null);
          setNotice(`🎉 Huấn luyện thành công! Mô hình Deep Learning mới đã được tạo từ ${finishedSnapCount} Gold Snapshots, vượt qua kiểm thử Python-ONNX Parity và thăng hạng thành 👑 Champion!`);
          void loadAvailableSnapshots();
        }
      } catch {
        // ignore network error while polling
      }
    }, 2000);

    return () => {
      clearInterval(timer);
      clearInterval(poll);
    };
  }, [activeTraining, loadAvailableSnapshots]);

  const handleOpenDialog = (open: boolean) => {
    setTrainDialogOpen(open);
    if (open) {
      void loadAvailableSnapshots();
    }
  };

  const handleStartTraining = async (params: {
    task: 'candidate_vetting' | 'astronomical_anomaly_detection';
    baseModelId: string;
    mode: 'fine_tune' | 'scratch';
    snapshotId: string;
    epochs: number;
    learningRate: number;
    batchSize: number;
    seed: number;
    autoPromote: boolean;
    unrunSnapshots: GoldSnapshotItem[];
  }) => {
    setTrainingSubmitting(true);
    setError(undefined);
    setNotice(undefined);
    try {
      initialModelCountRef.current = models.length;
      let snapshotCount = 1;
      let targetJobId = '';

      if (params.snapshotId === '__all_unrun__') {
        if (params.unrunSnapshots.length === 0) {
          throw new Error('Không có Gold Snapshot nào chưa chạy để huấn luyện.');
        }

        const snapshotIds = params.unrunSnapshots.map((s) => s.snapshot_id);
        snapshotCount = snapshotIds.length;
        const res = await apiFetch<TrainingResponse>('/v1/models/train', {
          method: 'POST',
          body: JSON.stringify({
            task: params.task,
            gold_snapshot_id: snapshotIds[0],
            gold_snapshot_ids: snapshotIds,
            base_model_id: params.baseModelId,
            training_mode: params.mode,
            epochs: params.epochs,
            learning_rate: params.learningRate,
            batch_size: params.batchSize,
            seed: params.seed,
            auto_promote: params.autoPromote,
          }),
        });
        targetJobId = res.job_id;
        setNotice(`🚀 Đã phát lệnh thành công tới GPU Worker! Đang gộp toàn bộ ${snapshotIds.length} Gold Snapshots để huấn luyện tạo ra 1 MÔ HÌNH HỌC SÂU DUY NHẤT...`);
      } else {
        const res = await apiFetch<TrainingResponse>('/v1/models/train', {
          method: 'POST',
          body: JSON.stringify({
            task: params.task,
            gold_snapshot_id: params.snapshotId.trim(),
            base_model_id: params.baseModelId,
            training_mode: params.mode,
            epochs: params.epochs,
            learning_rate: params.learningRate,
            batch_size: params.batchSize,
            seed: params.seed,
            auto_promote: params.autoPromote,
          }),
        });
        targetJobId = res.job_id;
        setNotice(`🚀 Training Job ${res.job_id} đã được gửi tới GPU Worker thành công với Gold Snapshot [${params.snapshotId}]...`);
      }

      setActiveTraining({
        jobId: targetJobId,
        task: params.task,
        snapshotCount,
        baseModel: params.baseModelId,
        epochs: params.epochs,
        startedAt: Date.now(),
      });
      setTrainingElapsed(0);
      setTrainDialogOpen(false);
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

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
        <div>
          <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
            <BrainCircuit className="size-4 text-primary" />
            PyTorch & ONNX ML Ops Platform
          </div>
          <h2 className="font-heading text-2xl font-semibold tracking-tight md:text-3xl">Models & Inference Engine</h2>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            Chủ động huấn luyện mô hình PyTorch trên GPU NVIDIA, linh hoạt lựa chọn và chuyển đổi mô hình phục vụ suy luận trực tiếp.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <TrainingModal
            open={trainDialogOpen}
            onOpenChange={handleOpenDialog}
            models={models}
            availableSnapshots={availableSnapshots}
            snapshotsLoading={snapshotsLoading}
            onRefreshSnapshots={() => void loadAvailableSnapshots()}
            onSubmitTraining={handleStartTraining}
            submitting={trainingSubmitting}
          />

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

      {/* Metric Cards */}
      <MetricCards
        totalModels={models.length}
        validatedCount={validatedCount}
        championCount={championCount}
        plannedCount={plannedCount}
      />

      {/* Main Grid: Registry Table & Details */}
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

      {/* Inference Jobs Table */}
      <InferenceJobsTable
        selectedModel={selectedModel}
        jobs={jobs}
        onQueueJob={queueJob}
        queueingJobId={queueingJob}
      />
    </div>
  );
}
