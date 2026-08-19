import type { JSX } from 'react';
import { CheckCircle2, Sparkles } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { formatBytes, StorageListing } from '../types';

interface LakehouseTierCardsProps {
  activeTab: 'bronze' | 'silver' | 'gold';
  onTabChange: (tab: 'bronze' | 'silver' | 'gold') => void;
  bronzeData: StorageListing | null;
  silverData: StorageListing | null;
  goldData: StorageListing | null;
}

export function LakehouseTierCards({
  activeTab,
  onTabChange,
  bronzeData,
  silverData,
  goldData,
}: LakehouseTierCardsProps): JSX.Element {
  // Rolling storage budget for Bronze (50 GiB max policy)
  const bronzeBufferCapacity = 50 * 1024 * 1024 * 1024;
  const bronzeUsedPercent = Math.min(
    100,
    Math.round(((bronzeData?.total_bytes ?? 0) / bronzeBufferCapacity) * 100),
  );

  return (
    <div className="grid gap-4 md:grid-cols-3">
      {/* Bronze Card */}
      <Card
        className={`cursor-pointer transition-colors ${
          activeTab === 'bronze' ? 'border-primary/80 bg-primary/5' : 'hover:border-border'
        }`}
        onClick={() => onTabChange('bronze')}
      >
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-xl">🥉</span>
              <CardTitle className="text-sm font-semibold">Bronze Layer</CardTitle>
            </div>
            <Badge variant="outline" className="font-mono text-[11px]">
              Raw FITS
            </Badge>
          </div>
          <CardDescription className="text-xs">
            Dữ liệu thô tải từ NASA MAST. Lưu trữ xoay vòng ~50 GiB.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex justify-between items-baseline">
            <span className="font-mono text-2xl font-bold">
              {bronzeData?.total ?? 0}
            </span>
            <span className="text-xs font-mono text-muted-foreground">
              {formatBytes(bronzeData?.total_bytes ?? 0)}
            </span>
          </div>
          <div className="mt-3 space-y-1">
            <div className="flex justify-between text-[11px] text-muted-foreground">
              <span>Vùng đệm 50 GiB</span>
              <span>{bronzeUsedPercent}%</span>
            </div>
            <Progress value={bronzeUsedPercent} className="h-1.5" />
          </div>
        </CardContent>
      </Card>

      {/* Silver Card */}
      <Card
        className={`cursor-pointer transition-colors ${
          activeTab === 'silver' ? 'border-primary/80 bg-primary/5' : 'hover:border-border'
        }`}
        onClick={() => onTabChange('silver')}
      >
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-xl">🥈</span>
              <CardTitle className="text-sm font-semibold">Silver Layer</CardTitle>
            </div>
            <Badge variant="outline" className="font-mono text-[11px]">
              Parquet Series
            </Badge>
          </div>
          <CardDescription className="text-xs">
            Đường cong ánh sáng & TPF đã được làm sạch, chuẩn hóa.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex justify-between items-baseline">
            <span className="font-mono text-2xl font-bold">
              {silverData?.total ?? 0}
            </span>
            <span className="text-xs font-mono text-muted-foreground">
              {formatBytes(silverData?.total_bytes ?? 0)}
            </span>
          </div>
          <div className="mt-3 flex items-center gap-1.5 text-xs text-emerald-400">
            <CheckCircle2 className="size-3.5" />
            <span>Lineage & Quality Verification</span>
          </div>
        </CardContent>
      </Card>

      {/* Gold Card */}
      <Card
        className={`cursor-pointer transition-colors ${
          activeTab === 'gold' ? 'border-primary/80 bg-primary/5' : 'hover:border-border'
        }`}
        onClick={() => onTabChange('gold')}
      >
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-xl">🥇</span>
              <CardTitle className="text-sm font-semibold">Gold Feature Store</CardTitle>
            </div>
            <Badge
              variant="outline"
              className="font-mono text-[11px] bg-amber-500/10 text-amber-300 border-amber-500/30"
            >
              ML Ready
            </Badge>
          </div>
          <CardDescription className="text-xs">
            Snapshots đặc trưng toán học & vật lý thiên văn cho PyTorch/ONNX.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex justify-between items-baseline">
            <span className="font-mono text-2xl font-bold">
              {goldData?.total ?? 0}
            </span>
            <span className="text-xs font-mono text-muted-foreground">
              {formatBytes(goldData?.total_bytes ?? 0)}
            </span>
          </div>
          <div className="mt-3 flex items-center gap-1.5 text-xs text-amber-300">
            <Sparkles className="size-3.5" />
            <span>16+ Derived Features & Snapshots</span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
