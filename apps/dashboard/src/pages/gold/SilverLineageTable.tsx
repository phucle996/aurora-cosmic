import type { JSX } from 'react';

import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

import type { GoldSnapshotInput } from './types';

interface SilverLineageTableProps {
  inputs: GoldSnapshotInput[];
}

function Hash({ value }: { value: string }): JSX.Element {
  return <span className="block max-w-44 truncate font-mono text-[11px]" title={value}>{value || '—'}</span>;
}

export function SilverLineageTable({ inputs }: SilverLineageTableProps): JSX.Element {
  if (inputs.length === 0) {
    return <p className="py-6 text-sm text-muted-foreground">Manifest này không ghi nhận Silver input nào.</p>;
  }
  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Loại Silver</TableHead>
            <TableHead>Source product</TableHead>
            <TableHead>Sample / lineage</TableHead>
            <TableHead>Silver object key</TableHead>
            <TableHead>Schema / processor</TableHead>
            <TableHead>SHA-256</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {inputs.map((input, index) => (
            <TableRow key={`${input.silver_object_key}-${index}`}>
              <TableCell><Badge variant="secondary">{input.product_kind || 'UNKNOWN'}</Badge></TableCell>
              <TableCell className="font-mono text-xs">{input.source_product_id || '—'}</TableCell>
              <TableCell className="space-y-1"><Hash value={input.sample_id} /><Hash value={input.lineage_id} /></TableCell>
              <TableCell><Hash value={input.silver_object_key} /></TableCell>
              <TableCell className="space-y-1 text-xs"><div>{input.silver_schema_version || '—'}</div><div className="text-muted-foreground">{input.processor_version || '—'}</div></TableCell>
              <TableCell><Hash value={input.silver_sha256} /></TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
