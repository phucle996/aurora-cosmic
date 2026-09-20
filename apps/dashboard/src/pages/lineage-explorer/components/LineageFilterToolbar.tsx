/**
 * @file LineageFilterToolbar.tsx
 * @description Controls toolbar for product kind switching, search, stage filtering, and stage coverage visualization.
 */

import type { JSX } from 'react';
import { RefreshCw, Search } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { LineageInventory, ProductKind, StageFilter } from '../types';
import { PRODUCT_CONFIG, STAGE_LABELS } from '../types';

interface LineageFilterToolbarProps {
  /** Currently selected product kind (lightcurve | target-pixel) */
  productKind: ProductKind;
  /** Callback fired when user changes product kind */
  onProductKindChange: (kind: ProductKind) => void;

  /** Active stage filter */
  stageFilter: StageFilter;
  /** Callback fired when user selects a stage filter pill */
  onStageFilterChange: (stage: StageFilter) => void;

  /** Current search query string */
  search: string;
  /** Callback fired when search query updates */
  onSearchChange: (search: string) => void;

  /** Whether the ledger is currently fetching data from backend */
  loading: boolean;
  /** Manual trigger to refresh lineage ledger */
  onRefresh: () => void;

  /** Breakdown of records on the current page per resolved stage */
  counts: Record<Exclude<StageFilter, 'all'>, number>;
  /** Total number of records on the current page */
  pageRecordCount: number;
  /** Number of records having a verified lineage commit */
  observedLineage: number;
  /** Total record count matching the current filters */
  total: number;
  /** Global inventory counts */
  inventory: LineageInventory;
}

/**
 * LineageFilterToolbar provides:
 *  - Visual progress indicators of stage progression for the loaded dataset.
 *  - Primary navigation tabs between Light Curves and Target Pixel Files.
 *  - Instant search filtering by TIC, source identifier, or object keys.
 *  - Quick stage filtering pills (All, Bronze only, Silver anomaly, Committed, Gold).
 */
export function LineageFilterToolbar({
  productKind,
  onProductKindChange,
  stageFilter,
  onStageFilterChange,
  search,
  onSearchChange,
  loading,
  onRefresh,
  counts,
  pageRecordCount,
  observedLineage,
  total,
  inventory,
}: LineageFilterToolbarProps): JSX.Element {
  return (
    <section className="border border-border/70 bg-card">
      {/* Upper Section: Stage Progress & Coverage Gauges */}
      <div className="flex flex-col gap-4 border-b border-border/60 p-4 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <p className="font-mono text-[9px] uppercase tracking-[0.15em] text-primary">
            Evidence coverage / loaded page
          </p>
          <h3 className="mt-1 text-sm font-semibold text-foreground">
            Identity-resolved provenance
          </h3>
          <p className="mt-1 text-xs text-muted-foreground">
            {pageRecordCount === 0
              ? 'No products observed on this page.'
              : `${observedLineage}/${pageRecordCount} products have lineage commits matching source identity and processor version.`}
          </p>
        </div>

        {/* Coverage Bars for Bronze, Silver, Gold - Interactive Filter Triggers */}
        <div className="grid min-w-0 flex-1 gap-1 sm:grid-cols-3 xl:max-w-xl">
          {(['bronze', 'silver', 'gold'] as const).map((stage) => {
            const count = counts[stage];
            const percentage = pageRecordCount ? (count / pageRecordCount) * 100 : 0;
            const isActive = stageFilter === stage;
            return (
              <button
                key={stage}
                type="button"
                onClick={() => onStageFilterChange(isActive ? 'all' : stage)}
                title={`Filter by ${STAGE_LABELS[stage]} (click to toggle)`}
                className={`border p-2 text-left transition-all ${
                  isActive
                    ? 'border-primary bg-primary/10 shadow-[inset_0_0_0_1px_hsl(var(--primary))]'
                    : 'border-border/60 bg-muted/15 hover:border-primary/50 hover:bg-muted/30'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span
                    className={`font-mono text-[9px] uppercase tracking-wider ${
                      isActive ? 'font-semibold text-primary' : 'text-muted-foreground'
                    }`}
                  >
                    {STAGE_LABELS[stage]}
                  </span>
                  <strong className="font-mono text-xs tabular-nums text-foreground">
                    {count}
                  </strong>
                </div>
                <div className="mt-2 h-1 bg-muted">
                  <div
                    className="h-full bg-primary transition-all duration-300"
                    style={{ width: `${percentage}%` }}
                  />
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Middle Section: Product Kind Selector + Search + Refresh */}
      <div className="flex flex-col gap-3 p-4 lg:flex-row lg:items-center lg:justify-between">
        {/* Product Kind Tabs */}
        <div className="flex flex-wrap gap-1 border border-border/60 bg-muted/15 p-1">
          {(Object.entries(PRODUCT_CONFIG) as Array<[ProductKind, (typeof PRODUCT_CONFIG)[ProductKind]]>).map(
            ([kind, config]) => (
              <button
                key={kind}
                type="button"
                onClick={() => onProductKindChange(kind)}
                className={`px-3 py-1.5 font-mono text-[10px] uppercase tracking-wider transition-colors ${
                  productKind === kind
                    ? 'bg-primary text-primary-foreground font-semibold'
                    : 'text-muted-foreground hover:bg-background hover:text-foreground'
                }`}
              >
                {config.label}
              </button>
            ),
          )}
        </div>

        {/* Search Field & Resync Button */}
        <div className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row lg:max-w-3xl lg:justify-end">
          <div className="relative min-w-0 flex-1 sm:max-w-sm">
            <Search className="absolute left-2.5 top-2.5 size-3.5 text-muted-foreground" aria-hidden="true" />
            <Input
              value={search}
              onChange={(event) => onSearchChange(event.target.value)}
              placeholder="Search TIC, source, object key, lineage ID…"
              className="h-8 rounded-none pl-8 text-xs font-mono"
            />
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={onRefresh}
            disabled={loading}
            className="rounded-none font-mono text-[10px] uppercase tracking-wider"
          >
            <RefreshCw className={`size-3.5 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
            Resync evidence
          </Button>
        </div>
      </div>

      {/* Lower Section: Stage Filter Quick Pills */}
      <div className="flex flex-wrap gap-1 border-t border-border/60 px-4 py-3">
        {(
          [
            ['all', `All (${stageFilter === 'all' ? total : inventory.bronze})`],
            ['bronze', `Bronze only (${counts.bronze})`],
            ['silver', `Silver (${counts.silver})`],
            ['gold', `Gold verified (${inventory.gold})`],
          ] as Array<[StageFilter, string]>
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => onStageFilterChange(value)}
            className={`border px-2.5 py-1 font-mono text-[9px] uppercase tracking-wider transition-colors ${
              stageFilter === value
                ? 'border-primary bg-primary text-primary-foreground font-semibold'
                : 'border-border/60 text-muted-foreground hover:border-primary/50 hover:text-foreground'
            }`}
          >
            {label}
          </button>
        ))}
        <span className="ml-auto self-center text-[10px] text-muted-foreground">
          Server-side verified provenance
        </span>
      </div>
    </section>
  );
}
