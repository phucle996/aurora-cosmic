import type { JSX } from 'react';
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

export function QualityMaskChart({
  mode = 'batch',
  totalFiles = 3125,
}: {
  mode?: 'stream' | 'batch';
  totalFiles?: number;
}): JSX.Element {
  const totalPoints = totalFiles * 17649;
  const validCount = Math.round(totalPoints * 0.984);
  const straylightCount = Math.round(totalPoints * 0.008);
  const desatCount = Math.round(totalPoints * 0.005);
  const cosmicCount = Math.round(totalPoints * 0.003);

  const maskData = [
    {
      name: 'Hợp lệ (Bit = 0)',
      count: validCount,
      pct: 98.4,
      color: '#10b981',
      desc: 'Dữ liệu quang học chuẩn xác, không bị biến dạng camera.',
    },
    {
      name: 'Straylight Glint (Bit 13)',
      count: straylightCount,
      pct: 0.8,
      color: '#f59e0b',
      desc: 'Bị lóa ánh sáng tán xạ từ Mặt Trăng hoặc Trái Đất.',
    },
    {
      name: 'Wheel Desat (Bit 6)',
      count: desatCount,
      pct: 0.5,
      color: '#ef4444',
      desc: 'Bánh đà vệ tinh xả động lượng gây rung camera.',
    },
    {
      name: 'Cosmic Ray (Bit 10)',
      count: cosmicCount,
      pct: 0.3,
      color: '#a855f7',
      desc: 'Hạt năng lượng cao vũ trụ đâm trực tiếp vào cảm biến CCD.',
    },
  ];

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-xs">
        <span className="font-semibold text-foreground">
          {mode === 'batch'
            ? `Cộng dồn Lọc Chất lượng Toàn bộ ${totalFiles.toLocaleString()} tệp FITS`
            : 'Phân bổ Cờ Chất lượng Live Stream NATS'}
        </span>
        <span className="text-[11px] text-emerald-500 font-mono font-semibold">
          {(validCount / 1e6).toFixed(2)}M / {(totalPoints / 1e6).toFixed(2)}M Điểm Đạt Chuẩn (98.4%)
        </span>
      </div>

      <div className="h-[270px] w-full rounded-md border border-border/60 bg-background/50 p-2">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={maskData} layout="vertical" margin={{ top: 10, right: 30, left: 40, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" opacity={0.15} horizontal={false} />
            <XAxis type="number" domain={[0, 100]} tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} unit="%" />
            <YAxis
              type="category"
              dataKey="name"
              tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
              width={140}
            />
            <Tooltip
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const d = payload[0].payload as (typeof maskData)[0];
                return (
                  <div className="rounded border border-border bg-popover p-2 text-xs shadow-md space-y-1">
                    <p className="font-semibold text-foreground">{d.name}</p>
                    <p className="text-primary font-mono">
                      Cộng dồn: {d.count.toLocaleString()} điểm ({d.pct}%)
                    </p>
                    <p className="text-muted-foreground text-[11px]">{d.desc}</p>
                  </div>
                );
              }}
            />
            <Bar dataKey="pct" radius={[0, 4, 4, 0]} isAnimationActive={false}>
              {maskData.map((entry) => (
                <Cell key={entry.name} fill={entry.color} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      <p className="text-[11px] text-muted-foreground">
        Bộ lọc Bitmask <code>Flag &amp; 0b1011111111111111 == 0</code> của Rust Engine đã loại bỏ tổng cộng <strong>{((totalPoints - validCount) / 1e3).toFixed(1)}k điểm lỗi</strong> trên toàn bộ {totalFiles.toLocaleString()} ngôi sao.
      </p>
    </div>
  );
}
