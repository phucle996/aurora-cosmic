import type { JSX } from 'react';
import { ChevronLeft, ChevronRight, RefreshCw } from 'lucide-react';
import { Link } from 'react-router-dom';

import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatBytes, formatDate, StorageListing } from '@/features/datasets/types';

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
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={4} className="h-32 text-center text-sm text-muted-foreground">
                  <RefreshCw className="mr-2 inline size-4 animate-spin" />
                  Querying MinIO object catalog…
                </TableCell>
              </TableRow>
            ) : objects.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="h-32 text-center text-sm text-muted-foreground">
                  Không có object trong prefix hiện tại.
                </TableCell>
              </TableRow>
            ) : (
              objects.map((obj) => (
                <TableRow key={obj.key} className={linkForObject?.(obj.key) ? 'cursor-pointer' : undefined}>
                  <TableCell
                    className="max-w-[400px] truncate font-mono text-[11px] font-medium text-foreground"
                    title={obj.key}
                  >
                    {linkForObject?.(obj.key) ? (
                      <Link to={linkForObject(obj.key)!} className="text-primary hover:underline">
                        {obj.key}
                      </Link>
                    ) : obj.key}
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
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <div className="flex flex-col gap-3 border-t border-border/60 px-4 py-3 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
        <span className="font-mono text-[10px] uppercase tracking-[0.08em]">
          <strong className="font-medium text-foreground">{(data?.total ?? 0).toLocaleString()}</strong> objects · {formatBytes(data?.total_bytes ?? 0)}
        </span>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="h-7 w-7 rounded-none p-0"
            disabled={page <= 1 || loading}
            onClick={() => onPageChange(page - 1)}
            aria-label="Previous object page"
          >
            <ChevronLeft className="size-3.5" />
          </Button>
          <span className="min-w-20 text-center font-mono text-[10px] uppercase">
            Page {page} / {totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            className="h-7 w-7 rounded-none p-0"
            disabled={page >= totalPages || loading}
            onClick={() => onPageChange(page + 1)}
            aria-label="Next object page"
          >
            <ChevronRight className="size-3.5" />
          </Button>
        </div>
      </div>
    </div>
  );
}
