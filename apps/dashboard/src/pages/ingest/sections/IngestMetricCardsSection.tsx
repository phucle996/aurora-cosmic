import type { JSX } from 'react';
import { Activity, Cpu, Files, HardDrive } from 'lucide-react';
import type { IngestStatus } from '../types';
import { formatBytes, formatRate } from '../types';

interface IngestMetricCardsSectionProps {
  status: IngestStatus | null;
  percent: number;
  spawnedWorkerCount: number;
}

function Stat({
  icon: Icon,
  label,
  value,
  detail,
}: {
  icon: typeof Files;
  label: string;
  value: string;
  detail: string;
}): JSX.Element {
  return (
    <div className="min-w-0 border border-border/70 bg-background/45 p-3.5">
      <div className="flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.13em] text-muted-foreground">
        <Icon className="size-4 text-primary" />
        {label}
      </div>
      <p className="mt-2 truncate font-mono text-lg font-semibold tabular-nums text-foreground sm:text-xl">{value}</p>
      <p className="mt-1 truncate text-[11px] text-muted-foreground" title={detail}>
        {detail}
      </p>
    </div>
  );
}

export function IngestMetricCardsSection({
  status,
  percent,
  spawnedWorkerCount,
}: IngestMetricCardsSectionProps): JSX.Element {
  return (
    <section
      aria-label="Run summary"
      className="grid gap-px overflow-hidden border border-border/70 bg-border/70 sm:grid-cols-2 xl:grid-cols-4"
    >
      <Stat
        icon={Files}
        label="Products observed"
        value={`${status?.completed_products ?? 0} / ${status?.total_products ?? 0}`}
        detail={`${percent}% acquisition complete`}
      />
      <Stat
        icon={HardDrive}
        label="Bronze footprint"
        value={formatBytes(status?.completed_bytes ?? 0)}
        detail={`Expected ${formatBytes(status?.expected_bytes ?? 0)}`}
      />
      <Stat
        icon={Activity}
        label="Transfer rate"
        value={`${(status?.products_per_second ?? 0).toFixed(1)} files/s`}
        detail={formatRate(status?.bytes_per_second ?? 0, 's')}
      />
      <Stat
        icon={Cpu}
        label="Active workers"
        value={String(spawnedWorkerCount)}
        detail={`${status?.queue_depth ?? 0} queued · ${status?.failed_products ?? 0} failed`}
      />
    </section>
  );
}
