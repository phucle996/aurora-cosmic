import type { JSX } from 'react';
import { Pause, Play, Terminal, Trash2 } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { actionLabel, shortTime } from '../constants';
import type { EventRow } from '../types';

export interface SynthesisActivityLogProps {
  eventRows: EventRow[];
  pausedFeed: boolean;
  onTogglePause: () => void;
  onClear: () => void;
}

export function SynthesisActivityLog({
  eventRows,
  pausedFeed,
  onTogglePause,
  onClear,
}: SynthesisActivityLogProps): JSX.Element {
  return (
    <Card className="rounded-none border-border/80 shadow-none">
      <CardHeader className="border-b border-border/70 pb-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle className="flex items-center gap-2 text-sm">
              <Terminal className="size-4 text-primary" />
              Synthesis Activity Stream
            </CardTitle>
            <CardDescription>Live timeline of worker lifecycle, batch dequeues, catalog syncs, and snapshot commits.</CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-[10px] text-muted-foreground">{eventRows.length} events</span>
            {pausedFeed && (
              <Badge variant="secondary" className="rounded-none font-mono text-[9px] uppercase tracking-wider text-amber-400 bg-amber-500/10 border-amber-500/30">
                Stream Paused
              </Badge>
            )}
            <Button
              variant={pausedFeed ? 'secondary' : 'outline'}
              size="sm"
              onClick={onTogglePause}
              className="h-7 rounded-none px-2.5 font-mono text-[10px] gap-1.5"
              title={pausedFeed ? 'Resume auto-scrolling live telemetry stream' : 'Pause auto-scrolling live telemetry stream'}
            >
              {pausedFeed ? (
                <>
                  <Play className="size-3 fill-current text-emerald-400" />
                  <span>Resume</span>
                </>
              ) : (
                <>
                  <Pause className="size-3 fill-current text-amber-400" />
                  <span>Pause</span>
                </>
              )}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={onClear}
              className="h-7 rounded-none px-2.5 font-mono text-[10px] gap-1.5 text-muted-foreground hover:text-foreground"
              title="Clear activity log"
            >
              <Trash2 className="size-3" />
              <span>Clear</span>
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="max-h-80 overflow-auto bg-slate-950 p-0 text-slate-200">
        {eventRows.length === 0 ? (
          <p className="p-4 font-mono text-[11px] text-slate-500">$ awaiting worker telemetry stream…</p>
        ) : (
          eventRows.map((row) => (
            <div key={row.id} className="grid gap-1 border-b border-slate-800 px-3 py-2 font-mono text-[10px] sm:grid-cols-[90px_90px_100px_minmax(0,1fr)]">
              <span className="text-slate-500">{shortTime(row.observedAt)}</span>
              <span className="text-cyan-400 font-medium">{row.worker.worker_id}</span>
              <span className={row.worker.lifecycle === 'KILLED' ? 'text-rose-400' : 'text-emerald-400 font-semibold'}>
                {row.worker.lifecycle}
              </span>
              <span>
                <strong className="font-medium text-slate-100">{actionLabel[row.worker.action] ?? row.worker.action}</strong>
                {row.worker.detail && <span className="ml-2 text-slate-400">{row.worker.detail}</span>}
              </span>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}
