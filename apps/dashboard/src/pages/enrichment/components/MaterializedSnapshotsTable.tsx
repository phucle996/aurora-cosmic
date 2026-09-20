import type { JSX } from 'react';
import { Check, Copy, Database, ExternalLink } from 'lucide-react';
import { Link } from 'react-router-dom';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { formatDate } from '../constants';
import type { PipelineBatch } from '@/pages/runner-tickets/types';

export interface MaterializedSnapshotsTableProps {
  batches: PipelineBatch[];
  historyLoading: boolean;
  runStatus?: string;
  copiedId: string | null;
  onCopyId: (id: string) => void;
}

export function MaterializedSnapshotsTable({
  batches,
  historyLoading,
  runStatus,
  copiedId,
  onCopyId,
}: MaterializedSnapshotsTableProps): JSX.Element {
  return (
    <Card className="rounded-none border-border/80 shadow-none">
      <CardHeader className="border-b border-border/70 pb-3">
        <div className="flex items-end justify-between">
          <div>
            <CardTitle className="flex items-center gap-2 text-sm">
              <Database className="size-4 text-primary" />
              Materialized Gold Datasets & Snapshots
            </CardTitle>
            <CardDescription>Committed snapshots recorded in the durable ClickHouse ledger.</CardDescription>
          </div>
          {historyLoading ? (
            <Badge variant="secondary" className="rounded-none font-mono text-[10px]">Reading ledger…</Badge>
          ) : runStatus ? (
            <Badge variant="secondary" className="rounded-none font-mono text-[10px]">{runStatus}</Badge>
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {batches.length === 0 ? (
          <div className="p-8 text-center text-xs text-muted-foreground font-mono">
            No Gold batches committed for this control run yet.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead className="border-b bg-muted/30 text-left font-mono text-[9px] uppercase text-muted-foreground">
                <tr>
                  <th className="p-3">Snapshot Identifier</th>
                  <th className="p-3 text-right">Silver Inputs</th>
                  <th className="p-3 text-right">Candidate Rows</th>
                  <th className="p-3 text-right">Indexed Rows</th>
                  <th className="p-3">Committed Timestamp</th>
                </tr>
              </thead>
              <tbody>
                {batches.map((batch) => {
                  const snapId = batch.snapshot_id ?? batch.batch_id;
                  const isCopied = copiedId === snapId;
                  return (
                    <tr key={batch.batch_id} className="border-b border-border/60 last:border-0 hover:bg-muted/10 transition-colors">
                      <td className="p-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-mono text-xs font-semibold text-foreground">
                            {snapId}
                          </span>
                          <button
                            type="button"
                            onClick={() => onCopyId(snapId)}
                            className="inline-flex size-6 items-center justify-center border border-border/60 bg-background/50 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                            title="Copy Snapshot Identifier"
                          >
                            {isCopied ? (
                              <Check className="size-3 text-emerald-400" />
                            ) : (
                              <Copy className="size-3" />
                            )}
                            <span className="sr-only">Copy Snapshot ID</span>
                          </button>
                          <Link
                            to={`/lakehouse/inspector?key=${encodeURIComponent(`gold/snapshots/${snapId}/manifest.json`)}`}
                            className="inline-flex items-center gap-1 border border-primary/40 bg-primary/10 px-2 py-0.5 font-mono text-[10px] text-primary hover:bg-primary/20 transition-colors"
                            title="Inspect snapshot manifest JSON in Lakehouse Inspector"
                          >
                            <ExternalLink className="size-3" />
                            <span>Inspect</span>
                          </Link>
                        </div>
                      </td>
                      <td className="p-3 text-right font-mono tabular-nums">{batch.input_records.toLocaleString()}</td>
                      <td className="p-3 text-right font-mono tabular-nums">{batch.candidate_rows.toLocaleString()}</td>
                      <td className="p-3 text-right font-mono tabular-nums">{batch.indexed_rows.toLocaleString()}</td>
                      <td className="p-3 text-xs text-muted-foreground font-mono">{formatDate(batch.completed_at)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
