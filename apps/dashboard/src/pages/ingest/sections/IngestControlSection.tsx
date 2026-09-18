import type { FormEvent, JSX } from 'react';
import { Play, Square } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import type { IngestStatus, PlanningSignal } from '../types';
import { formatDate, statusVariant } from '../types';

interface IngestControlSectionProps {
  sector: string;
  setSector: (sector: string) => void;
  concurrency: string;
  setConcurrency: (concurrency: string) => void;
  isIngesting: boolean;
  isDraining: boolean;
  controlBusy: boolean;
  activeTicket: string;
  activeJobId?: string;
  activeStatus?: string;
  status: IngestStatus | null;
  planningSignal: PlanningSignal | null;
  manifestDiscoveryActive: boolean;
  manifestStageCompleted: number;
  manifestStageTotal: number;
  manifestProgressPercent: number;
  onStart: (e: FormEvent) => void;
  onCancel: () => void;
}

export function IngestControlSection({
  sector,
  setSector,
  concurrency,
  setConcurrency,
  isIngesting,
  isDraining,
  controlBusy,
  activeTicket,
  activeJobId,
  activeStatus,
  status,
  planningSignal,
  manifestDiscoveryActive,
  manifestStageCompleted,
  manifestStageTotal,
  manifestProgressPercent,
  onStart,
  onCancel,
}: IngestControlSectionProps): JSX.Element {
  return (
    <Card className="rounded-none border-border/80 shadow-none">
      <CardHeader className="border-b border-border/60 pb-4">
        <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-primary">Control protocol / new run</p>
        <CardTitle className="mt-1 text-lg">Configure acquisition</CardTitle>
        <CardDescription>Configure target sector range and concurrent worker pool concurrency.</CardDescription>
      </CardHeader>
      <CardContent className="p-4 sm:p-5">
        <form className="space-y-5" onSubmit={onStart}>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-1">
            <label htmlFor="sector-input" className="space-y-2 text-xs font-medium text-muted-foreground">
              <span className="flex items-center justify-between">
                <span>TESS sector</span>
                <span className="font-mono text-[10px] font-normal">01—100</span>
              </span>
              <Input
                id="sector-input"
                type="number"
                min="1"
                max="100"
                value={sector}
                onChange={(e) => setSector(e.target.value)}
                placeholder="1"
                disabled={controlBusy || isIngesting}
                className="font-mono"
              />
            </label>
            <label htmlFor="concurrency-input" className="space-y-2 text-xs font-medium text-muted-foreground">
              <span className="flex items-center justify-between">
                <span>Download workers</span>
                <span className="font-mono text-[10px] font-normal">01—32</span>
              </span>
              <Input
                id="concurrency-input"
                type="number"
                min="1"
                max="32"
                value={concurrency}
                onChange={(e) => setConcurrency(e.target.value)}
                placeholder="8"
                disabled={controlBusy || isIngesting}
                className="font-mono"
              />
            </label>
          </div>
          <div className="border-y border-border/60 py-3 text-xs text-muted-foreground">
            <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-primary">Safety envelope</p>
            <p className="mt-1.5 leading-5">
              Single-flight, checkpointed run. Bronze budget and retry state are managed by the ingester.
            </p>
          </div>
          {activeStatus === 'planning' && (status?.catalog_progress || status?.manifest_progress) && (
            <div className="space-y-3 border-y border-border/60 py-3">
              <div className="flex items-center justify-between gap-3">
                <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-primary">Planning progress</p>
                <Badge variant="secondary" className="rounded-none font-mono text-[10px]">
                  planning
                </Badge>
              </div>
              {status?.catalog_progress && (
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between gap-3 text-xs">
                    <span className="font-medium text-foreground">Catalog sync · TIC + TOI</span>
                    <span className="font-mono text-muted-foreground">
                      {status.catalog_progress.completed}/{status.catalog_progress.total}
                    </span>
                  </div>
                  <Progress
                    value={
                      status.catalog_progress.total > 0
                        ? (status.catalog_progress.completed / status.catalog_progress.total) * 100
                        : 0
                    }
                    className="h-1.5"
                  />
                  <p className="truncate font-mono text-[10px] text-muted-foreground" title={status.catalog_progress.stage}>
                    {status.catalog_progress.stage} · TOI {status.catalog_progress.toi_rows.toLocaleString()} · TIC{' '}
                    {status.catalog_progress.tic_rows.toLocaleString()}
                  </p>
                  {status.catalog_progress.error && (
                    <p className="text-[10px] text-destructive">{status.catalog_progress.error}</p>
                  )}
                </div>
              )}
              {status?.manifest_progress && (
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between gap-3 text-xs">
                    <span className="font-medium text-foreground">Research manifest</span>
                    <span className="font-mono text-muted-foreground">
                      {manifestDiscoveryActive && manifestStageTotal > 0
                        ? `${manifestStageCompleted.toLocaleString()}/${manifestStageTotal.toLocaleString()}`
                        : `${status.manifest_progress.completed}/${status.manifest_progress.total}`}
                    </span>
                  </div>
                  <Progress value={manifestProgressPercent} className="h-1.5" />
                  <p className="truncate font-mono text-[10px] text-muted-foreground" title={status.manifest_progress.stage}>
                    {status.manifest_progress.stage} ·{' '}
                    {manifestDiscoveryActive
                      ? `${status.manifest_progress.discovered_products.toLocaleString()} products resolved`
                      : `${status.manifest_progress.selected_samples.toLocaleString()} selected targets`}
                  </p>
                  {manifestDiscoveryActive && (
                    <p className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                      <span className="relative flex size-2">
                        <span className="absolute inline-flex size-2 animate-ping rounded-full bg-primary/70" />
                        <span className="relative inline-flex size-2 rounded-full bg-primary" />
                      </span>
                      MAST query active
                      {planningSignal?.occurredAt ? ` · updated ${formatDate(planningSignal.occurredAt)}` : ''}
                    </p>
                  )}
                  {status.manifest_progress.error && (
                    <p className="text-[10px] text-destructive">{status.manifest_progress.error}</p>
                  )}
                </div>
              )}
            </div>
          )}
          {isIngesting ? (
            <Button
              type="button"
              variant="destructive"
              className="w-full gap-2"
              onClick={onCancel}
              disabled={controlBusy || isDraining}
            >
              <Square className="size-4 fill-current" />
              {isDraining ? 'Draining active transfers…' : controlBusy ? 'Stopping…' : 'Stop Ingestion Run'}
            </Button>
          ) : (
            <Button type="submit" className="w-full gap-2" disabled={controlBusy}>
              <Play className="size-4 fill-current" />
              {controlBusy ? 'Starting…' : 'Launch Ingestion Run'}
            </Button>
          )}
          {isDraining && (
            <p className="text-xs leading-5 text-muted-foreground">
              No new files accepted. Workers are finishing and checkpointing active downloads before stopping.
            </p>
          )}
        </form>
        <div className="mt-4 grid gap-2 border-t border-border/60 pt-4 text-xs">
          <div className="flex items-center justify-between gap-3">
            <span className="text-muted-foreground">Runner Ticket</span>
            <span className="max-w-[190px] truncate font-mono text-muted-foreground" title={activeTicket}>
              {activeTicket}
            </span>
          </div>
          {activeStatus && (
            <>
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground">Control job</span>
                <span className="max-w-[190px] truncate font-mono text-foreground" title={activeJobId}>
                  {activeJobId}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">State</span>
                <Badge variant={statusVariant(activeStatus)}>{activeStatus}</Badge>
              </div>
            </>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
