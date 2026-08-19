import type { JSX } from 'react';
import { ChevronLeft, ChevronRight, RefreshCw } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatBytes, formatDate, StorageListing } from '../types';

interface ObjectBrowserTableProps {
  data: StorageListing | null;
  loading: boolean;
  page: number;
  totalPages: number;
  onPageChange: (newPage: number) => void;
}

export function ObjectBrowserTable({
  data,
  loading,
  page,
  totalPages,
  onPageChange,
}: ObjectBrowserTableProps): JSX.Element {
  const objects = data?.objects ?? [];

  return (
    <div className="space-y-4">
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Object Key (S3 Path)</TableHead>
              <TableHead className="w-[120px]">Kích thước</TableHead>
              <TableHead className="w-[160px]">ETag / Hash</TableHead>
              <TableHead className="w-[200px]">Cập nhật lần cuối</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={4} className="h-32 text-center text-sm text-muted-foreground">
                  <RefreshCw className="size-4 animate-spin inline mr-2" />
                  Đang truy vấn MinIO S3...
                </TableCell>
              </TableRow>
            ) : objects.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="h-32 text-center text-sm text-muted-foreground">
                  Không có đối tượng nào trong prefix này.
                </TableCell>
              </TableRow>
            ) : (
              objects.map((obj) => (
                <TableRow key={obj.key}>
                  <TableCell
                    className="font-mono text-xs font-medium text-foreground truncate max-w-[400px]"
                    title={obj.key}
                  >
                    {obj.key}
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

      {/* Pagination Controls */}
      <div className="flex items-center justify-between border-t border-border/60 pt-3 text-xs text-muted-foreground">
        <span>
          Tổng cộng: <strong className="text-foreground">{data?.total ?? 0}</strong> đối tượng (
          {formatBytes(data?.total_bytes ?? 0)})
        </span>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="h-7 w-7 p-0"
            disabled={page <= 1 || loading}
            onClick={() => onPageChange(page - 1)}
          >
            <ChevronLeft className="size-3.5" />
          </Button>
          <span className="font-mono">
            Trang {page} / {totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            className="h-7 w-7 p-0"
            disabled={page >= totalPages || loading}
            onClick={() => onPageChange(page + 1)}
          >
            <ChevronRight className="size-3.5" />
          </Button>
        </div>
      </div>
    </div>
  );
}
