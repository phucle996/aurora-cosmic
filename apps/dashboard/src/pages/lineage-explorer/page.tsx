/**
 * @file page.tsx
 * @description Main composition page for Lineage Explorer (medallion lakehouse provenance).
 *
 * Composition Layout:
 *  1. Hero Banner: Contextual header with blueprint background and architecture badges.
 *  2. RunnerTicketBar: Live background pipeline worker ticket status.
 *  3. Error Alert: Dynamic warning banner for network or lineage resolution errors.
 *  4. LineageSummaryStrip: Medallion stage inventory cards (Bronze, Silver, Lineage, Gold).
 *  5. LineageFilterToolbar: Product selector, search bar, coverage gauges, and stage filters.
 *  6. ProvenanceLedgerTable & EvidenceInspector: Dual-pane layout showing artifact matrix and 5-step DAG proof inspector.
 */

import { useCallback, useEffect, useMemo, useState, type JSX } from 'react';
import { AlertCircle, GitBranch, Network } from 'lucide-react';

import { apiFetch } from '@/lib/api';
import { EvidenceInspector } from './components/EvidenceInspector';
import { LineageFilterToolbar } from './components/LineageFilterToolbar';
import { LineageSummaryStrip } from './components/LineageSummaryStrip';
import { ProvenanceLedgerTable } from './components/ProvenanceLedgerTable';
import type {
  LineageInventory,
  LineageLedgerResponse,
  LineageRecord,
  ProductKind,
  StageFilter,
} from './types';
import { recordStage } from './utils';

export default function LineageExplorerPage(): JSX.Element {
  // --- Filter & Pagination State ---
  const [productKind, setProductKind] = useState<ProductKind>('lightcurve');
  const [stageFilter, setStageFilter] = useState<StageFilter>('all');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [total, setTotal] = useState(0);

  // --- Data & Selection State ---
  const [records, setRecords] = useState<LineageRecord[]>([]);
  const [selectedIdentity, setSelectedIdentity] = useState<string>();
  const [inventory, setInventory] = useState<LineageInventory>({
    bronze: 0,
    silver: 0,
    lineage: 0,
    gold: 0,
  });

  // --- UI Lifecycle & Clipboard State ---
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [goldError, setGoldError] = useState<string>();
  const [copied, setCopied] = useState<string | null>(null);

  /**
   * Fetches paginated lineage evidence from backend Go API (/api/v1/lineage/ledger).
   * Server performs fast aggregation across Bronze MinIO objects, ClickHouse lineage commits,
   * and Gold analytical research manifests.
   */
  const loadLineage = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(undefined);
    setGoldError(undefined);

    try {
      const params = new URLSearchParams({
        product_kind: productKind,
        page: String(page),
        page_size: String(pageSize),
        stage_filter: stageFilter,
      });

      if (search.trim()) {
        params.set('search', search.trim());
      }

      const response = await apiFetch<LineageLedgerResponse>(
        `/v1/lineage/ledger?${params.toString()}`,
      );

      // Map backend response item structure to frontend LineageRecord
      const mapped: LineageRecord[] = response.items.map((item) => ({
        identity: item.identity,
        ticID: item.tic_id,
        sector: item.sector ?? null,
        productKind: item.product_kind,
        sourceProductID: item.source_product_id,
        bronze: item.bronze,
        silver: item.silver,
        processorVersion: item.processor_version,
        lineageID: item.lineage_id,
        lineage: item.lineage,
        gold: item.gold,
      }));

      setRecords(mapped);
      setTotal(response.total);
      setInventory(response.inventory);

      // Retain active selection if present in the new records set, otherwise default to first item
      setSelectedIdentity((current) =>
        mapped.some((record) => record.identity === current) ? current : mapped[0]?.identity,
      );
    } catch (cause) {
      setRecords([]);
      setTotal(0);
      setInventory({ bronze: 0, silver: 0, lineage: 0, gold: 0 });
      setSelectedIdentity(undefined);
      setError(cause instanceof Error ? cause.message : 'Failed to load lineage evidence');
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, productKind, stageFilter, search]);

  // Refetch when filters or pagination changes
  useEffect(() => {
    void loadLineage();
  }, [loadLineage]);

  /**
   * Computes counts of records per resolved stage for the currently loaded page.
   */
  const counts = useMemo(() => {
    const result: Record<Exclude<StageFilter, 'all'>, number> = {
      bronze: 0,
      silver: 0,
      gold: 0,
    };
    for (const record of records) {
      result[recordStage(record)] += 1;
    }
    return result;
  }, [records]);

  // Active selected record to display in the EvidenceInspector sidebar
  const selected = records.find((record) => record.identity === selectedIdentity) ?? records[0];

  // Derived metrics
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const observedLineage = records.filter((record) => Boolean(record.lineage)).length;
  const observedGold = records.filter((record) => record.gold?.status === 'EXTRACTED').length;

  /**
   * Copies text value to clipboard and resets feedback indicator after 1600ms.
   */
  const copyValue = (value: string, id: string): void => {
    void navigator.clipboard.writeText(value).then(() => {
      setCopied(id);
      window.setTimeout(() => setCopied((current) => (current === id ? null : current)), 1600);
    });
  };

  /**
   * Reset page index to 1 when changing product kind.
   */
  const handleProductKindChange = (kind: ProductKind): void => {
    setProductKind(kind);
    setPage(1);
    setStageFilter('all');
  };

  /**
   * Reset page index to 1 when changing stage filter.
   */
  const handleStageFilterChange = (stage: StageFilter): void => {
    setStageFilter(stage);
    setPage(1);
  };

  /**
   * Reset page index to 1 when changing page size.
   */
  const handlePageSizeChange = (newPageSize: number): void => {
    setPageSize(newPageSize);
    setPage(1);
  };

  return (
    <div className="space-y-5 pb-6">
      {/* 1. Hero Banner with Blueprint Grid */}
      <section className="relative overflow-hidden border border-border/70 bg-card px-4 py-5 shadow-sm sm:px-6">
        <div className="pointer-events-none absolute inset-0 opacity-[0.18] [background-image:linear-gradient(to_right,var(--border)_1px,transparent_1px),linear-gradient(to_bottom,var(--border)_1px,transparent_1px)] [background-size:28px_28px]" />
        <div className="relative flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="min-w-0">
            <div className="mb-3 flex items-center gap-2 font-mono text-[10px] font-medium uppercase tracking-[0.18em] text-primary">
              <GitBranch className="size-4" aria-hidden="true" />
              Provenance Observatory / Immutable Lineage Proofs
            </div>
            <h2 className="font-heading text-2xl font-semibold tracking-tight md:text-3xl">Lineage Explorer</h2>
            <p className="mt-2 max-w-4xl text-sm leading-6 text-muted-foreground">
              Trace end-to-end data provenance for TESS products across Bronze raw ingest, Rust preprocessing, Silver Parquet serialization, and Gold analytical manifests.
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2 border border-primary/25 bg-primary/5 px-3 py-2 font-mono text-[10px] uppercase tracking-[0.12em] text-primary">
            <Network className="size-3.5" aria-hidden="true" />
            Source → Bronze → Silver → Gold
          </div>
        </div>
      </section>

      {/* 2. Network or Resolution Error Alert Banner */}
      {(error || goldError) && (
        <div className="flex items-start gap-3 border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
          <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <div>
            <p className="font-medium">Lineage observation incomplete</p>
            <p className="mt-0.5 text-xs">
              {error ?? `Bronze→Silver evidence remains available; Gold resolver: ${goldError}`}
            </p>
          </div>
        </div>
      )}

      {/* 4. Top KPI Medallion Stat Strip */}
      <LineageSummaryStrip
        inventory={inventory}
        productKind={productKind}
        observedGold={observedGold}
        pageRecordCount={records.length}
      />

      {/* 5. Filter Toolbar: Product Toggle, Search Bar, Gauges, Stage Pills */}
      <LineageFilterToolbar
        productKind={productKind}
        onProductKindChange={handleProductKindChange}
        stageFilter={stageFilter}
        onStageFilterChange={handleStageFilterChange}
        search={search}
        onSearchChange={setSearch}
        loading={loading}
        onRefresh={() => void loadLineage()}
        counts={counts}
        pageRecordCount={records.length}
        observedLineage={observedLineage}
        total={total}
        inventory={inventory}
      />

      {/* 6. Dual-Pane Content: Artifact Identity Matrix Table + 5-step DAG Evidence Inspector */}
      <div className="grid gap-4 xl:grid-cols-12">
        <ProvenanceLedgerTable
          records={records}
          selectedIdentity={selectedIdentity}
          onSelectRecord={setSelectedIdentity}
          productKind={productKind}
          page={page}
          pageSize={pageSize}
          total={total}
          totalPages={totalPages}
          onPageChange={setPage}
          onPageSizeChange={handlePageSizeChange}
          loading={loading}
        />

        <EvidenceInspector
          selected={selected}
          productKind={productKind}
          goldError={goldError}
          copied={copied}
          onCopy={copyValue}
        />
      </div>
    </div>
  );
}
