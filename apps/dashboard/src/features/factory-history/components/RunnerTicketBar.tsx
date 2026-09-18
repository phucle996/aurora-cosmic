import type { JSX } from 'react';
import { Plus, Ticket } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useRunnerTicket } from '../runner-ticket';

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
  const { activeTicket, setActiveTicket, createNewTicket, recentTickets } = useRunnerTicket();

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
              <Badge variant="outline" className="h-4 rounded-none border-emerald-500/40 bg-emerald-500/10 px-1 font-mono text-[9px] text-emerald-400">
                <span className="mr-1 inline-block size-1.5 animate-pulse rounded-full bg-emerald-400" />
                ACTIVE
              </Badge>
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
              <option value={activeTicket}>{activeTicket}</option>
              {recentTickets
                .filter((t) => t !== activeTicket)
                .map((ticket) => (
                  <option key={ticket} value={ticket}>
                    {ticket}
                  </option>
                ))}
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
