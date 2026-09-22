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

  // 1. Catalog match confirmed (EPHEMERIS_MATCH with real TOI)
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

  if (isCatalogConfirmed) {
    const factors = [
      `TOI: ${validToiId}`,
      `BLS Power: ${number(evidence.bls_power, 2)}`,
    ];
    if (suggestion) factors.push(`Score: ${percentage(suggestion.candidate_score)}`);

    return {
      suggestedLabel: 'POSITIVE',
      suggestedReason: 'CATALOG_CONFIRMED',
      suggestedReasonLabel: 'Catalog-confirmed target',
      suggestedConfidence: '0.9',
      confidenceLabel: 'High (90%)',
      rationale: `Trùng khớp mục tiêu trong danh mục TOI (${validToiId}) với chu kỳ đồng pha xác nhận.`,
      keyFactors: factors,
    };
  }

  // 2. Physical radius limit: Rp > 2.5 R_Jup (Eclipsing Binary)
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
        confidenceLabel: 'High (90%)',
        rationale: `Kích thước thiên thể (${number(rPlanetJup, 2)} R_Jup > 2.5 R_Jup) vượt ngưỡng vật lý của hành tinh, là hệ sao đôi che nhau (EB).`,
        keyFactors: [
          `Planet Radius: ${number(rPlanetJup, 2)} R_Jup`,
          `Stellar Radius: ${number(evidence.stellar_radius, 2)} R_☉`,
          `BLS Depth: ${number(evidence.bls_depth_ppm)} ppm`,
        ],
      };
    }
  }

  // 3. Astronomical false positive: Centroid contamination
  if (evidence.centroid_offset_pixels >= 2.0) {
    const isHighConf = evidence.centroid_offset_pixels >= 3.0;
    const factors = [
      `Centroid offset: ${number(evidence.centroid_offset_pixels, 2)} px`,
      `Deficit offset: ${number(evidence.transit_deficit_center_offset_pixels ?? 0, 2)} px`,
    ];
    if (suggestion) factors.push(`Score: ${percentage(suggestion.candidate_score)}`);

    return {
      suggestedLabel: 'NEGATIVE',
      suggestedReason: 'CENTROID_CONTAMINATION',
      suggestedReasonLabel: 'Centroid contamination',
      suggestedConfidence: isHighConf ? '0.9' : '0.7',
      confidenceLabel: isHighConf ? 'High (90%)' : 'Medium (70%)',
      rationale: `Tâm nguồn sáng bị lệch đáng kể (${number(evidence.centroid_offset_pixels, 2)} px ≥ 2.0 px) khi có sự kiện dip, tín hiệu bắt nguồn từ sao nền lân cận.`,
      keyFactors: factors,
    };
  }

  // 4. Deep transit: Eclipsing Binary
  if (evidence.bls_depth_ppm > 35000) {
    const factors = [
      `BLS Depth: ${number(evidence.bls_depth_ppm)} ppm`,
      `Period: ${number(evidence.bls_period_days, 4)} d`,
    ];
    if (suggestion) factors.push(`Score: ${percentage(suggestion.candidate_score)}`);

    return {
      suggestedLabel: 'NEGATIVE',
      suggestedReason: 'ECLIPSING_BINARY',
      suggestedReasonLabel: 'Eclipsing-binary signature',
      suggestedConfidence: evidence.bls_depth_ppm > 50000 ? '0.9' : '0.7',
      confidenceLabel: evidence.bls_depth_ppm > 50000 ? 'High (90%)' : 'Medium (70%)',
      rationale: `Độ sâu quá cảnh lớn (${number(evidence.bls_depth_ppm)} ppm > 3.5%), dấu hiệu đặc trưng của hệ sao đôi che nhau.`,
      keyFactors: factors,
    };
  }

  // 5. High stellar variability
  if (evidence.variability_peak_fraction > 0.35 || evidence.flux_std_ppm > 12000) {
    return {
      suggestedLabel: 'NEGATIVE',
      suggestedReason: 'STELLAR_VARIABILITY',
      suggestedReasonLabel: 'Stellar variability',
      suggestedConfidence: '0.7',
      confidenceLabel: 'Medium (70%)',
      rationale: `Biến thiên quang thông nền cao (độ phân tán ${number(evidence.flux_std_ppm)} ppm), tín hiệu do sao chủ biến quang.`,
      keyFactors: [
        `Flux std: ${number(evidence.flux_std_ppm)} ppm`,
        `Peak fraction: ${percentage(evidence.variability_peak_fraction)}`,
      ],
    };
  }

  // 6. Insufficient cadences or large gap
  if (evidence.n_points < 1200 || evidence.largest_gap_hours > 72) {
    return {
      suggestedLabel: 'UNRESOLVED',
      suggestedReason: 'INSUFFICIENT_EVIDENCE',
      suggestedReasonLabel: 'Insufficient evidence',
      suggestedConfidence: '0.5',
      confidenceLabel: 'Low (50%)',
      rationale: `Khoảng trống dữ liệu lớn (${number(evidence.largest_gap_hours, 1)} h) hoặc điểm đo quá ít (${evidence.n_points}).`,
      keyFactors: [
        `Cadences: ${evidence.n_points.toLocaleString()}`,
        `Largest gap: ${number(evidence.largest_gap_hours, 1)} h`,
      ],
    };
  }

  // 7. When ML Model suggestion is available
  if (suggestion) {
    if (suggestion.above_threshold) {
      if (evidence.transit_evidence_available && evidence.centroid_offset_pixels < 1.5 && evidence.bls_power >= 7) {
        const isHighConf = suggestion.candidate_score >= 0.82 && evidence.centroid_offset_pixels < 1.0;
        return {
          suggestedLabel: 'POSITIVE',
          suggestedReason: 'PERIODIC_TRANSIT_SHAPE',
          suggestedReasonLabel: 'Periodic transit shape',
          suggestedConfidence: isHighConf ? '0.9' : '0.7',
          confidenceLabel: isHighConf ? 'High (90%)' : 'Medium (70%)',
          rationale: `Đường cong ánh sáng có dạng quá cảnh chữ U định kỳ rõ nét (chu kỳ ${number(evidence.bls_period_days, 4)} d), tâm ổn định.`,
          keyFactors: [
            `Period: ${number(evidence.bls_period_days, 4)} d`,
            `Depth: ${number(evidence.bls_depth_ppm)} ppm`,
            `Score: ${percentage(suggestion.candidate_score)}`,
            `BLS Power: ${number(evidence.bls_power, 2)}`,
          ],
        };
      }

      const isHighConf = suggestion.candidate_score >= 0.85 && evidence.bls_power >= 12;
      return {
        suggestedLabel: 'POSITIVE',
        suggestedReason: 'COHERENT_BLS_SIGNAL',
        suggestedReasonLabel: 'Coherent BLS signal',
        suggestedConfidence: isHighConf ? '0.9' : '0.7',
        confidenceLabel: isHighConf ? 'High (90%)' : 'Medium (70%)',
        rationale: `Tín hiệu BLS đồng pha mạch lạc (power = ${number(evidence.bls_power, 2)}), vượt ngưỡng tin cậy của mô hình.`,
        keyFactors: [
          `BLS Power: ${number(evidence.bls_power, 2)}`,
          `Score: ${percentage(suggestion.candidate_score)}`,
          `Threshold: ${percentage(suggestion.decision_threshold)}`,
        ],
      };
    } else {
      const isLowScore = suggestion.candidate_score < 0.25;
      return {
        suggestedLabel: 'NEGATIVE',
        suggestedReason: 'INSTRUMENTAL_SYSTEMATIC',
        suggestedReasonLabel: 'Instrumental systematic',
        suggestedConfidence: isLowScore ? '0.9' : '0.7',
        confidenceLabel: isLowScore ? 'High (90%)' : 'Medium (70%)',
        rationale: `Điểm số mô hình (${percentage(suggestion.candidate_score)}) dưới ngưỡng (${percentage(suggestion.decision_threshold)}), tín hiệu yếu hoặc do trôi phông thiết bị.`,
        keyFactors: [
          `Score: ${percentage(suggestion.candidate_score)}`,
          `BLS Power: ${number(evidence.bls_power, 2)}`,
        ],
      };
    }
  }

  // 8. Heuristic Fallback without model: strong clean BLS
  if (evidence.bls_available && evidence.bls_power >= 10 && evidence.centroid_offset_pixels < 1.5) {
    return {
      suggestedLabel: 'POSITIVE',
      suggestedReason: 'COHERENT_BLS_SIGNAL',
      suggestedReasonLabel: 'Coherent BLS signal',
      suggestedConfidence: '0.7',
      confidenceLabel: 'Medium (70%)',
      rationale: `Tín hiệu BLS đạt độ tin cậy mạnh (${number(evidence.bls_power, 2)}) và tâm ổn định.`,
      keyFactors: [
        `BLS Power: ${number(evidence.bls_power, 2)}`,
        `Period: ${number(evidence.bls_period_days, 4)} d`,
      ],
    };
  }

  return undefined;
}
