import type { JSX } from 'react';

import { TabsContent } from '@/components/ui/tabs';
import type { CandidateEvidence, Target } from '@/lib/analytics-types';
import { Info, number } from './InfoItem';

interface ObservationTabProps {
  target: Target;
  hasTicContext: boolean;
  toiMatch: string;
  evidence?: CandidateEvidence;
}

export function ObservationTab({
  target,
  hasTicContext,
  toiMatch,
  evidence,
}: ObservationTabProps): JSX.Element {
  // 1. Observation Cadence (phút)
  const cadenceMinutes =
    evidence?.median_cadence && evidence.median_cadence > 0
      ? evidence.median_cadence * 24 * 60
      : target.has_lightcurve && target.lightcurve_points > 0 && target.lightcurve_time_span > 0
        ? (target.lightcurve_time_span * 24 * 60) / target.lightcurve_points
        : null;
  const cadenceLabel = cadenceMinutes != null ? `${cadenceMinutes.toFixed(1)} min` : '—';

  // 2. Max Data Gap (ngày / giờ)
  const maxGapDays = evidence?.max_gap && evidence.max_gap > 0 ? evidence.max_gap : null;
  const maxGapLabel =
    maxGapDays != null
      ? `${number(maxGapDays, 2)} days (${(maxGapDays * 24).toFixed(1)} h)`
      : '—';

  // 3. Photometric Noise (ppm)
  const noisePpm =
    evidence?.median_flux_err && evidence.median_flux_err > 0
      ? Math.round(evidence.median_flux_err * 1e6)
      : evidence?.flux_std && evidence.flux_std > 0
        ? Math.round(evidence.flux_std * 1e6)
        : null;
  const noiseLabel = noisePpm != null ? `${noisePpm.toLocaleString()} ppm` : '—';

  return (
    <TabsContent value="observation" className="m-0 space-y-4">
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3.5 text-sm sm:grid-cols-3">
        <Info
          label="TESS Magnitude"
          value={hasTicContext && target.tess_mag > 0 ? `${number(target.tess_mag)} Tmag` : '— (TIC not enriched)'}
          tooltip="Cấp sao quang học trắc quang đo bởi kính thiên văn vũ trụ TESS trong dải bước sóng 600 - 1000 nm."
        />
        <Info
          label="TESS Sector"
          value={`Sector ${target.sector}`}
          tooltip="Vùng trời quan sát (Sector) của sứ mệnh TESS kéo dài khoảng 27.4 ngày liên tục."
        />
        <Info
          label="NASA TOI Match"
          value={toiMatch}
          valueClass={target.matched_toi ? 'text-emerald-500 font-medium' : undefined}
          tooltip={
            target.matched_toi
              ? `Đã đối chiếu khớp với danh mục NASA TESS Objects of Interest (${toiMatch}).`
              : 'Chưa ghi nhận đối tượng quan tâm (TOI) của NASA tương ứng với TIC này.'
          }
        />
        <Info
          label="Right Ascension (RA)"
          value={hasTicContext ? `${number(target.ra, 4)}°` : '— (TIC not enriched)'}
          tooltip="Tọa độ góc Xích kinh (RA) tính bằng độ (°), xác định vị trí sao theo kinh tuyến thiên cầu."
        />
        <Info
          label="Declination (Dec)"
          value={hasTicContext ? `${number(target.dec, 4)}°` : '— (TIC not enriched)'}
          tooltip="Tọa độ góc Xích vĩ (Dec) tính bằng độ (°), xác định vị trí sao theo vĩ tuyến thiên cầu."
        />
        <Info
          label="Sampling Cadence"
          value={cadenceLabel}
          tooltip="Chu kỳ lấy mẫu trắc quang trung vị giữa các lần đo liên tiếp (ví dụ 2.0 min cho short-cadence SPOC, 30 min cho Full Frame Images - FFI)."
        />
        <Info
          label="Light Curve Coverage"
          value={
            target.has_lightcurve
              ? `${target.lightcurve_points.toLocaleString()} pts (${number(target.lightcurve_time_span, 1)} d)`
              : 'Not indexed'
          }
          tooltip="Dữ liệu trắc quang TESS: tổng số điểm đo quang thông (flux samples) và khoảng thời gian quan sát hiệu dụng trong Sector."
        />
        <Info
          label="Max Data Gap"
          value={maxGapLabel}
          tooltip="Khoảng thời gian gián đoạn dài nhất giữa các lần đo, thường do thời gian vệ tinh TESS quay ăng-ten truyền dữ liệu về Trái Đất (Earth downlink gap)."
        />
        <Info
          label="Photometric Noise"
          value={noiseLabel}
          tooltip="Mức độ sai số trắc quang trung vị (Median Flux Uncertainty) tính bằng phần triệu (ppm). Càng nhỏ thì tín hiệu đo càng sạch và chính xác."
        />
      </dl>
      <div className="flex items-center justify-between border-t border-border/40 pt-2 text-xs text-muted-foreground">
        <span>{hasTicContext ? 'ICRS coordinates & TESS photometry from Gold snapshot' : 'TIC snapshot has not enriched this target'}</span>
        <span className="font-mono text-foreground/80">Sector {target.sector} Coverage</span>
      </div>
    </TabsContent>
  );
}
