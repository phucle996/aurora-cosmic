import { useEffect, useMemo, useState } from 'react';
import type { JSX } from 'react';
import { ArrowLeft, ChevronDown, ChevronUp, Database, FileSearch, Filter, LoaderCircle, Rows3, Search } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { apiFetch } from '@/lib/api';
import { formatBytes } from '@/pages/datasets/types';

import type { GoldArtifactDetail } from './types';

const pageSize = 25;

function cellValue(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function comparePreviewValues(left: unknown, right: unknown, direction: 'asc' | 'desc'): number {
  const leftNumber = typeof left === 'number' ? left : Number(left);
  const rightNumber = typeof right === 'number' ? right : Number(right);
  const comparison = Number.isFinite(leftNumber) && Number.isFinite(rightNumber)
    ? leftNumber - rightNumber
    : cellValue(left).localeCompare(cellValue(right), undefined, { numeric: true, sensitivity: 'base' });
  return direction === 'asc' ? comparison : -comparison;
}

export default function GoldArtifactPage(): JSX.Element {
  const { snapshotId = '', dataset = '', sector = '' } = useParams();
  const [detail, setDetail] = useState<GoldArtifactDetail>();
  const [error, setError] = useState<string>();
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState('');
  const [sortColumn, setSortColumn] = useState<string>();
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  const [schemaOpen, setSchemaOpen] = useState(false);
  const sectorNumber = Number(sector);

  useEffect(() => {
    if (!snapshotId || !dataset || !Number.isInteger(sectorNumber) || sectorNumber < 1) return;
    let active = true;
    setError(undefined);
    const params = new URLSearchParams({ limit: String(pageSize), offset: String(page * pageSize) });
    if (search.trim()) params.set('search', search.trim());
    void apiFetch<GoldArtifactDetail>(`/v1/gold/snapshots/${encodeURIComponent(snapshotId)}/artifacts/${encodeURIComponent(dataset)}/${sectorNumber}?${params.toString()}`)
      .then((value) => active && setDetail(value))
      .catch((cause: unknown) => active && setError(cause instanceof Error ? cause.message : 'Không tải được Gold file'));
    return () => { active = false; };
  }, [dataset, page, search, sectorNumber, snapshotId]);

  const columns = useMemo(() => detail?.schema.map((column) => column.path) ?? [], [detail]);
  const preview = useMemo(() => {
    const rows = [...(detail?.preview ?? [])];
    if (!sortColumn) return rows;
    return rows.sort((left, right) => comparePreviewValues(left[sortColumn], right[sortColumn], sortDirection));
  }, [detail?.preview, sortColumn, sortDirection]);
  const toggleSort = (column: string): void => {
    if (sortColumn === column) {
      setSortDirection((current) => current === 'asc' ? 'desc' : 'asc');
      return;
    }
    setSortColumn(column);
    setSortDirection('asc');
  };
  if (!Number.isInteger(sectorNumber) || sectorNumber < 1) return <StateMessage title="Gold file không hợp lệ" detail="Sector phải là một số nguyên dương." />;
  if (error) return <StateMessage title="Không tải được Gold file" detail={error} />;
  if (!detail) return <Loading />;
  const { artifact } = detail;

  return (
    <div className="min-w-0 space-y-6">
      <div>
        <Button asChild variant="ghost" size="sm" className="mb-3 -ml-3"><Link to={`/gold/snapshots/${encodeURIComponent(snapshotId)}`}><ArrowLeft />Snapshot detail</Link></Button>
        <div className="flex flex-wrap items-center gap-2"><h2 className="font-heading text-2xl font-semibold tracking-tight md:text-3xl">Gold file detail</h2><Badge>{artifact.dataset}</Badge><Badge variant="secondary">Sector {artifact.sector}</Badge></div>
        <p className="mt-2 break-all font-mono text-sm text-muted-foreground">{artifact.object_key}</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Metric icon={Rows3} label="Rows" value={artifact.row_count.toLocaleString()} detail="manifest row count" />
        <Metric icon={Database} label="File size" value={formatBytes(artifact.size_bytes)} detail="committed Parquet object" />
        <Metric icon={FileSearch} label="Columns" value={String(detail.schema.length)} detail="read directly from Parquet schema" />
        <Metric icon={Filter} label="Rows trong preview" value={detail.matched_rows.toLocaleString()} detail={search ? 'searched directly while reading Parquet' : 'all rows in this artifact'} />
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">File metadata</CardTitle><CardDescription>Checksums dùng để kiểm tra tính bất biến của artifact đã đúc.</CardDescription></CardHeader>
        <CardContent className="grid gap-4 text-sm md:grid-cols-2 xl:grid-cols-3">
          <Meta label="Dataset" value={artifact.dataset} /><Meta label="Sector" value={String(artifact.sector)} /><Meta label="Snapshot" value={detail.snapshot_id} mono />
          <Meta label="Object key" value={artifact.object_key} mono /><Meta label="Content SHA-256" value={artifact.content_sha256} mono /><Meta label="Parquet SHA-256" value={artifact.parquet_sha256} mono />
        </CardContent>
      </Card>

      <Card>
        <Collapsible open={schemaOpen} onOpenChange={setSchemaOpen}>
          <CardHeader className="flex-row items-center justify-between gap-4 space-y-0"><div><CardTitle className="text-base">Real Parquet schema</CardTitle><CardDescription className="mt-1">Đọc từ footer/schema của chính file này, không phải catalog tĩnh.</CardDescription></div><CollapsibleTrigger asChild><Button variant="outline" size="sm" className="shrink-0 gap-1.5">{schemaOpen ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}{schemaOpen ? 'Thu gọn' : `Mở ${detail.schema.length} cột`}</Button></CollapsibleTrigger></CardHeader>
          <CollapsibleContent><CardContent className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>Column</TableHead><TableHead>Path</TableHead><TableHead>Physical type</TableHead><TableHead>Nullable</TableHead><TableHead>Repeated</TableHead></TableRow></TableHeader><TableBody>{detail.schema.map((column) => <TableRow key={column.path}><TableCell className="font-mono text-xs">{column.name}</TableCell><TableCell className="font-mono text-xs">{column.path}</TableCell><TableCell><Badge variant="secondary" className="font-mono">{column.type}</Badge></TableCell><TableCell>{column.nullable ? 'yes' : 'no'}</TableCell><TableCell>{column.repeated ? 'yes' : 'no'}</TableCell></TableRow>)}</TableBody></Table></CardContent></CollapsibleContent>
        </Collapsible>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Data preview</CardTitle><CardDescription>Đọc Parquet thật theo từng trang 25 bản ghi. Tìm kiếm chạy trên toàn bộ file; nhấn tên cột để sắp xếp trang đang xem.</CardDescription></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 lg:max-w-xl">
            <label className="grid gap-1.5 text-xs font-medium"><span className="flex items-center gap-1.5 text-muted-foreground"><Search className="size-3.5" />Tìm trong mọi cột</span><input value={search} onChange={(event) => { setSearch(event.target.value); setPage(0); }} placeholder="Ví dụ: lineage ID, TIC, sector…" className="h-9 rounded-md border border-border bg-background px-3 text-sm outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring" /></label>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3"><p className="text-xs text-muted-foreground">{detail.matched_rows === 0 ? 'Không có dòng nào khớp.' : `Hiển thị ${detail.preview_offset + 1}–${detail.preview_offset + detail.preview.length} / ${detail.matched_rows.toLocaleString()} dòng khớp`}</p><div className="flex items-center gap-2"><Button variant="outline" size="sm" onClick={() => setPage((current) => Math.max(0, current - 1))} disabled={detail.preview_offset === 0}>Trước</Button><span className="min-w-20 text-center text-xs tabular-nums text-muted-foreground">Trang {Math.floor(detail.preview_offset / pageSize) + 1} / {Math.max(1, Math.ceil(detail.matched_rows / pageSize))}</span><Button variant="outline" size="sm" onClick={() => setPage((current) => current + 1)} disabled={detail.preview_offset + detail.preview.length >= detail.matched_rows}>Sau</Button></div></div>
          <div className="min-w-0 rounded-md border border-border"><Table><TableHeader><TableRow><TableHead className="sticky left-0 bg-background">#</TableHead>{columns.map((column) => <TableHead key={column} className="whitespace-nowrap font-mono text-[11px]"><button type="button" onClick={() => toggleSort(column)} className="flex items-center gap-1 text-left hover:text-primary" title={`Sắp xếp theo ${column}`}>{column}{sortColumn === column && (sortDirection === 'asc' ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />)}</button></TableHead>)}</TableRow></TableHeader><TableBody>{preview.length === 0 ? <TableRow><TableCell colSpan={columns.length + 1} className="h-20 text-center text-sm text-muted-foreground">Không có row nào khớp điều kiện hiện tại.</TableCell></TableRow> : preview.map((row, index) => <TableRow key={`${detail.preview_offset}-${index}`}><TableCell className="sticky left-0 bg-background font-mono text-xs text-muted-foreground">{detail.preview_offset + index + 1}</TableCell>{columns.map((column) => <TableCell key={column} className="max-w-72 truncate font-mono text-xs" title={cellValue(row[column])}>{cellValue(row[column])}</TableCell>)}</TableRow>)}</TableBody></Table></div>
        </CardContent>
      </Card>
    </div>
  );
}

function Metric({ icon: Icon, label, value, detail }: { icon: typeof Database; label: string; value: string; detail: string }): JSX.Element { return <Card><CardHeader className="pb-2"><CardDescription>{label}</CardDescription><CardTitle className="flex items-center gap-2 text-base"><Icon className="size-4 text-primary" />{value}</CardTitle></CardHeader><CardContent className="text-xs text-muted-foreground">{detail}</CardContent></Card>; }
function Meta({ label, value, mono }: { label: string; value: string; mono?: boolean }): JSX.Element { return <div><dt className="text-xs text-muted-foreground">{label}</dt><dd className={`mt-1 break-all text-sm ${mono ? 'font-mono text-xs' : ''}`}>{value || '—'}</dd></div>; }
function Loading(): JSX.Element { return <div className="flex items-center justify-center gap-2 py-24 text-sm text-muted-foreground"><LoaderCircle className="animate-spin" />Đang tải Gold file…</div>; }
function StateMessage({ title, detail }: { title: string; detail: string }): JSX.Element { return <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-5"><h2 className="font-semibold text-destructive">{title}</h2><p className="mt-1 text-sm text-muted-foreground">{detail}</p></div>; }
