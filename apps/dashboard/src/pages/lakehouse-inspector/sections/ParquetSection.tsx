import { useMemo, useState } from 'react';
import type { JSX } from 'react';
import {
  ChevronDown,
  ChevronUp,
  Database,
  FileSearch,
  Filter,
  Rows3,
  Search,
} from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatBytes, type StorageParquetPreview } from '../../lakehouse/types';

interface ParquetSectionProps {
  parquet: StorageParquetPreview;
  sizeBytes: number;
  page: number;
  pageSize: number;
  search: string;
  loading: boolean;
  onSearchChange: (search: string) => void;
  onSearchSubmit: (e: React.FormEvent) => void;
  onPageChange: (newPage: number) => void;
}

function cellValue(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function compareValues(left: unknown, right: unknown, direction: 'asc' | 'desc'): number {
  const leftNum = typeof left === 'number' ? left : Number(left);
  const rightNum = typeof right === 'number' ? right : Number(right);
  const comp =
    Number.isFinite(leftNum) && Number.isFinite(rightNum)
      ? leftNum - rightNum
      : cellValue(left).localeCompare(cellValue(right), undefined, { numeric: true, sensitivity: 'base' });
  return direction === 'asc' ? comp : -comp;
}

export function ParquetSection({
  parquet,
  sizeBytes,
  page,
  pageSize,
  search,
  loading,
  onSearchChange,
  onSearchSubmit,
  onPageChange,
}: ParquetSectionProps): JSX.Element {
  const [schemaOpen, setSchemaOpen] = useState(false);
  const [sortColumn, setSortColumn] = useState<string>();
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');

  const sortedRows = useMemo(() => {
    const rows = [...(parquet.rows ?? [])];
    if (!sortColumn) return rows;
    return rows.sort((a, b) => compareValues(a[sortColumn], b[sortColumn], sortDirection));
  }, [parquet.rows, sortColumn, sortDirection]);

  const toggleSort = (colName: string) => {
    if (sortColumn === colName) {
      setSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'));
      return;
    }
    setSortColumn(colName);
    setSortDirection('asc');
  };

  return (
    <div className="space-y-6">
      {/* Summary Metrics */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <Card className="rounded-none border-border/60">
          <CardHeader className="p-4 pb-1">
            <CardDescription className="text-xs uppercase font-mono tracking-wider">Total Rows</CardDescription>
            <CardTitle className="text-xl font-mono flex items-center gap-2 mt-1">
              <Rows3 className="size-4 text-primary" />
              {parquet.total_rows.toLocaleString()}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card className="rounded-none border-border/60">
          <CardHeader className="p-4 pb-1">
            <CardDescription className="text-xs uppercase font-mono tracking-wider">Columns</CardDescription>
            <CardTitle className="text-xl font-mono flex items-center gap-2 mt-1">
              <FileSearch className="size-4 text-primary" />
              {parquet.columns.length}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card className="rounded-none border-border/60">
          <CardHeader className="p-4 pb-1">
            <CardDescription className="text-xs uppercase font-mono tracking-wider">Matched Rows</CardDescription>
            <CardTitle className="text-xl font-mono flex items-center gap-2 mt-1">
              <Filter className="size-4 text-primary" />
              {parquet.matched_rows.toLocaleString()}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card className="rounded-none border-border/60">
          <CardHeader className="p-4 pb-1">
            <CardDescription className="text-xs uppercase font-mono tracking-wider">File Size</CardDescription>
            <CardTitle className="text-xl font-mono flex items-center gap-2 mt-1">
              <Database className="size-4 text-primary" />
              {formatBytes(sizeBytes)}
            </CardTitle>
          </CardHeader>
        </Card>
      </div>

      {/* Collapsible Schema */}
      <Collapsible open={schemaOpen} onOpenChange={setSchemaOpen} className="border border-border/70 rounded-none bg-card">
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-border/40">
          <div>
            <h4 className="text-xs font-semibold uppercase tracking-wider text-foreground font-mono">
              Real Parquet Physical Schema
            </h4>
            <p className="text-xs text-muted-foreground mt-0.5">
              Extracted directly from Parquet metadata footer ({parquet.columns.length} physical columns)
            </p>
          </div>
          <CollapsibleTrigger asChild>
            <Button variant="ghost" size="sm" className="h-8 text-xs gap-1 font-mono">
              {schemaOpen ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
              {schemaOpen ? 'Hide Schema' : 'Inspect Schema'}
            </Button>
          </CollapsibleTrigger>
        </div>
        <CollapsibleContent>
          <div className="max-h-80 overflow-y-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/30">
                  <TableHead className="font-mono text-[10px] uppercase">Column</TableHead>
                  <TableHead className="font-mono text-[10px] uppercase">Physical Type</TableHead>
                  <TableHead className="font-mono text-[10px] uppercase">Nullable</TableHead>
                  <TableHead className="font-mono text-[10px] uppercase">Repeated</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {parquet.columns.map((col) => (
                  <TableRow key={col.path}>
                    <TableCell className="font-mono text-xs font-medium">{col.name}</TableCell>
                    <TableCell>
                      <Badge variant="secondary" className="font-mono text-[10px]">
                        {col.type}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">{col.nullable ? 'yes' : 'no'}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{col.repeated ? 'yes' : 'no'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CollapsibleContent>
      </Collapsible>

      {/* Data Rows Search & Full-Width Table */}
      <Card className="rounded-none border-border/70">
        <CardHeader className="p-4 border-b border-border/60 pb-3">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <CardTitle className="text-base font-semibold">Parquet Data Preview</CardTitle>
              <CardDescription className="text-xs">
                Showing {pageSize} rows per page. Click column headers to sort.
              </CardDescription>
            </div>
            <form onSubmit={onSearchSubmit} className="flex items-center gap-2 max-w-sm">
              <Input
                placeholder="Search records / TIC ID…"
                value={search}
                onChange={(e) => onSearchChange(e.target.value)}
                className="h-8 text-xs font-mono"
              />
              <Button type="submit" size="sm" variant="secondary" className="h-8 px-3">
                <Search className="size-3.5" />
              </Button>
            </form>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto max-h-[580px]">
            <Table className="min-w-max">
              <TableHeader>
                <TableRow className="bg-muted/30 sticky top-0 z-10">
                  <TableHead className="w-12 font-mono text-[10px] sticky left-0 bg-background z-20">#</TableHead>
                  {parquet.columns.map((col) => (
                    <TableHead key={col.path} className="font-mono text-[11px] whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() => toggleSort(col.path)}
                        className="flex items-center gap-1 font-semibold hover:text-primary transition-colors"
                      >
                        {col.name}
                        {sortColumn === col.path &&
                          (sortDirection === 'asc' ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />)}
                      </button>
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedRows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={parquet.columns.length + 1} className="h-32 text-center text-sm text-muted-foreground">
                      No records match the current query.
                    </TableCell>
                  </TableRow>
                ) : (
                  sortedRows.map((row, idx) => (
                    <TableRow key={`${parquet.offset}-${idx}`} className="hover:bg-muted/20">
                      <TableCell className="font-mono text-xs text-muted-foreground sticky left-0 bg-background z-10">
                        {(parquet.offset ?? 0) + idx + 1}
                      </TableCell>
                      {parquet.columns.map((col) => (
                        <TableCell
                          key={col.path}
                          className="font-mono text-xs max-w-64 truncate"
                          title={cellValue(row[col.path])}
                        >
                          {cellValue(row[col.path])}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>

          {/* Pagination Controls */}
          <div className="flex flex-col sm:flex-row items-center justify-between p-3.5 border-t border-border/60 bg-muted/10 text-xs gap-2">
            <span className="text-muted-foreground tabular-nums font-mono">
              Showing {(parquet.offset ?? 0) + 1}–
              {Math.min((parquet.offset ?? 0) + parquet.rows.length, parquet.matched_rows)} of{' '}
              {parquet.matched_rows.toLocaleString()} matched rows
            </span>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs font-mono"
                disabled={page === 0 || loading}
                onClick={() => onPageChange(page - 1)}
              >
                Prev
              </Button>
              <span className="font-mono text-xs px-2 text-muted-foreground tabular-nums">
                Page {page + 1} / {Math.max(1, Math.ceil(parquet.matched_rows / pageSize))}
              </span>
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs font-mono"
                disabled={(page + 1) * pageSize >= parquet.matched_rows || loading}
                onClick={() => onPageChange(page + 1)}
              >
                Next
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
