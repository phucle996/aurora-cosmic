import React, { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatBytes, formatDate, statusVariant, type IngestProduct } from '../types';

interface IngestProductTableSectionProps {
  products?: IngestProduct[];
}

export const IngestProductTableSection: React.FC<IngestProductTableSectionProps> = ({ products = [] }) => {
  const [productFilter, setProductFilter] = useState<'all' | 'completed' | 'downloading' | 'failed'>('all');
  const [searchQuery, setSearchQuery] = useState('');

  const filteredProducts = useMemo(() => {
    return products.filter((p) => {
      if (productFilter === 'completed' && p.state !== 'completed' && p.state !== 'published') return false;
      if (productFilter === 'downloading' && p.state !== 'downloading' && p.state !== 'running') return false;
      if (productFilter === 'failed' && p.state !== 'failed') return false;
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase();
        return (
          p.id.toLowerCase().includes(query) ||
          p.object_key.toLowerCase().includes(query) ||
          p.kind.toLowerCase().includes(query)
        );
      }
      return true;
    });
  }, [products, productFilter, searchQuery]);

  return (
    <Card className="overflow-hidden rounded-none border-border/80 shadow-none">
      <CardHeader className="border-b border-border/60 p-4 sm:p-5">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-primary">
              Evidence ledger / current run
            </p>
            <CardTitle className="mt-1 text-lg">FITS product observations</CardTitle>
            <CardDescription>
              Target product checkpoint records, filterable by execution lifecycle state.
            </CardDescription>
          </div>
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
            <div className="relative min-w-0 flex-1 sm:w-64">
              <Search className="absolute left-2.5 top-2.5 size-3.5 text-muted-foreground" />
              <Input
                placeholder="Search TIC ID or object key..."
                className="h-8 w-full pl-8 text-xs"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
            <div className="flex flex-wrap gap-1 border border-border/60 bg-muted/20 p-1 text-xs">
              {(
                [
                  ['all', `All ${products.length}`],
                  ['completed', 'Complete'],
                  ['downloading', 'Active'],
                  ['failed', 'Failed'],
                ] as const
              ).map(([filter, label]) => (
                <button
                  key={filter}
                  type="button"
                  className={`rounded-sm px-2.5 py-1.5 transition-colors ${
                    productFilter === filter
                      ? 'bg-primary text-primary-foreground'
                      : 'text-muted-foreground hover:bg-background hover:text-foreground'
                  }`}
                  onClick={() => setProductFilter(filter)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <Table className="min-w-[760px]">
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="min-w-[320px] pl-5 font-mono text-[10px] uppercase tracking-wider">
                  Product / FITS file
                </TableHead>
                <TableHead>Kind</TableHead>
                <TableHead>State</TableHead>
                <TableHead className="text-right">Size</TableHead>
                <TableHead className="text-center">Attempts</TableHead>
                <TableHead className="pr-5 text-right">Observed at</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredProducts.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="h-32 text-center text-sm text-muted-foreground">
                    {products.length === 0
                      ? 'No product observations recorded yet. Launch a run to begin acquisition.'
                      : 'No products match the selected filter.'}
                  </TableCell>
                </TableRow>
              ) : (
                filteredProducts.slice(0, 50).map((product) => {
                  const ticMatch = product.id.match(/-(\d{8,16})-/);
                  const ticNum = ticMatch ? ticMatch[1].replace(/^0+/, '') : null;
                  return (
                    <TableRow key={product.id} className="hover:bg-muted/35">
                      <TableCell className="pl-5 font-mono text-xs">
                        <div className="flex min-w-0 items-center gap-2">
                          {ticNum && (
                            <Badge
                              variant="outline"
                              className="shrink-0 rounded-none border-primary/25 bg-primary/10 font-mono text-[10px] text-primary"
                            >
                              TIC {ticNum}
                            </Badge>
                          )}
                          <span className="truncate" title={product.id}>
                            {product.id}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="rounded-none font-mono text-[10px]">
                          {product.kind}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant={statusVariant(product.state)} className="rounded-none font-mono text-[10px]">
                          {product.state}
                        </Badge>
                        {product.last_error && (
                          <p className="mt-1 max-w-[180px] truncate text-[10px] text-destructive" title={product.last_error}>
                            {product.last_error}
                          </p>
                        )}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs">
                        {product.size_bytes > 0 || product.expected_size_bytes > 0
                          ? formatBytes(product.size_bytes > 0 ? product.size_bytes : product.expected_size_bytes)
                          : '—'}
                      </TableCell>
                      <TableCell className="text-center font-mono text-xs">
                        {product.attempts}
                      </TableCell>
                      <TableCell className="pr-5 text-right font-mono text-xs text-muted-foreground">
                        {formatDate(product.updated_at)}
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>
        {filteredProducts.length > 50 && (
          <p className="border-t border-border/60 px-4 py-3 text-center text-xs text-muted-foreground">
            Showing 50 of {filteredProducts.length} observed products.
          </p>
        )}
      </CardContent>
    </Card>
  );
};
