import type { JSX } from 'react';
import { Cpu, Database, FileInput, FileOutput, Gauge } from 'lucide-react';

interface StatProps {
  icon: typeof Gauge;
  label: string;
  value: string;
  detail: string;
  title?: string;
}

function Stat({ icon: Icon, label, value, detail, title }: StatProps): JSX.Element {
  return (
    <div className="min-w-0 border border-border/70 bg-background/45 p-3.5" title={title}>
      <div className="flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.13em] text-primary">
        <Icon className="size-4 text-primary" />
        {label}
      </div>
      <p className="mt-2 truncate font-mono text-lg font-semibold tabular-nums text-foreground sm:text-xl">{value}</p>
      <p className="mt-1 truncate text-[11px] text-muted-foreground" title={detail}>{detail}</p>
    </div>
  );
}

export interface EnrichmentStatStripProps {
  pendingTotal: number;
  readyLightcurves: number;
  missingTpf: number;
  lastSnapshotId?: string;
  catalogState?: string;
  catalogDetail: string;
  catalogTooltip?: string;
  activeWorkers: number;
  activeBuilds: number;
}

export function EnrichmentStatStrip({
  pendingTotal,
  readyLightcurves,
  missingTpf,
  lastSnapshotId,
  catalogState,
  catalogDetail,
  catalogTooltip,
  activeWorkers,
  activeBuilds,
}: EnrichmentStatStripProps): JSX.Element {
  return (
    <section aria-label="Enrichment summary" className="grid gap-px overflow-hidden border border-border/70 bg-border/70 sm:grid-cols-2 xl:grid-cols-4">
      <Stat
        icon={FileInput}
        label="Silver Pending Queue"
        value={`${pendingTotal.toLocaleString()} pending`}
        detail={`${readyLightcurves.toLocaleString()} paired · ${missingTpf} awaiting TPF`}
      />
      <Stat
        icon={FileOutput}
        label="Gold Materialized"
        value={lastSnapshotId ? 'Committed' : 'Awaiting Output'}
        detail={lastSnapshotId ? `Snapshot: ${lastSnapshotId.slice(0, 18)}…` : 'No snapshot recorded yet'}
      />
      <Stat
        icon={Database}
        label="Catalog Sync Readiness"
        value={catalogState ?? 'IDLE'}
        detail={catalogDetail}
        title={catalogTooltip}
      />
      <Stat
        icon={Cpu}
        label="Worker Pool"
        value={`${activeWorkers} active slots`}
        detail={`${activeBuilds} builds in progress`}
      />
    </section>
  );
}
