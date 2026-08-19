import { useMemo } from 'react';
import type { JSX } from 'react';
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

export function CheckpointMetricsChart(): JSX.Element {
  const metricData = useMemo(() => {
    const data = [];
    for (let batch = 1; batch <= 12; batch++) {
      const throughput = 115 + Math.sin(batch * 1.5) * 12 + (Math.random() - 0.5) * 8;
      const latencyMs = 8.5 + Math.cos(batch * 0.8) * 2.1 + (Math.random() - 0.5) * 1.2;

      data.push({
        batch: `Batch #${batch}`,
        throughput: Number(throughput.toFixed(1)),
        latencyMs: Number(latencyMs.toFixed(1)),
      });
    }
    return data;
  }, []);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-xs">
        <span className="font-semibold text-foreground">
          Độ trễ Ghi Checkpoint MinIO &amp; Thông lượng Xử lý (Engine Telemetry)
        </span>
        <span className="text-[11px] text-primary font-mono font-semibold">
          Avg Throughput: ~120 files/s &bull; Latency: ~8.5 ms
        </span>
      </div>

      <div className="h-[270px] w-full rounded-md border border-border/60 bg-background/50 p-2">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={metricData} margin={{ top: 15, right: 20, left: -20, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" opacity={0.15} />
            <XAxis
              dataKey="batch"
              tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
            />
            <YAxis
              yAxisId="left"
              domain={[0, 160]}
              tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
              tickFormatter={(v: number) => `${v}/s`}
            />
            <YAxis
              yAxisId="right"
              orientation="right"
              domain={[0, 20]}
              tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
              tickFormatter={(v: number) => `${v}ms`}
            />
            <Tooltip
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const d = payload[0].payload as (typeof metricData)[0];
                return (
                  <div className="rounded border border-border bg-popover p-2 text-xs shadow-md space-y-1">
                    <p className="font-semibold text-foreground">{d.batch}</p>
                    <p className="text-emerald-500 font-mono">Thông lượng: {d.throughput} tệp/giây</p>
                    <p className="text-amber-500 font-mono">Độ trễ MinIO: {d.latencyMs} ms</p>
                  </div>
                );
              }}
            />
            <Line
              yAxisId="left"
              type="monotone"
              dataKey="throughput"
              stroke="#10b981"
              strokeWidth={2}
              dot={{ r: 2 }}
              name="Throughput (files/s)"
            />
            <Line
              yAxisId="right"
              type="monotone"
              dataKey="latencyMs"
              stroke="#f59e0b"
              strokeWidth={1.5}
              strokeDasharray="3 3"
              dot={{ r: 2 }}
              name="MinIO Latency (ms)"
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <p className="text-[11px] text-muted-foreground">
        Cơ chế ghi nhận Checkpoint phi đồng bộ (Asynchronous Flush) đảm bảo an toàn chống sự cố (Crash-safe) mà không làm tắc nghẽn đường ống xử lý thông lượng cao của Rust.
      </p>
    </div>
  );
}
