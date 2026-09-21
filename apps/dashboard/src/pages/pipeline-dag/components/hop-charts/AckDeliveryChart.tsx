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
import { CheckCircle2, XCircle, FileText, Box } from 'lucide-react';

import type { Hop } from '../../types';

function value(metrics: Record<string, number> | undefined, key: string): number {
  return Math.max(0, Number(metrics?.[key] ?? 0));
}

export function AckDeliveryChart({
  metrics,
  materializationPoints = [],
}: {
  metrics?: Record<string, number>;
  materializationPoints?: Hop['materialization_points'];
}): JSX.Element {
  const lcPointsCount = materializationPoints.filter(
    (p) => p.product_kind === 'lightcurve' || p.product_kind === 'light_curve',
  ).length;
  const tpfPointsCount = materializationPoints.filter((p) => p.product_kind.includes('target')).length;

  const lcAck = value(metrics, 'acknowledged_lightcurves') || value(metrics, 'silver_lightcurves') || lcPointsCount;
  const tpfAck = value(metrics, 'acknowledged_target_pixels') || value(metrics, 'silver_target_pixels') || tpfPointsCount;

  const streamMessages =
    value(metrics, 'stream_messages') ||
    value(metrics, 'bronze_total_files') ||
    value(metrics, 'completed_products') ||
    value(metrics, 'silver_objects') ||
    (lcAck + tpfAck) ||
    materializationPoints.length;

  const unacked = value(metrics, 'ack_pending') + value(metrics, 'pending');
  const acknowledged =
    value(metrics, 'acknowledged_stream_positions') ||
    value(metrics, 'acknowledged_deliveries') ||
    Math.max(0, streamMessages - unacked);

  const coveragePct = streamMessages > 0 ? ((acknowledged / streamMessages) * 100).toFixed(1) : '100.0';
  const lcPct = streamMessages > 0 ? ((lcAck / streamMessages) * 100).toFixed(1) : '0.0';
  const tpfPct = streamMessages > 0 ? ((tpfAck / streamMessages) * 100).toFixed(1) : '0.0';

  // Data 1: Trạng thái ACK (Được vs Không được)
  const statusData = [
    { name: 'ACK Thành Công', count: acknowledged, fill: '#10b981' },
    { name: 'Không Được / Tồn Đọng', count: unacked, fill: '#ef4444' },
  ];

  // Data 2: Phân bổ Modality (Light Curve vs Target Pixel)
  const modalityData = [
    { name: 'Light Curve (1D)', count: lcAck, fill: '#0ea5e9' },
    { name: 'Target Pixel (3D)', count: tpfAck, fill: '#f59e0b' },
  ];

  return (
    <div className="space-y-3">
      {/* 4 Focused Key Indicators */}
      <div className="grid grid-cols-2 gap-px border border-border/70 bg-border/70 text-xs lg:grid-cols-4">
        <MetricCard
          icon={<CheckCircle2 className="size-3.5 text-emerald-500" />}
          label="ACK Thành Công"
          value={`${acknowledged.toLocaleString()} / ${streamMessages.toLocaleString()}`}
          sub={`${coveragePct}% đã tất toán`}
          highlight="emerald"
        />
        <MetricCard
          icon={<XCircle className="size-3.5 text-muted-foreground" />}
          label="Không Được / Tồn Đọng"
          value={`${unacked.toLocaleString()} msg`}
          sub={unacked === 0 ? '0 lỗi / 0 pending' : 'Cần xử lý lại'}
          highlight={unacked > 0 ? 'error' : undefined}
        />
        <MetricCard
          icon={<FileText className="size-3.5 text-sky-500" />}
          label="Light Curve (1D)"
          value={`${lcAck.toLocaleString()} LC`}
          sub={`${lcPct}% tổng số tin nhắn`}
        />
        <MetricCard
          icon={<Box className="size-3.5 text-amber-500" />}
          label="Target Pixel (3D)"
          value={`${tpfAck.toLocaleString()} TPF`}
          sub={`${tpfPct}% tổng số tin nhắn`}
        />
      </div>

      {/* 2 Simple, Clean Visual Charts */}
      <div className="grid gap-3 xl:grid-cols-2">
        {/* Panel 1: Trạng thái ACK */}
        <section className="border border-border/70 bg-background/40">
          <div className="border-b border-border/60 px-3 py-2">
            <p className="font-medium text-xs text-foreground">
              Đối Soát Trạng Thái ACK (Thành Công vs Không Được)
            </p>
            <p className="text-[10px] text-muted-foreground">
              Số lượng tin nhắn Bronze được xác nhận tất toán so với số lượng chờ hoặc lỗi.
            </p>
          </div>
          <div className="h-64 p-3">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={statusData} layout="vertical" margin={{ left: 16, right: 32, top: 16, bottom: 16 }}>
                <CartesianGrid horizontal={false} strokeDasharray="3 3" opacity={0.18} />
                <XAxis type="number" domain={[0, Math.max(streamMessages, 1)]} tick={{ fontSize: 10 }} />
                <YAxis type="category" dataKey="name" width={140} tick={{ fontSize: 10 }} />
                <Tooltip formatter={(val) => [`${Number(val).toLocaleString()} tin nhắn`, 'Số lượng']} />
                <Bar dataKey="count" radius={[0, 4, 4, 0]} isAnimationActive={false}>
                  {statusData.map((item) => (
                    <Cell key={item.name} fill={item.fill} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>

        {/* Panel 2: Phân bổ LC vs TPF */}
        <section className="border border-border/70 bg-background/40">
          <div className="border-b border-border/60 px-3 py-2">
            <p className="font-medium text-xs text-foreground">
              Phân Bổ Sản Phẩm ACK (Light Curve vs Target Pixel)
            </p>
            <p className="text-[10px] text-muted-foreground">
              Tách bạch số lượng tin nhắn đã xác nhận giữa chuỗi thời gian 1D và tem ảnh 3D.
            </p>
          </div>
          <div className="h-64 p-3">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={modalityData} layout="vertical" margin={{ left: 16, right: 32, top: 16, bottom: 16 }}>
                <CartesianGrid horizontal={false} strokeDasharray="3 3" opacity={0.18} />
                <XAxis type="number" domain={[0, Math.max(streamMessages, 1)]} tick={{ fontSize: 10 }} />
                <YAxis type="category" dataKey="name" width={130} tick={{ fontSize: 10 }} />
                <Tooltip formatter={(val) => [`${Number(val).toLocaleString()} sản phẩm`, 'Đã ACK']} />
                <Bar dataKey="count" radius={[0, 4, 4, 0]} isAnimationActive={false}>
                  {modalityData.map((item) => (
                    <Cell key={item.name} fill={item.fill} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>
      </div>
    </div>
  );
}

function MetricCard({
  icon,
  label,
  value: val,
  sub,
  highlight,
}: {
  icon?: JSX.Element;
  label: string;
  value: string;
  sub: string;
  highlight?: 'emerald' | 'error';
}): JSX.Element {
  return (
    <div className="bg-background p-3">
      <div className="flex items-center gap-1.5 text-muted-foreground text-[10px] font-medium uppercase tracking-wide">
        {icon}
        <span className="truncate">{label}</span>
      </div>
      <p
        className={`mt-1 font-mono text-sm font-semibold truncate ${
          highlight === 'emerald'
            ? 'text-emerald-600 dark:text-emerald-400'
            : highlight === 'error'
            ? 'text-rose-600 dark:text-rose-400'
            : 'text-foreground'
        }`}
      >
        {val}
      </p>
      <p className="mt-0.5 text-[10px] text-muted-foreground truncate">{sub}</p>
    </div>
  );
}
