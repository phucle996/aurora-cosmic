/**
 * @file EvidenceInspector.tsx
 * @description Inspector sidebar panel rendering the complete 5-step scientific provenance evidence chain for a selected product.
 */

import type { JSX } from 'react';
import { CircleDot, FileClock } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { LineageRecord, ProductKind } from '../types';
import { PRODUCT_CONFIG, STAGE_CLASSES, STAGE_LABELS } from '../types';
import { cleanETag, formatBytes, formatDate, recordStage, short } from '../utils';
import { CopyValue } from './CopyValue';
import { EvidenceStep } from './EvidenceStep';

interface EvidenceInspectorProps {
  /** The currently selected lineage record to inspect */
  selected?: LineageRecord;
  /** Active product kind for abbreviation display */
  productKind: ProductKind;
  /** Optional error from the Gold snapshot resolver */
  goldError?: string;
  /** ID of the item currently marked as copied */
  copied: string | null;
  /** Callback to copy text to clipboard with feedback */
  onCopy: (value: string, id: string) => void;
}

/**
 * EvidenceInspector visualizes the vertical 5-step DAG of scientific evidence:
 *   Step 01: NASA MAST source identity (observed from raw filename)
 *   Step 02: Bronze raw FITS object (size, ETag, modification date in S3/MinIO)
 *   Step 03: Rust Preprocessor artifact (calibrated Parquet segment, processor version)
 *   Step 04: Immutable Lineage Commit (cryptographic proof SHA-256)
 *   Step 05: Gold Research Snapshot (curated analytical dataset inclusion)
 */
export function EvidenceInspector({
  selected,
  productKind,
  goldError,
  copied,
  onCopy,
}: EvidenceInspectorProps): JSX.Element {
  const kindConfig = PRODUCT_CONFIG[productKind];

  return (
    <Card className="h-fit rounded-none border-border/70 shadow-none xl:sticky xl:top-4 xl:col-span-5 2xl:col-span-4">
      {/* Inspector Header: Target details & resolved status badge */}
      <CardHeader className="border-b border-border/60 p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="font-mono text-[9px] uppercase tracking-[0.15em] text-primary">
              Evidence inspector
            </p>
            <CardTitle className="mt-1 truncate text-base font-semibold text-foreground">
              {selected ? `TIC ${selected.ticID}` : 'No selection'}
            </CardTitle>
            <p className="mt-1 font-mono text-[10px] text-muted-foreground">
              {selected
                ? `sector ${selected.sector ?? '—'} · ${kindConfig.shortLabel}`
                : 'Select a ledger row'}
            </p>
          </div>
          {selected && (
            <Badge
              variant="outline"
              className={`rounded-none font-mono text-[8px] uppercase tracking-wider ${STAGE_CLASSES[recordStage(selected)]}`}
            >
              {STAGE_LABELS[recordStage(selected)]}
            </Badge>
          )}
        </div>
      </CardHeader>

      <CardContent className="space-y-2 p-4">
        {!selected ? (
          /* Empty placeholder when no record is selected */
          <div className="py-20 text-center text-sm text-muted-foreground">
            Select a product from the matrix to inspect provenance evidence.
          </div>
        ) : (
          <>
            {/* Step 01: Raw MAST Source Product Identity */}
            <EvidenceStep
              index="01"
              title="NASA MAST source identity"
              status="observed from Bronze key"
              tone="observed"
            >
              <div className="flex items-start justify-between gap-3">
                <p className="break-all font-mono text-[10px] leading-5 text-foreground">
                  {selected.sourceProductID}
                </p>
                <CopyValue
                  value={selected.sourceProductID}
                  id="source"
                  copied={copied}
                  onCopy={onCopy}
                />
              </div>
            </EvidenceStep>

            {/* Vertical DAG Connector Line */}
            <div className="ml-2 h-3 border-l border-dashed border-primary/40" />

            {/* Step 02: Bronze Raw FITS Storage Object */}
            <EvidenceStep
              index="02"
              title="Bronze FITS object"
              status="inventory observed"
              tone="observed"
            >
              <div className="flex items-start justify-between gap-3">
                <p className="break-all font-mono text-[10px] leading-5 text-foreground">
                  {selected.bronze.key}
                </p>
                <CopyValue
                  value={selected.bronze.key}
                  id="bronze-key"
                  copied={copied}
                  onCopy={onCopy}
                />
              </div>
              <div className="mt-2 grid grid-cols-2 gap-2 border-t border-border/50 pt-2 font-mono text-[9px] text-muted-foreground">
                <span>
                  size <strong className="text-foreground">{formatBytes(selected.bronze.size_bytes)}</strong>
                </span>
                <span>
                  ETag{' '}
                  <strong className="text-foreground" title={cleanETag(selected.bronze.etag)}>
                    {short(cleanETag(selected.bronze.etag))}
                  </strong>
                </span>
                <span className="col-span-2">
                  observed <strong className="text-foreground">{formatDate(selected.bronze.last_modified)}</strong>
                </span>
              </div>
            </EvidenceStep>

            {/* Vertical DAG Connector Line */}
            <div className="ml-2 h-3 border-l border-dashed border-primary/40" />

            {/* Step 03: Rust Preprocessing & Silver Parquet Serialization */}
            <EvidenceStep
              index="03"
              title="Rust processor → Silver Parquet"
              status={selected.silver ? 'artifact observed' : 'awaiting artifact'}
              tone={selected.silver ? 'observed' : 'pending'}
            >
              {selected.silver ? (
                <>
                  <div className="flex items-start justify-between gap-3">
                    <p className="break-all font-mono text-[10px] leading-5 text-foreground">
                      {selected.silver.key}
                    </p>
                    <CopyValue
                      value={selected.silver.key}
                      id="silver-key"
                      copied={copied}
                      onCopy={onCopy}
                    />
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-2 border-t border-border/50 pt-2 font-mono text-[9px] text-muted-foreground">
                    <span>
                      processor <strong className="text-foreground">{selected.processorVersion}</strong>
                    </span>
                    <span>
                      size <strong className="text-foreground">{formatBytes(selected.silver.size_bytes)}</strong>
                    </span>
                    <span className="col-span-2">
                      ETag <strong className="break-all text-foreground">{cleanETag(selected.silver.etag)}</strong>
                    </span>
                  </div>
                </>
              ) : (
                <p className="text-xs leading-5 text-muted-foreground">
                  No Silver object with matching MAST source identity found in observed prefix.
                </p>
              )}
            </EvidenceStep>

            {/* Vertical DAG Connector Line */}
            <div className="ml-2 h-3 border-l border-dashed border-primary/40" />

            {/* Step 04: Cryptographic Lineage Proof Commitment */}
            <EvidenceStep
              index="04"
              title="Immutable lineage commit"
              status={selected.lineage ? 'lineage_committed' : 'no durable commit'}
              tone={selected.lineage ? 'observed' : 'pending'}
            >
              {selected.lineage ? (
                <>
                  <div className="flex items-start justify-between gap-3">
                    <p className="break-all font-mono text-[10px] leading-5 text-foreground">
                      {selected.lineage.key}
                    </p>
                    <CopyValue
                      value={selected.lineage.key}
                      id="lineage-key"
                      copied={copied}
                      onCopy={onCopy}
                    />
                  </div>
                  <div className="mt-2 space-y-1 border-t border-border/50 pt-2 font-mono text-[9px] text-muted-foreground">
                    <p>
                      identity <strong className="break-all text-foreground">SHA256(source_product_id:processor_version)</strong>
                    </p>
                    <p>
                      lineage ID <strong className="break-all text-foreground">{selected.lineageID}</strong>
                    </p>
                    <p>
                      committed <strong className="text-foreground">{formatDate(selected.lineage.last_modified)}</strong>
                    </p>
                  </div>
                </>
              ) : (
                <div className="flex items-start gap-2 text-xs leading-5 text-muted-foreground">
                  <FileClock className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                  <p>
                    {selected.silver
                      ? 'Silver artifact exists but no matching lineage commit was found; investigate pipeline commit stage.'
                      : 'Lineage is committed only after the Silver artifact is verified durable.'}
                  </p>
                </div>
              )}
            </EvidenceStep>

            {/* Vertical DAG Connector Line */}
            <div className="ml-2 h-3 border-l border-dashed border-primary/40" />

            {/* Step 05: Gold Analytical Manifest Inclusion */}
            <EvidenceStep
              index="05"
              title="Gold research snapshot"
              status={
                selected.gold?.status === 'EXTRACTED'
                  ? 'manifest resolved'
                  : goldError
                    ? 'resolver unavailable'
                    : 'not in committed manifest'
              }
              tone={selected.gold?.status === 'EXTRACTED' ? 'gold' : 'pending'}
            >
              {selected.gold?.status === 'EXTRACTED' ? (
                <div className="space-y-2">
                  <div className="flex items-start justify-between gap-3">
                    <p className="break-all font-mono text-[10px] text-violet-700 dark:text-violet-300">
                      {selected.gold.snapshot_id}
                    </p>
                    <CopyValue
                      value={selected.gold.snapshot_id}
                      id="gold-snapshot"
                      copied={copied}
                      onCopy={onCopy}
                    />
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {selected.gold.datasets?.map((dataset) => (
                      <Badge key={dataset} variant="outline" className="rounded-none font-mono text-[8px]">
                        {dataset}
                      </Badge>
                    ))}
                  </div>
                </div>
              ) : (
                <p className="text-xs leading-5 text-muted-foreground">
                  No committed immutable Gold manifest currently records this input.
                </p>
              )}
            </EvidenceStep>

            {/* Informational Guidance on ETag vs Cryptographic Lineage Proof */}
            <div className="mt-3 flex items-center gap-2 border border-border/60 bg-muted/15 p-3 text-[10px] leading-4 text-muted-foreground">
              <CircleDot className="size-3.5 shrink-0 text-primary" aria-hidden="true" />
              ETag represents storage object identity. Scientific provenance hashes require a verified durable lineage commit.
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
