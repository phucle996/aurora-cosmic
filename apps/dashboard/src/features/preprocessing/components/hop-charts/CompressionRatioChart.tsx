import { type JSX } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

const gibibyte = 1024 ** 3;

function metric(metrics: Record<string, number> | undefined, key: string): number {
  return Math.max(0, Number(metrics?.[key] ?? 0));
}

function formatBytes(bytes: number): string {
  if (bytes <= 0) return '0 B';
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < gibibyte) return `${(bytes / 1024 ** 2).toFixed(2)} MB`;
  return `${(bytes / gibibyte).toFixed(2)} GiB`;
}

export function CompressionRatioChart({
  mode = 'batch',
  metrics,
  scope = 'bronze-silver',
}: {
  mode?: 'stream' | 'batch';
  metrics?: Record<string, number>;
  scope?: 'bronze-silver' | 'gold';
  totalFiles?: number;
}): JSX.Element {
  const inventoryObserved = metric(metrics, 'inventory_observed') === 1;
  const bronzeBytes = metric(metrics, 'bronze_bytes');
  const silverBytes = metric(metrics, 'silver_bytes');
  const goldBytes = metric(metrics, 'gold_bytes');
  const bronzeObjects = metric(metrics, 'bronze_objects');
  const silverObjects = metric(metrics, 'silver_objects');
  const goldObjects = metric(metrics, 'gold_objects');
  const footprintData = scope === 'gold'
    ? [{ stage: 'Gold artifacts', sizeGiB: goldBytes / gibibyte, bytes: goldBytes, objects: goldObjects, color: '#a855f7', prefix: 'gold/ · toàn bộ artifact và manifest' }]
    : [
        { stage: '1. Bronze FITS', sizeGiB: bronzeBytes / gibibyte, bytes: bronzeBytes, objects: bronzeObjects, color: '#ef4444', prefix: 'bronze/ · FITS nguồn bất biến' },
        { stage: '2. Silver Parquet (ZSTD)', sizeGiB: silverBytes / gibibyte, bytes: silverBytes, objects: silverObjects, color: '#10b981', prefix: 'silver/ · chỉ object .parquet' },
      ];
  const maxSizeGiB = Math.max(...footprintData.map((item) => item.sizeGiB), 1);
  const hasSilver = silverObjects > 0;
  const silverDelta = bronzeBytes - silverBytes;
  const silverDeltaPct = bronzeBytes > 0 && hasSilver ? (silverDelta / bronzeBytes) * 100 : undefined;

  if (!inventoryObserved) {
    return (
      <div className="rounded-md border border-dashed border-border/70 bg-background/40 p-4 text-xs text-muted-foreground">
        Chưa có snapshot footprint từ MinIO. Hệ thống không suy diễn dung lượng; hãy Refresh sau khi quét các prefix lakehouse hoàn tất.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3 text-xs">
        <span className="font-semibold text-foreground">{scope === 'gold' ? 'Gold artifact footprint' : 'Bronze → Silver stored footprint'} · {mode === 'batch' ? 'batch snapshot' : 'stream snapshot'}</span>
        {scope === 'gold' ? <span className="font-mono text-[11px] text-muted-foreground">{goldObjects.toLocaleString()} object dưới gold/</span> : silverDeltaPct === undefined ? <span className="font-mono text-[11px] text-muted-foreground">Silver chưa có artifact để đo nén</span> : (
          <span className={`font-mono text-[11px] font-semibold ${silverDelta >= 0 ? 'text-emerald-500' : 'text-amber-500'}`}>
            Bronze → Silver: {silverDelta >= 0 ? 'giảm' : 'tăng'} {formatBytes(Math.abs(silverDelta))} ({Math.abs(silverDeltaPct).toFixed(1)}%)
          </span>
        )}
      </div>

      <div className="h-[min(28svh,280px)] w-full rounded-md border border-border/60 bg-background/50 p-2">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={footprintData} layout="vertical" margin={{ top: 10, right: 30, left: 45, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" opacity={0.15} horizontal={false} />
            <XAxis
              type="number"
              domain={[0, Math.ceil(maxSizeGiB * 1.1)]}
              tick={{ fontSize: 10, fill: 'var(--muted-foreground)' }}
              tickFormatter={(value: number) => `${value} GiB`}
            />
            <YAxis
              type="category"
              dataKey="stage"
              tick={{ fontSize: 10, fill: 'var(--muted-foreground)' }}
              width={170}
            />
            <Tooltip
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const item = payload[0].payload as (typeof footprintData)[0];
                return (
                  <div className="space-y-1 rounded border border-border bg-popover p-2 text-xs shadow-md">
                    <p className="font-semibold text-foreground">{item.stage}</p>
                    <p className="font-mono text-primary">Dung lượng MinIO: {formatBytes(item.bytes)}</p>
                    <p className="font-mono text-muted-foreground">{item.objects.toLocaleString()} object</p>
                    <p className="text-[11px] text-muted-foreground">{item.prefix}</p>
                  </div>
                );
              }}
            />
            <Bar dataKey="sizeGiB" radius={[0, 4, 4, 0]} isAnimationActive={false}>
              {footprintData.map((entry) => <Cell key={entry.stage} fill={entry.color} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      <p className="text-[11px] text-muted-foreground">
        {scope === 'gold'
          ? <>Snapshot lấy trực tiếp từ <strong>ObjectInfo.Size</strong> của các object dưới gold/: {formatBytes(goldBytes)} trên {goldObjects.toLocaleString()} object.</>
          : <>Snapshot lấy trực tiếp từ <strong>ObjectInfo.Size</strong> của MinIO: Bronze {formatBytes(bronzeBytes)} · Silver {formatBytes(silverBytes)}. “Decoded time series” là dữ liệu tạm trong RAM của worker, không phải file lakehouse nên không xuất hiện trong biểu đồ.</>}
      </p>
    </div>
  );
}
