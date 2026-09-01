import type { JSX } from 'react';
import { ChevronDown } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

import type { SchemaCatalog } from '@/features/datasets/types';

type SchemaCatalogCardProps = {
  catalog: SchemaCatalog;
};

export function SchemaCatalogCard({ catalog }: SchemaCatalogCardProps): JSX.Element {
  return (
    <details className="group border border-border/80 bg-card">
      <summary className="flex cursor-pointer list-none flex-col gap-3 p-4 marker:content-none sm:flex-row sm:items-center sm:justify-between sm:p-5 [&::-webkit-details-marker]:hidden">
        <div className="min-w-0">
          <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-primary">Schema catalog / {catalog.columns.length} fields</p>
          <h3 className="mt-1 text-base font-semibold text-foreground">{catalog.title}</h3>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">{catalog.description}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Badge variant="outline" className="max-w-[14rem] truncate rounded-none font-mono text-[9px]" title={catalog.schemaVersion}>{catalog.schemaVersion}</Badge>
          <span className="flex size-8 items-center justify-center border border-border/70 text-muted-foreground"><ChevronDown className="size-4 transition-transform group-open:rotate-180" /></span>
        </div>
      </summary>
      <div className="border-t border-border/60">
        {catalog.note ? <p className="border-b border-border/60 bg-muted/20 px-4 py-3 text-xs leading-5 text-muted-foreground sm:px-5">{catalog.note}</p> : null}
        <div className="overflow-x-auto">
          <Table className="min-w-[52rem]">
            <TableHeader>
              <TableRow className="bg-muted/20">
                <TableHead className="w-[220px] font-mono text-[10px] uppercase">Field</TableHead>
                <TableHead className="font-mono text-[10px] uppercase">Group</TableHead>
                <TableHead className="font-mono text-[10px] uppercase">Type</TableHead>
                <TableHead className="font-mono text-[10px] uppercase">Unit</TableHead>
                <TableHead className="font-mono text-[10px] uppercase">Scientific meaning</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {catalog.columns.map((column) => (
                <TableRow key={column.name}>
                  <TableCell className="font-mono text-xs font-semibold text-primary">{column.name}</TableCell>
                  <TableCell><Badge variant="secondary" className="rounded-none text-[10px]">{column.category}</Badge></TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">{column.dtype}</TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">{column.unit}</TableCell>
                  <TableCell className="text-xs leading-5 text-muted-foreground">{column.description}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>
    </details>
  );
}
