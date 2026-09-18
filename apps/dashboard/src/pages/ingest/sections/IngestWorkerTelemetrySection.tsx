import type { JSX } from 'react';
import { Timer, Wifi } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import type { IngestProduct, IngestStatus, WorkerSignal } from '../types';
import { formatBytes, formatDate, formatTransferBytes, statusVariant } from '../types';

interface IngestWorkerTelemetrySectionProps {
  status: IngestStatus | null;
  percent: number;
  activeJobId?: string;
  activeStatus?: string;
  spawnedWorkerCount: number;
  workerSignals: Record<number, WorkerSignal>;
  downloadingProducts: IngestProduct[];
}

export function IngestWorkerTelemetrySection({
  status,
  percent,
  activeJobId,
  activeStatus,
  spawnedWorkerCount,
  workerSignals,
  downloadingProducts,
}: IngestWorkerTelemetrySectionProps): JSX.Element {
  return (
    <Card className="min-w-0 rounded-none border-border/80 shadow-none">
      <CardHeader className="border-b border-border/60 pb-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-primary">
              Live acquisition / run telemetry
            </p>
            <CardTitle className="mt-1 text-lg">Bronze capture sequence</CardTitle>
            <CardDescription>Checkpoint-backed execution state without browser-side simulations.</CardDescription>
          </div>
          {activeStatus && (
            <Badge variant={statusVariant(activeStatus)} className="w-fit rounded-none font-mono">
              {activeStatus}
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-5 p-4 sm:p-5">
        <div className="border border-primary/25 bg-primary/[0.035] p-4 sm:p-5">
          <div className="mb-3 flex items-end justify-between gap-4">
            <div>
              <p className="text-xs font-medium text-muted-foreground">Acquisition completion</p>
              <p className="mt-1 font-mono text-3xl font-semibold tracking-tight tabular-nums sm:text-4xl">
                {percent}
                <span className="text-lg text-muted-foreground">%</span>
              </p>
            </div>
            <p className="text-right font-mono text-xs text-muted-foreground">
              {status?.completed_products ?? 0} received
              <br />
              {status?.total_products ?? 0} planned
            </p>
          </div>
          <Progress value={percent} className="h-2" />
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="border-l-2 border-primary bg-muted/20 p-3">
            <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">Run identifier</p>
            <p className="mt-1 break-all font-mono text-xs text-foreground">{activeJobId}</p>
          </div>
          <div className="border-l-2 border-emerald-500 bg-muted/20 p-3">
            <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">Last checkpoint</p>
            <p className="mt-1 font-mono text-xs text-foreground">{formatDate(status?.updated_at ?? status?.observed_at)}</p>
          </div>
        </div>

        <div>
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium">Worker field array</p>
              <p className="text-xs text-muted-foreground">Displays active workers processing products in runtime.</p>
            </div>
            <span className="font-mono text-xs text-muted-foreground">{spawnedWorkerCount} spawned</span>
          </div>

          {spawnedWorkerCount === 0 ? (
            <div className="border border-dashed border-border/70 px-3 py-5 text-center text-xs text-muted-foreground">
              No workers currently transferring data.
            </div>
          ) : (
            <div className="space-y-2">
              {Array.from({ length: spawnedWorkerCount }, (_, index) => {
                const workerId = index + 1;
                const signal = workerSignals[workerId];
                const product = downloadingProducts[index];
                const productId = signal?.productId ?? product?.id;
                const bytesRead = signal?.bytesRead ?? product?.size_bytes ?? 0;
                const expectedBytes = signal?.expectedBytes ?? product?.expected_size_bytes ?? 0;
                const downloadPercent =
                  expectedBytes > 0 ? Math.min(100, Math.max(0, Math.round((bytesRead / expectedBytes) * 100))) : 0;

                return (
                  <div key={`worker-${workerId}`} className="border border-border/70 bg-background/50 px-3 py-3">
                    <div className="grid gap-2 sm:grid-cols-[5.5rem_minmax(0,1fr)_5rem] sm:items-center sm:gap-4">
                      <div className="flex items-center gap-2">
                        <span className="size-2 rounded-full bg-primary animate-pulse" />
                        <span className="font-mono text-xs text-foreground">
                          WORKER-{String(workerId).padStart(2, '0')}
                        </span>
                      </div>
                      <div className="min-w-0">
                        <p className="truncate font-mono text-[11px] text-foreground" title={productId}>
                          {productId ?? 'Awaiting product telemetry'}
                        </p>
                        <div className="mt-2 flex items-center gap-3">
                          <Progress value={downloadPercent} className="h-1.5 flex-1" />
                          <span className="font-mono text-[11px] text-muted-foreground">
                            {productId ? `${downloadPercent}%` : '—'}
                          </span>
                        </div>
                      </div>
                      <p className="font-mono text-[10px] text-muted-foreground sm:text-right">
                        {productId ? `${formatTransferBytes(bytesRead)} / ${formatBytes(expectedBytes)}` : 'DOWNLOADING'}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="grid gap-3 border-t border-border/60 pt-4 sm:grid-cols-2">
          <div className="flex gap-2 text-xs text-muted-foreground">
            <Timer className="size-4 shrink-0 text-primary" />
            <span>
              Started <b className="ml-1 font-mono font-medium text-foreground">{formatDate(status?.started_at)}</b>
            </span>
          </div>
          <div className="flex gap-2 text-xs text-muted-foreground">
            <Wifi className="size-4 shrink-0 text-primary" />
            <span>{status?.observed ? 'Live download activity available' : 'Awaiting download activity'}</span>
          </div>
        </div>

        {status?.manifest_path && (
          <div className="flex flex-col gap-1 border border-border/70 bg-muted/15 p-3 text-xs sm:flex-row sm:items-center sm:justify-between">
            <span className="shrink-0 text-muted-foreground">Manifest checkpoint</span>
            <span className="min-w-0 truncate font-mono text-foreground" title={status.manifest_path}>
              {status.manifest_path}
            </span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
