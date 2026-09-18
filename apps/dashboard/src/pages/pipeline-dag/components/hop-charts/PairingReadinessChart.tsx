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

import { TelemetryUnavailable } from './TelemetryUnavailable';

function value(metrics: Record<string, number> | undefined, key: string): number {
  const observed = metrics?.[key];
  return observed !== undefined && Number.isFinite(observed) ? Math.max(0, observed) : 0;
}

function percent(numerator: number, denominator: number): string {
  return denominator > 0 ? `${(numerator / denominator * 100).toFixed(2)}%` : '—';
}

function compact(observed: number): string {
  if (observed >= 1_000_000) return `${(observed / 1_000_000).toFixed(1)}M`;
  if (observed >= 1_000) return `${(observed / 1_000).toFixed(1)}k`;
  return observed.toLocaleString();
}

export function PairingReadinessChart({ metrics }: { metrics?: Record<string, number> }): JSX.Element {
  const ready = value(metrics, 'ready_lightcurves');
  const missingTPF = value(metrics, 'missing_tpf');
  const waiting = value(metrics, 'waiting_lightcurves');
  const pendingLC = value(metrics, 'pending_lightcurves') || ready + Math.max(missingTPF, waiting);
  const contexts = value(metrics, 'tpf_contexts');
  const contracted = value(metrics, 'contracted_lightcurves');
  const uncontracted = value(metrics, 'uncontracted_lightcurves');
  const contractPopulation = contracted + uncontracted;
  const capacity = value(metrics, 'max_batch_records');
  const prospectiveBatches = ready > 0 && capacity > 0 ? Math.ceil(ready / capacity) : 0;
  const firstBatchRecords = capacity > 0 ? Math.min(ready, capacity) : ready;
  const batchFill = capacity > 0 ? Math.min(100, firstBatchRecords / capacity * 100) : 0;

  if (value(metrics, 'readiness_observed') !== 1) {
    return <TelemetryUnavailable detail="Backend chưa trả readiness snapshot cho G01." />;
  }

  const denominator = Math.max(pendingLC, ready + missingTPF);
  const readinessData = [{ phase: 'Pending Light Curves', eligible: ready, blocked: missingTPF }];
  const gateData = [
    { gate: 'TPF pairing', pass: ready, blocked: missingTPF },
    { gate: 'Ingestion contract', pass: contracted, blocked: uncontracted },
  ];

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-px border border-border/70 bg-border/70 text-xs lg:grid-cols-3 2xl:grid-cols-6">
        <Metric label="Pending Light Curves" observed={pendingLC} detail="G01 population" />
        <Metric label="Eligible LC + TPF" observed={ready} detail={percent(ready, denominator)} />
        <Metric label="Missing TPF" observed={missingTPF} detail={percent(missingTPF, denominator)} warning={missingTPF > 0} />
        <Metric label="Durable contracts" observed={contracted} detail={percent(contracted, contractPopulation)} />
        <Metric label="TPF contexts" observed={contexts} detail="available to pairing" />
        <Metric label="Prospective batches" observed={prospectiveBatches} detail={capacity > 0 ? `${firstBatchRecords.toLocaleString()} / ${capacity.toLocaleString()} first batch` : 'capacity unavailable'} />
      </div>

      <div className="grid gap-3 xl:grid-cols-[minmax(0,1.15fr)_minmax(360px,0.85fr)]">
        <section className="border border-border/70 bg-background/40">
          <div className="border-b border-border/60 px-3 py-2">
            <p className="font-medium">Light Curve eligibility disposition</p>
            <p className="text-[10px] text-muted-foreground">Mỗi LC chỉ thuộc một nhóm: đã ghép TPF hoặc đang bị chặn vì thiếu TPF.</p>
          </div>
          <div className="h-[230px] p-3">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={readinessData} layout="vertical" margin={{ top: 20, right: 30, bottom: 12, left: 12 }}>
                <CartesianGrid horizontal={false} strokeDasharray="3 3" opacity={0.2} />
                <XAxis type="number" domain={[0, Math.max(denominator, 1)]} tickFormatter={(item) => compact(Number(item))} tick={{ fontSize: 10 }} />
                <YAxis type="category" dataKey="phase" width={120} tick={{ fontSize: 10 }} />
                <Tooltip formatter={(item, name) => [`${Number(item).toLocaleString()} LC`, String(name)]} />
                <Legend />
                <Bar dataKey="eligible" name="Eligible pair" stackId="readiness" fill="#10b981" isAnimationActive={false} />
                <Bar dataKey="blocked" name="Missing TPF" stackId="readiness" fill="#f59e0b" isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="grid gap-px border-t border-border/60 bg-border/60 sm:grid-cols-2">
            <Evidence label="Eligible pair" value={ready} ratio={percent(ready, denominator)} color="bg-emerald-500" />
            <Evidence label="Blocked: missing TPF" value={missingTPF} ratio={percent(missingTPF, denominator)} color="bg-amber-500" />
          </div>
        </section>

        <section className="border border-border/70 bg-background/40">
          <div className="border-b border-border/60 px-3 py-2">
            <p className="font-medium">Independent readiness gates</p>
            <p className="text-[10px] text-muted-foreground">Hai hàng là hai phép kiểm định riêng trên LC; không cộng chéo các nhóm.</p>
          </div>
          <div className="h-[230px] p-3">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={gateData} layout="vertical" margin={{ top: 12, right: 24, bottom: 12, left: 12 }}>
                <CartesianGrid horizontal={false} strokeDasharray="3 3" opacity={0.2} />
                <XAxis type="number" domain={[0, Math.max(denominator, contractPopulation, 1)]} tickFormatter={(item) => compact(Number(item))} tick={{ fontSize: 10 }} />
                <YAxis type="category" dataKey="gate" width={110} tick={{ fontSize: 10 }} />
                <Tooltip formatter={(item, name) => [`${Number(item).toLocaleString()} LC`, String(name)]} />
                <Legend />
                <Bar dataKey="pass" name="Pass" stackId="gate" fill="#22d3ee" isAnimationActive={false} />
                <Bar dataKey="blocked" name="Blocked / fallback" stackId="gate" fill="#fb7185" isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>
      </div>

      <section className="border border-border/70 bg-background/40 p-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="font-medium">Batch admission</p>
            <p className="mt-0.5 text-[10px] text-muted-foreground">Chỉ cặp hợp lệ mới được tính vào batch; LC thiếu TPF vẫn nằm ngoài admission.</p>
          </div>
          <div className="text-right">
            <p className="font-mono text-lg font-semibold tabular-nums">{capacity > 0 ? `${batchFill.toFixed(2)}%` : '—'}</p>
            <p className="font-mono text-[9px] uppercase tracking-wide text-muted-foreground">first-batch fill</p>
          </div>
        </div>
        <div className="mt-3 h-5 border border-border/70 bg-muted/30 p-0.5">
          <div className="h-full min-w-[2px] bg-primary" style={{ width: `${Math.max(ready > 0 ? 0.4 : 0, batchFill)}%` }} />
        </div>
        <div className="mt-2 flex flex-wrap justify-between gap-2 font-mono text-[10px] text-muted-foreground">
          <span>{ready.toLocaleString()} eligible targets admitted</span>
          <span>{capacity > 0 ? `${capacity.toLocaleString()} configured records / batch` : 'batch capacity unavailable'}</span>
        </div>
      </section>

      <div className="border-l-2 border-primary/50 bg-background/40 px-3 py-2 text-[11px] text-muted-foreground">
        G01 hiện quan sát {ready.toLocaleString()}/{denominator.toLocaleString()} LC đủ cặp ({percent(ready, denominator)}); {missingTPF.toLocaleString()} LC bị chặn do thiếu TPF. TPF context là số context khả dụng, không được diễn giải thành số TPF mồ côi.
      </div>
    </div>
  );
}

function Metric({ label, observed, detail, warning = false }: { label: string; observed: number; detail: string; warning?: boolean }): JSX.Element {
  return <div className="min-w-0 bg-background p-3"><p className="truncate text-[9px] uppercase tracking-wide text-muted-foreground" title={label}>{label}</p><p className={`mt-1 truncate font-mono text-sm font-semibold tabular-nums ${warning ? 'text-amber-600 dark:text-amber-400' : ''}`}>{observed.toLocaleString()}</p><p className="mt-0.5 truncate font-mono text-[9px] text-muted-foreground" title={detail}>{detail}</p></div>;
}

function Evidence({ label, value: observed, ratio, color }: { label: string; value: number; ratio: string; color: string }): JSX.Element {
  return <div className="flex items-center gap-2 bg-background px-3 py-2"><span className={`size-2 shrink-0 ${color}`} /><span className="min-w-0 flex-1 truncate text-[10px] text-muted-foreground">{label}</span><span className="font-mono font-semibold tabular-nums">{observed.toLocaleString()}</span><span className="w-14 text-right font-mono text-[10px] text-muted-foreground">{ratio}</span></div>;
}
