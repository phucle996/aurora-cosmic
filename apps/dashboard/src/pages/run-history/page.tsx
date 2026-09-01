import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { JSX } from 'react';
import {
  Activity,
  AlertCircle,
  ArrowRight,
  Boxes,
  CheckCircle2,
  Clock3,
  Database,
  GitBranch,
  LoaderCircle,
  RefreshCw,
  Search,
} from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import type { FactoryBatch, FactoryComponentEvent, FactoryRun, FactoryRunDetail } from '@/features/factory-history/types';
import { apiBase, apiFetch } from '@/lib/api';

type DetailView = 'batches' | 'components';
type StatusFilter = 'all' | 'active' | 'completed' | 'attention' | 'stopped';

function parseTime(value?: string): Date | undefined {
  if (!value) return undefined;
  const parsed = new Date(value.includes('T') ? value : `${value.replace(' ', 'T')}Z`);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

function displayTime(value?: string): string {
  return parseTime(value)?.toLocaleString('vi-VN') ?? value ?? '—';
}

function elapsed(start?: string, end?: string): string {
  const from = parseTime(start)?.getTime();
  const to = parseTime(end)?.getTime();
  if (from === undefined || to === undefined || to < from) return '—';
  const seconds = (to - from) / 1000;
  if (seconds < 60) return `${seconds.toFixed(seconds < 10 ? 1 : 0)}s`;
  if (seconds < 3600) return `${(seconds / 60).toFixed(1)}m`;
  return `${(seconds / 3600).toFixed(1)}h`;
}

function normalizedStatus(value?: string): string {
  return (value ?? 'not_observed').trim().toLowerCase();
}

function statusVariant(status: string): 'default' | 'secondary' | 'destructive' | 'outline' {
  const state = normalizedStatus(status);
  if (state === 'completed') return 'default';
  if (state === 'failed' || state === 'error') return 'destructive';
  if (state === 'running' || state === 'draining' || state === 'catalog_syncing') return 'secondary';
  return 'outline';
}

function statusMatches(run: FactoryRun, filter: StatusFilter): boolean {
  const status = normalizedStatus(run.status);
  if (filter === 'all') return true;
  if (filter === 'active') return ['running', 'draining', 'catalog_syncing'].includes(status);
  if (filter === 'completed') return status === 'completed';
  if (filter === 'attention') return status === 'failed' || status === 'error' || Boolean(run.last_error);
  return ['stopped', 'frozen', 'canceled', 'cancelled'].includes(status);
}

function recordYield(run: FactoryRun): string {
  if (run.input_records <= 0) return '—';
  return `${Math.min(999, run.output_rows / run.input_records * 100).toFixed(1)}%`;
}

export default function RunHistoryPage(): JSX.Element {
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedRunID = searchParams.get('run_id') ?? '';
  const [runs, setRuns] = useState<FactoryRun[]>([]);
  const [detail, setDetail] = useState<FactoryRunDetail>();
  const [detailView, setDetailView] = useState<DetailView>('batches');
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [modeFilter, setModeFilter] = useState('all');
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const refreshTimer = useRef<number>();

  const selectRun = useCallback((runID: string, replace = false): void => {
    const next = new URLSearchParams(searchParams);
    if (runID) next.set('run_id', runID);
    else next.delete('run_id');
    setSearchParams(next, { replace });
  }, [searchParams, setSearchParams]);

  const loadRuns = useCallback(async (showLoading = true): Promise<FactoryRun[]> => {
    if (showLoading) setLoading(true);
    try {
      const response = await apiFetch<{ items: FactoryRun[] }>('/v1/data-factory/runs?pipeline=silver_to_gold&limit=200');
      const items = response.items ?? [];
      setRuns(items);
      setError(undefined);
      return items;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Không tải được lịch sử Data Factory');
      return [];
    } finally {
      if (showLoading) setLoading(false);
    }
  }, []);

  const loadDetail = useCallback(async (runID: string, showLoading = true): Promise<void> => {
    if (!runID) {
      setDetail(undefined);
      return;
    }
    if (showLoading) setDetailLoading(true);
    try {
      setDetail(await apiFetch<FactoryRunDetail>(`/v1/data-factory/runs/${encodeURIComponent(runID)}`));
      setError(undefined);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Không tải được bằng chứng của run');
    } finally {
      if (showLoading) setDetailLoading(false);
    }
  }, []);

  useEffect(() => {
    void (async () => {
      const items = await loadRuns();
      if (!selectedRunID && items[0]) selectRun(items[0].run_id, true);
    })();
  }, [loadRuns, selectRun, selectedRunID]);

  useEffect(() => {
    setDetailView('batches');
    void loadDetail(selectedRunID);
  }, [loadDetail, selectedRunID]);

  useEffect(() => {
    const scheduleRefresh = (): void => {
      if (refreshTimer.current) window.clearTimeout(refreshTimer.current);
      refreshTimer.current = window.setTimeout(() => {
        void loadRuns(false);
        if (selectedRunID) void loadDetail(selectedRunID, false);
      }, 350);
    };
    const events = new EventSource(`${apiBase}/v1/events?workflow=gold`);
    events.addEventListener('workflow', scheduleRefresh);
    return () => {
      events.close();
      if (refreshTimer.current) window.clearTimeout(refreshTimer.current);
    };
  }, [loadDetail, loadRuns, selectedRunID]);

  const filteredRuns = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return runs.filter((run) => {
      if (!statusMatches(run, statusFilter)) return false;
      if (modeFilter !== 'all' && run.mode.toLowerCase() !== modeFilter) return false;
      if (!needle) return true;
      return [run.run_id, run.last_snapshot_id, run.status, run.mode].some((value) => value?.toLowerCase().includes(needle));
    });
  }, [modeFilter, query, runs, statusFilter]);

  const selectedSummary = runs.find((run) => run.run_id === selectedRunID);
  const selectedDetail = detail?.run.run_id === selectedRunID ? detail : undefined;
  const totals = useMemo(() => runs.reduce((result, run) => ({
    batches: result.batches + run.completed_batches,
    inputs: result.inputs + run.input_records,
    outputs: result.outputs + run.output_rows,
    indexed: result.indexed + run.indexed_rows,
  }), { batches: 0, inputs: 0, outputs: 0, indexed: 0 }), [runs]);

  const refresh = async (): Promise<void> => {
    await Promise.all([loadRuns(), selectedRunID ? loadDetail(selectedRunID) : Promise.resolve()]);
  };

  return <div className="space-y-5">
    <Card className="rounded-none border-border/80 shadow-none">
      <CardHeader className="border-b border-border/70 pb-4">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div><p className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.14em] text-primary"><Clock3 className="size-3.5" />Durable run console</p><CardTitle className="mt-1 text-xl">Data Factory History</CardTitle><CardDescription className="mt-1">Điều tra run Silver → Gold theo batch, component transition và snapshot evidence đã ghi nhận.</CardDescription></div>
          <Button variant="outline" size="sm" className="h-9 rounded-none font-mono text-[9px] uppercase" onClick={() => void refresh()} disabled={loading || detailLoading}><RefreshCw className={`size-3.5 ${loading || detailLoading ? 'animate-spin' : ''}`} />Refresh ledger</Button>
        </div>
      </CardHeader>
      <CardContent className="grid gap-px bg-border/60 p-0 sm:grid-cols-2 xl:grid-cols-5">
        <MetricCell icon={Activity} label="Observed runs" value={runs.length} detail={`${filteredRuns.length} visible`} />
        <MetricCell icon={Boxes} label="Committed batches" value={totals.batches} detail="durable batches" />
        <MetricCell icon={Database} label="Silver inputs" value={totals.inputs} detail="records admitted" />
        <MetricCell icon={GitBranch} label="Candidate rows" value={totals.outputs} detail="Gold rows emitted" />
        <MetricCell icon={CheckCircle2} label="Indexed rows" value={totals.indexed} detail="queryable evidence" />
      </CardContent>
    </Card>

    {error ? <div className="flex items-center gap-2 border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"><AlertCircle className="size-4" />{error}</div> : null}

    <div className="grid min-w-0 gap-4 2xl:grid-cols-[minmax(0,1.35fr)_minmax(380px,0.65fr)]">
      <Card className="min-w-0 rounded-none border-border/80 shadow-none">
        <CardHeader className="gap-3 border-b border-border/70 p-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between"><div><CardTitle className="text-sm">Run ledger</CardTitle><CardDescription>Chọn một record để giữ nguyên ngữ cảnh và nạp evidence ở inspector.</CardDescription></div><span className="font-mono text-[10px] text-muted-foreground">{filteredRuns.length} / {runs.length} runs</span></div>
          <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_150px_140px]">
            <label className="relative"><span className="sr-only">Search run</span><Search className="absolute left-2.5 top-2.5 size-3.5 text-muted-foreground" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Run ID hoặc snapshot…" className="h-9 w-full rounded-none border border-input bg-background pl-8 pr-3 text-xs outline-none focus:border-ring" /></label>
            <label><span className="sr-only">Run status</span><select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as StatusFilter)} className="h-9 w-full rounded-none border border-input bg-background px-2 font-mono text-[10px] uppercase outline-none focus:border-ring"><option value="all">All states</option><option value="active">Active</option><option value="completed">Completed</option><option value="attention">Attention</option><option value="stopped">Stopped / frozen</option></select></label>
            <label><span className="sr-only">Run mode</span><select value={modeFilter} onChange={(event) => setModeFilter(event.target.value)} className="h-9 w-full rounded-none border border-input bg-background px-2 font-mono text-[10px] uppercase outline-none focus:border-ring"><option value="all">All modes</option><option value="batch">Batch</option><option value="stream">Stream</option></select></label>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {loading && runs.length === 0 ? <LoadingState label="Đang nạp durable run ledger…" /> : filteredRuns.length === 0 ? <div className="flex min-h-72 flex-col items-center justify-center gap-2 p-8 text-center"><Clock3 className="size-6 text-muted-foreground/60" /><p className="text-sm font-medium">Không có run phù hợp</p><p className="max-w-md text-xs text-muted-foreground">Run đầu tiên sẽ xuất hiện sau khi một Gold batch thực sự được ghi nhận.</p></div> : <div className="max-h-[620px] overflow-auto"><table className="w-full min-w-[850px] text-sm"><thead className="sticky top-0 z-10 border-b bg-card text-left font-mono text-[9px] uppercase tracking-[0.1em] text-muted-foreground"><tr><th className="p-3 pl-4">Run / snapshot</th><th className="p-3">State</th><th className="p-3">Started</th><th className="p-3 text-right">Batches</th><th className="p-3 text-right">Input</th><th className="p-3 text-right">Gold</th><th className="p-3 text-right">Yield</th></tr></thead><tbody>{filteredRuns.map((run) => <RunRow key={run.run_id} run={run} selected={run.run_id === selectedRunID} onSelect={() => selectRun(run.run_id)} />)}</tbody></table></div>}
        </CardContent>
      </Card>

      <RunInspector run={selectedSummary} detail={selectedDetail} loading={detailLoading} view={detailView} onView={setDetailView} />
    </div>
  </div>;
}

function MetricCell({ icon: Icon, label, value, detail }: { icon: typeof Activity; label: string; value: number; detail: string }): JSX.Element {
  return <div className="min-w-0 bg-background/90 p-3"><div className="flex items-center gap-2 font-mono text-[9px] uppercase tracking-[0.12em] text-muted-foreground"><Icon className="size-3.5 text-primary" />{label}</div><p className="mt-1 font-mono text-lg font-semibold tabular-nums">{value.toLocaleString()}</p><p className="mt-1 text-[10px] text-muted-foreground">{detail}</p></div>;
}

function RunRow({ run, selected, onSelect }: { run: FactoryRun; selected: boolean; onSelect: () => void }): JSX.Element {
  return <tr onClick={onSelect} className={`cursor-pointer border-b border-border/60 transition-colors last:border-0 ${selected ? 'bg-primary/10 shadow-[inset_2px_0_0_hsl(var(--primary))]' : 'hover:bg-muted/30'}`}><td className="p-3 pl-4"><p className="max-w-64 truncate font-mono text-xs font-medium text-primary" title={run.run_id}>{run.run_id}</p><p className="mt-1 max-w-64 truncate font-mono text-[9px] text-muted-foreground" title={run.last_snapshot_id}>{run.last_snapshot_id || 'no committed snapshot'}</p></td><td className="p-3"><div className="flex items-center gap-1.5"><Badge variant={statusVariant(run.status)} className="rounded-none font-mono text-[9px] uppercase">{run.status}</Badge><span className="font-mono text-[9px] uppercase text-muted-foreground">{run.mode}</span></div></td><td className="p-3"><p className="text-xs">{displayTime(run.started_at)}</p><p className="mt-1 font-mono text-[9px] text-muted-foreground">{elapsed(run.started_at, run.finished_at ?? run.updated_at)}</p></td><td className="p-3 text-right font-mono text-xs tabular-nums">{run.completed_batches.toLocaleString()}</td><td className="p-3 text-right font-mono text-xs tabular-nums">{run.input_records.toLocaleString()}</td><td className="p-3 text-right font-mono text-xs tabular-nums">{run.output_rows.toLocaleString()}</td><td className="p-3 text-right font-mono text-xs tabular-nums">{recordYield(run)}</td></tr>;
}

function RunInspector({ run, detail, loading, view, onView }: { run?: FactoryRun; detail?: FactoryRunDetail; loading: boolean; view: DetailView; onView: (view: DetailView) => void }): JSX.Element {
  if (!run) return <Card className="rounded-none border-border/80 shadow-none"><CardContent className="flex min-h-[500px] flex-col items-center justify-center gap-2 p-8 text-center"><GitBranch className="size-7 text-muted-foreground/50" /><p className="text-sm font-medium">Chọn một run để inspect</p><p className="text-xs text-muted-foreground">Batch và component evidence sẽ được nạp tại đây.</p></CardContent></Card>;
  return <Card className="min-w-0 rounded-none border-border/80 shadow-none">
    <CardHeader className="border-b border-border/70 p-4">
      <div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="font-mono text-[9px] uppercase tracking-[0.12em] text-primary">Selected durable run</p><CardTitle className="mt-1 truncate font-mono text-sm" title={run.run_id}>{run.run_id}</CardTitle></div><Badge variant={statusVariant(run.status)} className="shrink-0 rounded-none font-mono text-[9px] uppercase">{run.status}</Badge></div>
      <div className="grid grid-cols-2 gap-px bg-border/60 text-xs"><InspectorMetric label="Elapsed" value={elapsed(run.started_at, run.finished_at ?? run.updated_at)} /><InspectorMetric label="Batch policy" value={`${run.max_batch_records.toLocaleString()} max`} /><InspectorMetric label="Silver → Gold" value={`${run.input_records.toLocaleString()} → ${run.output_rows.toLocaleString()}`} /><InspectorMetric label="Indexed" value={run.indexed_rows.toLocaleString()} /></div>
      <div className="space-y-2 border-y border-border/60 py-3 text-[11px]"><EvidenceLine label="Started" value={displayTime(run.started_at)} /><EvidenceLine label="Updated" value={displayTime(run.updated_at)} /><EvidenceLine label="Snapshot" value={run.last_snapshot_id || '—'} mono />{run.last_error ? <div className="border-l-2 border-destructive bg-destructive/10 px-2 py-1.5 text-destructive">{run.last_error}</div> : null}</div>
      <Button asChild size="sm" className="h-8 w-full rounded-none font-mono text-[9px] uppercase"><Link to={`/data-factory/pipeline?run_id=${encodeURIComponent(run.run_id)}`}>Open historical DAG<ArrowRight className="size-3.5" /></Link></Button>
    </CardHeader>
    <CardContent className="p-0">
      <div className="grid grid-cols-2 border-b border-border/70 bg-muted/20 p-1"><button type="button" onClick={() => onView('batches')} className={`px-3 py-2 font-mono text-[9px] uppercase ${view === 'batches' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-background'}`}>Batches {detail?.batches.length ?? run.completed_batches}</button><button type="button" onClick={() => onView('components')} className={`px-3 py-2 font-mono text-[9px] uppercase ${view === 'components' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-background'}`}>Components {detail?.components.length ?? 0}</button></div>
      <div className="relative min-h-[315px] max-h-[430px] overflow-auto">{loading && !detail ? <LoadingState label="Đang nạp run evidence…" /> : view === 'batches' ? <BatchLedger batches={detail?.batches ?? []} /> : <ComponentLedger events={detail?.components ?? []} />}{loading && detail ? <div className="pointer-events-none absolute right-2 top-2 border border-border/70 bg-background/90 p-1.5"><LoaderCircle className="size-3.5 animate-spin text-primary" /></div> : null}</div>
    </CardContent>
  </Card>;
}

function InspectorMetric({ label, value }: { label: string; value: string }): JSX.Element {
  return <div className="bg-background p-2.5"><p className="font-mono text-[9px] uppercase text-muted-foreground">{label}</p><p className="mt-1 truncate font-mono font-medium" title={value}>{value}</p></div>;
}

function EvidenceLine({ label, value, mono = false }: { label: string; value: string; mono?: boolean }): JSX.Element {
  return <div className="grid grid-cols-[70px_minmax(0,1fr)] gap-2"><span className="text-muted-foreground">{label}</span><span className={`truncate text-right ${mono ? 'font-mono text-[10px]' : ''}`} title={value}>{value}</span></div>;
}

function BatchLedger({ batches }: { batches: FactoryBatch[] }): JSX.Element {
  if (batches.length === 0) return <EmptyLedger icon={Boxes} label="Run chưa ghi completed batch." />;
  return <div className="divide-y divide-border/60">{batches.map((batch) => <div key={batch.batch_id} className="space-y-2 p-3 hover:bg-muted/20"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="truncate font-mono text-[10px] text-primary" title={batch.batch_id}>{batch.batch_id}</p><p className="mt-1 text-[10px] text-muted-foreground">{displayTime(batch.started_at)} · {elapsed(batch.started_at, batch.completed_at)}</p></div><Badge variant={statusVariant(batch.status)} className="shrink-0 rounded-none font-mono text-[9px]">{batch.status}</Badge></div><div className="grid grid-cols-4 gap-px bg-border/50 font-mono text-[9px]"><MiniMetric label="Input" value={batch.input_records} /><MiniMetric label="Candidate" value={batch.candidate_rows} /><MiniMetric label="Artifacts" value={batch.artifact_count} /><MiniMetric label="Indexed" value={batch.indexed_rows} /></div>{batch.snapshot_id ? <p className="truncate font-mono text-[9px] text-muted-foreground" title={batch.snapshot_id}>{batch.snapshot_id}</p> : null}{batch.error ? <p className="text-[10px] text-destructive">{batch.error}</p> : null}</div>)}</div>;
}

function ComponentLedger({ events }: { events: FactoryComponentEvent[] }): JSX.Element {
  if (events.length === 0) return <EmptyLedger icon={GitBranch} label="Run chưa ghi component transition." />;
  return <div className="relative divide-y divide-border/60 before:absolute before:bottom-4 before:left-[22px] before:top-4 before:w-px before:bg-border">{events.map((event, index) => <div key={`${event.component_id}-${event.occurred_at}-${index}`} className="relative grid grid-cols-[20px_minmax(0,1fr)] gap-3 p-3"><span className={`relative z-10 mt-1 size-2.5 rounded-full border-2 border-background ${normalizedStatus(event.status) === 'completed' ? 'bg-emerald-500' : normalizedStatus(event.status) === 'failed' ? 'bg-destructive' : 'bg-primary'}`} /><div className="min-w-0"><div className="flex items-start justify-between gap-2"><p className="truncate font-mono text-[10px] font-medium" title={event.component_id}>{event.component_id}</p><Badge variant={statusVariant(event.status)} className="shrink-0 rounded-none font-mono text-[8px]">{event.status}</Badge></div><p className="mt-1 font-mono text-[9px] text-muted-foreground">{displayTime(event.occurred_at)}</p><div className="mt-2 grid grid-cols-3 gap-px bg-border/50 font-mono text-[9px]"><MiniMetric label="Input" value={event.input_records} /><MiniMetric label="Output" value={event.output_rows} /><MiniMetric label="Indexed" value={event.indexed_rows} /></div>{event.error ? <p className="mt-2 text-[10px] text-destructive">{event.error}</p> : event.snapshot_id ? <p className="mt-2 truncate font-mono text-[9px] text-muted-foreground" title={event.snapshot_id}>{event.snapshot_id}</p> : null}</div></div>)}</div>;
}

function MiniMetric({ label, value }: { label: string; value: number }): JSX.Element {
  return <div className="bg-background/90 p-1.5 text-center"><p className="text-muted-foreground">{label}</p><p className="mt-0.5 tabular-nums">{value.toLocaleString()}</p></div>;
}

function EmptyLedger({ icon: Icon, label }: { icon: typeof Boxes; label: string }): JSX.Element {
  return <div className="flex min-h-72 flex-col items-center justify-center gap-2 p-6 text-center"><Icon className="size-6 text-muted-foreground/50" /><p className="text-xs text-muted-foreground">{label}</p></div>;
}

function LoadingState({ label }: { label: string }): JSX.Element {
  return <div className="flex min-h-72 items-center justify-center gap-2 text-xs text-muted-foreground"><LoaderCircle className="size-4 animate-spin text-primary" />{label}</div>;
}
