import type { JSX } from 'react';
import { Play, Square } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { formatDate, stateLabel, statusVariant } from '../constants';

export interface EnrichmentControlCardProps {
  activeTicket: string;
  setActiveTicket: (ticket: string) => void;
  tickets: Array<{ ticket_id: string; description?: string }>;
  mode: 'stream' | 'batch';
  setMode: (mode: 'stream' | 'batch') => void;
  maxBatchRecords: number;
  setMaxBatchRecords: (n: number) => void;
  idleFlushSeconds: number;
  setIdleFlushSeconds: (n: number) => void;
  busy: boolean;
  isFrozen: boolean;
  onStart: () => void;
  onStop: () => void;
  runtimeState: string;
  lastSignalAt?: string;
}

export function EnrichmentControlCard({
  activeTicket,
  setActiveTicket,
  tickets,
  mode,
  setMode,
  maxBatchRecords,
  setMaxBatchRecords,
  idleFlushSeconds,
  setIdleFlushSeconds,
  busy,
  isFrozen,
  onStart,
  onStop,
  runtimeState,
  lastSignalAt,
}: EnrichmentControlCardProps): JSX.Element {
  return (
    <Card className="h-fit rounded-none border-border/80 shadow-none">
      <CardHeader className="border-b border-border/60 pb-4">
        <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-primary">Control Protocol / Run Lifecycle</p>
        <CardTitle className="mt-1 text-lg">Configure Enrichment</CardTitle>
        <CardDescription>Select batching parameters, coalescing mode, and flush intervals.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5 p-4 sm:p-5">
        {/* Runner Ticket Select */}
        <label htmlFor="runner-ticket-select" className="block space-y-2 text-xs font-medium text-muted-foreground">
          <span className="flex items-center justify-between">
            <span>Runner Ticket</span>
            <span className="font-mono text-[10px] font-normal">EXECUTION SCOPE</span>
          </span>
          <select
            id="runner-ticket-select"
            value={activeTicket}
            onChange={(e) => setActiveTicket(e.target.value)}
            disabled={busy || !isFrozen}
            className="h-10 w-full rounded-none border border-input bg-background px-3 font-mono text-xs text-foreground outline-none focus:border-ring focus:ring-1 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
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
              <option value="">No runner ticket available</option>
            )}
          </select>
        </label>

        {/* Mode Select */}
        <label htmlFor="enrichment-mode" className="block space-y-2 text-xs font-medium text-muted-foreground">
          <span className="flex items-center justify-between">
            <span>Processing Mode</span>
            <span className="font-mono text-[10px] font-normal">STREAM / BATCH</span>
          </span>
          <select
            id="enrichment-mode"
            value={mode}
            onChange={(event) => setMode(event.target.value as 'stream' | 'batch')}
            disabled={busy || !isFrozen}
            className="h-10 w-full rounded-none border border-input bg-background px-3 font-mono text-xs text-foreground outline-none focus:border-ring focus:ring-1 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
          >
            <option value="stream">STREAM · coalesce Silver stream</option>
            <option value="batch">BATCH · drain available backlog</option>
          </select>
        </label>

        {/* Max Batch Records */}
        <label htmlFor="enrichment-batch" className="block space-y-2 text-xs font-medium text-muted-foreground">
          <span className="flex items-center justify-between">
            <span>Max LC / Batch</span>
            <span className="font-mono text-[10px] font-normal">100—5000</span>
          </span>
          <select
            id="enrichment-batch"
            value={String(maxBatchRecords)}
            onChange={(event) => setMaxBatchRecords(Number(event.target.value))}
            disabled={busy || !isFrozen}
            className="h-10 w-full rounded-none border border-input bg-background px-3 font-mono text-xs text-foreground outline-none focus:border-ring focus:ring-1 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
          >
            {[100, 250, 500, 1000, 2500, 5000].map((val) => (
              <option key={val} value={String(val)}>{val.toLocaleString()} records</option>
            ))}
          </select>
        </label>

        {/* Idle Flush Window */}
        {mode === 'stream' && (
          <label htmlFor="enrichment-flush" className="block space-y-2 text-xs font-medium text-muted-foreground">
            <span className="flex items-center justify-between">
              <span>Idle Flush Window</span>
              <span className="font-mono text-[10px] font-normal">TIMED TRIGGER</span>
            </span>
            <select
              id="enrichment-flush"
              value={String(idleFlushSeconds)}
              onChange={(event) => setIdleFlushSeconds(Number(event.target.value))}
              disabled={busy || !isFrozen}
              className="h-10 w-full rounded-none border border-input bg-background px-3 font-mono text-xs text-foreground outline-none focus:border-ring focus:ring-1 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
            >
              {[[60, '1 minute'], [120, '2 minutes'], [180, '3 minutes'], [300, '5 minutes'], [600, '10 minutes'], [900, '15 minutes']].map(([val, label]) => (
                <option key={val} value={String(val)}>{label}</option>
              ))}
            </select>
          </label>
        )}

        {/* Action Buttons */}
        {isFrozen ? (
          <Button onClick={onStart} disabled={busy} className="w-full rounded-none gap-2 font-mono text-xs uppercase">
            <Play className="size-3.5 fill-current" />
            {busy ? 'Starting Run…' : 'Launch Gold Run'}
          </Button>
        ) : (
          <Button onClick={onStop} disabled={busy} variant="destructive" className="w-full rounded-none gap-2 font-mono text-xs uppercase">
            <Square className="size-3.5 fill-current" />
            {busy ? 'Requesting Freeze…' : 'Freeze & Drain Run'}
          </Button>
        )}

        {/* Metadata KV */}
        <div className="space-y-2 border-t border-border/60 pt-4 text-xs">
          <div className="flex items-center justify-between gap-3">
            <span className="text-muted-foreground">State</span>
            <Badge variant={statusVariant(runtimeState)} className="rounded-none font-mono text-[10px]">
              {stateLabel[runtimeState] ?? runtimeState}
            </Badge>
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="text-muted-foreground">Mode</span>
            <span className="font-mono uppercase text-foreground">{mode}</span>
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="text-muted-foreground">Last Signal</span>
            <span className="font-mono text-[10px] text-foreground">{formatDate(lastSignalAt)}</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
