import type { JSX } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

function value(metrics: Record<string, number> | undefined, key: string): number {
  const observed = metrics?.[key];
  return observed !== undefined && Number.isFinite(observed) ? Math.max(0, observed) : 0;
}

function percent(numerator: number, denominator: number): string {
  return denominator > 0 ? `${(numerator / denominator * 100).toFixed(2)}%` : '—';
}

export function CatalogResolutionChart({ metrics, details }: { metrics?: Record<string, number>; details?: Record<string, string> }): JSX.Element {
  const targets = value(metrics, 'catalog_target_count');
  const ticRecords = value(metrics, 'tic_records');
  const toiRecords = value(metrics, 'toi_records');
  const missingTIC = Math.max(0, targets - ticRecords);
  const snapshots = value(metrics, 'catalog_snapshot_count');
  const state = details?.catalog_state || 'IDLE';
  const cacheHit = value(metrics, 'catalog_cache_hit') === 1;
  const toiDensity = targets > 0 ? toiRecords / targets : 0;

  const ticDisposition = [{ population: 'Batch targets', resolved: Math.min(ticRecords, targets), unresolved: missingTIC }];
  const catalogRows = [
    { source: 'Target scope', records: targets },
    { source: 'TIC records', records: ticRecords },
    { source: 'TOI records', records: toiRecords },
  ];

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-px border border-border/70 bg-border/70 text-xs lg:grid-cols-3 2xl:grid-cols-6">
        <Metric label="Catalog state" observed={state} detail={details?.catalog_mode || 'ON_DEMAND'} />
        <Metric label="Target scope" observed={targets.toLocaleString()} detail="unique TIC IDs requested" />
        <Metric label="TIC resolved" observed={ticRecords.toLocaleString()} detail={percent(Math.min(ticRecords, targets), targets)} warning={targets > 0 && missingTIC > 0} />
        <Metric label="TOI records" observed={toiRecords.toLocaleString()} detail={targets > 0 ? `${toiDensity.toFixed(3)} rows / target` : 'batch not started'} />
        <Metric label="Catalog snapshots" observed={snapshots.toLocaleString()} detail="immutable inputs" />
        <Metric label="Catalog source" observed={cacheHit ? 'CACHE' : targets > 0 ? 'FETCH' : '—'} detail={cacheHit ? 'verified snapshot reuse' : targets > 0 ? 'on-demand retrieval' : 'not observed'} />
      </div>

      {targets === 0 ? (
        <section className="border border-dashed border-border/70 bg-background/40 px-5 py-12 text-center">
          <p className="font-mono text-sm font-semibold uppercase">Catalog batch not admitted</p>
          <p className="mx-auto mt-2 max-w-2xl text-[11px] leading-5 text-muted-foreground">
            Backend đang trả catalog state {state} với target_count = 0. G02 chưa có mẫu số để tính TIC coverage hay TOI density, nên drawer không dựng biểu đồ 0 giả.
          </p>
        </section>
      ) : (
        <div className="grid gap-3 xl:grid-cols-2">
          <section className="border border-border/70 bg-background/40">
            <div className="border-b border-border/60 px-3 py-2">
              <p className="font-medium">TIC resolution disposition</p>
              <p className="text-[10px] text-muted-foreground">TIC là catalog bắt buộc: resolved + unresolved bằng target scope của batch.</p>
            </div>
            <div className="h-[240px] p-3">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={ticDisposition} layout="vertical" margin={{ top: 20, right: 28, bottom: 12, left: 12 }}>
                  <CartesianGrid horizontal={false} strokeDasharray="3 3" opacity={0.2} />
                  <XAxis type="number" domain={[0, Math.max(targets, 1)]} allowDecimals={false} tick={{ fontSize: 10 }} />
                  <YAxis type="category" dataKey="population" width={100} tick={{ fontSize: 10 }} />
                  <Tooltip formatter={(item, name) => [`${Number(item).toLocaleString()} targets`, String(name)]} />
                  <Legend />
                  <Bar dataKey="resolved" name="TIC resolved" stackId="tic" fill="#10b981" isAnimationActive={false} />
                  <Bar dataKey="unresolved" name="TIC unresolved" stackId="tic" fill="#ef4444" isAnimationActive={false} />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="grid gap-px border-t border-border/60 bg-border/60 sm:grid-cols-2">
              <Evidence label="Resolved" value={ticRecords} ratio={percent(Math.min(ticRecords, targets), targets)} color="bg-emerald-500" />
              <Evidence label="Unresolved" value={missingTIC} ratio={percent(missingTIC, targets)} color="bg-red-500" />
            </div>
          </section>

          <section className="border border-border/70 bg-background/40">
            <div className="border-b border-border/60 px-3 py-2">
              <p className="font-medium">Catalog record yield</p>
              <p className="text-[10px] text-muted-foreground">TOI là association row count, không được diễn giải thành unique-target coverage.</p>
            </div>
            <div className="h-[280px] p-3">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={catalogRows} margin={{ top: 12, right: 12, bottom: 12, left: 4 }}>
                  <CartesianGrid vertical={false} strokeDasharray="3 3" opacity={0.2} />
                  <XAxis dataKey="source" tick={{ fontSize: 10 }} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 10 }} width={48} />
                  <Tooltip formatter={(item) => [Number(item).toLocaleString(), 'Records']} />
                  <Bar dataKey="records" name="Observed records" fill="#22d3ee" isAnimationActive={false} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </section>
        </div>
      )}

      <section className="grid gap-px border border-border/70 bg-border/70 sm:grid-cols-2">
        <Snapshot label="TIC snapshot" id={details?.tic_snapshot_id} />
        <Snapshot label="TOI snapshot" id={details?.toi_snapshot_id} />
      </section>

      {details?.catalog_error && <div className="border-l-2 border-red-500 bg-red-500/5 px-3 py-2 text-[11px] text-red-700 dark:text-red-300">{details.catalog_error}</div>}
      <div className="border-l-2 border-primary/50 bg-background/40 px-3 py-2 text-[11px] text-muted-foreground">
        {targets > 0
          ? `G02 resolved ${ticRecords.toLocaleString()}/${targets.toLocaleString()} required TIC records (${percent(Math.min(ticRecords, targets), targets)}). ${toiRecords.toLocaleString()} TOI rows are contextual associations, not failed-or-passed targets.`
          : `G02 is ${state}; no batch-scoped catalog evidence has been emitted.`}
      </div>
    </div>
  );
}

function Metric({ label, observed, detail, warning = false }: { label: string; observed: string; detail: string; warning?: boolean }): JSX.Element {
  return <div className="min-w-0 bg-background p-3"><p className="truncate text-[9px] uppercase tracking-wide text-muted-foreground" title={label}>{label}</p><p className={`mt-1 truncate font-mono text-sm font-semibold tabular-nums ${warning ? 'text-red-600 dark:text-red-400' : ''}`}>{observed}</p><p className="mt-0.5 truncate font-mono text-[9px] text-muted-foreground" title={detail}>{detail}</p></div>;
}

function Evidence({ label, value: observed, ratio, color }: { label: string; value: number; ratio: string; color: string }): JSX.Element {
  return <div className="flex items-center gap-2 bg-background px-3 py-2"><span className={`size-2 shrink-0 ${color}`} /><span className="min-w-0 flex-1 truncate text-[10px] text-muted-foreground">{label}</span><span className="font-mono font-semibold tabular-nums">{observed.toLocaleString()}</span><span className="w-14 text-right font-mono text-[10px] text-muted-foreground">{ratio}</span></div>;
}

function Snapshot({ label, id }: { label: string; id?: string }): JSX.Element {
  return <div className="min-w-0 bg-background px-3 py-2"><p className="text-[9px] uppercase tracking-wide text-muted-foreground">{label}</p><p className="mt-1 truncate font-mono text-[10px] font-medium" title={id || 'not emitted'}>{id || 'not emitted'}</p></div>;
}
