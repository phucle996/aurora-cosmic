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

export function CompressionRatioChart(): JSX.Element {
  const compressionData = [
    {
      stage: '1. Bronze FITS Thô',
      sizeKb: 1863,
      pct: 100,
      color: '#ef4444',
      format: 'FITS Binary Table HDU (Uncompressed)',
    },
    {
      stage: '2. Decoded Raw Arrays',
      sizeKb: 850,
      pct: 45.6,
      color: '#f59e0b',
      format: 'In-memory Time Series Float64',
    },
    {
      stage: '3. Silver Parquet (Snappy)',
      sizeKb: 220,
      pct: 11.8,
      color: '#10b981',
      format: 'Columnar Parquet + Snappy Compression',
    },
  ];

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-xs">
        <span className="font-semibold text-foreground">
          Hiệu suất Tinh gọn Dữ liệu Lakehouse (Data Reduction Ratio)
        </span>
        <span className="text-[11px] text-emerald-500 font-mono font-semibold">
          Tiết kiệm: 88.2% Dung lượng Lưu trữ
        </span>
      </div>

      <div className="h-[270px] w-full rounded-md border border-border/60 bg-background/50 p-2">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={compressionData} layout="vertical" margin={{ top: 10, right: 30, left: 40, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" opacity={0.15} horizontal={false} />
            <XAxis
              type="number"
              domain={[0, 2000]}
              tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
              tickFormatter={(v: number) => `${v} KB`}
            />
            <YAxis
              type="category"
              dataKey="stage"
              tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
              width={140}
            />
            <Tooltip
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const d = payload[0].payload as (typeof compressionData)[0];
                return (
                  <div className="rounded border border-border bg-popover p-2 text-xs shadow-md space-y-1">
                    <p className="font-semibold text-foreground">{d.stage}</p>
                    <p className="text-primary font-mono">
                      {d.sizeKb} KB ({d.pct}% dung lượng gốc)
                    </p>
                    <p className="text-muted-foreground text-[11px]">{d.format}</p>
                  </div>
                );
              }}
            />
            <Bar dataKey="sizeKb" radius={[0, 4, 4, 0]} isAnimationActive={false}>
              {compressionData.map((entry) => (
                <Cell key={entry.stage} fill={entry.color} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      <p className="text-[11px] text-muted-foreground">
        Chuyển đổi từ định dạng FITS thô sang Apache Parquet nén Snappy giúp tối ưu hóa $8.5\times$ I/O khi nạp vào ClickHouse hoặc huấn luyện mạng nơ-ron Deep Learning.
      </p>
    </div>
  );
}
