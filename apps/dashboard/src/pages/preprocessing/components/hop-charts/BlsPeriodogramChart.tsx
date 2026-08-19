import { useMemo } from 'react';
import type { JSX } from 'react';
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceDot,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

export function BlsPeriodogramChart(): JSX.Element {
  const periodogramData = useMemo(() => {
    const data = [];
    const truePeriod = 3.842; // Planetary candidate period peak

    for (let p = 0.5; p <= 12.0; p += 0.05) {
      const period = Number(p.toFixed(3));
      // Base background white noise SDE ~ 3.0 to 5.0
      let power = 3.5 + Math.sin(p * 2.8) * 0.8 + Math.cos(p * 5.1) * 0.5;

      // Primary peak at truePeriod
      const distPrimary = Math.abs(period - truePeriod);
      if (distPrimary < 0.25) {
        power += 24.5 * Math.exp(-Math.pow(distPrimary / 0.06, 2));
      }

      // Harmonic peak at 2 * truePeriod (7.684 days)
      const distHarmonic2 = Math.abs(period - truePeriod * 2);
      if (distHarmonic2 < 0.3) {
        power += 12.2 * Math.exp(-Math.pow(distHarmonic2 / 0.08, 2));
      }

      // Half-harmonic peak at truePeriod / 2 (1.921 days)
      const distHarmonicHalf = Math.abs(period - truePeriod / 2);
      if (distHarmonicHalf < 0.2) {
        power += 8.5 * Math.exp(-Math.pow(distHarmonicHalf / 0.06, 2));
      }

      data.push({
        period,
        power: Number(power.toFixed(2)),
      });
    }
    return data;
  }, []);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-xs">
        <span className="font-semibold text-foreground">
          Phổ Chu kỳ BLS (Box Least Squares Periodogram Power Spectrum)
        </span>
        <span className="text-[11px] text-emerald-500 font-mono font-semibold">
          Đỉnh tín hiệu: P = 3.842 ngày (SDE = 28.4σ)
        </span>
      </div>

      <div className="h-[270px] w-full rounded-md border border-border/60 bg-background/50 p-2">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={periodogramData} margin={{ top: 15, right: 20, left: -20, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" opacity={0.15} />
            <XAxis
              dataKey="period"
              tickFormatter={(v: number) => `${v}d`}
              tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
            />
            <YAxis
              domain={[0, 32]}
              tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
              tickFormatter={(v: number) => `${v}σ`}
            />
            <Tooltip
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const d = payload[0].payload as (typeof periodogramData)[0];
                const isPeak = Math.abs(d.period - 3.842) < 0.06;
                return (
                  <div className="rounded border border-border bg-popover p-2 text-xs shadow-md">
                    <p className="font-semibold text-foreground">Chu kỳ thử nghiệm: {d.period} ngày</p>
                    <p className="text-primary font-mono mt-0.5">Công suất BLS: {d.power}σ SDE</p>
                    {isPeak && (
                      <p className="text-emerald-500 font-bold text-[11px] mt-1">
                        &bull; ĐỈNH CHU KỲ QUỸ ĐẠO HÀNH TINH (Transit Peak)
                      </p>
                    )}
                  </div>
                );
              }}
            />
            <ReferenceLine
              x={3.842}
              stroke="#10b981"
              strokeDasharray="3 3"
              label={{ value: 'P = 3.842d', position: 'top', fontSize: 10, fill: '#10b981' }}
            />
            <ReferenceDot x={3.842} y={28.4} r={4} fill="#10b981" stroke="#ffffff" strokeWidth={1.5} />
            <Line
              type="monotone"
              dataKey="power"
              stroke="#3b82f6"
              strokeWidth={1.5}
              dot={false}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <p className="text-[11px] text-muted-foreground">
        Thuật toán Box Least Squares (BLS) quét chu kỳ từ $0.5$ đến $12$ ngày để phát hiện trũng sáng hình hộp chữ nhật định kỳ. Đỉnh nhọn cao nhất biểu thị chu kỳ quỹ đạo chính xác của ngoại hành tinh.
      </p>
    </div>
  );
}
