import type { JSX } from 'react';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

import type { SchemaCatalog } from '../types';

type SchemaCatalogCardProps = {
  catalog: SchemaCatalog;
};

export function SchemaCatalogCard({ catalog }: SchemaCatalogCardProps): JSX.Element {
  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <CardTitle className="text-base font-semibold">{catalog.title}</CardTitle>
            <CardDescription>{catalog.description}</CardDescription>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            <Badge variant="outline" className="font-mono text-[10px]">{catalog.schemaVersion}</Badge>
            <Badge variant="secondary" className="font-mono text-[10px]">{catalog.columns.length} cột</Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {catalog.note ? <p className="rounded-md border bg-muted/40 p-3 text-xs text-muted-foreground">{catalog.note}</p> : null}
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[220px]">Tên cột</TableHead>
                <TableHead>Nhóm</TableHead>
                <TableHead>Kiểu dữ liệu</TableHead>
                <TableHead>Đơn vị</TableHead>
                <TableHead>Mô tả</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {catalog.columns.map((column) => (
                <TableRow key={column.name}>
                  <TableCell className="font-mono text-xs font-semibold text-primary">{column.name}</TableCell>
                  <TableCell><Badge variant="secondary" className="text-[10px]">{column.category}</Badge></TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">{column.dtype}</TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">{column.unit}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{column.description}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}
