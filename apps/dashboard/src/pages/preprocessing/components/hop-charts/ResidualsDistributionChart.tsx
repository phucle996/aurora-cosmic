import { useMemo } from 'react';
import type { JSX } from 'react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

export function ResidualsDistributionChart(): JSX.Element {
  const gaussianData = useMemo(() => {
    const data = [];
    const sigma = 1.0;
    const step = 0.2;

    for (let x = -6.0; x <= 6.0; x += step) {
      const roundedX = Number(x.toFixed(1));
      // Standard Gaussian probability density function: (1 / sqrt(2pi)) * exp(-0.5 * (x/sigma)^2)
      const pdf = (1.0 / (Math.sqrt(2 * Math.PI) * sigma)) * Math.exp(-0.5 * Math.pow(x / sigma, 2));

      const isOutlierZone = Math.abs(roundedX) >= 5.0;

      data.push({
        zScore: roundedX,
        density: Number((pdf * 100).toFixed(2)),
        isOutlierZone,
      });
    }
    return data;
  }, []);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-xs">
        <span className="font-semibold text-foreground">
          Phân bố Phần dư Sai lệch (Photometric Residuals) &bull; Ngưỡng Cắt Lọc 5σ
        </span>
        <span className="text-[11px] text-purple-400 font-mono font-semibold">
          Ngưỡng Outlier: |z-score| &gt; 5.0σ MAD
        </span>
      </div>

      <div className="h-[200px] w-full rounded-md border border-border/60 bg-background/50 p-2">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={gaussianData} margin={{ top: 15, right: 20, left: -20, bottom: 0 }}>
            <defs>
              <linearGradient id="residualGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#10b981" stopOpacity={0.4} />
                <stop offset="95%" stopColor="#10b981" stopOpacity={0.0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" opacity={0.15} />
            <XAxis
              dataKey="zScore"
              tickFormatter={(v: number) => `${v}σ`}
              tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
            />
            <YAxis
              tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
              tickFormatter={(v: number) => `${v}%`}
            />
            <Tooltip
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const d = payload[0].payload as (typeof gaussianData)[0];
                return (
                  <div className="rounded border border-border bg-popover p-2 text-xs shadow-md">
                    <p className="font-semibold text-foreground">Độ lệch: {d.zScore}σ</p>
                    <p className="text-primary font-mono mt-0.5">Mật độ xác suất: {d.density}%</p>
                    {d.isOutlierZone ? (
                      <p className="text-purple-400 font-bold text-[11px] mt-1">
                        &bull; Vùng ngoại lệ 5σ (Bị thuật toán loại bỏ)
                      </p>
                    ) : (
                      <p className="text-emerald-400 text-[11px] mt-1">
                        &bull; Nhiễu Gauss ngẫu nhiên hợp lệ
                      </p>
                    )}
                  </div>
                );
              }}
            />
            <ReferenceLine
              x={-5.0}
              stroke="#a855f7"
              strokeDasharray="3 3"
              label={{ value: '-5σ Outlier', position: 'top', fontSize: 10, fill: '#a855f7' }}
            />
            <ReferenceLine
              x={5.0}
              stroke="#a855f7"
              strokeDasharray="3 3"
              label={{ value: '+5σ Outlier', position: 'top', fontSize: 10, fill: '#a855f7' }}
            />
            <Area
              type="monotone"
              dataKey="density"
              stroke="#10b981"
              strokeWidth={2}
              fill="url(#residualGradient)"
              isAnimationActive={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      <p className="text-[11px] text-muted-foreground">
        Thuật toán Savitzky-Golay / Median Absolute Deviation (MAD) ước tính độ lệch chuẩn $\sigma$ và loại bỏ chính xác các điểm vọt đỉnh (Cosmic Ray Spikes) nằm ngoài vùng $\pm 5\sigma$.
      </p>
    </div>
  );
}
