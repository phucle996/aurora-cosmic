import { useCallback, useEffect, useMemo, useState, type JSX } from 'react';
import { Activity, BrainCircuit, CircleAlert, LoaderCircle, Play } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { apiBase, apiFetch } from '@/lib/api';
import { useRunnerTicket } from '@/lib/session';
import type { ModelRecord, ModelResponse } from '@/pages/model-registry/types';
import { DatasetSelectionPanel } from './components/DatasetSelectionPanel';
import { ExperimentSpecPanel } from './components/ExperimentSpecPanel';
import { LiveTrainingMonitor } from './components/LiveTrainingMonitor';
import {
  readStoredConfig,
  TRAINING_CONFIG_KEY,
  type ActiveTrainingState,
  type GoldSnapshotInventoryResponse,
  type GoldSnapshotItem,
  type StoredTrainingConfig,
  type TrainingParams,
  type TrainingReadiness,
  type TrainingResponse,
} from './types';

export default function TrainingLabPage(): JSX.Element {
  const { activeTicket } = useRunnerTicket();

  // Models & Snapshots inventory
  const [models, setModels] = useState<ModelRecord[]>([]);
  const [availableSnapshots, setAvailableSnapshots] = useState<GoldSnapshotItem[]>([]);
  const [snapshotsLoading, setSnapshotsLoading] = useState(false);
  const [error, setError] = useState<string>();

  // Stored configuration
  const stored = useMemo(readStoredConfig, []);
  const [intent, setIntent] = useState<'new' | 'evolve'>(stored.intent);
  const task: TrainingParams['task'] = 'candidate_vetting';
  const [computeTarget, setComputeTarget] = useState<'cpu' | 'gpu'>(stored.computeTarget);
  const [baseModelId, setBaseModelId] = useState(stored.baseModelId);
  const [epochs, setEpochs] = useState(stored.epochs);
  const [learningRate, setLearningRate] = useState(stored.learningRate);
  const [batchSize, setBatchSize] = useState(stored.batchSize);
  const [seed, setSeed] = useState(stored.seed);

  // Training submission & active run state
  const [trainingSubmitting, setTrainingSubmitting] = useState(false);
  const [activeTraining, setActiveTraining] = useState<ActiveTrainingState | null>(null);
  const [trainingElapsed, setTrainingElapsed] = useState(0);
  const [forceConfigMode, setForceConfigMode] = useState(false);

  // Selection & Cohort Readiness
  const [selectedSnapshotIds, setSelectedSnapshotIds] = useState<string[]>([]);
  const [readiness, setReadiness] = useState<TrainingReadiness | null>(null);
  const [readinessLoading, setReadinessLoading] = useState(false);

  // Sync config to localStorage
  useEffect(() => {
    window.localStorage.setItem(
      TRAINING_CONFIG_KEY,
      JSON.stringify({
        intent,
        computeTarget,
        baseModelId,
        epochs,
        learningRate,
        batchSize,
        seed,
      } satisfies StoredTrainingConfig),
    );
  }, [intent, computeTarget, baseModelId, epochs, learningRate, batchSize, seed]);

  // Load Models
  const loadModels = useCallback(async () => {
    try {
      const res = await apiFetch<ModelResponse>('/v1/models');
      setModels(res.models ?? []);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to load models');
    }
  }, []);

  // Read only manifest metadata for Gold snapshots
  const loadAvailableSnapshots = useCallback(async () => {
    setSnapshotsLoading(true);
    try {
      const inventory = await apiFetch<GoldSnapshotInventoryResponse>('/v1/models/snapshots?limit=200');

      const trainedSnapshotSet = new Map<string, string>();
      for (const m of models) {
        if (m.gold_snapshot_id) {
          trainedSnapshotSet.set(m.gold_snapshot_id, m.model_id);
        }
      }

      const list = inventory.snapshots
        .filter((snapshot) => !snapshot.status || snapshot.status === 'COMMITTED')
        .map((snapshot): GoldSnapshotItem => {
          const trainedModelID = trainedSnapshotSet.get(snapshot.snapshot_id);
          return {
            snapshot_id: snapshot.snapshot_id,
            key: snapshot.manifest_key || '',
            size_bytes: snapshot.size_bytes,
            last_modified: snapshot.last_modified || snapshot.created_at || '',
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
    void loadModels();
  }, [loadModels]);

  useEffect(() => {
    void loadAvailableSnapshots();
  }, [loadAvailableSnapshots]);

  // Rehydrate active training state from backend soft state on mount
  useEffect(() => {
    let active = true;
    apiFetch<{
      active: boolean;
      state?: {
        ticket_id: string;
        task: string;
        snapshot_count: number;
        base_model_id?: string;
        compute_target?: 'cpu' | 'gpu';
        status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
        phase?: string;
        progress_percent?: number;
        current_epoch?: number;
        total_epochs?: number;
        best_epoch?: number;
        best_val_loss?: number;
        train_loss?: number;
        val_loss?: number;
        loss_history?: Array<{ epoch: number; train_loss: number; val_loss: number; is_best?: boolean }>;
        logs?: Array<{ timestamp: string; message: string; level?: 'info' | 'warn' | 'error' | 'success' }>;
        started_at?: number;
        updated_at?: string;
        error?: string;
      };
    }>('/v1/models/train/active')
      .then((res) => {
        if (!active || !res?.active || !res.state) return;
        const s = res.state;
        setActiveTraining((prev) => {
          if (prev && prev.ticketId === s.ticket_id) return prev;
          return {
            ticketId: s.ticket_id,
            task: s.task,
            snapshotCount: s.snapshot_count,
            baseModel: s.base_model_id || '',
            epochs: s.total_epochs || 50,
            computeTarget: s.compute_target || 'gpu',
            startedAt: s.started_at ? Number(s.started_at) : Date.now(),
            status: s.status,
            phase: s.phase,
            progressPercent: s.progress_percent,
            currentEpoch: s.current_epoch,
            totalEpochs: s.total_epochs,
            bestEpoch: s.best_epoch,
            bestValidationLoss: s.best_val_loss,
            trainLoss: s.train_loss,
            valLoss: s.val_loss,
            lossHistory:
              s.loss_history?.map((pt) => ({
                epoch: pt.epoch,
                trainLoss: pt.train_loss,
                valLoss: pt.val_loss,
                isBest: pt.is_best,
              })) || [],
            logs: s.logs || [],
            updatedAt: s.updated_at,
          };
        });
      })
      .catch(() => {
        // Soft state endpoint is optional or returns no active run
      });

    return () => {
      active = false;
    };
  }, []);

  // Cohort readiness check when selection changes
  useEffect(() => {
    let active = true;
    if (selectedSnapshotIds.length === 0) {
      setReadiness(null);
      setReadinessLoading(false);
      return () => {
        active = false;
      };
    }

    const query = new URLSearchParams();
    selectedSnapshotIds.forEach((id) => query.append('snapshot_id', id));
    setReadinessLoading(true);

    void apiFetch<TrainingReadiness>(`/v1/models/training-readiness?${query.toString()}`)
      .then((res) => {
        if (active) setReadiness(res);
      })
      .catch(() => {
        if (active) setReadiness(null);
      })
      .finally(() => {
        if (active) setReadinessLoading(false);
      });

    return () => {
      active = false;
    };
  }, [selectedSnapshotIds]);

  // When activeTraining status transitions to running or queued, automatically return to live view
  useEffect(() => {
    if (activeTraining?.status === 'queued' || activeTraining?.status === 'running') {
      setForceConfigMode(false);
    }
  }, [activeTraining?.status]);

  // Live training events and local elapsed timer
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
          type?: string;
          ticket_id?: string;
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
            train_loss?: number;
            val_loss?: number;
            occurred_at?: string;
            level?: 'info' | 'warn' | 'error' | 'success';
            message?: string;
          };
        };
        if (update.ticket_id !== activeTraining.ticketId) return;

        const timeStr = new Date().toLocaleTimeString();

        // Handle streaming log events
        if (update.status === 'log' || update.type === 'aurora.v1.ml.training.log') {
          const logMsg = update.payload?.message;
          if (logMsg) {
            setActiveTraining((current) => {
              if (!current || current.ticketId !== update.ticket_id) return current;
              return {
                ...current,
                logs: [
                  ...(current.logs || []),
                  {
                    timestamp: timeStr,
                    message: logMsg,
                    level: update.payload?.level || 'info',
                  },
                ].slice(-200),
              };
            });
          }
          return;
        }

        if (update.status === 'failed' || update.status === 'cancelled') {
          const isCancel = update.status === 'cancelled' || update.payload?.error?.includes('CANCELLED');
          setActiveTraining((current) => {
            if (!current || current.ticketId !== update.ticket_id) return current;
            return {
              ...current,
              status: isCancel ? 'cancelled' : 'failed',
              phase: isCancel ? 'cancelled' : 'failed',
              updatedAt: update.payload?.occurred_at,
              logs: [
                ...(current.logs || []),
                {
                  timestamp: timeStr,
                  message: isCancel
                    ? 'Training execution was cancelled by operator.'
                    : `Training failed: ${update.payload?.error || 'Unknown error'}`,
                  level: isCancel ? 'warn' : 'error',
                },
              ],
            };
          });
          if (isCancel) {
            toast.info('Training job cancelled per request');
          } else {
            setError(`Training execution failed: ${update.payload?.error || 'ML Worker did not provide error details.'}`);
          }
          return;
        }

        if (update.status === 'completed') {
          void loadModels();
          setActiveTraining((current) => {
            if (!current || current.ticketId !== update.ticket_id) return current;
            return {
              ...current,
              status: 'completed',
              phase: 'completed',
              progressPercent: 100,
              currentEpoch: current.totalEpochs ?? current.epochs,
              updatedAt: update.payload?.occurred_at,
              logs: [
                ...(current.logs || []),
                {
                  timestamp: timeStr,
                  message: 'Training and ONNX runtime package build completed successfully.',
                  level: 'success',
                },
              ],
            };
          });
          toast.success('Training completed successfully', {
            description: 'Runtime package is awaiting parity verification and approval in Model Registry.',
          });
          void loadAvailableSnapshots();
          return;
        }

        if (update.status === 'progress' && update.payload?.status === 'running') {
          const payload = update.payload;
          setActiveTraining((current) => {
            if (!current || current.ticketId !== update.ticket_id) return current;
            const newHistory = [...(current.lossHistory || [])];
            if (payload.current_epoch && payload.val_loss !== undefined) {
              const epochNum = payload.current_epoch;
              const exists = newHistory.findIndex((h) => h.epoch === epochNum);
              const isBest = payload.best_epoch === epochNum;
              const point = {
                epoch: epochNum,
                trainLoss: payload.train_loss ?? payload.val_loss,
                valLoss: payload.val_loss,
                isBest,
              };
              if (exists >= 0) newHistory[exists] = point;
              else newHistory.push(point);
            }

            const newLogs = [...(current.logs || [])];
            if (payload.current_epoch && payload.val_loss !== undefined) {
              newLogs.push({
                timestamp: timeStr,
                message: `Epoch ${payload.current_epoch}/${payload.total_epochs || current.epochs} — train_loss: ${payload.train_loss?.toFixed(4) ?? '—'} · val_loss: ${payload.val_loss.toFixed(4)}${payload.best_epoch === payload.current_epoch ? ' ★ (Best)' : ''}`,
                level: payload.best_epoch === payload.current_epoch ? 'success' : 'info',
              });
            } else if (payload.phase && payload.phase !== current.phase) {
              newLogs.push({
                timestamp: timeStr,
                message: `Phase transition: ${payload.phase.replace('_', ' ').toUpperCase()}`,
                level: 'info',
              });
            }

            return {
              ...current,
              status: 'running',
              phase: payload.phase ?? current.phase,
              progressPercent: payload.progress_percent ?? current.progressPercent,
              currentEpoch: payload.current_epoch ?? current.currentEpoch,
              totalEpochs: payload.total_epochs ?? current.totalEpochs,
              bestEpoch: payload.best_epoch ?? current.bestEpoch,
              bestValidationLoss: payload.best_val_loss ?? current.bestValidationLoss,
              trainLoss: payload.train_loss ?? current.trainLoss,
              valLoss: payload.val_loss ?? current.valLoss,
              lossHistory: newHistory,
              logs: newLogs.slice(-100),
              updatedAt: payload.occurred_at,
            };
          });
        }
      } catch {
        // Ignore malformed workflow events.
      }
    });

    return () => {
      clearInterval(timer);
      eventSource.close();
    };
  }, [activeTraining, loadAvailableSnapshots, loadModels]);

  const handleStartTraining = async () => {
    if (!launchReady) return;
    setTrainingSubmitting(true);
    setError(undefined);
    try {
      const snapshotIds = [...new Set(selectedSnapshotIds.map((val) => val.trim()).filter(Boolean))];
      if (snapshotIds.length === 0) {
        throw new Error('Select at least one committed Gold Snapshot before training.');
      }

      const res = await apiFetch<TrainingResponse>('/v1/models/train', {
        method: 'POST',
        body: JSON.stringify({
          ticket_id: activeTicket,
          task,
          gold_snapshot_ids: snapshotIds,
          base_model_id: intent === 'new' ? '' : baseModelId,
          training_mode: intent === 'new' ? 'scratch' : 'fine_tune',
          epochs: Number(epochs),
          learning_rate: Number(learningRate),
          batch_size: Number(batchSize),
          seed: Number(seed),
          compute_target: computeTarget,
        }),
      });
      toast.success('Training run dispatched', {
        description: `${res.ticket_id} · ${computeTarget.toUpperCase()} · ${snapshotIds.length} Gold snapshots`,
      });

      setForceConfigMode(false);
      setActiveTraining({
        ticketId: res.ticket_id,
        task,
        snapshotCount: snapshotIds.length,
        baseModel: intent === 'new' ? '' : baseModelId,
        epochs: Number(epochs),
        computeTarget,
        startedAt: Date.now(),
        status: res.status === 'queued' ? 'queued' : 'running',
        phase: 'queued',
        progressPercent: 0,
        currentEpoch: 0,
        totalEpochs: Number(epochs),
      });
      setTrainingElapsed(0);
    } catch (trainError) {
      setError(trainError instanceof Error ? trainError.message : 'Unable to dispatch training run');
    } finally {
      setTrainingSubmitting(false);
    }
  };

  const handleControlTraining = useCallback(
    async (action: 'cancel' | 'checkpoint') => {
      if (!activeTraining?.ticketId) return;
      try {
        await apiFetch('/v1/models/train/control', {
          method: 'POST',
          body: JSON.stringify({
            ticket_id: activeTraining.ticketId,
            action,
          }),
        });
        if (action === 'cancel') {
          toast.info('Cancellation request sent to ML Worker');
          setActiveTraining((cur) => (cur ? { ...cur, status: 'cancelled', phase: 'cancelled' } : null));
        } else {
          toast.info('Requested early stop and export from best checkpoint');
        }
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Unable to send training control command');
      }
    },
    [activeTraining],
  );

  const hasActiveJob =
    activeTraining !== null &&
    (activeTraining.status === 'queued' ||
      activeTraining.status === 'running' ||
      activeTraining.status === 'completed' ||
      activeTraining.status === 'cancelled' ||
      activeTraining.status === 'failed');

  const isLiveView = hasActiveJob && !forceConfigMode;

  const numericConfigValid =
    Number(epochs) > 0 && Number(batchSize) > 0 && Number(learningRate) > 0 && Number(seed) >= 0;
  const cohortReady =
    readiness?.ready ?? (readiness?.tier !== undefined && readiness.tier !== 'BLOCKED');
  const launchReady =
    selectedSnapshotIds.length > 0 && cohortReady && numericConfigValid && !trainingSubmitting;

  return (
    <div className="space-y-6">
      {/* Blueprint Hero Banner */}
      <div className="relative flex flex-col justify-between gap-4 overflow-hidden border border-border/70 bg-card px-4 py-5 shadow-sm sm:px-6 md:flex-row md:items-end">
        <div className="pointer-events-none absolute inset-0 opacity-[0.18] [background-image:linear-gradient(to_right,var(--border)_1px,transparent_1px),linear-gradient(to_bottom,var(--border)_1px,transparent_1px)] [background-size:28px_28px]" />
        <div className="relative">
          <div className="mb-2 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-primary">
            <BrainCircuit className="size-4 text-primary" />
            AI Factory / Experimental ML
          </div>
          <h2 className="font-heading text-2xl font-semibold tracking-tight md:text-3xl">Training Lab</h2>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            Design experiments from immutable Gold snapshots, audit cohorts, lock reproducible hyperparameters, and monitor real-time convergence.
          </p>
        </div>
      </div>

      {/* Error Alert */}
      {error && (
        <div className="flex items-start gap-3 border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
          <CircleAlert className="mt-0.5 size-4 shrink-0" />
          <div>
            <p className="font-medium">Connection / Training Error</p>
            <p className="mt-1 opacity-90">{error}</p>
          </div>
        </div>
      )}

      {/* Direct Composition: Live View or Configuration View */}
      {isLiveView && activeTraining ? (
        <LiveTrainingMonitor
          activeTraining={activeTraining}
          trainingElapsed={trainingElapsed}
          onControl={handleControlTraining}
          onViewConfig={() => setForceConfigMode(true)}
          onNewRun={() => setForceConfigMode(true)}
        />
      ) : (
        <section className="min-w-0 border border-border/80 bg-card shadow-sm">
          {/* Header */}
          <header className="flex flex-col gap-3 border-b border-border/60 p-4 sm:flex-row sm:items-start sm:justify-between sm:p-5">
            <div>
              <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-primary">
                <span>Experiment protocol / candidate vetting</span>
              </div>
              <h3 className="mt-1 font-heading text-lg font-semibold">Configure training run</h3>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Lock committed Gold snapshots, initialization strategy, compute target, and reproducible hyperparameters.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline" className="w-fit rounded-none font-mono text-[10px]">
                {intent === 'new' ? 'SCRATCH' : 'FINE-TUNE'} · {computeTarget.toUpperCase()}
              </Badge>

              {hasActiveJob && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setForceConfigMode(false)}
                  className="rounded-none gap-1.5 text-xs text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/10"
                >
                  <Activity className="size-3.5 animate-pulse" />
                  Return to Active Run ({activeTraining.ticketId})
                </Button>
              )}
            </div>
          </header>

          {/* Config Panels */}
          <div className="grid min-w-0 xl:grid-cols-[minmax(0,1.25fr)_minmax(22rem,0.75fr)]">
            <DatasetSelectionPanel
              availableSnapshots={availableSnapshots}
              snapshotsLoading={snapshotsLoading}
              snapshotIds={selectedSnapshotIds}
              onSnapshotIdsChange={setSelectedSnapshotIds}
              readiness={readiness}
              readinessLoading={readinessLoading}
            />

            <ExperimentSpecPanel
              models={models}
              intent={intent}
              onIntentChange={setIntent}
              baseModelId={baseModelId}
              onBaseModelIdChange={setBaseModelId}
              computeTarget={computeTarget}
              onComputeTargetChange={setComputeTarget}
              epochs={epochs}
              onEpochsChange={setEpochs}
              batchSize={batchSize}
              onBatchSizeChange={setBatchSize}
              learningRate={learningRate}
              onLearningRateChange={setLearningRate}
              seed={seed}
              onSeedChange={setSeed}
            />
          </div>

          {/* Footer Launch Envelope */}
          <footer className="flex flex-col gap-3 border-t border-border/60 bg-muted/15 p-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
            <div className="min-w-0">
              <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                Launch envelope
              </p>
              <p
                className="mt-0.5 truncate font-mono text-xs"
                title={`${selectedSnapshotIds.length} snapshots · ${epochs} epochs · batch ${batchSize} · lr ${learningRate} · seed ${seed}`}
              >
                {selectedSnapshotIds.length} snapshots · {epochs} epochs · batch {batchSize} · lr {learningRate} · seed {seed}
              </p>
              {!numericConfigValid && (
                <p className="mt-0.5 text-[10px] text-destructive">
                  Hyperparameters must be valid positive numeric values.
                </p>
              )}
            </div>

            <Button
              type="button"
              onClick={() => void handleStartTraining()}
              disabled={!launchReady}
              className="min-w-[220px] rounded-none gap-2"
            >
              {trainingSubmitting ? (
                <>
                  <LoaderCircle className="size-4 animate-spin" />
                  Dispatching run request…
                </>
              ) : (
                <>
                  <Play className="size-4 fill-current" />
                  {cohortReady
                    ? `Launch ${intent === 'new' ? 'training' : 'evolution'} run`
                    : 'Cohort not ready'}
                </>
              )}
            </Button>
          </footer>
        </section>
      )}
    </div>
  );
}
