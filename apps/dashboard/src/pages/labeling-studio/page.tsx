import { useCallback, useEffect, useMemo, useRef, useState, type JSX } from 'react';
import { BrainCircuit, CircleAlert, Tags } from 'lucide-react';

import { apiBase, apiFetch } from '@/lib/api';
import type { ModelRecord, ModelResponse } from '@/pages/model-registry/types';
import { LabelingWorkspace } from './components/LabelingWorkspace';
import { TrainingLabelingQueue } from './components/TrainingLabelingQueue';
import type {
  LabelingCohortDisposition,
  LabelingCohortWorkspace,
  LabelingQueueSummaryItem,
  LabelingSnapshotItem,
  LabelingSnapshotsResponse,
  LabelingTargetDetail,
  LightcurveSeries,
} from './types';

const PAGE_SIZE = 12;
const LABELING_SCOPE_KEY = 'aurora.ai-factory.labeling.snapshots.v1';

function readStoredScope(): string[] | undefined {
  if (typeof window === 'undefined') return undefined;
  try {
    const stored = window.localStorage.getItem(LABELING_SCOPE_KEY);
    if (stored === null) return undefined;
    const value = JSON.parse(stored);
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : undefined;
  } catch {
    return undefined;
  }
}

function itemKey(item: { snapshot_id: string; source_product_id: string }): string {
  return `${item.snapshot_id}:${item.source_product_id}`;
}

export default function LabelingStudioPage(): JSX.Element {
  const [models, setModels] = useState<ModelRecord[]>([]);
  const [modelsError, setModelsError] = useState<string>();

  useEffect(() => {
    apiFetch<ModelResponse>('/v1/models')
      .then((res) => setModels(res.models ?? []))
      .catch((err) => setModelsError(err instanceof Error ? err.message : 'Unable to load models'));
  }, []);

  const [availableSnapshots, setAvailableSnapshots] = useState<LabelingSnapshotItem[]>([]);
  const [snapshotsLoading, setSnapshotsLoading] = useState(false);

  // Selected cohort scope
  const storedScope = useMemo(readStoredScope, []);
  const [snapshotIds, setSnapshotIds] = useState<string[]>(storedScope ?? []);
  const initialized = useRef(storedScope !== undefined);

  // Workspace state (Disposition & Queue)
  const [disposition, setDisposition] = useState<LabelingCohortDisposition>();
  const [queueItems, setQueueItems] = useState<LabelingQueueSummaryItem[]>([]);
  const [queueCount, setQueueCount] = useState(0);
  const [queueOffset, setQueueOffset] = useState(0);
  const [queueHasMore, setQueueHasMore] = useState(false);
  const [workspaceLoading, setWorkspaceLoading] = useState(false);
  const [workspaceError, setWorkspaceError] = useState<string>();
  const workspaceRequest = useRef(0);

  // Target detail & Lightcurve state
  const [selectedKey, setSelectedKey] = useState<string>('');
  const [selectedDetail, setSelectedDetail] = useState<LabelingTargetDetail>();
  const [detailLoading, setDetailLoading] = useState(false);
  const detailRequest = useRef(0);

  const [lightcurve, setLightcurve] = useState<LightcurveSeries>();
  const [curveLoading, setCurveLoading] = useState(false);

  // 1. Load available snapshots
  const loadAvailableSnapshots = useCallback(async () => {
    setSnapshotsLoading(true);
    try {
      const res = await apiFetch<LabelingSnapshotsResponse>('/v1/labeling/snapshots?limit=200');
      setAvailableSnapshots(res.snapshots ?? []);
    } catch {
      setAvailableSnapshots([]);
    } finally {
      setSnapshotsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadAvailableSnapshots();
  }, [loadAvailableSnapshots]);

  // Sync available snapshots with selected scope
  useEffect(() => {
    if (snapshotsLoading) return;
    const available = new Set(availableSnapshots.map((s) => s.snapshot_id));
    setSnapshotIds((current) => {
      const valid = current.filter((id) => available.has(id));
      if (valid.length > 0 || initialized.current || availableSnapshots.length === 0) return valid;
      return availableSnapshots.map((s) => s.snapshot_id);
    });
    initialized.current = true;
  }, [availableSnapshots, snapshotsLoading]);

  useEffect(() => {
    if (!initialized.current) return;
    window.localStorage.setItem(LABELING_SCOPE_KEY, JSON.stringify(snapshotIds));
  }, [snapshotIds]);

  const selectionSignature = useMemo(() => [...snapshotIds].sort().join(','), [snapshotIds]);
  useEffect(() => {
    setQueueOffset(0);
  }, [selectionSignature]);

  // 2. Load Workspace (Unified Disposition + Queue)
  const loadWorkspace = useCallback(async (currentSnapshots: string[], currentOffset: number): Promise<void> => {
    if (currentSnapshots.length === 0) {
      setDisposition(undefined);
      setQueueItems([]);
      setQueueCount(0);
      setQueueHasMore(false);
      setSelectedKey('');
      setSelectedDetail(undefined);
      setLightcurve(undefined);
      return;
    }
    const reqID = ++workspaceRequest.current;
    setWorkspaceLoading(true);
    setWorkspaceError(undefined);
    try {
      const search = new URLSearchParams();
      currentSnapshots.forEach((id) => search.append('snapshot_id', id));
      search.set('limit', String(PAGE_SIZE));
      search.set('offset', String(currentOffset));
      const res = await apiFetch<LabelingCohortWorkspace>(`/v1/labeling/workspace?${search.toString()}`);
      if (reqID !== workspaceRequest.current) return;
      setDisposition(res.disposition);
      setQueueItems(res.queue.items);
      setQueueCount(res.queue.total_count);
      setQueueHasMore(res.queue.has_more);
      setSelectedKey((prev) => {
        if (res.queue.items.length === 0) return '';
        if (res.queue.items.some((i) => itemKey(i) === prev)) return prev;
        return itemKey(res.queue.items[0]);
      });
    } catch (cause) {
      if (reqID !== workspaceRequest.current) return;
      setDisposition(undefined);
      setQueueItems([]);
      setQueueCount(0);
      setQueueHasMore(false);
      setSelectedKey('');
      setSelectedDetail(undefined);
      setLightcurve(undefined);
      setWorkspaceError(cause instanceof Error ? cause.message : 'Không tải được dữ liệu workspace.');
    } finally {
      if (reqID === workspaceRequest.current) setWorkspaceLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadWorkspace(snapshotIds, queueOffset);
  }, [snapshotIds, queueOffset, loadWorkspace]);

  // 3. Load Target Detail (Evidence)
  const selectedItem = useMemo(() => {
    return queueItems.find((i) => itemKey(i) === selectedKey);
  }, [queueItems, selectedKey]);

  useEffect(() => {
    let active = true;
    if (!selectedItem) {
      setSelectedDetail(undefined);
      return () => {
        active = false;
      };
    }
    const reqID = ++detailRequest.current;
    setDetailLoading(true);
    const search = new URLSearchParams({
      snapshot_id: selectedItem.snapshot_id,
      source_product_id: selectedItem.source_product_id,
    });
    apiFetch<LabelingTargetDetail>(`/v1/labeling/target-evidence?${search.toString()}`)
      .then((detail) => {
        if (active && reqID === detailRequest.current) {
          setSelectedDetail(detail);
        }
      })
      .catch(() => {
        if (active && reqID === detailRequest.current) {
          setSelectedDetail(undefined);
        }
      })
      .finally(() => {
        if (active && reqID === detailRequest.current) {
          setDetailLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, [selectedItem?.snapshot_id, selectedItem?.source_product_id, selectedKey]);

  // 4. Load Lightcurve
  useEffect(() => {
    let active = true;
    setLightcurve(undefined);
    const ticID = selectedDetail?.tic_id;
    const sector = selectedDetail?.sector;
    if (!ticID || !sector) return () => { active = false; };
    setCurveLoading(true);
    const requestedCadences = Math.min(50_000, Math.max(1000, selectedDetail?.n_points ?? 1000));
    apiFetch<LightcurveSeries>(`/v1/lightcurves?tic_id=${ticID}&sector=${sector}&limit=${requestedCadences}`)
      .then((value) => {
        if (active) setLightcurve(value);
      })
      .catch(() => {
        if (active) setLightcurve(undefined);
      })
      .finally(() => {
        if (active) setCurveLoading(false);
      });
    return () => {
      active = false;
    };
  }, [selectedDetail?.tic_id, selectedDetail?.sector, selectedDetail?.n_points]);

  // 5. Save Human Label
  const handleSaveLabel = useCallback(
    async (
      trainingLabel: 'POSITIVE' | 'NEGATIVE' | 'UNRESOLVED',
      reason: string,
      confidence: number
    ): Promise<void> => {
      if (!selectedDetail) return;
      await apiFetch('/v1/models/training-cohort/labels', {
        method: 'POST',
        body: JSON.stringify({
          snapshot_id: selectedDetail.snapshot_id,
          source_product_id: selectedDetail.source_product_id,
          training_label: trainingLabel,
          review_reason: reason,
          confidence,
        }),
      });
      await loadWorkspace(snapshotIds, queueOffset);
    },
    [selectedDetail, snapshotIds, queueOffset, loadWorkspace]
  );

  // 6. Live SSE workflow refresh
  useEffect(() => {
    if (snapshotIds.length === 0) return;
    const events = new EventSource(`${apiBase}/v1/events?topic=ml`);
    const onWorkflow = (): void => {
      void loadWorkspace(snapshotIds, queueOffset);
    };
    events.addEventListener('workflow', onWorkflow);
    return () => events.close();
  }, [snapshotIds, queueOffset, loadWorkspace]);

  return (
    <div className="space-y-5 pb-6">
      {/* Hero Banner with Blueprint Grid matching Data Factory pages */}
      <section className="relative overflow-hidden border border-border/70 bg-card px-4 py-5 shadow-sm sm:px-6">
        <div className="pointer-events-none absolute inset-0 opacity-[0.18] [background-image:linear-gradient(to_right,var(--border)_1px,transparent_1px),linear-gradient(to_bottom,var(--border)_1px,transparent_1px)] [background-size:28px_28px]" />
        <div className="relative flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="min-w-0">
            <div className="mb-2 flex items-center gap-2 font-mono text-[10px] font-medium uppercase tracking-[0.18em] text-primary">
              <BrainCircuit className="size-4" aria-hidden="true" />
              AI Factory / Scientific Supervision
            </div>
            <h2 className="font-heading text-2xl font-semibold tracking-tight md:text-3xl">Labeling Studio</h2>
            <p className="mt-2 max-w-4xl text-sm leading-6 text-muted-foreground">
              Kiểm tra Gold evidence, xử lý hàng đợi unresolved và ghi quyết định của con người với model suggestion khi khả dụng.
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2 border border-primary/25 bg-primary/5 px-3 py-2 font-mono text-[10px] uppercase tracking-[0.12em] text-primary">
            <Tags className="size-3.5" aria-hidden="true" />
            Human-in-the-Loop · Gold Vetting
          </div>
        </div>
      </section>

      {/* Error Alert */}
      {modelsError && (
        <div className="flex items-start gap-3 border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
          <CircleAlert className="mt-0.5 size-4 shrink-0" />
          <div>
            <p className="font-medium">Lỗi kết nối / Model Registry</p>
            <p className="mt-0.5 text-xs opacity-90">{modelsError}</p>
          </div>
        </div>
      )}

      {/* 01. Cohort Scope & Disposition */}
      <LabelingWorkspace
        models={models}
        availableSnapshots={availableSnapshots}
        snapshotsLoading={snapshotsLoading}
        onRefreshSnapshots={() => void loadAvailableSnapshots()}
        snapshotIds={snapshotIds}
        onSnapshotIdsChange={setSnapshotIds}
        disposition={disposition}
        dispositionLoading={workspaceLoading}
      />

      {/* 02. Review Queue & Scientific Supervision */}
      <TrainingLabelingQueue
        snapshotIds={snapshotIds}
        models={models}
        items={queueItems}
        count={queueCount}
        offset={queueOffset}
        hasMore={queueHasMore}
        loading={workspaceLoading}
        error={workspaceError}
        selectedKey={selectedKey}
        onSelectKey={setSelectedKey}
        onOffsetChange={setQueueOffset}
        onRefresh={() => void loadWorkspace(snapshotIds, queueOffset)}
        selectedDetail={selectedDetail}
        detailLoading={detailLoading}
        lightcurve={lightcurve}
        curveLoading={curveLoading}
        onSaveLabel={handleSaveLabel}
      />
    </div>
  );
}
