import type { JSX } from 'react';
import {
  AlertTriangle,
  Globe,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { TabsContent } from '@/components/ui/tabs';
import type { TargetAIInsights } from '@/lib/analytics-types';
import { Info, number } from './InfoItem';

interface AiPhysicsTabProps {
  ai: TargetAIInsights;
  hasCandidate: boolean;
}

export function AiPhysicsTab({
  ai,
  hasCandidate,
}: AiPhysicsTabProps): JSX.Element {
  const scorePct = ai.candidate_score != null ? ai.candidate_score * 100 : 0;
  const habitabilityScore = ai.habitability_score != null ? ai.habitability_score : 0;
  const confidencePct = Math.round((ai.habitability_confidence || 0) * 100);

  const getTierBadge = (tier: string) => {
    switch (tier) {
      case 'high_priority':
        return { label: 'Ưu tiên Cao / High Priority', class: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30' };
      case 'promising':
        return { label: 'Triển vọng / Promising', class: 'bg-sky-500/15 text-sky-400 border-sky-500/30' };
      case 'low_priority':
        return { label: 'Ưu tiên Thấp / Low', class: 'bg-amber-500/15 text-amber-400 border-amber-500/30' };
      case 'unlikely':
        return { label: 'Khó Khả Thi / Unlikely', class: 'bg-rose-500/15 text-rose-400 border-rose-500/30' };
      default:
        return { label: 'Chưa Đủ Mẫu / Insufficient Data', class: 'bg-muted/40 text-muted-foreground border-border/60' };
    }
  };

  const getHzBadge = (hz: string) => {
    switch (hz) {
      case 'conservative':
        return { label: 'Vùng Sống Được (Bảo thủ)', class: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30' };
      case 'optimistic':
        return { label: 'Vùng Sống Được (Lạc quan)', class: 'bg-amber-500/15 text-amber-400 border-amber-500/30' };
      default:
        return { label: 'Ngoại Vùng Sống (Outside HZ)', class: 'bg-muted/30 text-muted-foreground border-border/50' };
    }
  };

  const tierInfo = getTierBadge(ai.habitability_tier);
  const hzInfo = getHzBadge(ai.hz_classification);
  const transitDepthPpm = ai.bls_depth_fraction != null ? Math.round(ai.bls_depth_fraction * 1e6) : null;

  return (
    <TabsContent value="ai_physics" className="m-0 space-y-4">
      {/* 1. TOP CARDS: AI VETTING CONFIDENCE & HABITABILITY INDEX */}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {/* ML Transit Vetting Confidence */}
        <div className="border border-border/70 bg-card/60 p-3.5">
          <div className="flex items-center justify-between text-xs">
            <span className="flex items-center gap-1.5 font-medium text-muted-foreground">
              <Sparkles className="size-3.5 text-primary" />
              AI Transit Vetting Score
            </span>
            <Badge
              variant={ai.candidate_above_threshold ? 'default' : 'secondary'}
              className="h-5 rounded-none font-mono text-[10px] uppercase"
            >
              {ai.candidate_above_threshold ? 'VƯỢT NGƯỠNG THẨM ĐỊNH' : 'TIÊU CHUẨN'}
            </Badge>
          </div>
          <div className="mt-2 flex items-baseline justify-between">
            <span className="font-mono text-2xl font-bold tabular-nums text-foreground">
              {hasCandidate && ai.candidate_score != null ? `${scorePct.toFixed(1)}%` : 'Chưa có điểm'}
            </span>
            <span className="font-mono text-xs text-muted-foreground">Threshold: 75.0%</span>
          </div>
          <Progress value={hasCandidate ? scorePct : 0} className="mt-2.5 h-1.5" />
          <p className="mt-2 text-[11px] text-muted-foreground leading-relaxed">
            Mức độ tin cậy của mạng nơ-ron tích chập (CNN) phân loại tín hiệu transit thực nghiệm so với biến tinh hoặc nhiễu đo lường.
          </p>
        </div>

        {/* Analytic Habitability Index */}
        <div className="border border-primary/25 bg-primary/5 p-3.5">
          <div className="flex items-center justify-between text-xs">
            <span className="flex items-center gap-1.5 font-medium text-foreground">
              <Globe className="size-3.5 text-primary" />
              Habitability Index (Giải tích Vật lý)
            </span>
            <Badge className={`h-5 rounded-none font-mono text-[10px] uppercase border ${tierInfo.class}`}>
              {tierInfo.label}
            </Badge>
          </div>
          <div className="mt-2 flex items-baseline justify-between">
            <div className="flex items-baseline gap-1.5">
              <span className="font-mono text-2xl font-bold tabular-nums text-primary">
                {ai.habitability_score != null ? habitabilityScore.toFixed(1) : '—'}
              </span>
              <span className="font-mono text-xs text-muted-foreground">/ 100 pts</span>
            </div>
            <span className="font-mono text-[11px] text-muted-foreground">
              Độ tin cậy dữ liệu: <span className="font-semibold text-foreground">{confidencePct}%</span>
            </span>
          </div>
          <Progress value={habitabilityScore} className="mt-2.5 h-1.5" />
          <div className="mt-2 flex items-center justify-between text-[11px]">
            <span className="text-muted-foreground">Vùng cư trú:</span>
            <span className={`font-mono text-[10px] font-medium uppercase px-1.5 py-0.5 border ${hzInfo.class}`}>
              {hzInfo.label}
            </span>
          </div>
        </div>
      </div>

      {/* 2. HABITABILITY 5-COMPONENT BREAKDOWN (WHEN AVAILABLE) */}
      {ai.habitability_components && ai.habitability_components.length > 0 && (
        <div className="border border-border/70 bg-muted/10 p-3.5">
          <div className="flex items-center justify-between border-b border-border/50 pb-2">
            <div className="flex items-center gap-1.5 font-mono text-xs uppercase tracking-wider text-muted-foreground">
              <ShieldCheck className="size-3.5 text-primary" />
              <span>Ma trận 5 tiêu chí phân tích khả năng sống được</span>
            </div>
            <span className="font-mono text-[10px] text-muted-foreground">Thang đo Kopparapu & NASA baseline</span>
          </div>
          <div className="mt-3 grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
            {ai.habitability_components.map((comp) => {
              const compPct = comp.max_score > 0 ? (comp.score / comp.max_score) * 100 : 0;
              return (
                <div key={comp.key} className="border border-border/50 bg-background/50 p-2.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-medium text-foreground">{comp.label}</span>
                    <span className="font-mono text-[11px] font-semibold text-primary">
                      {comp.score.toFixed(1)} / {comp.max_score.toFixed(0)}
                    </span>
                  </div>
                  <Progress value={compPct} className="mt-1.5 h-1" />
                  <p className="mt-1.5 line-clamp-1 text-[10px] text-muted-foreground" title={comp.reason}>
                    {comp.reason || 'Đang thẩm định'}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 3. DERIVED PLANETARY PHYSICS TELEMETRY */}
      <div>
        <p className="mb-2 font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
          Đặc tính Vật lý Thiên văn Giải tích (Kepler & Stefan-Boltzmann)
        </p>
        <dl className="grid grid-cols-2 gap-x-3 gap-y-3 border border-border/70 bg-card/40 p-3 text-xs sm:grid-cols-4">
          <Info
            label="Phân loại Hành tinh"
            value={ai.planet_classification || (ai.planet_radius_earth ? `${number(ai.planet_radius_earth, 2)} R⊕` : '—')}
            valueClass="text-primary font-semibold"
            tooltip="Phân tầng kích thước hành tinh: Sub-Earth (<0.8 R⊕), Earth-size (0.8-1.25 R⊕), Super-Earth (1.25-2.0 R⊕), Sub-Neptune (2-4 R⊕), Jovian (>4 R⊕)."
          />
          <Info
            label="Bán kính Hành tinh (Rp)"
            value={ai.planet_radius_earth && ai.planet_radius_earth > 0 ? `${number(ai.planet_radius_earth, 2)} R⊕` : '—'}
            tooltip="Bán kính hành tinh quy đổi theo Trái Đất (R⊕) từ tỷ lệ độ sâu transit và bán kính sao mẹ: R_p = √(depth) × R_* × 109.076."
          />
          <Info
            label="Bức xạ Nhận được (Seff)"
            value={ai.insolation_earth && ai.insolation_earth > 0 ? `${number(ai.insolation_earth, 2)} S⊕` : '—'}
            tooltip="Cường độ bức xạ năng lượng nhận từ sao mẹ quy đổi theo năng lượng Trái Đất nhận từ Mặt Trời: S_eff = L_* / a²."
          />
          <Info
            label="Nhiệt độ Cân bằng (Teq)"
            value={ai.equilibrium_temp_k && ai.equilibrium_temp_k > 0 ? `${number(ai.equilibrium_temp_k, 0)} K (${number(ai.equilibrium_temp_k - 273.15, 0)}°C)` : '—'}
            tooltip="Nhiệt độ cân bằng nhiệt bức xạ bề mặt của hành tinh (Kelvin) với giả định hệ số phản xạ Bond Albedo = 0.30."
          />
          <Info
            label="Chu kỳ Quỹ đạo (Porb)"
            value={ai.bls_period_days && ai.bls_period_days > 0 ? `${number(ai.bls_period_days, 4)} ngày` : '—'}
            tooltip="Chu kỳ quay quanh sao chủ xác định bởi thuật toán Box Least Squares (BLS) từ chuỗi thời gian đường cong ánh sáng."
          />
          <Info
            label="Bán trục Lớn (a)"
            value={ai.semi_major_axis_au && ai.semi_major_axis_au > 0 ? `${number(ai.semi_major_axis_au, 3)} AU` : '—'}
            tooltip="Khoảng cách quỹ đạo bán trục lớn tính bằng Đơn vị Thiên văn (AU) theo Định luật Kepler 3: a = (M_* × P²)^(1/3)."
          />
          <Info
            label="Thời gian Transit (Tdur)"
            value={ai.transit_duration_hours && ai.transit_duration_hours > 0 ? `${number(ai.transit_duration_hours, 2)} giờ` : (ai.bls_duration_days ? `${number(ai.bls_duration_days * 24, 2)} giờ` : '—')}
            tooltip="Thời gian hành tinh đi qua bề mặt sao chủ (Transit Duration) đo từ điểm tiếp xúc đầu tiên đến tiếp xúc cuối cùng."
          />
          <Info
            label="Độ sâu Quá cảnh (ΔF/F)"
            value={transitDepthPpm ? `${transitDepthPpm.toLocaleString()} ppm` : (ai.bls_depth_fraction ? `${number(ai.bls_depth_fraction * 100, 3)}%` : '—')}
            tooltip="Tỷ lệ suy giảm thông lượng ánh sáng của sao chủ tại điểm cực tiểu khi hành tinh che khuất (tính bằng phần triệu - ppm)."
          />
        </dl>
      </div>

      {/* 4. PHYSICS CAVEATS & WARNINGS */}
      {ai.warnings && ai.warnings.length > 0 && (
        <div className="flex items-start gap-2.5 border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-300">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-400" />
          <div className="space-y-1">
            <p className="font-medium text-amber-200">Giới hạn dữ liệu giải tích:</p>
            <ul className="list-inside list-disc text-[11px] text-amber-300/80 leading-relaxed">
              {ai.warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </TabsContent>
  );
}
