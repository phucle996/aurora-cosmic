import { useEffect, useState } from 'react';
import type { JSX } from 'react';
import { ArrowLeft, Boxes, Database, FileCode2, GitBranch, LoaderCircle, Rows3 } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { apiFetch } from '@/lib/api';
import { formatBytes, formatDate } from '@/pages/datasets/types';

import type { GoldSnapshotDetail } from './types';

function ShortHash({ value }: { value: string }): JSX.Element {
  return <span className="font-mono text-xs" title={value}>{value ? `${value.slice(0, 16)}…` : '—'}</span>;
}

function artifactPresentation(dataset: string): { family: string; modality: string } {
  switch (dataset) {
    case 'candidate': return { family: 'Candidate vetting', modality: 'Transit candidate features' };
    default: return { family: 'Gold dataset', modality: dataset };
  }
}

export default function GoldSnapshotPage(): JSX.Element {
  const { snapshotId = '' } = useParams();
  const [detail, setDetail] = useState<GoldSnapshotDetail>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (!snapshotId) return;
    let active = true;
    setDetail(undefined);
    setError(undefined);
    void apiFetch<GoldSnapshotDetail>(`/v1/gold/snapshots/${encodeURIComponent(snapshotId)}`)
      .then((value) => active && setDetail(value))
      .catch((cause: unknown) => active && setError(cause instanceof Error ? cause.message : 'Không tải được Gold snapshot'));
    return () => { active = false; };
  }, [snapshotId]);

  if (error) return <StateMessage title="Không tải được Gold snapshot" detail={error} />;
  if (!detail) return <Loading />;

  return (
    <div className="space-y-6">
      <div>
        <Button asChild variant="ghost" size="sm" className="mb-3 -ml-3"><Link to="/datasets"><ArrowLeft />Gold datasets</Link></Button>
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="font-heading text-2xl font-semibold tracking-tight md:text-3xl">Gold snapshot</h2>
          <Badge>{detail.status || 'COMMITTED'}</Badge>
          <Badge variant="secondary">{detail.snapshot_type || 'GOLD'}</Badge>
        </div>
        <p className="mt-2 break-all font-mono text-sm text-muted-foreground">{detail.snapshot_id}</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Metric icon={Rows3} label="Artifacts" value={String(detail.artifacts.length)} detail={`${detail.inputs.length} Silver inputs`} />
        <Metric icon={Database} label="Gold schema" value={detail.gold_schema_version || '—'} detail={detail.producer || 'Gold Builder'} />
        <Metric icon={Boxes} label="Tạo lúc" value={formatDate(detail.created_at)} detail={detail.snapshot_type || 'snapshot'} />
        <Metric icon={GitBranch} label="Fingerprint" value={<ShortHash value={detail.snapshot_fingerprint} />} detail="immutable snapshot identity" />
      </div>

      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2 text-base"><FileCode2 className="size-4 text-primary" />Metadata snapshot</CardTitle><CardDescription>Metadata đã commit trong manifest; mỗi artifact bên dưới có schema và preview Parquet thật.</CardDescription></CardHeader>
        <CardContent className="grid gap-4 text-sm md:grid-cols-2 xl:grid-cols-3">
          <Meta label="Snapshot ID" value={detail.snapshot_id} mono />
          <Meta label="Created at" value={formatDate(detail.created_at)} />
          <Meta label="Producer" value={detail.producer} />
          <Meta label="Fingerprint" value={detail.snapshot_fingerprint} mono />
          <Meta label="Feature versions" value={Object.entries(detail.feature_versions ?? {}).map(([key, value]) => `${key}: ${value}`).join(' · ') || '—'} />
          <Meta label="Dataset row counts" value={Object.entries(detail.dataset_row_counts ?? {}).map(([key, value]) => `${key}: ${value}`).join(' · ') || '—'} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Gold snapshot artifacts</CardTitle><CardDescription>Mỗi file là một artifact Gold đã commit. Family cho biết mục đích ML; modality cho biết bằng chứng khoa học được materialize.</CardDescription></CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader><TableRow><TableHead>Gold family</TableHead><TableHead>Modality</TableHead><TableHead>Sector</TableHead><TableHead>Rows</TableHead><TableHead>Size</TableHead><TableHead>Parquet SHA-256</TableHead><TableHead>Object key</TableHead></TableRow></TableHeader>
            <TableBody>{detail.artifacts.map((artifact) => {
              const presentation = artifactPresentation(artifact.dataset);
              return <TableRow key={`${artifact.dataset}-${artifact.sector}`}>
                <TableCell><Badge variant={artifact.dataset === 'candidate' ? 'secondary' : 'outline'}>{presentation.family}</Badge></TableCell>
                <TableCell><Link className="font-medium text-primary hover:underline" to={`/gold/snapshots/${encodeURIComponent(detail.snapshot_id)}/files/${encodeURIComponent(artifact.dataset)}/${artifact.sector}`}>{presentation.modality}</Link></TableCell>
                <TableCell>Sector {artifact.sector}</TableCell><TableCell>{artifact.row_count.toLocaleString()}</TableCell><TableCell>{formatBytes(artifact.size_bytes)}</TableCell><TableCell><ShortHash value={artifact.parquet_sha256} /></TableCell><TableCell className="max-w-60 truncate font-mono text-[11px]" title={artifact.object_key}>{artifact.object_key}</TableCell>
              </TableRow>;
            })}</TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

function Metric({ icon: Icon, label, value, detail }: { icon: typeof Database; label: string; value: string | JSX.Element; detail: string }): JSX.Element {
  return <Card><CardHeader className="pb-2"><CardDescription>{label}</CardDescription><CardTitle className="flex items-center gap-2 break-all text-base"><Icon className="size-4 shrink-0 text-primary" />{value}</CardTitle></CardHeader><CardContent className="truncate text-xs text-muted-foreground" title={detail}>{detail}</CardContent></Card>;
}

function Meta({ label, value, mono }: { label: string; value: string; mono?: boolean }): JSX.Element {
  return <div><dt className="text-xs text-muted-foreground">{label}</dt><dd className={`mt-1 break-all text-sm ${mono ? 'font-mono text-xs' : ''}`}>{value || '—'}</dd></div>;
}

function Loading(): JSX.Element { return <div className="flex items-center justify-center gap-2 py-24 text-sm text-muted-foreground"><LoaderCircle className="animate-spin" />Đang tải Gold snapshot…</div>; }
function StateMessage({ title, detail }: { title: string; detail: string }): JSX.Element { return <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-5"><h2 className="font-semibold text-destructive">{title}</h2><p className="mt-1 text-sm text-muted-foreground">{detail}</p></div>; }
