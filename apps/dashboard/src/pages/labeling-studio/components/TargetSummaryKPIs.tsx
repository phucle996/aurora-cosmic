import type { JSX } from 'react';
import type { ScientificReviewEvidence } from '../types';

function number(value: number, digits = 2): string {
  return Number.isFinite(value) ? value.toLocaleString(undefined, { maximumFractionDigits: digits }) : '—';
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

export function TargetSummaryKPIs({ evidence }: { evidence: ScientificReviewEvidence }): JSX.Element {
  return (
    <div className="grid grid-cols-2 gap-px border border-border/70 bg-border/70 sm:grid-cols-4">
      <EvidenceValue
        label="BLS period"
        value={evidence.bls_available ? `${number(evidence.bls_period_days, 4)} d` : 'Unavailable'}
      />
      <EvidenceValue
        label="BLS depth"
        value={evidence.bls_available ? `${number(evidence.bls_depth_ppm)} ppm` : '—'}
      />
      <EvidenceValue
        label="BLS power"
        value={evidence.bls_available ? number(evidence.bls_power, 4) : '—'}
      />
      <EvidenceValue
        label="Centroid offset"
        value={evidence.transit_evidence_available ? `${number(evidence.centroid_offset_pixels, 3)} px` : 'Unavailable'}
      />
      <EvidenceValue
        label="Cadences"
        value={evidence.n_points.toLocaleString()}
      />
      <EvidenceValue
        label="Sector coverage"
        value={`${number(evidence.sector_coverage_percent, 2)}%`}
        detail={`${number(evidence.time_span_days, 4)} / ${number(evidence.sector_baseline_days, 4)} d observed`}
      />
      <EvidenceValue
        label="Largest gap"
        value={`${number(evidence.largest_gap_hours, 2)} h`}
        detail="longest interval without a valid cadence"
      />
      <EvidenceValue
        label="Flux scatter"
        value={`${number(evidence.flux_std_ppm)} ppm`}
      />
      <EvidenceValue
        label="TOI context"
        value={evidence.matched_toi_id || evidence.toi_match_status || 'Unavailable'}
      />
    </div>
  );
}
