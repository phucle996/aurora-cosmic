import { useEffect, useState } from 'react';
import type { JSX } from 'react';
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, Eye, RefreshCw } from 'lucide-react';
import { Link } from 'react-router-dom';

import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatBytes, formatDate, StorageListing } from '../types';

interface ObjectBrowserTableProps {
  data: StorageListing | null;
  loading: boolean;
  page: number;
  totalPages: number;
  onPageChange: (newPage: number) => void;
  linkForObject?: (key: string) => string | undefined;
}

export function ObjectBrowserTable({
  data,
  loading,
  page,
  totalPages,
  onPageChange,
  linkForObject,
}: ObjectBrowserTableProps): JSX.Element {
  const objects = data?.objects ?? [];
  const [jumpPage, setJumpPage] = useState(String(page));

  useEffect(() => {
    setJumpPage(String(page));
  }, [page]);

  const handleJumpSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = parseInt(jumpPage, 10);
    if (!isNaN(parsed) && parsed >= 1 && parsed <= totalPages && parsed !== page) {
      onPageChange(parsed);
    } else {
      setJumpPage(String(page));
    }
  };

  return (
    <div>
      <div className="overflow-x-auto">
        <Table className="min-w-[48rem]">
          <TableHeader>
            <TableRow className="bg-muted/20">
              <TableHead className="font-mono text-[10px] uppercase tracking-[0.08em]">Object key / S3 path</TableHead>
              <TableHead className="w-[120px] font-mono text-[10px] uppercase tracking-[0.08em]">Bytes</TableHead>
              <TableHead className="w-[160px] font-mono text-[10px] uppercase tracking-[0.08em]">ETag</TableHead>
              <TableHead className="w-[200px] font-mono text-[10px] uppercase tracking-[0.08em]">Modified</TableHead>
              <TableHead className="w-[110px] text-right font-mono text-[10px] uppercase tracking-[0.08em]">Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={5} className="h-32 text-center text-sm text-muted-foreground">
                  <RefreshCw className="mr-2 inline size-4 animate-spin" />
                  Querying MinIO object catalog…
                </TableCell>
              </TableRow>
            ) : objects.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="h-32 text-center text-sm text-muted-foreground">
                  No objects found in current prefix.
                </TableCell>
              </TableRow>
            ) : (
              objects.map((obj) => {
                const targetUrl = linkForObject?.(obj.key) ?? `/lakehouse/inspector?key=${encodeURIComponent(obj.key)}`;
                return (
                  <TableRow key={obj.key} className="hover:bg-muted/30">
                    <TableCell
                      className="max-w-[420px] truncate font-mono text-[11px] font-medium text-foreground"
                      title={obj.key}
                    >
                      <Link
                        to={targetUrl}
                        className="text-left text-primary hover:underline font-mono truncate max-w-full inline-block"
                      >
                        {obj.key}
                      </Link>
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {formatBytes(obj.size_bytes)}
                    </TableCell>
                    <TableCell
                      className="font-mono text-[11px] text-muted-foreground truncate max-w-[140px]"
                      title={obj.etag}
                    >
                      {obj.etag ? obj.etag.replace(/"/g, '') : '—'}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {formatDate(obj.last_modified)}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        asChild
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2 font-mono text-[11px] gap-1 text-primary hover:text-primary hover:bg-primary/10"
                      >
                        <Link to={targetUrl} title="Inspect object in dedicated page">
                          <Eye className="size-3.5" />
                          Inspect
                        </Link>
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      <div className="flex flex-col gap-3 border-t border-border/60 px-4 py-3 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
        <span className="font-mono text-[10px] uppercase tracking-[0.08em]">
          <strong className="font-medium text-foreground">{(data?.total ?? objects.length).toLocaleString()}</strong> objects · {formatBytes(data?.total_bytes ?? 0)}
        </span>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="h-7 w-7 rounded-none p-0"
            disabled={page <= 1 || loading}
            onClick={() => onPageChange(1)}
            title="First page"
            aria-label="First object page"
          >
            <ChevronsLeft className="size-3.5" />
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-7 w-7 rounded-none p-0"
            disabled={page <= 1 || loading}
            onClick={() => onPageChange(page - 1)}
            title="Previous page"
            aria-label="Previous object page"
          >
            <ChevronLeft className="size-3.5" />
          </Button>

          <form onSubmit={handleJumpSubmit} className="flex items-center gap-1 font-mono text-[10px] uppercase">
            <span>Page</span>
            <input
              type="number"
              min={1}
              max={Math.max(1, totalPages)}
              value={jumpPage}
              onChange={(e) => setJumpPage(e.target.value)}
              onBlur={handleJumpSubmit}
              className="h-6 w-12 rounded border border-border bg-background px-1 text-center font-mono text-xs text-foreground focus:border-primary focus:outline-none"
              title="Enter page number to jump"
            />
            <span>/ {Math.max(1, totalPages)}</span>
          </form>

          <Button
            variant="outline"
            size="sm"
            className="h-7 w-7 rounded-none p-0"
            disabled={page >= totalPages || loading}
            onClick={() => onPageChange(page + 1)}
            title="Next page"
            aria-label="Next object page"
          >
            <ChevronRight className="size-3.5" />
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-7 w-7 rounded-none p-0"
            disabled={page >= totalPages || loading}
            onClick={() => onPageChange(totalPages)}
            title="Last page"
            aria-label="Last object page"
          >
            <ChevronsRight className="size-3.5" />
          </Button>
        </div>
      </div>
    </div>
  );
}
