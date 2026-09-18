import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { apiBase, apiFetch } from '@/lib/api';
import { useRunnerTicket } from '@/lib/session';
import type {
  ActiveTrainingState,
  GoldSnapshotInventoryResponse,
  GoldSnapshotItem,
  InferenceJob,
  JobResponse,
  ModelDeployResponse,
  ModelPromotionState,
  ModelRecord,
  ModelResponse,
  TaskType,
  TrainingResponse,
} from '@/types/models';

export function useModelWorkspace(view?: string) {
  const { modelId } = useParams<{ modelId: string }>();
  const { activeTicket } = useRunnerTicket();
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
  const loadData = useCallback(
    async (isRefresh = false) => {
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
            : current && modelResponse.models.some((model) => model.runtime_package_id === current)
              ? current
              : modelResponse.models[0]?.runtime_package_id,
        );
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : 'Unable to load model registry');
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [modelId],
  );

  useEffect(() => {
    void loadData();
  }, [loadData]);

  useEffect(() => () => promotionEventsRef.current?.close(), []);

  // Read only manifest metadata; browser never scans every Gold object.
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

      const list = inventory.snapshots
        .filter((snapshot) => snapshot.status === 'COMMITTED')
        .map((snapshot): GoldSnapshotItem => {
          const trainedModelID = trainedSnapshotSet.get(snapshot.snapshot_id);
          return {
            snapshot_id: snapshot.snapshot_id,
            key: snapshot.manifest_key,
            size_bytes: snapshot.size_bytes,
            last_modified: snapshot.last_modified || snapshot.created_at,
            is_trained: trainedModelID !== undefined,
            ...(trainedModelID ? { trained_model_id: trainedModelID } : {}),
          };
        })
        .sort((a, b) => {
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

    const topicQuery = activeTraining.ticketId
      ? `?topic=ml&topic=${encodeURIComponent(`ml:${activeTraining.ticketId}`)}&topic=${encodeURIComponent(`obj:${activeTraining.ticketId}`)}`
      : '?topic=ml';
    const eventSource = new EventSource(`${apiBase}/v1/events${topicQuery}`);
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
          setActiveTraining((current) =>
            current?.jobId === update.job_id
              ? {
                  ...current,
                  status: 'failed',
                  phase: 'failed',
                  updatedAt: update.payload?.occurred_at,
                }
              : current,
          );
          setError(`Huấn luyện thất bại: ${update.payload?.error || 'ML Worker không trả về chi tiết lỗi.'}`);
          return;
        }

        if (update.status === 'completed') {
          void apiFetch<ModelResponse>('/v1/models')
            .then((res) => setModels(res.models ?? []))
            .catch(() => undefined);
          setActiveTraining((current) =>
            current?.jobId === update.job_id
              ? {
                  ...current,
                  status: 'completed',
                  phase: 'completed',
                  progressPercent: 100,
                  currentEpoch: current.totalEpochs ?? current.epochs,
                  updatedAt: update.payload?.occurred_at,
                }
              : current,
          );
          toast.success('Huấn luyện đã hoàn tất', {
            description: 'Runtime package đang chờ parity verification và phê duyệt trong Model Registry.',
          });
          void loadAvailableSnapshots();
          return;
        }

        if (update.status === 'progress' && update.payload?.status === 'running') {
          setActiveTraining((current) =>
            current?.jobId === update.job_id
              ? {
                  ...current,
                  status: 'running',
                  phase: update.payload?.phase ?? current.phase,
                  progressPercent: update.payload?.progress_percent ?? current.progressPercent,
                  currentEpoch: update.payload?.current_epoch ?? current.currentEpoch,
                  totalEpochs: update.payload?.total_epochs ?? current.totalEpochs,
                  bestEpoch: update.payload?.best_epoch ?? current.bestEpoch,
                  bestValidationLoss: update.payload?.best_val_loss ?? current.bestValidationLoss,
                  updatedAt: update.payload?.occurred_at,
                }
              : current,
          );
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
          ticket_id: activeTicket,
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
        ticketId: res.ticket_id || activeTicket,
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

  const handleDeployModel = async (modelId: string, task: string, active: boolean) => {
    setDeploying(true);
    setError(undefined);
    let events: EventSource | undefined;
    try {
      const ticketId = activeTicket || crypto.randomUUID();
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
        events = new EventSource(
          `${apiBase}/v1/events?topic=${encodeURIComponent(`ml:${ticketId}`)}&topic=${encodeURIComponent(`obj:${ticketId}`)}&topic=ml`,
        );
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
            setPromotion((current) =>
              current?.ticketId === ticketId
                ? {
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
                  }
                : current,
            );
          } catch {
            // Ignore malformed or unrelated workflow events.
          }
        });
        await new Promise<void>((resolve, reject) => {
          const timeout = window.setTimeout(() => reject(new Error('Không thể mở promotion telemetry SSE.')), 5000);
          events?.addEventListener(
            'ready',
            () => {
              window.clearTimeout(timeout);
              resolve();
            },
            { once: true },
          );
          events?.addEventListener(
            'error',
            () => {
              window.clearTimeout(timeout);
              reject(new Error('Promotion telemetry SSE bị ngắt trước khi đăng ký ticket.'));
            },
            { once: true },
          );
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
        setPromotion((current) =>
          current?.ticketId === ticketId
            ? {
                ...current,
                status: 'completed',
                phase: 'completed',
                progressPercent: 100,
                message: 'Champion is serving after a successful Rust runtime canary.',
                runtimeValidationId: response.runtime_validation_id ?? current.runtimeValidationId,
                engine: response.engine ?? current.engine,
                maxAbsoluteError: response.max_absolute_error ?? current.maxAbsoluteError,
                maxRelativeError: response.max_relative_error ?? current.maxRelativeError,
              }
            : current,
        );
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
      setPromotion((current) =>
        current && current.runtimePackageId === modelId
          ? {
              ...current,
              status: 'failed',
              progressPercent: 100,
              message,
              error: message,
            }
          : current,
      );
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
  const validatedCount = models.filter((model) => model.status === 'validated' || model.status === 'champion').length;
  const championCount = models.filter((model) => model.status === 'champion').length;
  const plannedCount = jobs.filter((job) => job.status === 'planned').length;

  return {
    models,
    jobs,
    selectedModel,
    selectedRuntimeId,
    setSelectedRuntimeId,
    taskFilter,
    setTaskFilter,
    loading,
    refreshing,
    error,
    loadData,
    availableSnapshots,
    snapshotsLoading,
    loadAvailableSnapshots,
    activeTraining,
    trainingElapsed,
    handleStartTraining,
    trainingSubmitting,
    handleDeployModel,
    deploying,
    promotion,
    queueJob,
    queueingJob,
    validatedCount,
    championCount,
    plannedCount,
  };
}
