import { useCallback, useEffect, useMemo, useRef, useState, type JSX } from 'react';
import {
  BrainCircuit,
  CheckCheck,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  Database,
  LoaderCircle,
  PanelLeftClose,
  PanelLeftOpen,
  RefreshCw,
  RotateCcw,
  Sparkles,
  XCircle,
} from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { apiBase, apiFetch } from '@/lib/api';
import type { ModelRecord } from '../types';
import { ScientificEvidenceWorkspace, type LightcurveSeries, type ScientificReviewEvidence } from './ScientificEvidenceWorkspace';

type ModelSuggestion = {
  candidate_score: number;
  decision_threshold: number;
  above_threshold: boolean;
  model_id: string;
  model_version: string;
  runtime_package_id: string;
  predicted_at: string;
};

type ReviewQueueItem = {
  snapshot_id: string;
  source_product_id: string;
  tic_id: number;
  sector: number;
  training_label: 'UNRESOLVED';
  label_source: string;
  review_status: string;
  review_reason?: string;
  confidence: number;
  policy_version: string;
  evidence: ScientificReviewEvidence;
  model_suggestion?: ModelSuggestion;
};

type ReviewQueueResponse = {
  items: ReviewQueueItem[];
  count: number;
  limit: number;
  offset: number;
  has_more: boolean;
};

export type AIDecisionRecommendation = {
  suggestedLabel: 'POSITIVE' | 'NEGATIVE' | 'UNRESOLVED';
  suggestedReason: string;
  suggestedReasonLabel: string;
  suggestedConfidence: '0.9' | '0.7' | '0.5';
  confidenceLabel: string;
  rationale: string;
  keyFactors: string[];
};

export const DECISION_BASIS_OPTIONS: { value: string; label: string; description: string }[] = [
  { value: 'PERIODIC_TRANSIT_SHAPE', label: 'Periodic transit shape', description: 'Dạng quá cảnh chữ U định kỳ rõ nét' },
  { value: 'CATALOG_CONFIRMED', label: 'Catalog-confirmed target', description: 'Trùng khớp mục tiêu đã xác nhận trong TOI' },
  { value: 'COHERENT_BLS_SIGNAL', label: 'Coherent BLS signal', description: 'Tín hiệu BLS đồng pha mạch lạc cao' },
  { value: 'ECLIPSING_BINARY', label: 'Eclipsing-binary signature', description: 'Độ sâu quá cảnh lớn, dấu hiệu hệ sao đôi' },
  { value: 'STELLAR_VARIABILITY', label: 'Stellar variability', description: 'Quang thông biến thiên tự nhiên của sao' },
  { value: 'CENTROID_CONTAMINATION', label: 'Centroid contamination', description: 'Độ lệch tâm khối lớn, nhiễm quang sao nền' },
  { value: 'INSTRUMENTAL_SYSTEMATIC', label: 'Instrumental systematic', description: 'Nhiễu thiết bị hoặc trôi phông đo lường' },
  { value: 'INSUFFICIENT_EVIDENCE', label: 'Insufficient evidence', description: 'Dữ liệu quá thưa hoặc khoảng trống lớn' },
];

export const CONFIDENCE_OPTIONS: { value: '0.9' | '0.7' | '0.5'; label: string; tier: string }[] = [
  { value: '0.9', label: 'High · 90%', tier: 'Độ tin cậy cao (High)' },
  { value: '0.7', label: 'Medium · 70%', tier: 'Độ tin cậy trung bình (Medium)' },
  { value: '0.5', label: 'Low · 50%', tier: 'Độ tin cậy thấp / Thận trọng (Low)' },
];

const PAGE_SIZE = 12;
const QUEUE_VISIBILITY_KEY = 'aurora.ai-factory.labeling.queue-visible.v1';

function readQueueVisibility(): boolean {
  if (typeof window === 'undefined') return true;
  return window.localStorage.getItem(QUEUE_VISIBILITY_KEY) !== 'false';
}

function itemKey(item: ReviewQueueItem): string {
  return `${item.snapshot_id}:${item.source_product_id}`;
}

function percentage(value: number): string {
  return Number.isFinite(value) ? `${(value * 100).toFixed(1)}%` : '—';
}

function number(value: number, digits = 2): string {
  return Number.isFinite(value) ? value.toLocaleString(undefined, { maximumFractionDigits: digits }) : '—';
}

export function computeRecommendation(
  suggestion?: ModelSuggestion,
  evidence?: ScientificReviewEvidence
): AIDecisionRecommendation | undefined {
  if (!evidence) return undefined;

  // Check if target is truly confirmed in TOI catalog with matching ephemeris
  const validToiId =
    evidence.matched_toi_id &&
    evidence.matched_toi_id.trim() !== '' &&
    evidence.matched_toi_id !== 'NO_TOI_FOR_TARGET'
      ? evidence.matched_toi_id.trim()
      : '';
  const toiStatus = (evidence.toi_match_status || '').toUpperCase();
  const isCatalogConfirmed =
    Boolean(validToiId) &&
    (toiStatus === 'EPHEMERIS_MATCH' || toiStatus === 'MATCHED' || toiStatus === 'CONFIRMED');

  // Case 1: Catalog match confirmed (EPHEMERIS_MATCH with real TOI)
  if (isCatalogConfirmed) {
    return {
      suggestedLabel: 'POSITIVE',
      suggestedReason: 'CATALOG_CONFIRMED',
      suggestedReasonLabel: 'Catalog-confirmed target',
      suggestedConfidence: '0.9',
      confidenceLabel: 'High · 90%',
      rationale: `Trùng khớp mục tiêu trong danh mục TOI (${validToiId}) với chu kỳ đồng pha xác nhận. Điểm tín hiệu và tọa độ phù hợp ứng viên đã công bố.`,
      keyFactors: [
        `TOI: ${validToiId}`,
        `BLS Power: ${number(evidence.bls_power, 2)}`,
        `Score: ${suggestion ? percentage(suggestion.candidate_score) : 'N/A'}`,
      ],
    };
  }

  // Case 2: Model prediction available
  if (suggestion) {
    if (suggestion.above_threshold) {
      // Score >= decision threshold
      // Check for astronomical false positive: Centroid contamination
      if (evidence.centroid_offset_pixels >= 2.5) {
        return {
          suggestedLabel: 'NEGATIVE',
          suggestedReason: 'CENTROID_CONTAMINATION',
          suggestedReasonLabel: 'Centroid contamination',
          suggestedConfidence: evidence.centroid_offset_pixels >= 4.0 ? '0.9' : '0.7',
          confidenceLabel: evidence.centroid_offset_pixels >= 4.0 ? 'High · 90%' : 'Medium · 70%',
          rationale: `Điểm AI cao (${percentage(suggestion.candidate_score)}) nhưng độ lệch tâm khối lớn (${number(evidence.centroid_offset_pixels, 2)} px ≥ 2.5 px), nghi ngờ nhiễm quang từ nguồn lân cận.`,
          keyFactors: [
            `Centroid offset: ${number(evidence.centroid_offset_pixels, 2)} px (Lệch cao)`,
            `Transit deficit offset: ${number(evidence.transit_deficit_center_offset_pixels, 2)} px`,
            `AI Score: ${percentage(suggestion.candidate_score)}`,
          ],
        };
      }

      // Check for deep transit: Eclipsing Binary
      if (evidence.bls_depth_ppm > 35000) {
        return {
          suggestedLabel: 'NEGATIVE',
          suggestedReason: 'ECLIPSING_BINARY',
          suggestedReasonLabel: 'Eclipsing-binary signature',
          suggestedConfidence: evidence.bls_depth_ppm > 50000 ? '0.9' : '0.7',
          confidenceLabel: evidence.bls_depth_ppm > 50000 ? 'High · 90%' : 'Medium · 70%',
          rationale: `Độ sâu quá cảnh lớn (${number(evidence.bls_depth_ppm)} ppm > 3.5%), gợi ý kích thước che khuất của hệ sao đôi che nhau (EB).`,
          keyFactors: [
            `BLS Depth: ${number(evidence.bls_depth_ppm)} ppm`,
            `Period: ${number(evidence.bls_period_days, 4)} d`,
            `AI Score: ${percentage(suggestion.candidate_score)}`,
          ],
        };
      }

      // Clean periodic transit shape
      if (evidence.transit_evidence_available && evidence.centroid_offset_pixels < 1.5 && evidence.bls_power >= 7) {
        const isHighConf = suggestion.candidate_score >= 0.82 && evidence.centroid_offset_pixels < 1.0;
        return {
          suggestedLabel: 'POSITIVE',
          suggestedReason: 'PERIODIC_TRANSIT_SHAPE',
          suggestedReasonLabel: 'Periodic transit shape',
          suggestedConfidence: isHighConf ? '0.9' : '0.7',
          confidenceLabel: isHighConf ? 'High · 90%' : 'Medium · 70%',
          rationale: `Đường cong ánh sáng có hình dạng quá cảnh chữ U định kỳ rõ nét (chu kỳ ${number(evidence.bls_period_days, 4)} d, sâu ${number(evidence.bls_depth_ppm)} ppm), tâm quang học ổn định (${number(evidence.centroid_offset_pixels, 2)} px).`,
          keyFactors: [
            `Period: ${number(evidence.bls_period_days, 4)} d`,
            `Depth: ${number(evidence.bls_depth_ppm)} ppm`,
            `Centroid: ${number(evidence.centroid_offset_pixels, 2)} px`,
            `BLS Power: ${number(evidence.bls_power, 2)}`,
          ],
        };
      }

      // High BLS coherence
      const isHighConf = suggestion.candidate_score >= 0.85 && evidence.bls_power >= 12;
      return {
        suggestedLabel: 'POSITIVE',
        suggestedReason: 'COHERENT_BLS_SIGNAL',
        suggestedReasonLabel: 'Coherent BLS signal',
        suggestedConfidence: isHighConf ? '0.9' : '0.7',
        confidenceLabel: isHighConf ? 'High · 90%' : 'Medium · 70%',
        rationale: `Tín hiệu BLS đồng pha mạch lạc (power = ${number(evidence.bls_power, 2)}), vượt ngưỡng tin cậy của mô hình (${percentage(suggestion.decision_threshold)}).`,
        keyFactors: [
          `BLS Power: ${number(evidence.bls_power, 2)}`,
          `AI Score: ${percentage(suggestion.candidate_score)}`,
          `Threshold: ${percentage(suggestion.decision_threshold)}`,
        ],
      };
    } else {
      // Score < decision threshold
      if (evidence.bls_depth_ppm > 35000) {
        return {
          suggestedLabel: 'NEGATIVE',
          suggestedReason: 'ECLIPSING_BINARY',
          suggestedReasonLabel: 'Eclipsing-binary signature',
          suggestedConfidence: '0.9',
          confidenceLabel: 'High · 90%',
          rationale: `Độ sâu suy giảm quang thông cực đại (${number(evidence.bls_depth_ppm)} ppm) vượt ngưỡng bán kính hành tinh vật lý, điển hình của hệ sao đôi.`,
          keyFactors: [
            `BLS Depth: ${number(evidence.bls_depth_ppm)} ppm`,
            `AI Score: ${percentage(suggestion.candidate_score)}`,
          ],
        };
      }

      if (evidence.centroid_offset_pixels >= 2.0) {
        return {
          suggestedLabel: 'NEGATIVE',
          suggestedReason: 'CENTROID_CONTAMINATION',
          suggestedReasonLabel: 'Centroid contamination',
          suggestedConfidence: evidence.centroid_offset_pixels >= 3.0 ? '0.9' : '0.7',
          confidenceLabel: evidence.centroid_offset_pixels >= 3.0 ? 'High · 90%' : 'Medium · 70%',
          rationale: `Tâm nguồn sáng bị lệch đáng kể (${number(evidence.centroid_offset_pixels, 2)} px) khi có sự kiện dip, tín hiệu bắt nguồn từ sao nền lân cận.`,
          keyFactors: [
            `Centroid offset: ${number(evidence.centroid_offset_pixels, 2)} px`,
            `Deficit offset: ${number(evidence.transit_deficit_center_offset_pixels, 2)} px`,
          ],
        };
      }

      if (evidence.variability_peak_fraction > 0.35 || evidence.flux_std_ppm > 12000) {
        return {
          suggestedLabel: 'NEGATIVE',
          suggestedReason: 'STELLAR_VARIABILITY',
          suggestedReasonLabel: 'Stellar variability',
          suggestedConfidence: '0.7',
          confidenceLabel: 'Medium · 70%',
          rationale: `Biến thiên quang thông nền cao (độ phân tán ${number(evidence.flux_std_ppm)} ppm, phân đoạn đỉnh ${percentage(evidence.variability_peak_fraction)}), tín hiệu do sao chủ biến quang.`,
          keyFactors: [
            `Flux std: ${number(evidence.flux_std_ppm)} ppm`,
            `Peak fraction: ${percentage(evidence.variability_peak_fraction)}`,
          ],
        };
      }

      if (evidence.n_points < 1200 || evidence.largest_gap_hours > 72) {
        return {
          suggestedLabel: 'UNRESOLVED',
          suggestedReason: 'INSUFFICIENT_EVIDENCE',
          suggestedReasonLabel: 'Insufficient evidence',
          suggestedConfidence: '0.5',
          confidenceLabel: 'Low · 50%',
          rationale: `Khoảng trống dữ liệu lớn (${number(evidence.largest_gap_hours, 1)} h) hoặc số điểm đo (${evidence.n_points}) không đủ để khẳng định chu kỳ quá cảnh.`,
          keyFactors: [
            `Cadences: ${evidence.n_points.toLocaleString()}`,
            `Largest gap: ${number(evidence.largest_gap_hours, 1)} h`,
          ],
        };
      }

      const isLowScore = suggestion.candidate_score < 0.25;
      return {
        suggestedLabel: 'NEGATIVE',
        suggestedReason: 'INSTRUMENTAL_SYSTEMATIC',
        suggestedReasonLabel: 'Instrumental systematic',
        suggestedConfidence: isLowScore ? '0.9' : '0.7',
        confidenceLabel: isLowScore ? 'High · 90%' : 'Medium · 70%',
        rationale: `Điểm số mô hình (${percentage(suggestion.candidate_score)}) dưới ngưỡng (${percentage(suggestion.decision_threshold)}), tín hiệu yếu hoặc do trôi phông thiết bị.`,
        keyFactors: [
          `AI Score: ${percentage(suggestion.candidate_score)}`,
          `BLS Power: ${number(evidence.bls_power, 2)}`,
        ],
      };
    }
  }

  // Fallback: strong BLS without model suggestion
  if (evidence.bls_available && evidence.bls_power > 10) {
    return {
      suggestedLabel: 'POSITIVE',
      suggestedReason: 'COHERENT_BLS_SIGNAL',
      suggestedReasonLabel: 'Coherent BLS signal',
      suggestedConfidence: '0.7',
      confidenceLabel: 'Medium · 70%',
      rationale: `Tín hiệu BLS đạt độ tin cậy mạnh (${number(evidence.bls_power, 2)}), đề xuất kiểm tra khả năng có quá cảnh hành tinh.`,
      keyFactors: [`BLS Power: ${number(evidence.bls_power, 2)}`],
    };
  }

  return undefined;
}

export function TrainingLabelingQueue({ snapshotIds, models, onReviewSaved }: { snapshotIds: string[]; models: ModelRecord[]; onReviewSaved: () => void }): JSX.Element {
  const [items, setItems] = useState<ReviewQueueItem[]>([]);
  const [count, setCount] = useState(0);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [selectedKey, setSelectedKey] = useState('');
  const [lightcurve, setLightcurve] = useState<LightcurveSeries>();
  const [loading, setLoading] = useState(false);
  const [curveLoading, setCurveLoading] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [reviewReason, setReviewReason] = useState('');
  const [reviewConfidence, setReviewConfidence] = useState<'0.9' | '0.7' | '0.5'>('0.7');
  const [queueVisible, setQueueVisible] = useState(readQueueVisibility);
  const queueRequest = useRef(0);
  const activeModel = models.find((model) => model.task === 'candidate_vetting' && model.status === 'champion');
  const selectionSignature = snapshotIds.join('|');

  const loadQueue = useCallback(async (): Promise<void> => {
    const requestID = ++queueRequest.current;
    if (snapshotIds.length === 0) {
      setItems([]);
      setCount(0);
      setHasMore(false);
      setSelectedKey('');
      return;
    }
    setLoading(true);
    setError(undefined);
    const query = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(offset) });
    snapshotIds.forEach((snapshotId) => query.append('snapshot_id', snapshotId));
    try {
      const response = await apiFetch<ReviewQueueResponse>(`/v1/models/training-cohort/review-queue?${query.toString()}`);
      if (requestID !== queueRequest.current) return;
      const nextItems = response.items ?? [];
      setItems(nextItems);
      setCount(response.count ?? 0);
      setHasMore(response.has_more === true);
      setSelectedKey((current) => nextItems.some((item) => itemKey(item) === current) ? current : nextItems[0] ? itemKey(nextItems[0]) : '');
    } catch (cause) {
      if (requestID !== queueRequest.current) return;
      setItems([]);
      setCount(0);
      setHasMore(false);
      setSelectedKey('');
      setError(cause instanceof Error ? cause.message : 'Không tải được hàng đợi gán nhãn.');
    } finally {
      if (requestID === queueRequest.current) setLoading(false);
    }
  }, [offset, snapshotIds]);

  useEffect(() => {
    setOffset(0);
  }, [selectionSignature]);

  useEffect(() => {
    window.localStorage.setItem(QUEUE_VISIBILITY_KEY, String(queueVisible));
  }, [queueVisible]);

  useEffect(() => {
    void loadQueue();
  }, [loadQueue]);

  useEffect(() => {
    if (snapshotIds.length === 0) return;
    const events = new EventSource(`${apiBase}/v1/events?workflow=ml`);
    const refreshEvidence = (): void => { void loadQueue(); };
    events.addEventListener('workflow', refreshEvidence);
    return () => events.close();
  }, [loadQueue, snapshotIds.length]);

  const selected = items.find((item) => itemKey(item) === selectedKey);
  const selectedTICID = selected?.tic_id;
  const selectedSector = selected?.sector;

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
  }, [selected?.confidence, selected?.label_source, selected?.review_reason, selectedKey, recommendation]);

  useEffect(() => {
    let active = true;
    setLightcurve(undefined);
    if (!selectedTICID || !selectedSector) return () => { active = false; };
    setCurveLoading(true);
    const requestedCadences = Math.min(50_000, Math.max(1000, selected?.evidence.n_points ?? 1000));
    void apiFetch<LightcurveSeries>(`/v1/lightcurves?tic_id=${selectedTICID}&sector=${selectedSector}&limit=${requestedCadences}`)
      .then((value) => { if (active) setLightcurve(value); })
      .catch(() => { if (active) setLightcurve(undefined); })
      .finally(() => { if (active) setCurveLoading(false); });
    return () => { active = false; };
  }, [selected?.evidence.n_points, selectedKey, selectedTICID, selectedSector]);

  const saveLabel = async (
    trainingLabel: 'POSITIVE' | 'NEGATIVE' | 'UNRESOLVED',
    overrideReason?: string,
    overrideConfidence?: '0.9' | '0.7' | '0.5'
  ): Promise<void> => {
    if (!selected) return;
    const reasonToUse = overrideReason || reviewReason;
    const confToUse = overrideConfidence || reviewConfidence;
    if (!reasonToUse) {
      setError('Chọn decision basis trước khi lưu nhãn khoa học.');
      return;
    }
    setReviewing(true);
    setNotice(undefined);
    setError(undefined);
    try {
      await apiFetch('/v1/models/training-cohort/labels', {
        method: 'POST',
        body: JSON.stringify({
          snapshot_id: selected.snapshot_id,
          source_product_id: selected.source_product_id,
          training_label: trainingLabel,
          review_reason: reasonToUse,
          confidence: Number(confToUse),
        }),
      });
      const basisOpt = DECISION_BASIS_OPTIONS.find((o) => o.value === reasonToUse);
      const basisName = basisOpt ? basisOpt.label : reasonToUse;
      setNotice(
        trainingLabel === 'POSITIVE'
          ? `TIC ${selected.tic_id} đã được xác nhận POSITIVE (${basisName} · ${Number(confToUse) * 100}%).`
          : trainingLabel === 'NEGATIVE'
          ? `TIC ${selected.tic_id} đã được gán HARD NEGATIVE (${basisName} · ${Number(confToUse) * 100}%).`
          : `TIC ${selected.tic_id} được giữ UNRESOLVED (${basisName}).`
      );
      onReviewSaved();
      if (items.length === 1 && offset > 0 && trainingLabel !== 'UNRESOLVED') {
        setOffset(Math.max(0, offset - PAGE_SIZE));
      } else {
        await loadQueue();
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Không lưu được quyết định gán nhãn.');
    } finally {
      setReviewing(false);
    }
  };

  const acceptRecommendation = async (): Promise<void> => {
    if (!selected || !recommendation) return;
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

  return (
    <section className="min-w-0 border border-border/80 bg-card">
      <header className="flex flex-col gap-3 border-b border-border/60 p-4 sm:flex-row sm:items-start sm:justify-between sm:p-5">
        <div>
          <p className="font-mono text-xs uppercase tracking-[0.14em] text-primary">Evidence review workspace</p>
          <h3 className="mt-1 text-lg font-semibold">Review unresolved training evidence</h3>
          <p className="mt-1 max-w-3xl text-xs text-muted-foreground">
            Con người đưa ra nhãn khoa học cuối cùng. AI hỗ trợ gợi ý cả <strong>Decision basis</strong> và <strong>Confidence</strong> để bạn có thể nhấn Accept nhanh chóng.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={activeModel ? 'default' : 'outline'} className="rounded-none font-mono text-xs">
            {activeModel ? `AI · ${activeModel.model_version || activeModel.model_id}` : 'HUMAN ONLY · NO CHAMPION'}
          </Badge>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="rounded-none"
            aria-expanded={queueVisible}
            onClick={() => setQueueVisible((visible) => !visible)}
          >
            {queueVisible ? <PanelLeftClose className="size-3.5" /> : <PanelLeftOpen className="size-3.5" />}
            {queueVisible ? 'Hide target queue' : `Show target queue · ${count}`}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="rounded-none"
            disabled={loading || snapshotIds.length === 0}
            onClick={() => void loadQueue()}
          >
            <RefreshCw className={`size-3.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh
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
            <div className="min-w-0 border-b border-border/60 xl:border-b-0 xl:border-r">
              <div className="flex items-center justify-between border-b border-border/60 bg-muted/20 px-3 py-2">
                <span className="font-mono text-xs uppercase tracking-wide">{count.toLocaleString()} unresolved targets</span>
                <span className="font-mono text-xs text-muted-foreground">{offset + 1}–{Math.min(offset + items.length, count)} / {count}</span>
              </div>
              <div className="max-h-[640px] overflow-y-auto">
                {loading ? (
                  <QueueState icon={<LoaderCircle className="size-5 animate-spin" />} label="Đang tải cohort evidence…" />
                ) : error && items.length === 0 ? (
                  <QueueState label={error} />
                ) : items.length === 0 ? (
                  <QueueState icon={<CheckCircle2 className="size-5 text-emerald-500" />} label="Không còn target UNRESOLVED trong các snapshot đã chọn." />
                ) : (
                  items.map((item) => {
                    const suggestion = item.model_suggestion;
                    const active = itemKey(item) === selectedKey;
                    return (
                      <button
                        type="button"
                        key={itemKey(item)}
                        onClick={() => setSelectedKey(itemKey(item))}
                        className={`grid w-full grid-cols-[minmax(0,1fr)_auto] gap-3 border-b border-border/50 px-3 py-3 text-left transition-colors ${
                          active ? 'bg-primary/10 shadow-[inset_3px_0_0_var(--primary)]' : 'hover:bg-muted/30'
                        }`}
                      >
                        <span className="min-w-0">
                          <span className="block font-mono text-sm font-semibold text-primary">TIC {item.tic_id} · S{item.sector}</span>
                          <span className="mt-1 block truncate font-mono text-xs text-muted-foreground" title={item.source_product_id}>
                            {item.source_product_id}
                          </span>
                          <span className="mt-1 block text-xs text-muted-foreground">
                            BLS power {number(item.evidence.bls_power, 3)} · {item.evidence.toi_match_status || 'TOI unavailable'}
                          </span>
                        </span>
                        <span className="text-right">
                          <Badge
                            variant={suggestion ? (suggestion.above_threshold ? 'default' : 'secondary') : 'outline'}
                            className="rounded-none text-[11px]"
                          >
                            {suggestion ? `${suggestion.above_threshold ? 'AI POS' : 'AI NEG'} ${percentage(suggestion.candidate_score)}` : 'NO AI SCORE'}
                          </Badge>
                          <span className="mt-1 block font-mono text-[11px] text-muted-foreground">{item.snapshot_id.slice(-12)}</span>
                        </span>
                      </button>
                    );
                  })
                )}
              </div>
              <div className="flex items-center justify-between border-t border-border/60 p-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="rounded-none"
                  disabled={loading || offset === 0}
                  onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
                >
                  <ChevronLeft className="size-3.5" />Previous
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="rounded-none"
                  disabled={loading || !hasMore}
                  onClick={() => setOffset(offset + PAGE_SIZE)}
                >
                  Next<ChevronRight className="size-3.5" />
                </Button>
              </div>
            </div>
          )}

          <div className="min-w-0 p-4 sm:p-5">
            {!selected ? (
              <QueueState label="Chọn một target để kiểm tra bằng chứng." />
            ) : (
              <div className="space-y-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <p className="font-mono text-base font-semibold text-primary">TIC {selected.tic_id} · Sector {selected.sector}</p>
                    <p className="mt-1 font-mono text-xs text-muted-foreground">{selected.snapshot_id}</p>
                  </div>
                  <Badge variant="outline" className="w-fit rounded-none font-mono text-xs">{selected.label_source}</Badge>
                </div>

                <div className="grid grid-cols-2 gap-px border border-border/70 bg-border/70 sm:grid-cols-4">
                  <EvidenceValue label="BLS period" value={selected.evidence.bls_available ? `${number(selected.evidence.bls_period_days, 4)} d` : 'Unavailable'} />
                  <EvidenceValue label="BLS depth" value={selected.evidence.bls_available ? `${number(selected.evidence.bls_depth_ppm)} ppm` : '—'} />
                  <EvidenceValue label="BLS power" value={selected.evidence.bls_available ? number(selected.evidence.bls_power, 4) : '—'} />
                  <EvidenceValue label="Centroid offset" value={selected.evidence.transit_evidence_available ? `${number(selected.evidence.centroid_offset_pixels, 3)} px` : 'Unavailable'} />
                  <EvidenceValue label="Cadences" value={selected.evidence.n_points.toLocaleString()} />
                  <EvidenceValue
                    label="Sector coverage"
                    value={`${number(selected.evidence.sector_coverage_percent, 2)}%`}
                    detail={`${number(selected.evidence.time_span_days, 4)} / ${number(selected.evidence.sector_baseline_days, 4)} d observed`}
                  />
                  <EvidenceValue
                    label="Largest gap"
                    value={`${number(selected.evidence.largest_gap_hours, 2)} h`}
                    detail="longest interval without a valid cadence"
                  />
                  <EvidenceValue label="Flux scatter" value={`${number(selected.evidence.flux_std_ppm)} ppm`} />
                  <EvidenceValue label="TOI context" value={selected.evidence.matched_toi_id || selected.evidence.toi_match_status || 'Unavailable'} />
                </div>

                <ScientificEvidenceWorkspace evidence={selected.evidence} lightcurve={lightcurve} loading={curveLoading} />

                <div className="grid gap-3 lg:grid-cols-[minmax(0,0.44fr)_minmax(0,0.56fr)]">
                  {/* LEFT CARD: AI SUGGESTION & RECOMMENDATION */}
                  <div className="flex flex-col justify-between border border-border/70 bg-muted/15 p-3.5 sm:p-4">
                    <div>
                      <div className="flex items-center justify-between">
                        <p className="flex items-center gap-2 text-sm font-medium">
                          <BrainCircuit className="size-4 text-primary" />AI suggestion
                        </p>
                        {selected.model_suggestion && (
                          <Badge
                            variant={selected.model_suggestion.above_threshold ? 'default' : 'secondary'}
                            className="rounded-none font-mono text-[11px]"
                          >
                            {selected.model_suggestion.above_threshold ? 'PASS THRESHOLD' : 'BELOW THRESHOLD'}
                          </Badge>
                        )}
                      </div>

                      {selected.model_suggestion ? (
                        <div className="mt-3">
                          <p className="font-mono text-2xl font-bold tracking-tight text-primary">
                            {selected.model_suggestion.above_threshold ? 'POSITIVE' : 'NEGATIVE'} · {percentage(selected.model_suggestion.candidate_score)}
                          </p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            Ngưỡng {percentage(selected.model_suggestion.decision_threshold)} · {selected.model_suggestion.model_version || selected.model_suggestion.model_id}
                          </p>
                        </div>
                      ) : (
                        <p className="mt-3 text-xs leading-5 text-muted-foreground">
                          {activeModel
                            ? `Champion ${activeModel.model_version || activeModel.model_id} đang hoạt động nhưng chưa có prediction cho target này.`
                            : 'Chưa có champion model đang phục vụ. Hàng đợi vẫn cho phép con người gán nhãn từ evidence đo được.'}
                        </p>
                      )}

                      {/* AI RECOMMENDATION BOX */}
                      {recommendation && (
                        <div className="mt-3.5 space-y-2 border border-primary/25 bg-background/80 p-3 shadow-sm dark:bg-background/50">
                          <div className="flex items-center justify-between">
                            <span className="flex items-center gap-1.5 font-mono text-[11px] font-semibold uppercase tracking-wider text-primary">
                              <Sparkles className="size-3.5 text-amber-500" />
                              Đề xuất cho Human Decision
                            </span>
                            <Badge
                              variant={
                                recommendation.suggestedLabel === 'POSITIVE'
                                  ? 'default'
                                  : recommendation.suggestedLabel === 'NEGATIVE'
                                  ? 'destructive'
                                  : 'outline'
                              }
                              className="rounded-none font-mono text-[10px]"
                            >
                              {recommendation.suggestedLabel}
                            </Badge>
                          </div>

                          <div className="grid grid-cols-2 gap-2 rounded border border-border/60 bg-muted/20 p-2 text-xs">
                            <div>
                              <span className="block font-mono text-[10px] uppercase text-muted-foreground">1. Đề xuất Decision basis:</span>
                              <span className="mt-0.5 block font-semibold text-primary">{recommendation.suggestedReasonLabel}</span>
                            </div>
                            <div>
                              <span className="block font-mono text-[10px] uppercase text-muted-foreground">2. Đề xuất Confidence:</span>
                              <span className="mt-0.5 block font-semibold text-primary">{recommendation.confidenceLabel}</span>
                            </div>
                          </div>

                          <p className="text-xs leading-relaxed text-muted-foreground">
                            {recommendation.rationale}
                          </p>

                          {recommendation.keyFactors.length > 0 && (
                            <div className="flex flex-wrap gap-1 pt-0.5">
                              {recommendation.keyFactors.map((factor, idx) => (
                                <span key={idx} className="inline-flex items-center border border-border/80 bg-muted/50 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                                  {factor}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>

                    {/* 1-CLICK ACCEPT BUTTON ON AI SUGGESTION CARD */}
                    {recommendation && (
                      <div className="mt-3 pt-2">
                        <Button
                          type="button"
                          size="sm"
                          className={`w-full rounded-none font-mono text-xs font-semibold shadow-sm transition-all ${
                            recommendation.suggestedLabel === 'POSITIVE'
                              ? 'bg-emerald-600 hover:bg-emerald-700 text-white'
                              : recommendation.suggestedLabel === 'NEGATIVE'
                              ? 'bg-rose-600 hover:bg-rose-700 text-white'
                              : 'bg-primary text-primary-foreground'
                          }`}
                          disabled={reviewing}
                          onClick={() => void acceptRecommendation()}
                        >
                          <CheckCheck className="mr-1.5 size-3.5" />
                          {reviewing
                            ? 'Đang lưu quyết định…'
                            : `Chấp nhận gợi ý (${recommendation.suggestedLabel} · ${recommendation.suggestedReasonLabel} · ${recommendation.confidenceLabel})`}
                        </Button>
                      </div>
                    )}
                  </div>

                  {/* RIGHT CARD: HUMAN DECISION */}
                  <div className="flex flex-col justify-between border border-primary/30 bg-primary/5 p-3.5 sm:p-4">
                    <div>
                      <div className="flex items-center justify-between">
                        <p className="text-sm font-medium">Human decision</p>
                        {recommendation && (
                          <span className="flex items-center gap-1 font-mono text-[11px] text-primary">
                            <Sparkles className="size-3" /> Đã auto-fill theo gợi ý AI
                          </span>
                        )}
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Decision basis và confidence được lưu cùng training cohort; Gold snapshot gốc không thay đổi.
                      </p>

                      {/* AI RECOMMENDATION PROMPT BAR */}
                      {recommendation && (
                        <div className="mt-2.5 flex flex-wrap items-center justify-between gap-1.5 rounded border border-primary/20 bg-background/60 px-2.5 py-1.5 text-[11px]">
                          <span className="text-muted-foreground">
                            Gợi ý: <strong className="text-primary">{recommendation.suggestedReasonLabel}</strong> · Độ tin cậy: <strong className="text-primary">{recommendation.confidenceLabel}</strong>
                          </span>
                          {(reviewReason !== recommendation.suggestedReason || reviewConfidence !== recommendation.suggestedConfidence) && (
                            <button
                              type="button"
                              onClick={applyRecommendationToForm}
                              className="flex items-center gap-1 font-mono text-[10px] text-primary hover:underline"
                            >
                              <RotateCcw className="size-3" /> Áp dụng lại gợi ý AI
                            </button>
                          )}
                        </div>
                      )}

                      <div className="mt-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_10rem]">
                        <label className="block">
                          <div className="flex items-center justify-between">
                            <span className="font-mono text-xs uppercase text-muted-foreground">Decision basis · required</span>
                            {recommendation && reviewReason === recommendation.suggestedReason && (
                              <span className="font-mono text-[10px] text-emerald-600 dark:text-emerald-400">★ AI đề xuất</span>
                            )}
                          </div>
                          <select
                            value={reviewReason}
                            onChange={(event) => setReviewReason(event.target.value)}
                            className={`mt-1 h-10 w-full rounded-none border bg-background px-2 text-sm outline-none transition-colors focus:border-primary ${
                              recommendation && reviewReason === recommendation.suggestedReason ? 'border-primary/60 bg-primary/5 font-medium' : 'border-border'
                            }`}
                          >
                            <option value="">Select evidence basis…</option>
                            {DECISION_BASIS_OPTIONS.map((opt) => (
                              <option key={opt.value} value={opt.value}>
                                {opt.label}
                                {recommendation?.suggestedReason === opt.value ? ' ★ (AI đề xuất)' : ''}
                              </option>
                            ))}
                          </select>
                        </label>

                        <label className="block">
                          <div className="flex items-center justify-between">
                            <span className="font-mono text-xs uppercase text-muted-foreground">Confidence</span>
                            {recommendation && reviewConfidence === recommendation.suggestedConfidence && (
                              <span className="font-mono text-[10px] text-emerald-600 dark:text-emerald-400">★ AI đề xuất</span>
                            )}
                          </div>
                          <select
                            value={reviewConfidence}
                            onChange={(event) => setReviewConfidence(event.target.value as '0.9' | '0.7' | '0.5')}
                            className={`mt-1 h-10 w-full rounded-none border bg-background px-2 text-sm outline-none transition-colors focus:border-primary ${
                              recommendation && reviewConfidence === recommendation.suggestedConfidence ? 'border-primary/60 bg-primary/5 font-medium' : 'border-border'
                            }`}
                          >
                            {CONFIDENCE_OPTIONS.map((opt) => (
                              <option key={opt.value} value={opt.value}>
                                {opt.label}
                                {recommendation?.suggestedConfidence === opt.value ? ' ★ (AI đề xuất)' : ''}
                              </option>
                            ))}
                          </select>
                        </label>
                      </div>
                    </div>

                    <div className="mt-4 space-y-2">
                      <div className="grid gap-2 sm:grid-cols-3">
                        <Button
                          type="button"
                          size="sm"
                          className={`rounded-none transition-all ${
                            recommendation?.suggestedLabel === 'POSITIVE'
                              ? 'bg-emerald-600 hover:bg-emerald-700 text-white font-semibold ring-2 ring-emerald-500/50 ring-offset-1 shadow-sm'
                              : ''
                          }`}
                          disabled={reviewing || !reviewReason}
                          onClick={() => void saveLabel('POSITIVE')}
                        >
                          <CheckCircle2 className="size-3.5" />
                          Positive
                          {recommendation?.suggestedLabel === 'POSITIVE' && ' (Gợi ý)'}
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="destructive"
                          className={`rounded-none transition-all ${
                            recommendation?.suggestedLabel === 'NEGATIVE'
                              ? 'bg-rose-600 hover:bg-rose-700 font-semibold ring-2 ring-rose-500/50 ring-offset-1 shadow-sm'
                              : ''
                          }`}
                          disabled={reviewing || !reviewReason}
                          onClick={() => void saveLabel('NEGATIVE')}
                        >
                          <XCircle className="size-3.5" />
                          Hard negative
                          {recommendation?.suggestedLabel === 'NEGATIVE' && ' (Gợi ý)'}
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className={`rounded-none transition-all ${
                            recommendation?.suggestedLabel === 'UNRESOLVED'
                              ? 'border-primary font-semibold ring-2 ring-primary/50 ring-offset-1 shadow-sm'
                              : ''
                          }`}
                          disabled={reviewing || !reviewReason}
                          onClick={() => void saveLabel('UNRESOLVED')}
                        >
                          <CircleHelp className="size-3.5" />
                          Insufficient evidence
                          {recommendation?.suggestedLabel === 'UNRESOLVED' && ' (Gợi ý)'}
                        </Button>
                      </div>
                    </div>
                  </div>
                </div>

                {notice && (
                  <div className="border border-emerald-500/40 bg-emerald-500/5 px-3 py-2 text-xs text-emerald-700 dark:text-emerald-300">
                    {notice}
                  </div>
                )}
                {error && (
                  <div className="border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">
                    {error}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

function EvidenceValue({ label, value, detail }: { label: string; value: string; detail?: string }): JSX.Element {
  return (
    <div className="min-w-0 bg-background p-3">
      <p className="truncate font-mono text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 truncate font-mono text-sm font-semibold" title={value}>{value}</p>
      {detail && <p className="mt-1 truncate text-xs text-muted-foreground" title={detail}>{detail}</p>}
    </div>
  );
}

function QueueState({ icon, label }: { icon?: JSX.Element; label: string }): JSX.Element {
  return (
    <div className="flex min-h-40 flex-col items-center justify-center gap-2 p-6 text-center text-xs text-muted-foreground">
      {icon}
      {label}
    </div>
  );
}
