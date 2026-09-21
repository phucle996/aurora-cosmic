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
import { CheckCircle2, AlertTriangle, Box, Cpu } from 'lucide-react';

function value(metrics: Record<string, number> | undefined, key: string): number {
  const observed = metrics?.[key];
  return observed !== undefined && Number.isFinite(observed) ? Math.max(0, observed) : 0;
}

export function PairingReadinessChart({
  metrics,
}: {
  metrics?: Record<string, number>;
}): JSX.Element {
  const ready = value(metrics, 'ready_lightcurves');
  const missingTPF = value(metrics, 'missing_tpf');
  const pendingLC = value(metrics, 'pending_lightcurves') || (ready + missingTPF);
  const contexts = value(metrics, 'tpf_contexts');
  const contracted = value(metrics, 'contracted_lightcurves') || pendingLC;
  const capacity = value(metrics, 'max_batch_records');

  const firstBatchRecords = capacity > 0 ? Math.min(ready, capacity) : ready;
  const batchFill = capacity > 0 ? (firstBatchRecords / capacity) * 100 : 0;

  const pairingPct = pendingLC > 0 ? ((ready / pendingLC) * 100).toFixed(1) : '100.0';
  const missingPct = pendingLC > 0 ? ((missingTPF / pendingLC) * 100).toFixed(1) : '0.0';

  // Data 1: Đối soát ghép cặp Multimodal (LC vs TPF Context)
  const pairingData = [
    { name: 'Đủ Cặp (Eligible LC)', count: ready, fill: '#10b981' },
    { name: 'Thiếu TPF (Bị Chặn)', count: missingTPF, fill: '#f59e0b' },
    { name: 'Kho TPF Khả Dụng', count: contexts, fill: '#0ea5e9' },
  ];

  // Data 2: Nạp Batch & Tiến Độ Dequeue (Readiness & Admission)
  const admissionData = [
    { name: 'Tổng LC Cần Ghép', count: pendingLC, fill: '#0ea5e9' },
    { name: 'Đạt Chuẩn Hợp Đồng', count: contracted, fill: '#10b981' },
    { name: 'Sẵn Sàng Dequeue', count: ready, fill: '#6366f1' },
  ];

  const maxPairingDomain = Math.max(contexts, pendingLC, 1);
  const maxAdmissionDomain = Math.max(pendingLC, capacity > 0 ? capacity : 1, 1);

  return (
    <div className="space-y-3">
      {/* 4 Focused Key Indicators */}
      <div className="grid grid-cols-2 gap-px border border-border/70 bg-border/70 text-xs lg:grid-cols-4">
        <MetricCard
          icon={<CheckCircle2 className="size-3.5 text-emerald-500" />}
          label="Ghép Cặp Đủ (Eligible)"
          value={`${ready.toLocaleString()} / ${pendingLC.toLocaleString()}`}
          sub={`${pairingPct}% sẵn sàng nạp Gold`}
          highlight="emerald"
        />
        <MetricCard
          icon={<AlertTriangle className="size-3.5 text-amber-500" />}
          label="Thiếu TPF (Bị Chặn)"
          value={`${missingTPF.toLocaleString()} LC`}
          sub={missingTPF === 0 ? '0 LC lỗi / hoàn hảo' : `${missingPct}% chờ dữ liệu TPF`}
          highlight={missingTPF > 0 ? 'amber' : undefined}
        />
        <MetricCard
          icon={<Box className="size-3.5 text-sky-500" />}
          label="Kho TPF Khả Dụng"
          value={`${contexts.toLocaleString()} TPF`}
          sub="Contexts sẵn sàng ghép"
        />
        <MetricCard
          icon={<Cpu className="size-3.5 text-indigo-500" />}
          label="Worker Dequeue Batch"
          value={capacity > 0 ? `${firstBatchRecords.toLocaleString()} / ${capacity.toLocaleString()}` : `${ready.toLocaleString()} rec`}
          sub={capacity > 0 ? `${batchFill.toFixed(1)}% tải batch đầu tiên` : '1 batch sẵn sàng'}
        />
      </div>

      {/* 2 Clean Visual Charts */}
      <div className="grid gap-3 xl:grid-cols-2">
        {/* Panel 1: Đối Soát Ghép Cặp Multimodal */}
        <section className="border border-border/70 bg-background/40">
          <div className="border-b border-border/60 px-3 py-2">
            <p className="font-medium text-xs text-foreground">
              Đối Soát Ghép Cặp Multimodal (LC vs TPF Context)
            </p>
            <p className="text-[10px] text-muted-foreground">
              So sánh số lượng LC ghép cặp thành công, LC bị thiếu TPF và dung lượng kho TPF khả dụng.
            </p>
          </div>
          <div className="h-64 p-3">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={pairingData} layout="vertical" margin={{ left: 24, right: 32, top: 16, bottom: 16 }}>
                <CartesianGrid horizontal={false} strokeDasharray="3 3" opacity={0.18} />
                <XAxis type="number" domain={[0, maxPairingDomain]} tick={{ fontSize: 10 }} />
                <YAxis type="category" dataKey="name" width={140} tick={{ fontSize: 10 }} />
                <Tooltip formatter={(val) => [`${Number(val).toLocaleString()} đối tượng`, 'Số lượng']} />
                <Bar dataKey="count" radius={[0, 4, 4, 0]} isAnimationActive={false}>
                  {pairingData.map((item) => (
                    <Cell key={item.name} fill={item.fill} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>

        {/* Panel 2: Nạp Batch & Tiến Độ Dequeue */}
        <section className="flex flex-col border border-border/70 bg-background/40">
          <div className="border-b border-border/60 px-3 py-2">
            <p className="font-medium text-xs text-foreground">
              Nạp Batch & Tiến Độ Dequeue (Batch Admission)
            </p>
            <p className="text-[10px] text-muted-foreground">
              Kiểm tra tính hợp lệ của hợp đồng và tỷ lệ sẵn sàng xuất batch cho Worker.
            </p>
          </div>
          <div className="flex-1 p-3">
            <div className="h-44">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={admissionData} layout="vertical" margin={{ left: 24, right: 32, top: 8, bottom: 8 }}>
                  <CartesianGrid horizontal={false} strokeDasharray="3 3" opacity={0.18} />
                  <XAxis type="number" domain={[0, maxAdmissionDomain]} tick={{ fontSize: 10 }} />
                  <YAxis type="category" dataKey="name" width={140} tick={{ fontSize: 10 }} />
                  <Tooltip formatter={(val) => [`${Number(val).toLocaleString()} bản ghi`, 'Số lượng']} />
                  <Bar dataKey="count" radius={[0, 4, 4, 0]} isAnimationActive={false}>
                    {admissionData.map((item) => (
                      <Cell key={item.name} fill={item.fill} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* Batch fill progress indicator */}
            <div className="mt-2 border-t border-border/50 pt-2.5">
              <div className="flex items-center justify-between text-xs">
                <span className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium">
                  Tỷ Lệ Lấp Đầy Batch Đầu Tiên
                </span>
                <span className="font-mono text-xs font-semibold text-foreground">
                  {batchFill.toFixed(1)}% ({firstBatchRecords.toLocaleString()} / {capacity.toLocaleString()} records)
                </span>
              </div>
              <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-muted/40 border border-border/60">
                <div
                  className="h-full bg-indigo-500 rounded-full transition-all duration-300"
                  style={{ width: `${Math.min(100, Math.max(2, batchFill))}%` }}
                />
              </div>
            </div>
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
  highlight?: 'emerald' | 'amber' | 'error';
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
            : highlight === 'amber'
            ? 'text-amber-600 dark:text-amber-400'
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
