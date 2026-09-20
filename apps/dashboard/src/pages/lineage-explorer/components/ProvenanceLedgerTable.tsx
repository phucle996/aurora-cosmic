/**
 * @file ProvenanceLedgerTable.tsx
 * @description Tabular matrix displaying joined Bronze, Silver, Lineage, and Gold evidence per TESS artifact.
 */

import type { JSX } from 'react';
import { ChevronLeft, ChevronRight, FileCheck2, LoaderCircle, ShieldCheck } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { LineageRecord, ProductKind } from '../types';
import { PRODUCT_CONFIG } from '../types';
import { formatBytes, short } from '../utils';

interface ProvenanceLedgerTableProps {
  /** Lineage records loaded on the current page */
  records: LineageRecord[];
  /** Currently selected record identity */
  selectedIdentity?: string;
  /** Callback fired when a table row is clicked or activated */
  onSelectRecord: (identity: string) => void;

  /** Active product classification for short labels */
  productKind: ProductKind;

  /** Current page index (1-based) */
  page: number;
  /** Number of items displayed per page */
  pageSize: number;
  /** Total matching records across all pages */
  total: number;
  /** Total calculated pages */
  totalPages: number;

  /** Callback fired when user changes page index */
  onPageChange: (newPage: number) => void;
  /** Callback fired when user changes page size */
  onPageSizeChange: (newPageSize: number) => void;

  /** Loading indicator during network fetch */
  loading: boolean;
}

/**
 * ProvenanceLedgerTable renders the core artifact identity matrix:
 *  - Joins raw NASA MAST Bronze inputs with preprocessed Silver Parquet files.
 *  - Displays immutable cryptographic commit status.
 *  - Exposes server-side pagination with selectable page size (10/25/50).
 */
export function ProvenanceLedgerTable({
  records,
  selectedIdentity,
  onSelectRecord,
  productKind,
  page,
  pageSize,
  total,
  totalPages,
  onPageChange,
  onPageSizeChange,
  loading,
}: ProvenanceLedgerTableProps): JSX.Element {
  const kindConfig = PRODUCT_CONFIG[productKind];

  return (
    <Card className="overflow-hidden rounded-none border-border/70 shadow-none xl:col-span-7 2xl:col-span-8">
      {/* Table Header with page indicator */}
      <CardHeader className="border-b border-border/60 p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="font-mono text-[9px] uppercase tracking-[0.15em] text-primary">
              Provenance ledger
            </p>
            <CardTitle className="mt-1 text-base font-semibold text-foreground">
              Artifact identity matrix
            </CardTitle>
          </div>
          <Badge variant="outline" className="rounded-none font-mono text-[9px] uppercase tracking-wider text-muted-foreground">
            {total.toLocaleString()} products
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="p-0">
        <Table className="min-w-[940px]">
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="w-[190px] pl-4 font-mono text-[9px] uppercase tracking-wider">
                Target / source
              </TableHead>
              <TableHead className="font-mono text-[9px] uppercase tracking-wider">
                Bronze evidence
              </TableHead>
              <TableHead className="font-mono text-[9px] uppercase tracking-wider">
                Silver artifact
              </TableHead>
              <TableHead className="pr-4 font-mono text-[9px] uppercase tracking-wider">
                Gold resolution
              </TableHead>
            </TableRow>
          </TableHeader>

          <TableBody>
            {/* Case 1: Initial Loading with no cached records */}
            {loading && records.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="h-40 text-center">
                  <LoaderCircle className="mx-auto size-5 animate-spin text-primary" aria-hidden="true" />
                  <p className="mt-2 text-xs text-muted-foreground">Joining persisted evidence…</p>
                </TableCell>
              </TableRow>
            ) : records.length === 0 ? (
              /* Case 2: Empty Result */
              <TableRow>
                <TableCell colSpan={4} className="h-40 text-center text-sm text-muted-foreground">
                  No products match the selected filters on this page.
                </TableCell>
              </TableRow>
            ) : (
              /* Case 3: Render Ledger Rows */
              records.map((record) => {
                const active = selectedIdentity === record.identity;

                return (
                  <TableRow
                    key={record.identity}
                    tabIndex={0}
                    aria-selected={active}
                    onClick={() => onSelectRecord(record.identity)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        onSelectRecord(record.identity);
                      }
                    }}
                    className={`cursor-pointer transition-colors ${
                      active ? 'bg-primary/5 shadow-[inset_3px_0_0_hsl(var(--primary))]' : ''
                    }`}
                  >
                    {/* Column 1: Target / Source Identifiers */}
                    <TableCell className="pl-4">
                      <p className="font-mono text-xs font-semibold text-foreground">
                        TIC {record.ticID}
                      </p>
                      <p className="mt-1 font-mono text-[10px] text-muted-foreground">
                        sector {record.sector ?? '—'} · {kindConfig.shortLabel}
                      </p>
                      <p
                        className="mt-1 max-w-[180px] truncate font-mono text-[9px] text-muted-foreground"
                        title={record.sourceProductID}
                      >
                        {record.sourceProductID}
                      </p>
                    </TableCell>

                    {/* Column 2: Raw Bronze FITS Storage Proof */}
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <FileCheck2 className="size-3.5 text-emerald-500" aria-hidden="true" />
                        <span className="font-mono text-[10px]">
                          {formatBytes(record.bronze.size_bytes)}
                        </span>
                      </div>
                      <p
                        className="mt-1 max-w-[170px] truncate font-mono text-[9px] text-muted-foreground"
                        title={record.bronze.key}
                      >
                        {record.bronze.key}
                      </p>
                    </TableCell>

                    {/* Column 3: Calibrated Silver Parquet Artifact */}
                    <TableCell>
                      {record.silver ? (
                        <>
                          <div className="flex items-center gap-2">
                            <FileCheck2 className="size-3.5 text-sky-500" aria-hidden="true" />
                            <span className="font-mono text-[10px]">
                              {formatBytes(record.silver.size_bytes)}
                            </span>
                          </div>
                          <p className="mt-1 font-mono text-[9px] text-muted-foreground">
                            {record.processorVersion}
                          </p>
                        </>
                      ) : (
                        <span className="font-mono text-[10px] text-muted-foreground">
                          NO MATCHED OBJECT
                        </span>
                      )}
                    </TableCell>

                    {/* Column 4: Gold Resolution Manifest */}
                    <TableCell className="pr-4">
                      {record.gold?.status === 'EXTRACTED' ? (
                        <>
                          <div className="flex items-center gap-2">
                            <ShieldCheck className="size-3.5 text-violet-500" aria-hidden="true" />
                            <span className="font-mono text-[10px] font-medium text-violet-600 dark:text-violet-300">
                              EXTRACTED
                            </span>
                          </div>
                          <p
                            className="mt-1 max-w-[180px] truncate font-mono text-[9px] text-muted-foreground"
                            title={record.gold.snapshot_id}
                          >
                            {record.gold.snapshot_id ? short(record.gold.snapshot_id, 18) : 'Manifest linked'}
                          </p>
                        </>
                      ) : (
                        <span className="font-mono text-[10px] text-muted-foreground">
                          NOT IN MANIFEST
                        </span>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>

        {/* Pagination Footer */}
        <div className="flex flex-col gap-3 border-t border-border/60 bg-muted/10 p-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-[11px] text-muted-foreground">
            {total === 0
              ? '0 objects'
              : `Objects ${(page - 1) * pageSize + 1}–${Math.min(page * pageSize, total)} / ${total.toLocaleString()}`}
          </p>
          <div className="flex items-center gap-2">
            {/* Page Size Selector */}
            <select
              value={pageSize}
              onChange={(event) => onPageSizeChange(Number(event.target.value))}
              className="h-8 rounded-none border border-border bg-background px-2 font-mono text-[10px]"
              aria-label="Objects per page"
            >
              <option value={10}>10 / page</option>
              <option value={25}>25 / page</option>
              <option value={50}>50 / page</option>
            </select>

            {/* Previous Page Button */}
            <Button
              variant="outline"
              size="icon-sm"
              className="rounded-none"
              disabled={page <= 1 || loading}
              onClick={() => onPageChange(Math.max(1, page - 1))}
              title="Previous page"
            >
              <ChevronLeft className="size-3.5" aria-hidden="true" />
            </Button>

            {/* Current Page Indicator */}
            <span className="min-w-14 text-center font-mono text-[10px]">
              {page} / {totalPages}
            </span>

            {/* Next Page Button */}
            <Button
              variant="outline"
              size="icon-sm"
              className="rounded-none"
              disabled={page >= totalPages || loading}
              onClick={() => onPageChange(Math.min(totalPages, page + 1))}
              title="Next page"
            >
              <ChevronRight className="size-3.5" aria-hidden="true" />
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
