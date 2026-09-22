import type { JSX } from 'react';
import { CheckCheck, CheckCircle2, CircleHelp, RotateCcw, XCircle } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { ModelRecord } from '@/pages/model-registry/types';
import {
  CONFIDENCE_OPTIONS,
  DECISION_BASIS_OPTIONS,
  type AIDecisionRecommendation,
  type LabelingTargetDetail,
  type ModelSuggestion,
} from '../types';

function percentage(value: number): string {
  return Number.isFinite(value) ? `${(value * 100).toFixed(1)}%` : '—';
}

export function DecisionPanel({
  selected,
  recommendation,
  reviewReason,
  setReviewReason,
  reviewConfidence,
  setReviewConfidence,
  reviewing,
  onAcceptRecommendation,
  onSaveLabel,
  onResetToRecommendation,
  notice,
  error,
}: {
  selected: LabelingTargetDetail & { model_suggestion?: ModelSuggestion };
  activeModel?: ModelRecord;
  recommendation?: AIDecisionRecommendation;
  reviewReason: string;
  setReviewReason: (reason: string) => void;
  reviewConfidence: '0.9' | '0.7' | '0.5';
  setReviewConfidence: (confidence: '0.9' | '0.7' | '0.5') => void;
  reviewing: boolean;
  onAcceptRecommendation: () => void;
  onSaveLabel: (label: 'POSITIVE' | 'NEGATIVE' | 'UNRESOLVED') => void;
  onResetToRecommendation: () => void;
  notice?: string;
  error?: string;
}): JSX.Element {
  const isReasonRecommended = recommendation && reviewReason === recommendation.suggestedReason;
  const isConfidenceRecommended = recommendation && reviewConfidence === recommendation.suggestedConfidence;
  const isModified = recommendation && (!isReasonRecommended || !isConfidenceRecommended);

  // Check if a model prediction genuinely exists with valid score
  const hasModelPrediction =
    Boolean(selected.prediction_available) &&
    selected.model_suggestion !== undefined &&
    selected.model_suggestion.candidate_score !== undefined &&
    selected.model_suggestion.candidate_score !== null &&
    (selected.model_suggestion.model_id !== '' || selected.model_suggestion.model_version !== '');

  return (
    <div className="space-y-2.5">
      {/* UNIFIED DECISION & ADJUDICATION CARD */}
      <div className="border border-border/80 bg-card p-4 shadow-sm">
        {/* Top bar: Finding & Quick Action */}
        <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between border-b border-border/60 pb-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Đánh giá:
            </span>

            {recommendation ? (
              <Badge
                variant={
                  recommendation.suggestedLabel === 'POSITIVE'
                    ? 'default'
                    : recommendation.suggestedLabel === 'NEGATIVE'
                    ? 'destructive'
                    : 'outline'
                }
                className="rounded-none font-mono text-xs font-bold px-2 py-0.5"
              >
                {recommendation.suggestedLabel} · {recommendation.suggestedReasonLabel}
              </Badge>
            ) : (
              <Badge variant="outline" className="rounded-none font-mono text-xs text-muted-foreground">
                Chưa có đề xuất
              </Badge>
            )}

            {hasModelPrediction && selected.model_suggestion && (
              <span className="font-mono text-xs text-muted-foreground">
                (Model {selected.model_suggestion.model_version || selected.model_suggestion.model_id}: {percentage(selected.model_suggestion.candidate_score)})
              </span>
            )}
          </div>

          {/* 1-Click Accept Recommendation Button */}
          {recommendation && (
            <Button
              type="button"
              size="sm"
              className={`rounded-none font-mono text-xs font-semibold h-8 px-3 transition-all shrink-0 ${
                recommendation.suggestedLabel === 'POSITIVE'
                  ? 'bg-emerald-600 hover:bg-emerald-700 text-white'
                  : recommendation.suggestedLabel === 'NEGATIVE'
                  ? 'bg-rose-600 hover:bg-rose-700 text-white'
                  : 'bg-primary text-primary-foreground'
              }`}
              disabled={reviewing}
              onClick={onAcceptRecommendation}
            >
              <CheckCheck className="mr-1.5 size-3.5" />
              <span>{reviewing ? 'Đang lưu…' : `Chấp nhận gợi ý (${recommendation.suggestedLabel})`}</span>
              <kbd className="ml-2 rounded border border-white/30 bg-black/20 px-1 py-0.5 font-mono text-[9px] leading-none">
                Space
              </kbd>
            </Button>
          )}
        </div>

        {/* Evidence explanation & metrics */}
        {recommendation && (
          <div className="pt-2.5 pb-3">
            <p className="text-xs leading-relaxed text-muted-foreground">
              {recommendation.rationale}
            </p>

            {recommendation.keyFactors.length > 0 && (
              <div className="flex flex-wrap gap-1.5 pt-2">
                {recommendation.keyFactors.map((factor, idx) => (
                  <span
                    key={idx}
                    className="inline-flex items-center border border-border/70 bg-muted/40 px-2 py-0.5 font-mono text-[10px] text-muted-foreground"
                  >
                    {factor}
                  </span>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Decision Controls: Inputs + Action Buttons */}
        <div className="pt-2 border-t border-border/50">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
            {/* Form selects: Clean, wide, responsive */}
            <div className="grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_160px] gap-2.5 flex-1 max-w-2xl">
              <div>
                <label className="block text-[11px] font-mono uppercase text-muted-foreground mb-1">
                  Evidence basis
                </label>
                <select
                  value={reviewReason}
                  onChange={(event) => setReviewReason(event.target.value)}
                  className="h-8 w-full rounded-none border border-border bg-background px-2.5 text-xs outline-none transition-colors focus:border-primary"
                >
                  <option value="">Chọn cơ sở bằng chứng…</option>
                  {DECISION_BASIS_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-[11px] font-mono uppercase text-muted-foreground">
                    Confidence
                  </label>
                  {isModified && (
                    <button
                      type="button"
                      onClick={onResetToRecommendation}
                      className="flex items-center gap-0.5 font-mono text-[10px] text-primary hover:underline"
                    >
                      <RotateCcw className="size-2.5" /> Đặt lại
                    </button>
                  )}
                </div>
                <select
                  value={reviewConfidence}
                  onChange={(event) => setReviewConfidence(event.target.value as '0.9' | '0.7' | '0.5')}
                  className="h-8 w-full rounded-none border border-border bg-background px-2.5 text-xs outline-none transition-colors focus:border-primary"
                >
                  {CONFIDENCE_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Direct 3 Decision Buttons */}
            <div className="grid grid-cols-3 gap-1.5 sm:flex sm:items-center shrink-0">
              <Button
                type="button"
                size="sm"
                className={`h-8 rounded-none font-mono text-xs px-3 transition-all ${
                  recommendation?.suggestedLabel === 'POSITIVE'
                    ? 'bg-emerald-600 hover:bg-emerald-700 text-white font-semibold ring-1 ring-emerald-500'
                    : ''
                }`}
                disabled={reviewing || !reviewReason}
                onClick={() => onSaveLabel('POSITIVE')}
              >
                <CheckCircle2 className="size-3.5 mr-1" />
                <span>Positive</span>
                <kbd className="ml-1 rounded border border-current/30 px-1 py-0.5 font-mono text-[9px] leading-none opacity-80">
                  1
                </kbd>
              </Button>

              <Button
                type="button"
                size="sm"
                variant="destructive"
                className={`h-8 rounded-none font-mono text-xs px-3 transition-all ${
                  recommendation?.suggestedLabel === 'NEGATIVE'
                    ? 'bg-rose-600 hover:bg-rose-700 text-white font-semibold ring-1 ring-rose-500'
                    : ''
                }`}
                disabled={reviewing || !reviewReason}
                onClick={() => onSaveLabel('NEGATIVE')}
              >
                <XCircle className="size-3.5 mr-1" />
                <span>Negative</span>
                <kbd className="ml-1 rounded border border-white/30 px-1 py-0.5 font-mono text-[9px] leading-none opacity-80">
                  2
                </kbd>
              </Button>

              <Button
                type="button"
                size="sm"
                variant="outline"
                className={`h-8 rounded-none font-mono text-xs px-3 transition-all ${
                  recommendation?.suggestedLabel === 'UNRESOLVED'
                    ? 'border-primary font-semibold ring-1 ring-primary'
                    : ''
                }`}
                disabled={reviewing || !reviewReason}
                onClick={() => onSaveLabel('UNRESOLVED')}
              >
                <CircleHelp className="size-3.5 mr-1" />
                <span>Unresolved</span>
                <kbd className="ml-1 rounded border border-border px-1 py-0.5 font-mono text-[9px] leading-none opacity-80">
                  3
                </kbd>
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* Notifications */}
      {notice && (
        <div className="border border-emerald-500/40 bg-emerald-500/10 px-3 py-1.5 text-xs font-medium text-emerald-700 dark:text-emerald-300">
          {notice}
        </div>
      )}
      {error && (
        <div className="border border-destructive/40 bg-destructive/10 px-3 py-1.5 text-xs font-medium text-destructive">
          {error}
        </div>
      )}
    </div>
  );
}
