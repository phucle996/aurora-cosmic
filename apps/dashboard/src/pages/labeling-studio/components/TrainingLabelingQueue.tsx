import { useEffect, useMemo, useState, type JSX } from 'react';
import { Database, PanelLeftClose, PanelLeftOpen, } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { ModelRecord } from '@/pages/model-registry/types';
import {
  DECISION_BASIS_OPTIONS,
  type LabelingQueueSummaryItem,
  type LabelingTargetDetail,
  type LightcurveSeries,
  type ScientificReviewEvidence,
} from '../types';
import { DecisionPanel } from './DecisionPanel';
import { computeRecommendation } from './recommendation';
import { ScientificEvidenceWorkspace } from './ScientificEvidenceWorkspace';
import { TargetQueueSidebar } from './TargetQueueSidebar';
import { TargetSummaryKPIs } from './TargetSummaryKPIs';

const PAGE_SIZE = 12;
const QUEUE_VISIBILITY_KEY = 'aurora.ai-factory.labeling.queue-visible.v1';

function readQueueVisibility(): boolean {
  if (typeof window === 'undefined') return true;
  return window.localStorage.getItem(QUEUE_VISIBILITY_KEY) !== 'false';
}

function itemKey(item: LabelingQueueSummaryItem): string {
  return `${item.snapshot_id}:${item.source_product_id}`;
}

export function TrainingLabelingQueue({
  snapshotIds,
  models,
  items,
  count,
  offset,
  hasMore,
  loading,
  error,
  selectedKey,
  onSelectKey,
  onOffsetChange,
  selectedDetail,
  detailLoading,
  lightcurve,
  curveLoading,
  onSaveLabel,
}: {
  snapshotIds: string[];
  models: ModelRecord[];
  items: LabelingQueueSummaryItem[];
  count: number;
  offset: number;
  hasMore: boolean;
  loading: boolean;
  error?: string;
  selectedKey: string;
  onSelectKey: (key: string) => void;
  onOffsetChange: (offset: number) => void;
  onRefresh: () => void;
  selectedDetail?: LabelingTargetDetail;
  detailLoading: boolean;
  lightcurve?: LightcurveSeries;
  curveLoading: boolean;
  onSaveLabel: (
    trainingLabel: 'POSITIVE' | 'NEGATIVE' | 'UNRESOLVED',
    reason: string,
    confidence: number
  ) => Promise<void>;
}): JSX.Element {
  const [reviewReason, setReviewReason] = useState<string>('');
  const [reviewConfidence, setReviewConfidence] = useState<'0.9' | '0.7' | '0.5'>('0.7');
  const [reviewing, setReviewing] = useState(false);
  const [notice, setNotice] = useState<string>();
  const [localError, setLocalError] = useState<string>();
  const [queueVisible, setQueueVisible] = useState(readQueueVisibility);

  const activeModel = models.find((model) => model.task === 'candidate_vetting' && model.status === 'champion');

  useEffect(() => {
    window.localStorage.setItem(QUEUE_VISIBILITY_KEY, String(queueVisible));
  }, [queueVisible]);

  const selected = useMemo(() => {
    if (!selectedDetail) return undefined;
    const hasPrediction =
      Boolean(selectedDetail.prediction_available) &&
      selectedDetail.candidate_score !== undefined &&
      selectedDetail.candidate_score !== null;

    const modelSuggestion = hasPrediction
      ? {
          candidate_score: selectedDetail.candidate_score as number,
          decision_threshold: selectedDetail.decision_threshold ?? 0,
          above_threshold: selectedDetail.above_threshold ?? false,
          model_id: selectedDetail.model_id ?? '',
          model_version: selectedDetail.model_version ?? '',
          runtime_package_id: selectedDetail.runtime_package_id ?? '',
          predicted_at: selectedDetail.predicted_at ?? '',
        }
      : undefined;

    return {
      ...selectedDetail,
      evidence: selectedDetail as ScientificReviewEvidence,
      model_suggestion: modelSuggestion,
    };
  }, [selectedDetail]);

  const recommendation = useMemo(() => {
    if (!selected) return undefined;
    return computeRecommendation(selected.model_suggestion, selected.evidence);
  }, [selected]);

  // Auto-fill BOTH Decision Basis AND Confidence when target is selected
  useEffect(() => {
    if (selected?.label_source === 'HUMAN_REVIEW' && selected.review_reason) {
      setReviewReason(selected.review_reason);
      setReviewConfidence(selected.confidence >= 0.85 ? '0.9' : selected.confidence >= 0.6 ? '0.7' : '0.5');
    } else if (recommendation) {
      setReviewReason(recommendation.suggestedReason);
      setReviewConfidence(recommendation.suggestedConfidence);
    } else {
      setReviewReason(selected?.review_reason ?? '');
      setReviewConfidence('0.7');
    }
    setNotice(undefined);
    setLocalError(undefined);
  }, [selected?.confidence, selected?.label_source, selected?.review_reason, selectedKey, recommendation]);

  const saveLabel = async (
    trainingLabel: 'POSITIVE' | 'NEGATIVE' | 'UNRESOLVED',
    overrideReason?: string,
    overrideConfidence?: '0.9' | '0.7' | '0.5'
  ): Promise<void> => {
    if (!selected) return;
    const reasonToUse = overrideReason || reviewReason;
    const confToUse = overrideConfidence || reviewConfidence;
    if (!reasonToUse) {
      setLocalError('Chọn decision basis trước khi lưu nhãn khoa học.');
      return;
    }
    setReviewing(true);
    setNotice(undefined);
    setLocalError(undefined);
    try {
      await onSaveLabel(trainingLabel, reasonToUse, Number(confToUse));
      const basisOpt = DECISION_BASIS_OPTIONS.find((o) => o.value === reasonToUse);
      const basisName = basisOpt ? basisOpt.label : reasonToUse;
      setNotice(
        trainingLabel === 'POSITIVE'
          ? `TIC ${selected.tic_id} đã được xác nhận POSITIVE (${basisName} · ${Number(confToUse) * 100}%).`
          : trainingLabel === 'NEGATIVE'
            ? `TIC ${selected.tic_id} đã được gán HARD NEGATIVE (${basisName} · ${Number(confToUse) * 100}%).`
            : `TIC ${selected.tic_id} được giữ UNRESOLVED (${basisName}).`
      );
    } catch (cause) {
      setLocalError(cause instanceof Error ? cause.message : 'Không thể lưu nhãn huấn luyện.');
    } finally {
      setReviewing(false);
    }
  };

  const acceptRecommendation = async (): Promise<void> => {
    if (!recommendation) return;
    await saveLabel(
      recommendation.suggestedLabel,
      recommendation.suggestedReason,
      recommendation.suggestedConfidence
    );
  };

  const applyRecommendationToForm = (): void => {
    if (!recommendation) return;
    setReviewReason(recommendation.suggestedReason);
    setReviewConfidence(recommendation.suggestedConfidence);
  };

  // Rapid vetting keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const activeElement = document.activeElement;
      const isInputFocused =
        activeElement &&
        (activeElement.tagName === 'INPUT' ||
          activeElement.tagName === 'TEXTAREA' ||
          activeElement.tagName === 'SELECT');
      if (isInputFocused) return;

      if (!selected) return;

      if (e.code === 'Space') {
        e.preventDefault();
        if (recommendation && !reviewing) {
          void acceptRecommendation();
        }
      } else if (e.key === '1') {
        e.preventDefault();
        if (reviewReason && !reviewing) {
          void saveLabel('POSITIVE');
        }
      } else if (e.key === '2') {
        e.preventDefault();
        if (reviewReason && !reviewing) {
          void saveLabel('NEGATIVE');
        }
      } else if (e.key === '3') {
        e.preventDefault();
        if (reviewReason && !reviewing) {
          void saveLabel('UNRESOLVED');
        }
      } else if (e.key === 'j' || e.key === 'ArrowDown') {
        e.preventDefault();
        const currentIndex = items.findIndex((i) => itemKey(i) === selectedKey);
        if (currentIndex >= 0 && currentIndex < items.length - 1) {
          onSelectKey(itemKey(items[currentIndex + 1]));
        } else if (hasMore && !loading) {
          onOffsetChange(offset + PAGE_SIZE);
        }
      } else if (e.key === 'k' || e.key === 'ArrowUp') {
        e.preventDefault();
        const currentIndex = items.findIndex((i) => itemKey(i) === selectedKey);
        if (currentIndex > 0) {
          onSelectKey(itemKey(items[currentIndex - 1]));
        } else if (offset > 0 && !loading) {
          onOffsetChange(Math.max(0, offset - PAGE_SIZE));
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    selected,
    recommendation,
    reviewing,
    reviewReason,
    items,
    selectedKey,
    hasMore,
    loading,
    offset,
    acceptRecommendation,
    saveLabel,
    onSelectKey,
    onOffsetChange,
  ]);

  return (
    <section className="min-w-0 border border-border/70 bg-card shadow-sm">
      <header className="flex flex-col gap-3 border-b border-border/60 p-4 sm:flex-row sm:items-start sm:justify-between sm:p-5">
        <div>
          <p className="font-mono text-[10px] font-medium uppercase tracking-[0.18em] text-primary">
            02 / Review Queue & Scientific Supervision
          </p>
          <h3 className="mt-1 text-base font-semibold tracking-tight sm:text-lg">Examine unresolved targets</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Bảo đảm chất lượng dữ liệu bằng kiểm định khoa học trực tiếp; nhãn lưu vào training cohort table và không ghi đè snapshot Gold gốc.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="rounded-none font-mono text-xs"
            onClick={() => setQueueVisible((current) => !current)}
          >
            {queueVisible ? <PanelLeftClose className="size-3.5" /> : <PanelLeftOpen className="size-3.5" />}
            {queueVisible ? 'Hide target queue' : `Show target queue · ${count}`}
          </Button>
        </div>
      </header>

      {snapshotIds.length === 0 ? (
        <div className="flex min-h-48 flex-col items-center justify-center border-dashed p-6 text-center text-xs text-muted-foreground">
          <Database className="mb-2 size-6 opacity-60" />
          Chọn ít nhất một Gold snapshot ở bước 01 để mở hàng đợi gán nhãn.
        </div>
      ) : (
        <div className={`grid min-w-0 ${queueVisible ? 'xl:grid-cols-[minmax(24rem,0.38fr)_minmax(0,0.62fr)]' : 'grid-cols-1'}`}>
          {queueVisible && (
            <TargetQueueSidebar
              items={items}
              count={count}
              offset={offset}
              loading={loading}
              error={error}
              selectedKey={selectedKey}
              hasMore={hasMore}
              onSelectKey={onSelectKey}
              onPrevPage={() => onOffsetChange(Math.max(0, offset - PAGE_SIZE))}
              onNextPage={() => onOffsetChange(offset + PAGE_SIZE)}
            />
          )}

          <div className="min-w-0 p-4 sm:p-5">
            {!selected ? (
              <div className="flex min-h-40 flex-col items-center justify-center gap-2 p-6 text-center text-xs text-muted-foreground">
                {detailLoading ? 'Đang tải bằng chứng khoa học…' : 'Chọn một target để kiểm tra bằng chứng.'}
              </div>
            ) : (
              <div className="space-y-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="font-mono text-base font-semibold text-primary">
                        TIC {selected.tic_id} · Sector {selected.sector}
                      </p>
                      {detailLoading && <span className="inline-block size-3.5 animate-spin rounded-full border-2 border-primary border-t-transparent" />}
                    </div>
                    <p className="mt-1 font-mono text-xs text-muted-foreground">{selected.snapshot_id}</p>
                  </div>
                  <Badge variant="outline" className="w-fit rounded-none font-mono text-xs">
                    {selected.label_source}
                  </Badge>
                </div>

                <TargetSummaryKPIs evidence={selected.evidence} />

                <ScientificEvidenceWorkspace evidence={selected.evidence} lightcurve={lightcurve} loading={curveLoading} />

                <DecisionPanel
                  selected={selected}
                  activeModel={activeModel}
                  recommendation={recommendation}
                  reviewReason={reviewReason}
                  setReviewReason={setReviewReason}
                  reviewConfidence={reviewConfidence}
                  setReviewConfidence={setReviewConfidence}
                  reviewing={reviewing}
                  onAcceptRecommendation={() => void acceptRecommendation()}
                  onSaveLabel={(label) => void saveLabel(label)}
                  onResetToRecommendation={applyRecommendationToForm}
                  notice={notice}
                  error={localError}
                />
              </div>
            )}
          </div>
        </div>
      )}

      {selected && (
        <div className="sticky bottom-0 z-20 flex flex-wrap items-center justify-between gap-3 border-t border-border/80 bg-background/95 px-4 py-2 text-xs shadow-md backdrop-blur">
          <div className="flex items-center gap-2">
            <span className="font-mono text-xs font-semibold text-primary">
              TIC {selected.tic_id} · S{selected.sector}
            </span>
            <span className="rounded border border-border/60 bg-muted/40 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground uppercase">
              {selected.review_status || 'UNRESOLVED'}
            </span>
            {recommendation && (
              <span className="hidden items-center gap-1 font-mono text-[11px] text-muted-foreground sm:inline-flex">
                · Gợi ý: <strong className="text-foreground">{recommendation.suggestedLabel}</strong>
              </span>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2 font-mono text-[11px] text-muted-foreground">
            <div className="hidden items-center gap-1.5 lg:flex">
              <span className="text-[10px] uppercase text-muted-foreground/80">Phím tắt:</span>
              <span className="inline-flex items-center gap-0.5">
                <kbd className="rounded border border-border px-1 py-0.5 text-[10px]">Space</kbd> Duyệt
              </span>
              <span className="inline-flex items-center gap-0.5">
                <kbd className="rounded border border-border px-1 py-0.5 text-[10px]">1</kbd> Pos
              </span>
              <span className="inline-flex items-center gap-0.5">
                <kbd className="rounded border border-border px-1 py-0.5 text-[10px]">2</kbd> Neg
              </span>
              <span className="inline-flex items-center gap-0.5">
                <kbd className="rounded border border-border px-1 py-0.5 text-[10px]">3</kbd> Unres
              </span>
            </div>

            <div className="flex items-center gap-1 border-l border-border/60 pl-2">
              <span className="text-[10px] text-muted-foreground">Di chuyển:</span>
              <kbd className="rounded border border-border px-1 py-0.5 text-[10px]">J</kbd>
              <kbd className="rounded border border-border px-1 py-0.5 text-[10px]">K</kbd>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
