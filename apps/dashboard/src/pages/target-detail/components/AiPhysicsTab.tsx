import type { JSX } from 'react';
import { Sparkles } from 'lucide-react';

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
  return (
    <TabsContent value="ai_physics" className="m-0 space-y-3.5">
      <div className="grid grid-cols-1 gap-3">
        <div className="border border-primary/20 bg-primary/5 p-3">
          <div className="flex items-center justify-between text-xs">
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <Sparkles className="size-3.5 text-primary" />Candidate AI Score
            </span>
            <Badge
              variant={ai.candidate_above_threshold ? 'default' : 'secondary'}
              className="h-5 rounded-none font-mono text-[10px] uppercase"
            >
              {ai.candidate_above_threshold ? 'VƯỢT NGƯỠNG' : 'TIÊU CHUẨN'}
            </Badge>
          </div>
          <div className="mt-2 flex items-baseline justify-between">
            <span className="font-mono text-xl font-bold tabular-nums text-primary">
              {hasCandidate && ai.candidate_score != null ? `${scorePct.toFixed(1)}%` : 'Not Scored'}
            </span>
            <span className="text-xs text-muted-foreground">Threshold: 75.0%</span>
          </div>
          <Progress value={hasCandidate ? scorePct : 0} className="mt-2 h-1.5" />
        </div>
      </div>
      <dl className="grid grid-cols-2 gap-x-3 gap-y-2.5 pt-1 text-xs sm:grid-cols-4">
        <Info
          label="BLS Orbital Period"
          value={ai.bls_period_days && ai.bls_period_days > 0 ? `${number(ai.bls_period_days, 3)} d` : '—'}
          tooltip="Chu kỳ quỹ đạo tìm thấy bởi thuật toán Box Least Squares (BLS) từ đường cong ánh sáng (tính theo ngày Trái Đất)."
        />
        <Info
          label="Semi-Major Axis"
          value={ai.semi_major_axis_au && ai.semi_major_axis_au > 0 ? `${number(ai.semi_major_axis_au, 3)} AU` : '—'}
          tooltip="Khoảng cách bán trục lớn của quỹ đạo tính bằng Đơn vị Thiên văn (AU) theo Định luật Kepler 3: a = (M_* × P²)^(1/3)."
        />
        <Info
          label="Planet Radius"
          value={ai.planet_radius_earth && ai.planet_radius_earth > 0 ? `${number(ai.planet_radius_earth, 2)} R⊕` : '—'}
          tooltip="Bán kính hành tinh ước lượng theo Trái Đất (R⊕) từ tỷ lệ độ sâu transit và bán kính sao mẹ: R_p = √(depth) × R_* × 109.076."
        />
        <Info
          label="Equilibrium Temp"
          value={ai.equilibrium_temp_k && ai.equilibrium_temp_k > 0 ? `${number(ai.equilibrium_temp_k, 0)} K (${number(ai.equilibrium_temp_k - 273, 0)}°C)` : '—'}
          tooltip="Nhiệt độ cân bằng nhiệt độ bề mặt của hành tinh (Kelvin) với giả định hệ số phản xạ Bond Albedo = 0.30."
        />
      </dl>
    </TabsContent>
  );
}
