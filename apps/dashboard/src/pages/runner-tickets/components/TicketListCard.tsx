/**
 * @file TicketListCard.tsx
 * @description Master table listing all runner tickets with search and active state indicators.
 */

import type { JSX } from 'react';
import { Clock3, LoaderCircle, Search } from 'lucide-react';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import type { TicketRecord } from '../types';
import { displayTime } from '../utils';

interface TicketRowProps {
  ticket: TicketRecord;
  selected: boolean;
  onSelect: () => void;
}

function TicketRow({ ticket, selected, onSelect }: TicketRowProps): JSX.Element {
  const createdAt = ticket.started_at ?? ticket.updated_at;

  return (
    <tr
      onClick={onSelect}
      className={`cursor-pointer border-b border-border/60 transition-colors last:border-0 ${selected ? 'bg-primary/10 shadow-[inset_2px_0_0_hsl(var(--primary))]' : 'hover:bg-muted/30'
        }`}
    >
      <td className="p-3 pl-4">
        <div className="flex items-center gap-2">
          <p className="max-w-56 truncate font-mono text-xs font-medium text-primary" title={ticket.ticket_id}>
            {ticket.ticket_id}
          </p>
        </div>
        <p className="mt-1 max-w-56 truncate font-mono text-[9px] text-muted-foreground" title={ticket.last_snapshot_id}>
          {ticket.last_snapshot_id || (ticket.runs.length > 0 ? `${ticket.runs.length} execution(s)` : 'fresh ticket')}
        </p>
      </td>
      <td className="p-3 text-right">
        <p className="font-mono text-xs text-foreground">{createdAt ? displayTime(createdAt) : '—'}</p>
      </td>
    </tr>
  );
}

interface TicketListCardProps {
  tickets: TicketRecord[];
  totalTicketsCount: number;
  selectedRunID?: string;
  searchQuery: string;
  onSearchChange: (query: string) => void;
  onSelectTicket: (ticketId: string) => void;
  loading: boolean;
}

export function TicketListCard({
  tickets,
  totalTicketsCount,
  selectedRunID,
  searchQuery,
  onSearchChange,
  onSelectTicket,
  loading,
}: TicketListCardProps): JSX.Element {
  return (
    <Card className="min-w-0 rounded-none border-border/80 shadow-none">
      <CardHeader className="gap-3 border-b border-border/70 p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <CardTitle className="text-sm">Ticket List</CardTitle>
            <CardDescription>Select a runner ticket to inspect execution history.</CardDescription>
          </div>
          <span className="font-mono text-[10px] text-muted-foreground">
            {tickets.length} / {totalTicketsCount} tickets
          </span>
        </div>
        <div className="relative">
          <span className="sr-only">Search ticket</span>
          <Search className="absolute left-2.5 top-2.5 size-3.5 text-muted-foreground" />
          <input
            value={searchQuery}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder="Search ticket ID or snapshot…"
            className="h-9 w-full rounded-none border border-input bg-background pl-8 pr-3 text-xs outline-none focus:border-ring"
          />
        </div>
      </CardHeader>

      <CardContent className="p-0">
        {loading && totalTicketsCount === 0 ? (
          <div className="flex min-h-72 items-center justify-center gap-2 text-xs text-muted-foreground">
            <LoaderCircle className="size-4 animate-spin text-primary" />
            Loading runner tickets…
          </div>
        ) : tickets.length === 0 ? (
          <div className="flex min-h-72 flex-col items-center justify-center gap-2 p-8 text-center">
            <Clock3 className="size-6 text-muted-foreground/60" />
            <p className="text-sm font-medium">No matching runner tickets</p>
            <p className="max-w-md text-xs text-muted-foreground">
              Runner tickets will appear after pipeline activity is recorded or created.
            </p>
          </div>
        ) : (
          <div className="max-h-[620px] overflow-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-10 border-b bg-card text-left font-mono text-[9px] uppercase tracking-[0.1em] text-muted-foreground">
                <tr>
                  <th className="p-3 pl-4">Runner Ticket</th>
                  <th className="p-3 text-right">Created At</th>
                </tr>
              </thead>
              <tbody>
                {tickets.map((ticket) => (
                  <TicketRow
                    key={ticket.ticket_id}
                    ticket={ticket}
                    selected={ticket.ticket_id === selectedRunID}
                    onSelect={() => onSelectTicket(ticket.ticket_id)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
