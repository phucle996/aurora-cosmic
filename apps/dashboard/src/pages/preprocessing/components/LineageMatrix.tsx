import { useMemo, useState } from 'react';
import type { JSX } from 'react';
import { CheckCircle2, ChevronRight, Search, ShieldCheck } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { sampleLineageRecords, type LineageRecord } from '../types';

export function LineageMatrix(): JSX.Element {
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedLineageRecord, setSelectedLineageRecord] = useState<LineageRecord | null>(
    sampleLineageRecords[0]
  );

  const filteredLineage = useMemo(() => {
    if (!searchQuery.trim()) return sampleLineageRecords;
    const q = searchQuery.toLowerCase();
    return sampleLineageRecords.filter(
      (r) =>
        r.tic_id.includes(q) ||
        r.target_name.toLowerCase().includes(q) ||
        r.source_sha256.includes(q) ||
        r.silver_sha256.includes(q)
    );
  }, [searchQuery]);

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      {/* Search & List of Lineage Records */}
      <Card className="lg:col-span-1 border-border/80">
        <CardHeader className="pb-3 border-b border-border/60">
          <CardTitle className="text-base font-semibold">Truy vết Phả hệ Dữ liệu (Lineage)</CardTitle>
          <CardDescription className="text-xs">
            Tra cứu lịch sử biến đổi của từng bản ghi từ Bronze FITS sang Silver Parquet.
          </CardDescription>
          <div className="relative mt-2">
            <Search className="absolute left-2.5 top-2.5 size-3.5 text-muted-foreground" />
            <Input
              placeholder="Tìm theo TIC ID, tên, mã SHA-256..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-8 text-xs h-8"
            />
          </div>
        </CardHeader>
        <CardContent className="p-2 divide-y divide-border/40 max-h-[500px] overflow-y-auto">
          {filteredLineage.map((rec) => {
            const isSelected = selectedLineageRecord?.tic_id === rec.tic_id;
            return (
              <button
                key={rec.tic_id}
                type="button"
                onClick={() => setSelectedLineageRecord(rec)}
                className={`w-full text-left p-3 rounded-md transition ${
                  isSelected ? 'bg-primary/10 border-l-2 border-primary' : 'hover:bg-muted/30'
                }`}
              >
                <div className="flex items-center justify-between text-xs">
                  <span className="font-mono font-bold text-foreground">TIC {rec.tic_id}</span>
                  <Badge variant="outline" className="text-[10px] text-emerald-500 border-emerald-500/30">
                    {rec.integrity}
                  </Badge>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{rec.target_name}</p>
                <div className="mt-2 flex items-center justify-between text-[11px] text-muted-foreground font-mono">
                  <span>Sector {rec.sector}</span>
                  <span>{rec.silver_records} pts</span>
                </div>
              </button>
            );
          })}
        </CardContent>
      </Card>

      {/* Lineage Tree & Cryptographic Audit Trail */}
      <Card className="lg:col-span-2 border-border/80">
        <CardHeader className="pb-3 border-b border-border/60">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base font-semibold flex items-center gap-2">
                <ShieldCheck className="size-4 text-emerald-500" />
                Cây Phả hệ Toàn diện (Provenance Tree) &bull; TIC {selectedLineageRecord?.tic_id}
              </CardTitle>
              <CardDescription className="text-xs">
                Xác thực nguồn gốc 100% không thể giả mạo bằng mã băm SHA-256 đối xứng.
              </CardDescription>
            </div>
            <Badge className="bg-emerald-500/10 text-emerald-500 border-emerald-500/30">
              <CheckCircle2 className="size-3 mr-1 inline" /> Cryptographically Verified
            </Badge>
          </div>
        </CardHeader>

        <CardContent className="p-5 space-y-6 text-xs">
          {selectedLineageRecord ? (
            <div className="space-y-4">
              {/* Node 1: Bronze Source */}
              <div className="border border-border/80 bg-muted/20 p-3.5 rounded-lg">
                <div className="flex items-center justify-between text-xs font-semibold text-foreground">
                  <span className="flex items-center gap-2">
                    <span className="flex size-5 items-center justify-center rounded-full bg-amber-500/20 text-amber-500 font-mono text-[10px]">
                      1
                    </span>
                    Bronze Source Layer (NASA MAST FITS)
                  </span>
                  <span className="font-mono text-muted-foreground text-[11px]">S3 Object</span>
                </div>
                <p className="mt-2 font-mono text-[11px] text-muted-foreground break-all bg-background/80 p-2 rounded border border-border/50">
                  {selectedLineageRecord.source_fits_key}
                </p>
                <p className="mt-1 font-mono text-[10px] text-muted-foreground/80">
                  SHA-256: {selectedLineageRecord.source_sha256}
                </p>
              </div>

              <div className="flex justify-center text-muted-foreground">
                <ChevronRight className="rotate-90 size-4" />
              </div>

              {/* Node 2: Transformation Engine */}
              <div className="border border-border/80 bg-primary/5 p-3.5 rounded-lg border-l-4 border-l-primary">
                <div className="flex items-center justify-between text-xs font-semibold text-foreground">
                  <span className="flex items-center gap-2">
                    <span className="flex size-5 items-center justify-center rounded-full bg-primary/20 text-primary font-mono text-[10px]">
                      2
                    </span>
                    Transformation Engine (Rust Preprocessor)
                  </span>
                  <span className="font-mono text-primary text-[11px]">{selectedLineageRecord.run_id}</span>
                </div>
                <div className="mt-2 grid grid-cols-2 gap-2 text-[11px]">
                  <div>
                    <span className="text-muted-foreground">Version:</span>{' '}
                    <span className="font-mono font-medium text-foreground">
                      {selectedLineageRecord.preprocessor_version}
                    </span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Thời điểm xử lý:</span>{' '}
                    <span className="font-mono font-medium text-foreground">
                      {new Date(selectedLineageRecord.processed_at).toLocaleString()}
                    </span>
                  </div>
                </div>
              </div>

              <div className="flex justify-center text-muted-foreground">
                <ChevronRight className="rotate-90 size-4" />
              </div>

              {/* Node 3: Silver Artifact */}
              <div className="border border-border/80 bg-muted/20 p-3.5 rounded-lg">
                <div className="flex items-center justify-between text-xs font-semibold text-foreground">
                  <span className="flex items-center gap-2">
                    <span className="flex size-5 items-center justify-center rounded-full bg-emerald-500/20 text-emerald-500 font-mono text-[10px]">
                      3
                    </span>
                    Silver Lakehouse Layer (Cleaned Parquet)
                  </span>
                  <span className="font-mono text-emerald-500 text-[11px]">
                    {selectedLineageRecord.silver_records} Records
                  </span>
                </div>
                <p className="mt-2 font-mono text-[11px] text-muted-foreground break-all bg-background/80 p-2 rounded border border-border/50">
                  {selectedLineageRecord.silver_parquet_key}
                </p>
                <p className="mt-1 font-mono text-[10px] text-muted-foreground/80">
                  SHA-256: {selectedLineageRecord.silver_sha256}
                </p>
              </div>

              <div className="flex justify-center text-muted-foreground">
                <ChevronRight className="rotate-90 size-4" />
              </div>

              {/* Node 4: Downstream Gold & ML */}
              <div className="border border-border/80 bg-purple-500/5 p-3.5 rounded-lg border-l-4 border-l-purple-500">
                <div className="flex items-center justify-between text-xs font-semibold text-foreground">
                  <span className="flex items-center gap-2">
                    <span className="flex size-5 items-center justify-center rounded-full bg-purple-500/20 text-purple-500 font-mono text-[10px]">
                      4
                    </span>
                    Downstream Gold Features &amp; Champion Model
                  </span>
                  <span className="font-mono text-purple-400 text-[11px]">model-cand-v1</span>
                </div>
                <div className="mt-2 grid grid-cols-3 gap-2 font-mono text-[11px]">
                  <div className="bg-background/80 p-2 rounded border border-border/50">
                    <span className="text-muted-foreground block text-[10px]">Depth PPM:</span>
                    <span className="font-bold text-foreground">
                      {selectedLineageRecord.features.transit_depth_ppm}
                    </span>
                  </div>
                  <div className="bg-background/80 p-2 rounded border border-border/50">
                    <span className="text-muted-foreground block text-[10px]">Period:</span>
                    <span className="font-bold text-foreground">
                      {selectedLineageRecord.features.period_days}d
                    </span>
                  </div>
                  <div className="bg-background/80 p-2 rounded border border-border/50">
                    <span className="text-muted-foreground block text-[10px]">Transit SNR:</span>
                    <span className="font-bold text-emerald-500">
                      {selectedLineageRecord.features.snr}σ
                    </span>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="py-12 text-center text-muted-foreground">
              Chọn một đối tượng từ danh sách bên trái để xem cây phả hệ chi tiết.
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
