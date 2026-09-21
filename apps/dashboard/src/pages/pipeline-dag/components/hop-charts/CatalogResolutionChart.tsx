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
import { CheckCircle2, Sparkles, Compass, ShieldCheck, Database } from 'lucide-react';

function value(metrics: Record<string, number> | undefined, key: string): number {
  const observed = metrics?.[key];
  return observed !== undefined && Number.isFinite(observed) ? Math.max(0, observed) : 0;
}

export function CatalogResolutionChart({
  metrics,
  details,
}: {
  metrics?: Record<string, number>;
  details?: Record<string, string>;
}): JSX.Element {
  const targets = value(metrics, 'catalog_target_count') || value(metrics, 'input_records');
  const ticRecords = value(metrics, 'tic_records');
  const toiRecords = value(metrics, 'toi_records');
  const missingTIC = Math.max(0, targets - (ticRecords > 0 ? targets : 0));
  const resolvedTargets = targets > 0 ? targets - missingTIC : 0;
  const snapshots = value(metrics, 'catalog_snapshot_count');
  const cacheHit = value(metrics, 'catalog_cache_hit') === 1 || details?.catalog_mode === 'RESOLVED';
  const toiDensity = targets > 0 ? toiRecords / targets : 0;
  const ticDensity = targets > 0 ? ticRecords / targets : 0;

  const ticSnapshot = details?.tic_snapshot_id || 'Chưa ghi nhận';
  const toiSnapshot = details?.toi_snapshot_id || 'Chưa ghi nhận';

  const syncPct = targets > 0 ? ((resolvedTargets / targets) * 100).toFixed(1) : '0.0';

  // Data 1: Quy mô dữ liệu Catalog (TIC Stellar Params vs TOI Ephemerides)
  const catalogYieldData = [
    { name: 'TIC Stellar Params', count: ticRecords, fill: '#0ea5e9' },
    { name: 'NASA TOI Ephemerides', count: toiRecords, fill: '#f59e0b' },
  ];

  // Data 2: Trạng thái đối soát mục tiêu (Target Scope vs Resolved)
  const targetDispositionData = [
    { name: 'Mục Tiêu Yêu Cầu', count: targets, fill: '#0ea5e9' },
    { name: 'Đã Khớp TIC', count: resolvedTargets, fill: '#10b981' },
    { name: 'Chưa Khớp (Lỗi)', count: missingTIC, fill: '#ef4444' },
  ];

  const maxYieldDomain = Math.max(ticRecords, toiRecords, 1);
  const maxTargetDomain = Math.max(targets, 1);

  return (
    <div className="space-y-3">
      {/* 4 Focused Key Indicators */}
      <div className="grid grid-cols-2 gap-px border border-border/70 bg-border/70 text-xs lg:grid-cols-4">
        <MetricCard
          icon={<CheckCircle2 className="size-3.5 text-emerald-500" />}
          label="Mục Tiêu Đã Khớp (TIC Match)"
          value={`${resolvedTargets.toLocaleString()} / ${targets.toLocaleString()}`}
          sub={targets > 0 ? `${syncPct}% mục tiêu đã đồng bộ` : 'Chưa nạp mục tiêu'}
          highlight={targets > 0 && missingTIC === 0 ? 'emerald' : undefined}
        />
        <MetricCard
          icon={<Sparkles className="size-3.5 text-sky-500" />}
          label="Thông Số Sao TIC (Stellar)"
          value={`${ticRecords.toLocaleString()} bản ghi`}
          sub={`${ticDensity.toFixed(1)} tham số / mục tiêu`}
        />
        <MetricCard
          icon={<Compass className="size-3.5 text-amber-500" />}
          label="Tham Chiếu NASA TOI"
          value={`${toiRecords.toLocaleString()} bản ghi`}
          sub={`${toiDensity.toFixed(1)} liên kết / mục tiêu`}
        />
        <MetricCard
          icon={<ShieldCheck className="size-3.5 text-indigo-500" />}
          label="Catalog Snapshot Cache"
          value={`${snapshots} Snapshots`}
          sub={cacheHit ? '100% Cache Hit (Tái sử dụng)' : 'On-demand Fetch'}
          highlight={cacheHit ? 'emerald' : undefined}
        />
      </div>

      {/* 2 Clean Visual Charts */}
      <div className="grid gap-3 xl:grid-cols-2">
        {/* Panel 1: Quy Mô Catalog Thiên Văn */}
        <section className="border border-border/70 bg-background/40">
          <div className="border-b border-border/60 px-3 py-2">
            <p className="font-medium text-xs text-foreground">
              Quy Mô Nạp Catalog Thiên Văn (TIC & TOI Yield)
            </p>
            <p className="text-[10px] text-muted-foreground">
              Số lượng bản ghi thông số sao TIC và bảng tham chiếu thiên thể TOI được tải vào bộ nhớ.
            </p>
          </div>
          <div className="h-64 p-3">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={catalogYieldData} layout="vertical" margin={{ left: 24, right: 32, top: 24, bottom: 24 }}>
                <CartesianGrid horizontal={false} strokeDasharray="3 3" opacity={0.18} />
                <XAxis type="number" domain={[0, maxYieldDomain]} tick={{ fontSize: 10 }} />
                <YAxis type="category" dataKey="name" width={140} tick={{ fontSize: 10 }} />
                <Tooltip formatter={(val) => [`${Number(val).toLocaleString()} bản ghi`, 'Số lượng']} />
                <Bar dataKey="count" radius={[0, 4, 4, 0]} isAnimationActive={false}>
                  {catalogYieldData.map((item) => (
                    <Cell key={item.name} fill={item.fill} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>

        {/* Panel 2: Đối Soát Khớp Mục Tiêu & Snapshot Provenance */}
        <section className="flex flex-col border border-border/70 bg-background/40">
          <div className="border-b border-border/60 px-3 py-2">
            <p className="font-medium text-xs text-foreground">
              Khớp Mục Tiêu & Snapshot Provenance
            </p>
            <p className="text-[10px] text-muted-foreground">
              Tỷ lệ phủ mục tiêu và định danh snapshot bất biến ghim vào batch tính toán.
            </p>
          </div>
          <div className="flex-1 p-3">
            <div className="h-40">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={targetDispositionData} layout="vertical" margin={{ left: 24, right: 32, top: 6, bottom: 6 }}>
                  <CartesianGrid horizontal={false} strokeDasharray="3 3" opacity={0.18} />
                  <XAxis type="number" domain={[0, maxTargetDomain]} tick={{ fontSize: 10 }} />
                  <YAxis type="category" dataKey="name" width={140} tick={{ fontSize: 10 }} />
                  <Tooltip formatter={(val) => [`${Number(val).toLocaleString()} mục tiêu`, 'Số lượng']} />
                  <Bar dataKey="count" radius={[0, 4, 4, 0]} isAnimationActive={false}>
                    {targetDispositionData.map((item) => (
                      <Cell key={item.name} fill={item.fill} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* Snapshot provenance cards */}
            <div className="mt-2 grid grid-cols-2 gap-2 border-t border-border/50 pt-2.5">
              <div className="flex items-center gap-2 rounded border border-border/60 bg-muted/20 px-2.5 py-1.5">
                <Database className="size-3.5 shrink-0 text-sky-500" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between">
                    <span className="text-[9px] uppercase tracking-wide text-muted-foreground font-medium">TIC Snapshot</span>
                    <span className="text-[9px] font-medium text-emerald-500">CACHE HIT</span>
                  </div>
                  <p className="truncate font-mono text-[10px] font-semibold text-foreground" title={ticSnapshot}>
                    {ticSnapshot}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2 rounded border border-border/60 bg-muted/20 px-2.5 py-1.5">
                <Database className="size-3.5 shrink-0 text-amber-500" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between">
                    <span className="text-[9px] uppercase tracking-wide text-muted-foreground font-medium">TOI Snapshot</span>
                    <span className="text-[9px] font-medium text-emerald-500">CACHE HIT</span>
                  </div>
                  <p className="truncate font-mono text-[10px] font-semibold text-foreground" title={toiSnapshot}>
                    {toiSnapshot}
                  </p>
                </div>
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
