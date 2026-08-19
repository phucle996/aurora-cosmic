import type { JSX } from 'react';
import { Sparkles } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { goldFeatureCatalog } from '../types';

export function GoldFeatureCatalogCard(): JSX.Element {
  return (
    <div className="space-y-6">
      {/* Active Champion Snapshot Banner */}
      <Card className="border-amber-500/30 bg-amber-500/5">
        <CardHeader className="pb-3">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div className="flex items-center gap-2">
              <Sparkles className="size-5 text-amber-400" />
              <div>
                <CardTitle className="text-base font-semibold">
                  Current Gold Snapshot Pointer
                </CardTitle>
                <CardDescription className="text-xs">
                  Con trỏ snapshot chuẩn bất biến đang được cung cấp cho GPU ML Worker huấn luyện & suy luận.
                </CardDescription>
              </div>
            </div>
            <Badge className="bg-amber-500 text-black font-semibold text-xs">
              gold/current/CANDIDATE.json
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs">
            <div className="rounded border border-amber-500/20 bg-background/50 p-3">
              <span className="text-muted-foreground">ML Task Mục tiêu:</span>
              <p className="mt-1 font-mono font-medium text-foreground">candidate_vetting</p>
            </div>
            <div className="rounded border border-amber-500/20 bg-background/50 p-3">
              <span className="text-muted-foreground">Định dạng tệp:</span>
              <p className="mt-1 font-mono font-medium text-foreground">features.parquet (DuckDB)</p>
            </div>
            <div className="rounded border border-amber-500/20 bg-background/50 p-3">
              <span className="text-muted-foreground">Phân chia tập dữ liệu:</span>
              <p className="mt-1 font-mono font-medium text-foreground">Train (70%) · Val (15%) · Test (15%)</p>
            </div>
            <div className="rounded border border-amber-500/20 bg-background/50 p-3">
              <span className="text-muted-foreground">Tự động hóa:</span>
              <p className="mt-1 font-mono font-medium text-emerald-400">python-gold-builder (Active)</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Feature Catalog Dictionary */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base font-semibold">
                Từ điển Đặc trưng Thiên văn (Gold Feature Store Schema)
              </CardTitle>
              <CardDescription>
                Danh mục các đặc trưng toán học và vật lý được trích xuất từ chuỗi thời gian ánh sáng Silver.
              </CardDescription>
            </div>
            <Badge variant="outline" className="font-mono">
              {goldFeatureCatalog.length} Features
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[200px]">Tên đặc trưng (Column)</TableHead>
                  <TableHead>Nhóm</TableHead>
                  <TableHead>Kiểu dữ liệu</TableHead>
                  <TableHead>Đơn vị</TableHead>
                  <TableHead>Mô tả giải tích</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {goldFeatureCatalog.map((feat) => (
                  <TableRow key={feat.name}>
                    <TableCell className="font-mono text-xs font-semibold text-primary">
                      {feat.name}
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary" className="text-[10px]">
                        {feat.category}
                      </Badge>
                    </TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {feat.dtype}
                    </TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {feat.unit}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {feat.description}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
