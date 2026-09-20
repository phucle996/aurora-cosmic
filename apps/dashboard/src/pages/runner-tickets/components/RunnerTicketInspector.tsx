/**
 * @file RunnerTicketInspector.tsx
 * @description Detail inspector displaying pipeline execution runs (starts, stops, completions) per runner ticket.
 */

import { useMemo } from 'react';
import type { JSX } from 'react';
import { ArrowRight, Clock3, GitBranch, LoaderCircle } from 'lucide-react';
import { Link } from 'react-router-dom';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { ExecutionActionRecord, ExecutionActionType, TicketRecord } from '../types';
import { displayTime, normalizedStatus, parseTime } from '../utils';

interface RunnerTicketInspectorProps {
  ticket?: TicketRecord;
  loading: boolean;
}

const PIPELINE_NAMES: Record<string, string> = {
  bronze_ingest: 'Bronze Ingest',
  ingest: 'Bronze Ingest',
  bronze: 'Bronze Ingest',
  silver_preprocess: 'Silver Preprocessing',
  preprocessing: 'Silver Preprocessing',
  silver: 'Silver Preprocessing',
  silver_to_gold: 'Gold Enrichment',
  enrichment: 'Gold Enrichment',
  gold: 'Gold Enrichment',
};

function formatPipelineName(id: string): string {
  const lower = id.toLowerCase();
  if (PIPELINE_NAMES[lower]) return PIPELINE_NAMES[lower];
  if (lower.includes('gold') || lower.includes('enrich')) return 'Gold Enrichment';
  if (lower.includes('silver') || lower.includes('preprocess')) return 'Silver Preprocessing';
  if (lower.includes('bronze') || lower.includes('ingest')) return 'Bronze Ingest';
  return id.replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function actionDotColor(action: ExecutionActionType): string {
  switch (action) {
    case 'started':
    case 'completed':
      return 'bg-emerald-600 dark:bg-emerald-400 shadow-[0_0_6px_rgba(16,185,129,0.35)]';
    case 'running':
      return 'bg-sky-600 dark:bg-sky-400 animate-pulse shadow-[0_0_6px_rgba(56,189,248,0.35)]';
    case 'stopped':
      return 'bg-amber-600 dark:bg-amber-400 shadow-[0_0_6px_rgba(245,158,11,0.35)]';
    case 'failed':
      return 'bg-rose-600 dark:bg-rose-400 shadow-[0_0_6px_rgba(244,63,94,0.35)]';
    default:
      return 'bg-primary';
  }
}

function actionBadgeClass(action: ExecutionActionType): string {
  switch (action) {
    case 'started':
    case 'completed':
      return 'border border-emerald-300 bg-emerald-100/90 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300';
    case 'running':
      return 'border border-sky-300 bg-sky-100/90 text-sky-900 dark:border-sky-800 dark:bg-sky-950/50 dark:text-sky-300';
    case 'stopped':
      return 'border border-amber-300 bg-amber-100/90 text-amber-900 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-300';
    case 'failed':
      return 'border border-rose-300 bg-rose-100/90 text-rose-900 dark:border-rose-800 dark:bg-rose-950/50 dark:text-rose-300';
    default:
      return 'border border-border/80 bg-muted/60 text-muted-foreground';
  }
}

export function RunnerTicketInspector({
  ticket,
  loading,
}: RunnerTicketInspectorProps): JSX.Element {
  // Build execution run actions directly from ticket.runs (from DB table aurora.pipeline_runs_v1)
  const actions: ExecutionActionRecord[] = useMemo(() => {
    if (!ticket) return [];
    const items: ExecutionActionRecord[] = [];

    // Map each pipeline run from the database into start and finish action records
    for (let i = 0; i < ticket.runs.length; i++) {
      const r = ticket.runs[i];
      const targetName = formatPipelineName(r.pipeline);

      if (r.started_at) {
        items.push({
          id: `run-start-${r.pipeline}-${r.started_at}-${i}`,
          timestamp: r.started_at,
          action: 'started',
          actionLabel: 'Started',
          target: targetName,
          detail: r.mode ? `Mode: ${r.mode.toUpperCase()}` : undefined,
          snapshotId: r.last_snapshot_id,
        });
      }

      const finishedTimestamp =
        r.finished_at ?? (r.updated_at && r.updated_at !== r.started_at ? r.updated_at : undefined);

      if (finishedTimestamp) {
        const s = normalizedStatus(r.status);
        const isFailed = s === 'failed' || s === 'error';
        const isCompleted = s === 'completed';
        const isFrozen = s === 'frozen' || s === 'paused';

        items.push({
          id: `run-finish-${r.pipeline}-${finishedTimestamp}-${i}`,
          timestamp: finishedTimestamp,
          action: isFailed ? 'failed' : isCompleted ? 'completed' : 'stopped',
          actionLabel: isFailed
            ? 'Failed'
            : isCompleted
              ? 'Completed'
              : isFrozen
                ? 'Stopped (Frozen)'
                : 'Stopped',
          target: targetName,
          detail: r.last_error || (r.output_rows > 0 ? `${r.output_rows} rows produced` : undefined),
          snapshotId: r.last_snapshot_id,
        });
      }
    }

    // Fallback to ticket root session timestamps if runs array is empty
    if (items.length === 0 && ticket.started_at) {
      items.push({
        id: `ticket-start-${ticket.ticket_id}`,
        timestamp: ticket.started_at,
        action: 'started',
        actionLabel: 'Started',
        target: 'Pipeline Run',
        detail: ticket.mode ? `Mode: ${ticket.mode.toUpperCase()}` : undefined,
      });

      const finishedTime =
        ticket.finished_at ??
        (ticket.updated_at && ticket.updated_at !== ticket.started_at ? ticket.updated_at : undefined);

      if (finishedTime) {
        items.push({
          id: `ticket-stop-${ticket.ticket_id}`,
          timestamp: finishedTime,
          action: 'stopped',
          actionLabel: 'Stopped',
          target: 'Pipeline Run',
          detail: ticket.last_error,
        });
      }
    }

    // Sort descending by timestamp (newest run action first)
    items.sort((a, b) => {
      const tA = parseTime(a.timestamp)?.getTime() ?? 0;
      const tB = parseTime(b.timestamp)?.getTime() ?? 0;
      return tB - tA;
    });

    return items;
  }, [ticket]);


  if (!ticket) {
    return (
      <Card className="rounded-none border-border/80 bg-card shadow-none">
        <CardContent className="flex min-h-[500px] flex-col items-center justify-center gap-2 p-8 text-center">
          <GitBranch className="size-7 text-muted-foreground/50" />
          <p className="text-sm font-medium">Select a runner ticket to inspect</p>
          <p className="text-xs text-muted-foreground">Execution history will load here.</p>
        </CardContent>
      </Card>
    );
  }

  const stoppedTime = ticket.finished_at
    ? displayTime(ticket.finished_at)
    : ticket.updated_at && ticket.updated_at !== ticket.started_at
      ? displayTime(ticket.updated_at)
      : '—';

  return (
    <Card className="min-w-0 rounded-none border-border/80 bg-card shadow-none">
      <CardHeader className="border-b border-border/70 p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="font-mono text-[9px] uppercase tracking-[0.12em] text-primary">Runner Ticket Inspection</p>
            <CardTitle className="mt-1 truncate font-mono text-sm text-foreground" title={ticket.ticket_id}>
              {ticket.ticket_id}
            </CardTitle>
          </div>
        </div>

        {/* Overview Row: Started & Stopped */}
        <div className="grid grid-cols-2 gap-2 border-y border-border/60 py-2.5 text-[11px]">
          <div>
            <span className="text-muted-foreground">Started: </span>
            <span className="font-mono text-[10px] text-foreground">{ticket.started_at ? displayTime(ticket.started_at) : '—'}</span>
          </div>
          <div>
            <span className="text-muted-foreground">Stopped: </span>
            <span className="font-mono text-[10px] text-foreground">{stoppedTime}</span>
          </div>
          {ticket.last_error ? (
            <div className="col-span-2 border-l-2 border-destructive bg-destructive/10 px-2 py-1.5 text-[10px] text-destructive">
              {ticket.last_error}
            </div>
          ) : null}
        </div>

        {/* Action Button */}
        <div className="pt-1">
          <Button asChild size="sm" variant="outline" className="h-8 w-full rounded-none font-mono text-[9px] uppercase">
            <Link to={`/data-factory/pipeline?run_id=${encodeURIComponent(ticket.ticket_id)}`}>
              Inspect in DAG
              <ArrowRight className="ml-1 size-3.5" />
            </Link>
          </Button>
        </div>
      </CardHeader>

      <CardContent className="space-y-4 p-4">
        {loading && !ticket ? (
          <div className="flex min-h-72 items-center justify-center gap-2 text-xs text-muted-foreground">
            <LoaderCircle className="size-4 animate-spin text-primary" />
            Loading execution history…
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between">
              <div>
                <p className="font-mono text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                  Execution History
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Recorded pipeline stage runs and executions for this ticket.
                </p>
              </div>
              <Badge variant="outline" className="rounded-none font-mono text-[9px] text-foreground border-border/80">
                {actions.length} {actions.length === 1 ? 'action' : 'actions'}
              </Badge>
            </div>

            {/* Actions list */}
            {actions.length === 0 ? (
              <div className="border border-dashed border-border/70 p-6 text-center">
                <Clock3 className="mx-auto size-7 text-muted-foreground/40" />
                <p className="mt-2 text-sm font-medium text-foreground">No execution history recorded</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  This runner ticket has not recorded any execution runs yet.
                </p>
              </div>
            ) : (
              <div className="max-h-[540px] overflow-y-auto pr-1 space-y-1.5">
                {actions.map((item) => (
                  <div
                    key={item.id}
                    className="flex flex-col gap-1 border border-border/70 bg-card p-2.5 font-mono text-xs transition-colors hover:bg-muted/30 dark:bg-background/40 dark:hover:bg-muted/20"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex min-w-0 items-center gap-2">
                        <span className={`size-2 shrink-0 rounded-full ${actionDotColor(item.action)}`} />
                        <span className="truncate font-semibold text-foreground" title={item.target}>
                          {item.target}
                        </span>
                        <span
                          className={`shrink-0 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wider ${actionBadgeClass(
                            item.action,
                          )}`}
                        >
                          {item.actionLabel}
                        </span>
                      </div>
                      <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                        {displayTime(item.timestamp)}
                      </span>
                    </div>
                    {item.detail ? (
                      <div className="pl-4 text-[10px] text-muted-foreground truncate" title={item.detail}>
                        {item.detail}
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}


