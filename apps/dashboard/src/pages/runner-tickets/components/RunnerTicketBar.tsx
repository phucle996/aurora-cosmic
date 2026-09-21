import type { JSX } from 'react';
import { Plus, Ticket } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useRunnerTicket } from '@/lib/runner-ticket';

interface RunnerTicketBarProps {
  className?: string;
  onTicketChange?: (ticket: string) => void;
  allowCreate?: boolean;
}

export function RunnerTicketBar({
  className = '',
  onTicketChange,
  allowCreate = false,
}: RunnerTicketBarProps): JSX.Element {
  const { activeTicket, setActiveTicket, createNewTicket, tickets } = useRunnerTicket();

  const handleSelect = (ticket: string) => {
    setActiveTicket(ticket);
    onTicketChange?.(ticket);
  };

  const handleQuickNew = () => {
    const created = createNewTicket();
    onTicketChange?.(created);
  };

  return (
    <div className={`border border-border/70 bg-card/60 px-4 py-3 sm:px-5 ${className}`}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <div className="flex size-7 shrink-0 items-center justify-center border border-primary/40 bg-primary/10 text-primary">
            <Ticket className="size-4" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-primary">
                Runner Ticket
              </span>
            </div>
            <p className="truncate text-xs text-muted-foreground">
              Controls unified data flow and lineage across Ingest, Preprocessing, and Enrichment.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center">
            <select
              value={activeTicket}
              onChange={(e) => handleSelect(e.target.value)}
              className="h-8 rounded-none border border-input bg-background px-2.5 font-mono text-xs font-medium text-foreground outline-none focus:border-ring"
              title="Select runner ticket"
            >
              {tickets.length > 0 ? (
                tickets.map((t) => (
                  <option key={t.ticket_id} value={t.ticket_id}>
                    {t.ticket_id} {t.description ? `(${t.description})` : ''}
                  </option>
                ))
              ) : activeTicket ? (
                <option value={activeTicket}>{activeTicket}</option>
              ) : (
                <option value="">No tickets available</option>
              )}
            </select>
          </div>

          {allowCreate && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleQuickNew}
              className="h-8 rounded-none gap-1.5 font-mono text-xs uppercase"
              title="Create a new runner ticket"
            >
              <Plus className="size-3.5" />
              New Ticket
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
