import type { AIDecisionRecommendation, ModelSuggestion, ScientificReviewEvidence } from '../types';

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
      // Check for astronomical physical radius limit: Rp > 2.5 R_Jup
      if (evidence.stellar_radius && evidence.stellar_radius > 0 && evidence.bls_depth_ppm > 0) {
        const delta = evidence.bls_depth_ppm / 1_000_000;
        const rPlanetEarth = Math.sqrt(Math.max(0, delta)) * evidence.stellar_radius * 109.2;
        const rPlanetJup = rPlanetEarth / 11.209;
        if (rPlanetJup > 2.5) {
          return {
            suggestedLabel: 'NEGATIVE',
            suggestedReason: 'ECLIPSING_BINARY',
            suggestedReasonLabel: 'Eclipsing-binary signature',
            suggestedConfidence: '0.9',
            confidenceLabel: 'High · 90%',
            rationale: `Kích thước thiên thể tính toán (${number(rPlanetJup, 2)} R_Jup > 2.5 R_Jup) vượt ngưỡng vật lý tối đa của hành tinh khí, là hệ sao đôi che nhau (EB).`,
            keyFactors: [
              `Planet Radius: ${number(rPlanetJup, 2)} R_Jup (Phi vật lý)`,
              `Stellar Radius: ${number(evidence.stellar_radius, 2)} R_☉`,
              `BLS Depth: ${number(evidence.bls_depth_ppm)} ppm`,
            ],
          };
        }
      }

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
            `Transit deficit offset: ${number(evidence.transit_deficit_center_offset_pixels ?? 0, 2)} px`,
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
            `Deficit offset: ${number(evidence.transit_deficit_center_offset_pixels ?? 0, 2)} px`,
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
