import type { JSX } from 'react';
import { CircleAlert } from 'lucide-react';

import { TabsContent } from '@/components/ui/tabs';
import type { TargetStellarPhysicsInsight } from '@/lib/analytics-types';
import { Info, number } from './InfoItem';

interface StarPhysicsTabProps {
  stellar: TargetStellarPhysicsInsight;
  tessMag: number;
  hasStellarContext: boolean;
  warnings?: string[];
}

export function StarPhysicsTab({
  stellar,
  tessMag,
  hasStellarContext,
  warnings,
}: StarPhysicsTabProps): JSX.Element {
  const evolutionColor = stellar.evolution_status.includes('Evolved')
    ? 'text-amber-500 font-medium'
    : 'text-emerald-500 font-medium';

  return (
    <TabsContent value="star_physics" className="m-0 space-y-4">
      {hasStellarContext ? (
        <>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3.5 text-sm sm:grid-cols-3">
            <Info
              label="Spectral Class"
              value={stellar.spectral_class_label}
              tooltip="Phân loại quang phổ sao theo hệ Morgan–Keenan (O, B, A, F, G, K, M) và nhóm độ sáng (Dwarf / Subgiant / Giant) dựa trên nhiệt độ hiệu dụng và bán kính sao."
            />
            <Info
              label="Effective Temperature"
              value={`${number(stellar.teff, 0)} K`}
              tooltip="Nhiệt độ hiệu dụng bề mặt ngôi sao (Kelvin) theo định luật Stefan-Boltzmann, quyết định màu sắc quang phổ và tổng năng lượng bức xạ."
            />
            <Info
              label="Stellar Radius"
              value={`${number(stellar.radius, 2)} R☉ (${(stellar.radius * 696340).toLocaleString()} km)`}
              tooltip="Bán kính sao mẹ quy đổi theo bán kính Mặt Trời (1 R☉ ≈ 696.340 km), trích xuất từ snapshot danh mục TIC đã chuẩn hóa."
            />
            <Info
              label="Stellar Mass"
              value={stellar.mass > 0 ? `${stellar.mass.toFixed(2)} M☉` : '—'}
              tooltip="Khối lượng sao mẹ tính theo khối lượng Mặt Trời (1 M☉ ≈ 1.989 × 10³⁰ kg), là tham số quyết định giếng hấp dẫn và chu kỳ quỹ đạo theo định luật Kepler."
            />
            <Info
              label="Surface Gravity (log g)"
              value={stellar.logg > 0 ? `${number(stellar.logg, 2)} cgs` : '—'}
              tooltip="Gia tốc trọng trường tại bề mặt ngôi sao theo thang logarit log10(g) (cm/s²). Sao lùn thường có log g ≈ 4.0 - 4.5, sao khổng lồ có log g < 3.5."
            />
            <Info
              label="TESS Magnitude"
              value={tessMag > 0 ? `${number(tessMag, 2)} Tmag` : '—'}
              tooltip="Cấp sao biểu kiến quan sát được qua kính viễn vọng không gian TESS trong dải bước sóng 600 - 1000 nm. Càng nhỏ thì sao càng sáng."
            />
            <Info
              label="Stellar Luminosity (L*)"
              value={stellar.hz_luminosity_solar > 0 ? `${stellar.hz_luminosity_solar.toFixed(3)} L☉` : '—'}
              tooltip="Tổng công suất bức xạ năng lượng toàn phần (Bolometric Luminosity) so với Mặt Trời: L/L☉ = (R/R☉)² × (T_eff / 5778)⁴."
            />
            <Info
              label="Conservative HZ (AU)"
              value={stellar.hz_inner_au > 0 ? `${stellar.hz_inner_au.toFixed(2)} - ${stellar.hz_outer_au.toFixed(2)} AU` : '—'}
              tooltip="Vùng có thể sống được bảo thủ (Conservative Habitable Zone) theo mô hình Kopparapu (2013), giới hạn bởi hiệu ứng nhà kính mất kiểm soát (Runaway Greenhouse) và nhà kính tối đa (Maximum Greenhouse)."
            />
            <Info
              label="Optimistic HZ (AU)"
              value={stellar.hz_inner_au > 0 ? `${(stellar.hz_inner_au * 0.75).toFixed(2)} - ${(stellar.hz_outer_au * 1.4).toFixed(2)} AU` : '—'}
              tooltip="Vùng sống được mở rộng (Optimistic Habitable Zone) theo Kopparapu (2013), tương ứng phạm vi bức xạ từ Sao Kim gần đây (Recent Venus) đến Sao Hỏa sơ khai (Early Mars)."
            />
            <Info
              label="Stellar Density (ρ*)"
              value={stellar.stellar_density_gcc > 0 ? `${number(stellar.stellar_density_gcc, 3)} g/cm³` : '—'}
              tooltip="Mật độ khối lượng trung bình của sao (g/cm³). Dùng để đối chiếu chéo với mật độ suy ra từ quá cảnh transit để loại trừ sao đôi nền (False Positive)."
            />
            <Info
              label="Escape Velocity (v_esc)"
              value={stellar.escape_velocity_kms > 0 ? `${number(stellar.escape_velocity_kms, 0)} km/s` : '—'}
              tooltip="Vận tốc thoát ly tối thiểu tại bề mặt sao mẹ (km/s): v_esc = √(2GM/R). Mặt Trời có v_esc ≈ 617.5 km/s."
            />
            <Info
              label="Bolometric Mag (M_bol)"
              value={stellar.bolometric_mag != null ? `${number(stellar.bolometric_mag, 2)} mag` : '—'}
              tooltip="Cấp sao tuyệt đối toàn phần đo tổng bức xạ của ngôi sao ở khoảng cách chuẩn 10 parsec (32.6 năm ánh sáng). M_bol của Mặt Trời là 4.74 mag."
            />
            <Info
              label="Stellar Variability (σ)"
              value={stellar.flux_std_ppm != null ? `${stellar.flux_std_ppm.toLocaleString()} ppm` : '—'}
              tooltip="Độ lệch chuẩn quang thông (Flux Std) sau chuẩn hóa tính theo phần triệu (ppm). Phản ánh mức độ biến quang tự nhiên, vết đen hoặc bùng phát của sao mẹ."
            />
            <Info
              label="Flux Amplitude (ΔF)"
              value={stellar.flux_amplitude_pct != null ? `${stellar.flux_amplitude_pct.toFixed(3)}%` : '—'}
              tooltip="Biên độ dao động độ sáng cực đại của sao mẹ trong suốt thời gian quan sát Sector."
            />
            <Info
              label="Solar Ratio"
              value={`${stellar.radius.toFixed(2)}x R☉ · ${(stellar.teff / 5778).toFixed(2)}x T☉`}
              tooltip="Tỷ lệ so sánh trực tiếp kích thước bán kính (R/R☉) và nhiệt độ hiệu dụng (T_eff/T☉) của ngôi sao so với Mặt Trời."
            />
          </dl>
          {warnings && warnings.length > 0 && (
            <div className="flex items-start gap-2 border border-amber-500/20 bg-amber-500/5 p-2.5 text-xs text-amber-600 dark:text-amber-400">
              <CircleAlert className="mt-0.5 size-3.5 shrink-0" />
              <div>
                <span className="font-mono text-[10px] font-semibold uppercase tracking-wider">Lưu ý dữ liệu vật lý TIC: </span>
                <span className="text-muted-foreground">{warnings.map((w: string) => w.replace(/_/g, ' ')).join(', ')}</span>
              </div>
            </div>
          )}
          <div className="flex items-center justify-between border-t border-border/40 pt-2 text-xs text-muted-foreground">
            <span>Mô hình quang thông bức xạ Stefan-Boltzmann & Kopparapu (2013)</span>
            <span className={evolutionColor}>{stellar.evolution_status}</span>
          </div>
        </>
      ) : (
        <div className="border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-800 dark:text-amber-200">
          Chưa có thông số TIC đã xác minh cho target này, nên không suy diễn loại sao, độ sáng hay vùng Goldilocks.
        </div>
      )}
    </TabsContent>
  );
}
