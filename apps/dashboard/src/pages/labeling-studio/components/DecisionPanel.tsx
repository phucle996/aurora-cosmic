import type { JSX } from 'react';
import { BrainCircuit, CheckCheck, CheckCircle2, CircleHelp, RotateCcw, Sparkles, XCircle } from 'lucide-react';

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
  activeModel,
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
  return (
    <div className="space-y-3">
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

          {/* 1-CLICK ACCEPT BUTTON */}
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
                onClick={onAcceptRecommendation}
              >
                <CheckCheck className="mr-1.5 size-3.5" />
                <span className="flex items-center gap-1.5">
                  <span>{reviewing ? 'Đang lưu quyết định…' : `Chấp nhận gợi ý (${recommendation.suggestedLabel} · ${recommendation.suggestedReasonLabel} · ${recommendation.confidenceLabel})`}</span>
                  <kbd className="rounded border border-white/30 bg-black/20 px-1 py-0.5 font-mono text-[10px] leading-none">Space</kbd>
                </span>
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
                    onClick={onResetToRecommendation}
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
                onClick={() => onSaveLabel('POSITIVE')}
              >
                <CheckCircle2 className="size-3.5" />
                <span>Positive{recommendation?.suggestedLabel === 'POSITIVE' && ' (Gợi ý)'}</span>
                <kbd className="ml-1 rounded border border-current/30 px-1 py-0.5 font-mono text-[9px] leading-none opacity-80">1</kbd>
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
                onClick={() => onSaveLabel('NEGATIVE')}
              >
                <XCircle className="size-3.5" />
                <span>Hard negative{recommendation?.suggestedLabel === 'NEGATIVE' && ' (Gợi ý)'}</span>
                <kbd className="ml-1 rounded border border-white/30 px-1 py-0.5 font-mono text-[9px] leading-none opacity-80">2</kbd>
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
                onClick={() => onSaveLabel('UNRESOLVED')}
              >
                <CircleHelp className="size-3.5" />
                <span>Insufficient{recommendation?.suggestedLabel === 'UNRESOLVED' && ' (Gợi ý)'}</span>
                <kbd className="ml-1 rounded border border-border px-1 py-0.5 font-mono text-[9px] leading-none opacity-80">3</kbd>
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
  );
}
