import { useEffect, useMemo, useState, type JSX } from 'react';
import { Link } from 'react-router-dom';
import { Activity, Check, Circle, CircleAlert, Cpu, Database, FileInput, FileOutput, Fingerprint, Gauge, LoaderCircle, Play, Search, Server, ShieldCheck } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { formatDate, statusVariant, taskLabel, type InferenceJob, type ModelRecord } from '../types';

interface InferenceJobsTableProps {
  models: ModelRecord[];
  selectedRuntimeId?: string;
  onSelectRuntimeId: (runtimePackageId: string) => void;
  selectedModel?: ModelRecord;
  jobs: InferenceJob[];
  onQueueJob: (job: InferenceJob) => Promise<void>;
  queueingJobId?: string;
}

type StatusFilter = 'all' | 'planned' | 'active' | 'completed' | 'failed';
const PAGE_SIZE = 12;

function pass(value?: string): boolean {
  return value?.toUpperCase() === 'PASS' || value?.toUpperCase() === 'PASSED';
}

function activeStatus(status: string): boolean {
  return status === 'running' || status === 'retrying' || status === 'queued';
}

export function InferenceJobsTable({ models, selectedRuntimeId, onSelectRuntimeId, selectedModel, jobs, onQueueJob, queueingJobId }: InferenceJobsTableProps): JSX.Element {
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [search, setSearch] = useState('');
  const [selectedJobId, setSelectedJobId] = useState<string>();
  const [page, setPage] = useState(1);
  const modelJobs = useMemo(() => selectedModel ? jobs.filter((job) => job.model_id === selectedModel.model_id || job.runtime_package_id === selectedModel.runtime_package_id) : [], [jobs, selectedModel]);
  const counts = useMemo(() => ({
    planned: modelJobs.filter((job) => job.status === 'planned').length,
    active: modelJobs.filter((job) => activeStatus(job.status)).length,
    completed: modelJobs.filter((job) => job.status === 'completed').length,
    failed: modelJobs.filter((job) => job.status === 'failed').length,
    expected: modelJobs.reduce((sum, job) => sum + job.expected_prediction_count, 0),
    processed: modelJobs.reduce((sum, job) => sum + (job.processed_rows ?? 0), 0),
  }), [modelJobs]);
  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return modelJobs.filter((job) => {
      if (statusFilter === 'active' ? !activeStatus(job.status) : statusFilter !== 'all' && job.status !== statusFilter) return false;
      if (!query) return true;
      return [job.job_id, job.gold_snapshot_id, job.gold_artifact_key, job.output_key, job.error].some((value) => value?.toLowerCase().includes(query));
    });
  }, [modelJobs, search, statusFilter]);
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const rows = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const selectedJob = modelJobs.find((job) => job.job_id === selectedJobId) ?? rows[0] ?? modelJobs[0];
  const runtimeVerified = selectedModel ? selectedModel.status !== 'invalid' && pass(selectedModel.parity_status) && pass(selectedModel.integrity_status) : false;

  useEffect(() => { setPage(1); setSelectedJobId(undefined); }, [selectedRuntimeId]);
  useEffect(() => setPage((current) => Math.min(current, pageCount)), [pageCount]);
  const setFilter = (value: StatusFilter) => { setStatusFilter(value); setPage(1); setSelectedJobId(undefined); };

  return <section className="min-w-0 overflow-hidden border border-border/80 bg-card">
    <header className="flex flex-col gap-4 border-b border-border/60 p-4 sm:p-5 xl:flex-row xl:items-end xl:justify-between">
      <div><p className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.14em] text-primary"><Cpu className="size-4" />Inference execution console</p><h3 className="mt-1 text-lg font-semibold">Gold batch scoring</h3><p className="mt-1 max-w-2xl text-xs text-muted-foreground">Inspect immutable job inputs, runtime verification, execution attempts and committed prediction outputs.</p></div>
      <label className="block min-w-0"><span className="mb-1 block font-mono text-[9px] uppercase text-muted-foreground">Runtime subject</span><select value={selectedRuntimeId ?? ''} onChange={(event) => onSelectRuntimeId(event.target.value)} disabled={models.length === 0} className="h-10 w-full border border-input bg-background px-3 font-mono text-[10px] outline-none focus:border-primary sm:w-[460px]">{models.length === 0 ? <option value="">No runtime package</option> : models.map((model) => <option key={model.runtime_package_id} value={model.runtime_package_id}>{model.model_id} · {model.status} · {model.runtime_package_id}</option>)}</select></label>
    </header>

    <div className="grid gap-px border-b border-border/60 bg-border/60 sm:grid-cols-2 xl:grid-cols-4">
      <InferenceStat icon={<Activity className="size-3.5 text-sky-500" />} label="Queue / active" value={`${counts.planned} / ${counts.active}`} detail="planned manifests / worker-owned" />
      <InferenceStat icon={<Check className="size-3.5 text-emerald-500" />} label="Completed batches" value={counts.completed} detail={`${counts.processed.toLocaleString()} rows durably reported`} />
      <InferenceStat icon={<CircleAlert className="size-3.5 text-red-500" />} label="Failed batches" value={counts.failed} detail={counts.failed ? 'inspect selected failure below' : 'no terminal failures'} />
      <InferenceStat icon={<Gauge className="size-3.5 text-violet-500" />} label="Expected workload" value={counts.expected.toLocaleString()} detail={`${modelJobs.length.toLocaleString()} immutable jobs`} />
    </div>

    <div className={`flex flex-col gap-2 border-b px-4 py-3 sm:flex-row sm:items-center sm:justify-between ${runtimeVerified ? 'border-emerald-500/25 bg-emerald-500/[0.035]' : 'border-red-500/25 bg-red-500/[0.04]'}`}><div className="flex min-w-0 items-start gap-2">{runtimeVerified ? <ShieldCheck className="mt-0.5 size-4 shrink-0 text-emerald-500" /> : <CircleAlert className="mt-0.5 size-4 shrink-0 text-red-500" />}<div className="min-w-0"><p className="text-xs font-medium">{runtimeVerified ? 'Runtime eligible for execution' : 'Runtime execution blocked'}</p><p className="mt-0.5 truncate text-[10px] text-muted-foreground">{selectedModel ? `${selectedModel.model_id} · parity ${selectedModel.parity_status || '—'} · integrity ${selectedModel.integrity_status || '—'}` : 'No runtime package selected'}</p></div></div><Badge variant={selectedModel ? statusVariant(selectedModel.status) : 'outline'} className="w-fit rounded-none font-mono text-[9px] uppercase">{selectedModel?.status || 'unselected'}</Badge></div>

    <div className="grid min-w-0 xl:grid-cols-[minmax(0,1.35fr)_minmax(340px,0.65fr)]">
      <div className="min-w-0 border-b border-border/60 xl:border-b-0 xl:border-r">
        <div className="flex flex-col gap-2 border-b border-border/60 bg-muted/10 p-3 lg:flex-row lg:items-center lg:justify-between"><div className="relative min-w-0 flex-1 lg:max-w-lg"><Search className="absolute left-2.5 top-2.5 size-3.5 text-muted-foreground" /><Input value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} placeholder="Filter job, Gold snapshot, artifact or error…" className="h-9 rounded-none pl-8 font-mono text-xs" /></div><div className="flex border border-border/70 bg-background p-0.5">{(['all', 'planned', 'active', 'completed', 'failed'] as const).map((status) => <button key={status} type="button" onClick={() => setFilter(status)} className={`px-2 py-1.5 font-mono text-[8px] uppercase transition-colors ${statusFilter === status ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted/50'}`}>{status}</button>)}</div></div>
        {rows.length === 0 ? <EmptyState text={selectedModel ? 'No inference job matches the current filters.' : 'Select a runtime package to inspect its jobs.'} /> : <div className="overflow-x-auto"><table className="w-full min-w-[780px] text-left"><thead className="border-b border-border/60 bg-muted/20 font-mono text-[9px] uppercase tracking-[0.1em] text-muted-foreground"><tr><th className="px-3 py-2.5">Job / Gold input</th><th className="px-3 py-2.5">Workload</th><th className="px-3 py-2.5">Execution</th><th className="px-3 py-2.5 text-right">Control</th></tr></thead><tbody>{rows.map((job) => {
          const selected = job.job_id === selectedJob?.job_id;
          return <tr key={job.job_id} onClick={() => setSelectedJobId(job.job_id)} className={`cursor-pointer border-b border-border/50 transition-colors last:border-b-0 ${selected ? 'bg-primary/[0.07] shadow-[inset_3px_0_0_var(--primary)]' : 'hover:bg-muted/25'}`}><td className="max-w-[340px] px-3 py-3"><p className="truncate font-mono text-[10px] font-semibold" title={job.job_id}>{job.job_id}</p><p className="mt-1 truncate font-mono text-[9px] text-primary" title={job.gold_snapshot_id}>{job.gold_snapshot_id}</p><p className="mt-1 truncate text-[9px] text-muted-foreground" title={job.gold_artifact_key}>{job.gold_artifact_key}</p></td><td className="px-3 py-3"><p className="font-mono text-xs font-semibold">{job.expected_prediction_count.toLocaleString()} rows</p><p className="mt-1 text-[9px] text-muted-foreground">sector {job.sector} · processed {(job.processed_rows ?? 0).toLocaleString()}</p></td><td className="px-3 py-3"><Badge variant={statusVariant(job.status)} className="rounded-none font-mono text-[9px] uppercase">{job.status}</Badge><p className="mt-1 truncate font-mono text-[9px] text-muted-foreground">attempt {job.attempt || '—'} · {formatDate(job.updated_at || job.created_at)}</p></td><td className="px-3 py-3 text-right" onClick={(event) => event.stopPropagation()}><Button size="sm" variant="outline" className="h-7 rounded-none px-2 text-[10px]" onClick={() => void onQueueJob(job)} disabled={queueingJobId === job.job_id || !runtimeVerified || activeStatus(job.status)}>{queueingJobId === job.job_id ? <LoaderCircle className="size-3 animate-spin" /> : <Play className="size-3" />}{job.status === 'completed' ? 'Run again' : 'Retry'}</Button></td></tr>;
        })}</tbody></table></div>}
        <footer className="flex items-center justify-between border-t border-border/60 bg-muted/10 px-3 py-2.5 font-mono text-[9px] uppercase text-muted-foreground"><span>{filtered.length.toLocaleString()} matching</span><div className="flex items-center gap-2"><Button variant="outline" size="sm" className="h-7 rounded-none px-2 text-[9px]" onClick={() => setPage((value) => Math.max(1, value - 1))} disabled={page === 1}>Previous</Button><span>{page} / {pageCount}</span><Button variant="outline" size="sm" className="h-7 rounded-none px-2 text-[9px]" onClick={() => setPage((value) => Math.min(pageCount, value + 1))} disabled={page === pageCount}>Next</Button></div></footer>
      </div>
      <JobInspector job={selectedJob} runtimeVerified={runtimeVerified} queueing={queueingJobId === selectedJob?.job_id} onQueueJob={onQueueJob} />
    </div>
  </section>;
}

function JobInspector({ job, runtimeVerified, queueing, onQueueJob }: { job?: InferenceJob; runtimeVerified: boolean; queueing: boolean; onQueueJob: (job: InferenceJob) => Promise<void> }): JSX.Element {
  if (!job) return <EmptyState text="Select a job to inspect its immutable bindings and execution outcome." />;
  const started = Boolean(job.started_at);
  const completed = job.status === 'completed';
  const failed = job.status === 'failed';
  const coverage = job.expected_prediction_count > 0 ? (job.processed_rows ?? 0) / job.expected_prediction_count * 100 : 0;
  return <aside className="min-w-0 bg-background/30">
    <div className="flex items-start justify-between gap-3 border-b border-border/60 p-4"><div className="min-w-0"><p className="font-mono text-[9px] uppercase tracking-[0.12em] text-primary">Job inspector</p><p className="mt-1 truncate font-mono text-xs font-semibold" title={job.job_id}>{job.job_id}</p></div><Badge variant={statusVariant(job.status)} className="rounded-none font-mono text-[9px] uppercase">{job.status}</Badge></div>
    <div className="grid gap-px border-b border-border/60 bg-border/60 sm:grid-cols-3 xl:grid-cols-1 2xl:grid-cols-3"><InspectorStat label="Expected" value={job.expected_prediction_count.toLocaleString()} /><InspectorStat label="Processed" value={(job.processed_rows ?? 0).toLocaleString()} /><InspectorStat label="Coverage" value={`${coverage.toFixed(1)}%`} /></div>
    <div className="border-b border-border/60 p-4"><p className="text-xs font-medium">Execution evidence</p><div className="mt-3 space-y-2"><EvidenceStep icon={<Fingerprint className="size-3.5" />} label="Immutable manifest" state="pass" detail="Job identity and input bindings recorded" /><EvidenceStep icon={<Server className="size-3.5" />} label="Worker execution" state={failed ? 'fail' : started ? 'pass' : 'wait'} detail={started ? `attempt ${job.attempt || 1} · ${formatDate(job.started_at!)}` : 'not acknowledged'} /><EvidenceStep icon={<FileOutput className="size-3.5" />} label="Prediction commit" state={completed && job.output_sha256 ? 'pass' : failed ? 'fail' : 'wait'} detail={completed ? `${(job.processed_rows ?? 0).toLocaleString()} rows committed` : failed ? 'output not committed' : 'waiting'} /></div></div>
    {job.error && <div className="border-b border-red-500/30 bg-red-500/[0.045] p-4"><p className="flex items-center gap-2 text-xs font-medium text-red-600 dark:text-red-300"><CircleAlert className="size-3.5" />Failure diagnostic</p><p className="mt-2 break-words font-mono text-[9px] leading-4 text-muted-foreground">{job.error}</p></div>}
    <div className="space-y-3 border-b border-border/60 p-4"><p className="text-xs font-medium">Bound artifacts</p><Binding icon={<Database className="size-3.5" />} label="Gold snapshot" value={job.gold_snapshot_id} link={`/gold/snapshots/${encodeURIComponent(job.gold_snapshot_id)}`} /><Binding icon={<FileInput className="size-3.5" />} label="Gold artifact" value={job.gold_artifact_key} /><Binding icon={<Cpu className="size-3.5" />} label="Runtime package" value={job.runtime_package_id} /><Binding icon={<FileOutput className="size-3.5" />} label="Prediction output" value={job.output_key} /><Binding icon={<Fingerprint className="size-3.5" />} label="Output SHA-256" value={job.output_sha256} /></div>
    <div className="space-y-2 p-4"><p className="text-[10px] text-muted-foreground">{taskLabel[job.task] ?? job.task} · sector {job.sector} · {job.producer || 'runtime not observed'}</p><Button className="h-8 w-full rounded-none text-xs" onClick={() => void onQueueJob(job)} disabled={queueing || !runtimeVerified || activeStatus(job.status)}>{queueing ? <LoaderCircle className="size-3.5 animate-spin" /> : <Play className="size-3.5" />}{completed ? 'Run batch again' : 'Retry batch'}</Button>{!runtimeVerified && <p className="text-[9px] text-red-600 dark:text-red-300">Retry is locked because the selected runtime has not passed every verification gate.</p>}</div>
  </aside>;
}

function InferenceStat({ icon, label, value, detail }: { icon: JSX.Element; label: string; value: string | number; detail: string }): JSX.Element { return <div className="min-w-0 bg-background/95 p-3"><p className="flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-[0.1em] text-muted-foreground">{icon}{label}</p><p className="mt-1 font-mono text-lg font-semibold">{value}</p><p className="mt-0.5 truncate text-[9px] text-muted-foreground">{detail}</p></div>; }
function InspectorStat({ label, value }: { label: string; value: string }): JSX.Element { return <div className="bg-background p-3"><p className="font-mono text-[8px] uppercase text-muted-foreground">{label}</p><p className="mt-1 font-mono text-sm font-semibold">{value}</p></div>; }
function EvidenceStep({ icon, label, detail, state }: { icon: JSX.Element; label: string; detail: string; state: 'pass' | 'fail' | 'wait' }): JSX.Element { return <div className={`flex items-start gap-2 border px-2.5 py-2 ${state === 'pass' ? 'border-emerald-500/25 bg-emerald-500/[0.035]' : state === 'fail' ? 'border-red-500/25 bg-red-500/[0.035]' : 'border-border/70 bg-muted/10'}`}><span className={state === 'pass' ? 'text-emerald-500' : state === 'fail' ? 'text-red-500' : 'text-muted-foreground'}>{state === 'pass' ? <Check className="size-3.5" /> : state === 'fail' ? <CircleAlert className="size-3.5" /> : <Circle className="size-3.5" />}</span><span className="min-w-0"><span className="block text-[10px] font-medium">{label}</span><span className="mt-0.5 block truncate text-[9px] text-muted-foreground" title={detail}>{detail}</span></span>{icon}</div>; }
function Binding({ icon, label, value, link }: { icon: JSX.Element; label: string; value?: string; link?: string }): JSX.Element { const content = <span className="block break-all font-mono text-[9px] leading-4 text-foreground">{value || 'not recorded'}</span>; return <div className="flex min-w-0 items-start gap-2 text-muted-foreground">{icon}<div className="min-w-0"><p className="font-mono text-[8px] uppercase">{label}</p>{link && value ? <Link to={link} className="text-primary hover:underline">{content}</Link> : content}</div></div>; }
function EmptyState({ text }: { text: string }): JSX.Element { return <div className="grid min-h-64 place-items-center p-6 text-center"><div><Database className="mx-auto size-6 text-muted-foreground/50" /><p className="mt-2 max-w-sm text-xs text-muted-foreground">{text}</p></div></div>; }
