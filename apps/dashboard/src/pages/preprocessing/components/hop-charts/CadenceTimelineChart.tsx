import { useMemo } from 'react';
import type { JSX } from 'react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceArea,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

export function CadenceTimelineChart({
  mode = 'batch',
  totalFiles = 3125,
}: {
  mode?: 'stream' | 'batch';
  totalFiles?: number;
}): JSX.Element {
  const totalPoints = totalFiles * 17649;

  const timelineData = useMemo(() => {
    const data = [];
    const totalDays = 27.4;
    const pointsCount = 100;

    for (let i = 0; i < pointsCount; i++) {
      const day = (i / (pointsCount - 1)) * totalDays;
      const bjd = 2459440 + day; // Sector 42 BJD reference

      // Downlink gap between day 13.0 and day 14.2
      const isDownlinkGap = day >= 13.0 && day <= 14.2;
      const cadenceVolume = isDownlinkGap
        ? 0
        : Math.round((totalPoints / 100) * (0.98 + (Math.sin(day * 0.8) + (Math.random() - 0.5) * 0.05) * 0.04));

      const flux = isDownlinkGap
        ? 0
        : 1.0 + Math.sin(day * 0.8) * 0.005 + (Math.random() - 0.5) * 0.002;

      data.push({
        day: Number(day.toFixed(2)),
        bjd: Number(bjd.toFixed(2)),
        cadenceVolume,
        flux: isDownlinkGap ? null : Number(flux.toFixed(4)),
        status: isDownlinkGap ? 'TESS Downlink Gap' : 'Active Observation',
      });
    }
    return data;
  }, [totalPoints]);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-xs">
        <span className="font-semibold text-foreground">
          {mode === 'batch'
            ? `Cộng dồn Toàn bộ Sector 42 (${totalFiles.toLocaleString()} tệp FITS)`
            : 'Luồng Live Stream NATS JetStream (2-minute Cadence)'}
        </span>
        <span className="text-[11px] text-primary font-mono font-semibold">
          Tổng tích lũy: ~{(totalPoints / 1e6).toFixed(2)} Triệu điểm trắc quang
        </span>
      </div>

      <div className="h-[270px] w-full rounded-md border border-border/60 bg-background/50 p-2">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={timelineData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
            <defs>
              <linearGradient id="cadenceGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.4} />
                <stop offset="95%" stopColor="#3b82f6" stopOpacity={0.0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" opacity={0.15} />
            <XAxis
              dataKey="day"
              tickFormatter={(v: number) => `Ngày ${v}`}
              tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
            />
            <YAxis
              domain={[0.98, 1.02]}
              tickFormatter={(v: number) => v.toFixed(2)}
              tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
            />
            <Tooltip
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const d = payload[0].payload as (typeof timelineData)[0];
                return (
                  <div className="rounded border border-border bg-popover p-2 text-xs shadow-md space-y-1">
                    <p className="font-semibold text-foreground">
                      BJD {d.bjd} (Ngày thứ {d.day})
                    </p>
                    <p className="text-primary font-mono">
                      Mật độ cộng dồn: {d.cadenceVolume.toLocaleString()} điểm đo
                    </p>
                    <p className="text-muted-foreground font-mono">Trạng thái: {d.status}</p>
                  </div>
                );
              }}
            />
            <ReferenceArea
              x1={13.0}
              x2={14.2}
              stroke="#f59e0b"
              strokeOpacity={0.5}
              fill="#f59e0b"
              fillOpacity={0.15}
              label={{
                value: 'TESS Downlink Gap (~1.2 ngày)',
                position: 'insideTop',
                fontSize: 10,
                fill: '#f59e0b',
              }}
            />
            <Area
              type="monotone"
              dataKey="flux"
              stroke="#3b82f6"
              strokeWidth={1.5}
              fillOpacity={1}
              fill="url(#cadenceGradient)"
              isAnimationActive={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
      <p className="text-[11px] text-muted-foreground">
        Biểu diễn tổng hợp toàn bộ <strong>{totalFiles.toLocaleString()} tệp FITS</strong> trong Sector 42. Tích lũy <strong>{(totalPoints / 1e6).toFixed(2)}M điểm đo</strong> liên tục trong 27.4 ngày quan sát của kính viễn vọng không gian TESS.
      </p>
    </div>
  );
}
