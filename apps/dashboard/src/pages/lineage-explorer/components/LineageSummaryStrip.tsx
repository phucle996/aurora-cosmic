/**
 * @file LineageSummaryStrip.tsx
 * @description KPI summary strip providing high-level counts across Bronze, Silver, Lineage, and Gold tiers.
 */

import type { JSX } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Database, GitBranch, Layers, ShieldCheck } from 'lucide-react';

import type { LineageInventory, ProductKind } from '../types';
import { PRODUCT_CONFIG } from '../types';

interface StatProps {
  /** Lucide icon displayed in the stat header */
  icon: LucideIcon;
  /** Primary label of the statistic */
  label: string;
  /** Highlighted tabular metric value */
  value: string;
  /** Subtext description providing operational context */
  detail: string;
}

/**
 * Individual KPI card widget.
 */
function Stat({ icon: Icon, label, value, detail }: StatProps): JSX.Element {
  return (
    <div className="min-w-0 border border-border/70 bg-background/45 p-3.5">
      <div className="flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.13em] text-primary">
        <Icon className="size-4 text-primary" aria-hidden="true" />
        {label}
      </div>
      <p className="mt-2 truncate font-mono text-lg font-semibold tabular-nums text-foreground sm:text-xl">
        {value}
      </p>
      <p className="mt-1 truncate text-[11px] text-muted-foreground" title={detail}>
        {detail}
      </p>
    </div>
  );
}

interface LineageSummaryStripProps {
  /** Object inventory aggregates directly from MinIO/ClickHouse backend */
  inventory: LineageInventory;
  /** Currently active telescope product classification */
  productKind: ProductKind;
  /** Number of items on current page verified in Gold research snapshot */
  observedGold: number;
  /** Total number of records rendered on current page */
  pageRecordCount: number;
}

/**
 * LineageSummaryStrip presents the top 4 inventory metrics across medallion layers:
 *  1. Bronze raw FITS objects in lakehouse storage.
 *  2. Silver calibrated Parquet artifacts.
 *  3. Durable SHA-256 lineage commit proofs.
 *  4. Gold analytical manifest resolution percentage.
 */
export function LineageSummaryStrip({
  inventory,
  productKind,
  observedGold,
  pageRecordCount,
}: LineageSummaryStripProps): JSX.Element {
  const kindConfig = PRODUCT_CONFIG[productKind];
  const goldPercentage = pageRecordCount > 0 ? Math.round((observedGold / pageRecordCount) * 100) : 0;

  return (
    <section
      aria-label="Lineage summary"
      className="grid gap-px overflow-hidden border border-border/70 bg-border/70 sm:grid-cols-2 xl:grid-cols-4"
    >
      {/* Metric 1: Bronze raw FITS storage count */}
      <Stat
        icon={Database}
        label="Bronze Inventory"
        value={`${inventory.bronze.toLocaleString()} objects`}
        detail={`${kindConfig.shortLabel} raw source files in storage`}
      />

      {/* Metric 2: Silver Parquet calibrated artifacts count */}
      <Stat
        icon={Layers}
        label="Silver Inventory"
        value={`${inventory.silver.toLocaleString()} artifacts`}
        detail="Parquet segments in silver prefix"
      />

      {/* Metric 3: Immutable lineage commit proofs count */}
      <Stat
        icon={GitBranch}
        label="Durable Lineage"
        value={`${inventory.lineage.toLocaleString()} commits`}
        detail="Immutable SHA-256 provenance proofs"
      />

      {/* Metric 4: Verified Gold analytical manifest readiness */}
      <Stat
        icon={ShieldCheck}
        label="Gold Resolution"
        value={`${observedGold} / ${pageRecordCount}`}
        detail={`${goldPercentage}% of loaded page manifest-ready`}
      />
    </section>
  );
}
