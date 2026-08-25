import type { JSX } from 'react';
import { Sparkles } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { goldCandidateSchema } from '../types';
import { SchemaCatalogCard } from './SchemaCatalogCard';

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

      <SchemaCatalogCard catalog={goldCandidateSchema} />
    </div>
  );
}
