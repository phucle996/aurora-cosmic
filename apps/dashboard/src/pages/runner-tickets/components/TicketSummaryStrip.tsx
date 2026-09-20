/**
 * @file TicketSummaryStrip.tsx
 * @description KPI summary strip displaying total tickets, stage executions, and health metrics.
 */

import type { JSX } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Activity, CheckCircle2, Layers, Ticket } from 'lucide-react';

interface StatProps {
  icon: LucideIcon;
  label: string;
  value: string;
  detail: string;
}

function Stat({ icon: Icon, label, value, detail }: StatProps): JSX.Element {
  return (
    <div className="min-w-0 border border-border/70 bg-card p-3.5">
      <div className="flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.13em] text-primary">
        <Icon className="size-4 text-primary" />
        {label}
      </div>
      <p className="mt-2 truncate font-mono text-lg font-semibold tabular-nums text-foreground sm:text-xl">
        {value}
      </p>
      <p className="mt-1 truncate text-[11px] text-muted-foreground" title={detail}>
        {detail}
      </p>
    </div>
  );
}

interface TicketSummaryStripProps {
  totalTickets: number;
  completedCount: number;
  totalRuns: number;
  executionHealth: string;
}

export function TicketSummaryStrip({
  totalTickets,
  completedCount,
  totalRuns,
  executionHealth,
}: TicketSummaryStripProps): JSX.Element {
  return (
    <section
      aria-label="Tickets summary"
      className="grid gap-px overflow-hidden border border-border/70 bg-border/70 sm:grid-cols-2 xl:grid-cols-4"
    >
      <Stat
        icon={Ticket}
        label="Total Tickets"
        value={`${totalTickets} tickets`}
        detail={`${completedCount} completed · ${Math.max(0, totalTickets - completedCount)} in progress`}
      />
      <Stat
        icon={Layers}
        label="Executed Stages"
        value={`${totalRuns} runs`}
        detail="Ingest, Preprocessing & Enrichment transitions"
      />
      <Stat
        icon={CheckCircle2}
        label="Completed Tickets"
        value={`${completedCount} tickets`}
        detail="End-to-end verified pipeline runs"
      />
      <Stat
        icon={Activity}
        label="Execution Health"
        value={executionHealth}
        detail={`${completedCount} tickets completed without errors`}
      />
    </section>
  );
}

