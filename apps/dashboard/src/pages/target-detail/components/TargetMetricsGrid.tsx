import type { JSX } from 'react';
import { Gauge, MapPin, Star, ThermometerSun } from 'lucide-react';

import type { Target } from '@/lib/analytics-types';
import { MetricCard, number } from './InfoItem';

interface TargetMetricsGridProps {
  target: Target;
  hasTicContext: boolean;
  surfaceGravity: number;
}

export function TargetMetricsGrid({
  target,
  hasTicContext,
  surfaceGravity,
}: TargetMetricsGridProps): JSX.Element {
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <MetricCard
        icon={ThermometerSun}
        label="Effective temperature"
        value={hasTicContext && target.effective_t > 0 ? `${number(target.effective_t, 0)} K` : '—'}
        detail={hasTicContext ? 'TIC catalog' : 'TIC catalog not enriched'}
        tooltip="Nhiệt độ hiệu dụng bề mặt của ngôi sao (Kelvin) theo định luật Stefan-Boltzmann."
      />
      <MetricCard
        icon={Star}
        label="Stellar radius"
        value={hasTicContext && target.radius > 0 ? `${number(target.radius)} R☉` : '—'}
        detail={hasTicContext ? 'TIC catalog' : 'TIC catalog not enriched'}
        tooltip="Bán kính sao mẹ quy đổi theo bán kính Mặt Trời (1 R☉ ≈ 696.340 km)."
      />
      <MetricCard
        icon={Gauge}
        label="Surface gravity"
        value={hasTicContext && surfaceGravity > 0 ? number(surfaceGravity, 2) : '—'}
        detail={hasTicContext ? 'log g (cgs)' : 'TIC catalog not enriched'}
        tooltip="Gia tốc trọng trường bề mặt sao ở thang đo logarit log10(g) (cgs: cm/s²)."
      />
      <MetricCard
        icon={MapPin}
        label="Coordinates"
        value={hasTicContext ? `${number(target.ra, 3)}°, ${number(target.dec, 3)}°` : '—'}
        detail={hasTicContext ? 'RA / Dec (ICRS)' : 'TIC catalog not enriched'}
        tooltip="Tọa độ thiên văn Xích kinh (Right Ascension) và Xích vĩ (Declination) theo hệ quy chiếu thiên thể ICRS J2000."
      />
    </div>
  );
}
