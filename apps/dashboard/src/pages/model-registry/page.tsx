import { useCallback, useEffect, useRef, useState, type JSX } from 'react';
import { CircleAlert, Package, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { apiBase, apiFetch } from '@/lib/api';
import { useRunnerTicket } from '@/lib/session';
import { ModelRegistryTable } from './components/ModelRegistryTable';
import { SelectedModelDetails } from './components/SelectedModelDetails';
import type {
  ModelDeployResponse,
  ModelPromotionState,
  ModelRecord,
  ModelResponse,
  TaskType,
} from './types';

export default function ModelRegistryPage(): JSX.Element {
  const { activeTicket } = useRunnerTicket();
  const [models, setModels] = useState<ModelRecord[]>([]);
  const [selectedRuntimeId, setSelectedRuntimeId] = useState<string>();
  const [taskFilter, setTaskFilter] = useState<TaskType>('all');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string>();
  const [deploying, setDeploying] = useState(false);
  const [promotion, setPromotion] = useState<ModelPromotionState>();
  const promotionEventsRef = useRef<EventSource | undefined>(undefined);

  const loadData = useCallback(async (isRefresh = false) => {
    setError(undefined);
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    try {
      const modelResponse = await apiFetch<ModelResponse>('/v1/models');
      const items = modelResponse.models ?? [];
      setModels(items);
      setSelectedRuntimeId((current) =>
        current && items.some((model) => model.runtime_package_id === current)
          ? current
          : items[0]?.runtime_package_id,
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
    return () => {
      promotionEventsRef.current?.close();
    };
  }, [loadData]);

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

  const selectedModel = models.find((model) => model.runtime_package_id === selectedRuntimeId) ?? models[0];

  return (
    <div className="space-y-6">
      {/* Blueprint Hero Banner */}
      <div className="relative flex flex-col justify-between gap-4 overflow-hidden border border-border/70 bg-card px-4 py-5 shadow-sm sm:px-6 md:flex-row md:items-end">
        <div className="pointer-events-none absolute inset-0 opacity-[0.18] [background-image:linear-gradient(to_right,var(--border)_1px,transparent_1px),linear-gradient(to_bottom,var(--border)_1px,transparent_1px)] [background-size:28px_28px]" />
        <div className="relative">
          <div className="mb-2 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-primary">
            <Package className="size-4 text-primary" />
            AI Factory / Model Registry
          </div>
          <h2 className="font-heading text-2xl font-semibold tracking-tight md:text-3xl">Model Registry</h2>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            Version management, candidate/validated/champion lifecycle, and rollback-safe deployment controls.
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
            <p className="font-medium">Connection / Model Registry Error</p>
            <p className="mt-1 opacity-90">{error}</p>
          </div>
        </div>
      )}

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
    </div>
  );
}
