import type { JSX } from 'react';
import { Check, Timer, Wifi } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import {
  PIPELINE_STEPS,
  actionLabel,
  formatDate,
  shortTime,
  stateLabel,
  statusVariant,
} from '../constants';
import type { ConnectionState, GoldWorkerTelemetry } from '../types';

export interface AssemblySequenceCardProps {
  runtimeState: string;
  synthesisPercent: number;
  readyLightcurves: number;
  pendingTotal: number;
  workers: GoldWorkerTelemetry[];
  nextFlushAt?: string;
  connection: ConnectionState;
}

export function AssemblySequenceCard({
  runtimeState,
  synthesisPercent,
  readyLightcurves,
  pendingTotal,
  workers,
  nextFlushAt,
  connection,
}: AssemblySequenceCardProps): JSX.Element {
  return (
    <Card className="min-w-0 rounded-none border-border/80 shadow-none">
      <CardHeader className="border-b border-border/60 pb-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-primary">Live Synthesis / Runtime Telemetry</p>
            <CardTitle className="mt-1 text-lg">Gold Feature Assembly Sequence</CardTitle>
            <CardDescription>Track ingestion, modality pairing, stellar catalog resolution, and snapshot commits.</CardDescription>
          </div>
          <Badge variant={statusVariant(runtimeState)} className="w-fit rounded-none font-mono text-[10px]">
            {stateLabel[runtimeState] ?? runtimeState}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-5 p-4 sm:p-5">
        {/* Progress Hero */}
        <div className="border border-primary/25 bg-primary/[0.035] p-4 sm:p-5">
          <div className="mb-3 flex items-end justify-between gap-4">
            <div>
              <p className="text-xs font-medium text-muted-foreground">Gold Feature Assembly Completion</p>
              <p className="mt-1 font-mono text-3xl font-semibold tracking-tight tabular-nums sm:text-4xl">
                {synthesisPercent.toFixed(synthesisPercent > 0 && synthesisPercent < 1 ? 1 : 0)}
                <span className="text-lg text-muted-foreground">%</span>
              </p>
            </div>
            <p className="text-right font-mono text-xs text-muted-foreground">
              {readyLightcurves.toLocaleString()} paired eligible<br />
              {pendingTotal.toLocaleString()} pending intake
            </p>
          </div>
          <Progress value={synthesisPercent} className="h-2" />
        </div>

        {/* Worker Field Array */}
        <div>
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium">Worker Field Array</p>
              <p className="text-xs text-muted-foreground">Real-time execution footsteps per worker slot across intake, pairing, catalog, extract, parquet, index, and commit.</p>
            </div>
            <span className="font-mono text-xs text-muted-foreground">{workers.length} spawned</span>
          </div>
          {workers.length === 0 ? (
            <div className="border border-dashed border-border/70 px-3 py-5 text-center text-xs text-muted-foreground">
              No active Gold synthesis workers observed.
            </div>
          ) : (
            <div className="space-y-2.5">
              {workers.map((worker) => {
                const isKilled = worker.lifecycle === 'KILLED';
                const isProcessing = /MATERIALIZING|SYNCING|COMMITTING|DEQUEUED|VERIFYING|EXTRACTING|INDEXING/.test(worker.action);
                const isFailed = /FAILED|RETRY/.test(worker.action);
                const currentStep = worker.step_index ?? 0;
                const isCommitted = worker.action === 'SNAPSHOT_COMMITTED';

                return (
                  <div key={worker.worker_id} className="border border-border/70 bg-background/50 p-3 sm:p-3.5">
                    <div className="grid gap-2 sm:grid-cols-[7.5rem_minmax(0,1fr)_8rem] sm:items-center sm:gap-4">
                      <div className="flex items-center gap-2">
                        <span className={`size-2 rounded-full ${isKilled ? 'bg-rose-500' : isFailed ? 'bg-amber-500' : isProcessing ? 'animate-pulse bg-primary' : 'bg-emerald-500'}`} />
                        <span className="font-mono text-xs font-semibold text-foreground">{worker.worker_id}</span>
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="truncate font-mono text-[11px] font-medium text-foreground" title={worker.action}>
                            {actionLabel[worker.action] ?? worker.action}
                          </p>
                          {worker.step_name && worker.step_name !== 'IDLE' && (
                            <Badge variant="outline" className="h-4 rounded-none px-1 font-mono text-[9px] uppercase text-primary border-primary/40">
                              {worker.step_name}
                            </Badge>
                          )}
                        </div>
                        <p className="mt-0.5 truncate font-mono text-[10px] text-muted-foreground" title={worker.detail}>
                          {worker.detail || `${worker.input_count.toLocaleString()} inputs claimed`}
                        </p>
                      </div>
                      <div className="sm:text-right">
                        <Badge variant={isKilled ? 'destructive' : isProcessing ? 'default' : 'outline'} className="rounded-none font-mono text-[9px] uppercase">
                          {worker.lifecycle}
                        </Badge>
                        <p className="mt-1 font-mono text-[9px] text-muted-foreground">{shortTime(worker.updated_at)}</p>
                      </div>
                    </div>

                    {/* 7-Step Footstep Pipeline Stepper */}
                    <div className="mt-3 grid grid-cols-2 gap-1.5 border-t border-border/50 pt-2.5 sm:grid-cols-4 lg:grid-cols-7">
                      {PIPELINE_STEPS.map((s) => {
                        const isDone = isCommitted || s.step < currentStep;
                        const isActive = !isCommitted && currentStep === s.step;
                        return (
                          <div
                            key={s.key}
                            className={`flex items-center justify-between gap-1 border px-2 py-1.5 font-mono text-[10px] transition-colors ${
                              isDone
                                ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-400 font-medium'
                                : isActive
                                ? isFailed
                                  ? 'border-amber-500/70 bg-amber-500/15 text-amber-300 font-semibold'
                                  : 'border-primary bg-primary/10 text-primary font-semibold shadow-[inset_0_1px_0_hsl(var(--primary))]'
                                : 'border-border/40 bg-background/30 text-muted-foreground/50'
                            }`}
                          >
                            <span className="truncate">{s.label}</span>
                            {isDone ? (
                              <Check className="size-3 shrink-0 text-emerald-400" />
                            ) : isActive ? (
                              <span className={`size-1.5 shrink-0 rounded-full ${isFailed ? 'bg-amber-400' : 'animate-ping bg-primary'}`} />
                            ) : null}
                          </div>
                        );
                      })}
                    </div>

                    {/* Worker telemetry details footer */}
                    <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 border-t border-border/40 pt-2 font-mono text-[9px] text-muted-foreground">
                      <span>{worker.input_count.toLocaleString()} inputs processed</span>
                      {worker.snapshot_id && (
                        <span className="text-primary truncate max-w-[200px]" title={worker.snapshot_id}>
                          Snapshot: {worker.snapshot_id.slice(0, 18)}…
                        </span>
                      )}
                      <span>Ticket: {worker.ticket_id || worker.command_id || 'untracked'}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Timers Footer */}
        <div className="grid gap-3 border-t border-border/60 pt-4 sm:grid-cols-2">
          <div className="flex gap-2 text-xs text-muted-foreground">
            <Timer className="size-4 shrink-0 text-primary" />
            <span>Next Flush <b className="ml-1 font-mono font-medium text-foreground">{formatDate(nextFlushAt)}</b></span>
          </div>
          <div className="flex gap-2 text-xs text-muted-foreground">
            <Wifi className="size-4 shrink-0 text-primary" />
            <span>{connection === 'live' ? 'Live synthesis feed connected' : 'Reconnecting to telemetry…'}</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
