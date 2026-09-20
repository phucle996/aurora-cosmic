/**
 * @file TicketHeroBanner.tsx
 * @description Header hero banner for the Runner Tickets workflow node.
 */

import type { JSX } from 'react';
import { Plus, Ticket } from 'lucide-react';

import { Button } from '@/components/ui/button';

interface TicketHeroBannerProps {
  onCreateNew: () => void;
}

export function TicketHeroBanner({ onCreateNew }: TicketHeroBannerProps): JSX.Element {
  return (
    <section className="relative overflow-hidden border border-border/70 bg-card px-4 py-5 shadow-sm sm:px-6">
      <div className="pointer-events-none absolute inset-0 opacity-[0.18] [background-image:linear-gradient(to_right,var(--border)_1px,transparent_1px),linear-gradient(to_bottom,var(--border)_1px,transparent_1px)] [background-size:28px_28px]" />
      <div className="relative">
        <div className="mb-3 flex items-center gap-2 font-mono text-[10px] font-medium uppercase tracking-[0.18em] text-primary">
          <Ticket className="size-4" aria-hidden="true" />
          Data Factory / Execution & Governance Node
        </div>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="font-heading text-2xl font-semibold tracking-tight md:text-3xl">Runner Tickets</h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              Track ticket-scoped stage execution history across Bronze Ingest, Silver Preprocessing, and Gold Enrichment.
            </p>
          </div>
          <Button
            size="sm"
            className="h-9 w-fit rounded-none font-mono text-xs uppercase gap-1.5"
            onClick={onCreateNew}
            title="Create a new runner ticket"
          >
            <Plus className="size-3.5" />
            New Ticket
          </Button>
        </div>
      </div>
    </section>
  );
}
