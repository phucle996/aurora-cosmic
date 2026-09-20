/**
 * @file EvidenceStep.tsx
 * @description Card representing an individual milestone along the 5-step scientific provenance path.
 */

import type { JSX, ReactNode } from 'react';

export type EvidenceTone = 'observed' | 'pending' | 'anomaly' | 'gold';

interface EvidenceStepProps {
  /** Numeric step index (e.g. "01", "02") */
  index: string;
  /** Title of the provenance stage */
  title: string;
  /** Right-aligned short status description */
  status: string;
  /** Visual tone theme reflecting evidence availability or anomalies */
  tone: EvidenceTone;
  /** Content details, keys, and copy triggers */
  children: ReactNode;
}

/**
 * Maps evidence tone to border and background CSS styles.
 */
const TONE_CONTAINER_CLASSES: Record<EvidenceTone, string> = {
  observed: 'border-emerald-500/35 bg-emerald-500/5',
  gold: 'border-violet-500/35 bg-violet-500/5',
  anomaly: 'border-sky-500/35 bg-sky-500/5',
  pending: 'border-border/70 bg-muted/10',
};

/**
 * Maps evidence tone to step badge indicator colors.
 */
const TONE_BADGE_CLASSES: Record<EvidenceTone, string> = {
  observed: 'bg-emerald-500 text-white',
  gold: 'bg-violet-500 text-white',
  anomaly: 'bg-sky-500 text-white',
  pending: 'bg-muted text-muted-foreground',
};

/**
 * EvidenceStep renders a stylized milestone card with:
 *   - A numbered badge (01..05)
 *   - Title and status badge
 *   - Detailed metadata payload (FITS keys, Parquet paths, SHA256 hashes, etc.)
 */
export function EvidenceStep({
  index,
  title,
  status,
  tone,
  children,
}: EvidenceStepProps): JSX.Element {
  return (
    <div className={`relative border p-3.5 ${TONE_CONTAINER_CLASSES[tone]}`}>
      {/* Step Header: Number badge, title, and stage status */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span
            className={`flex size-5 items-center justify-center font-mono text-[9px] font-bold ${TONE_BADGE_CLASSES[tone]}`}
          >
            {index}
          </span>
          <p className="text-xs font-semibold text-foreground">{title}</p>
        </div>
        <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-muted-foreground">
          {status}
        </span>
      </div>

      {/* Step Body: Key-value details and actions */}
      <div className="mt-3">{children}</div>
    </div>
  );
}
