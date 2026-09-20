import { Fragment, useEffect, useMemo, useState, type JSX } from 'react';
import { Boxes, CheckCircle2, CircleAlert, Crown, Database, HardDrive, LoaderCircle, Search, ShieldCheck, Sparkles, Square, XCircle } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { formatBytes, formatDate, statusVariant, taskLabel, type ModelPromotionState, type ModelRecord, type TaskType } from '../types';

interface ModelRegistryTableProps {
  models: ModelRecord[];
  selectedRuntimeId?: string;
  onSelectRuntimeId: (runtimePackageId: string) => void;
  taskFilter: TaskType;
  onTaskFilterChange: (filter: TaskType) => void;
  loading: boolean;
  onDeployModel?: (runtimePackageId: string, task: string, active: boolean) => Promise<void>;
  isDeploying?: boolean;
  promotion?: ModelPromotionState;
}

type LifecycleFilter = 'all' | 'champion' | 'validated' | 'invalid';
const PAGE_SIZE = 10;

function pass(value?: string): boolean {
  return value?.toUpperCase() === 'PASS' || value?.toUpperCase() === 'PASSED';
}

export function ModelRegistryTable({ models, selectedRuntimeId, onSelectRuntimeId, taskFilter, onTaskFilterChange, loading, onDeployModel, isDeploying, promotion }: ModelRegistryTableProps): JSX.Element {
  const [search, setSearch] = useState('');
  const [lifecycle, setLifecycle] = useState<LifecycleFilter>('all');
  const [page, setPage] = useState(1);
  const counts = useMemo(() => ({
    champion: models.filter((model) => model.status === 'champion').length,
    validated: models.filter((model) => model.status === 'validated').length,
    invalid: models.filter((model) => model.status === 'invalid').length,
    bytes: models.reduce((total, model) => total + model.onnx_size_bytes, 0),
  }), [models]);
  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return models.filter((model) => {
      if (taskFilter !== 'all' && model.task !== taskFilter) return false;
      if (lifecycle !== 'all' && model.status !== lifecycle) return false;
      if (!query) return true;
      return [model.model_id, model.runtime_package_id, model.model_version, model.evaluation_run_id, taskLabel[model.task] ?? model.task].some((value) => value?.toLowerCase().includes(query));
    });
  }, [lifecycle, models, search, taskFilter]);
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const rows = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  useEffect(() => setPage((current) => Math.min(current, pageCount)), [pageCount]);
  const changeFilters = (change: () => void) => { change(); setPage(1); };

  return <section className="min-w-0 overflow-hidden border border-border/80 bg-card">
    <header className="flex flex-col gap-4 border-b border-border/60 p-4 sm:p-5 lg:flex-row lg:items-end lg:justify-between">
      <div><p className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.14em] text-primary"><Boxes className="size-4" />Runtime registry console</p><h3 className="mt-1 text-lg font-semibold">Versioned ONNX generations</h3><p className="mt-1 max-w-2xl text-xs text-muted-foreground">Inspect verification gates, select a generation and control the active serving pointer.</p></div>
      <span className="w-fit border border-border/70 bg-muted/20 px-2 py-1 font-mono text-[9px] uppercase text-muted-foreground">MinIO runtime registry</span>
    </header>
    <div className="grid gap-px border-b border-border/60 bg-border/60 sm:grid-cols-2 xl:grid-cols-4">
      <RegistryStat icon={<Crown className="size-3.5 text-amber-500" />} label="Serving champion" value={counts.champion || '—'} detail={counts.champion ? 'active runtime pointer' : 'no active generation'} />
      <RegistryStat icon={<CheckCircle2 className="size-3.5 text-emerald-500" />} label="Promotion ready" value={counts.validated} detail="parity + integrity passed" />
      <RegistryStat icon={<CircleAlert className="size-3.5 text-red-500" />} label="Blocked packages" value={counts.invalid} detail="failed verification gate" />
      <RegistryStat icon={<HardDrive className="size-3.5 text-sky-500" />} label="ONNX footprint" value={formatBytes(counts.bytes)} detail={`${models.length.toLocaleString()} registered generations`} />
    </div>
    <div className="flex flex-col gap-3 border-b border-border/60 bg-muted/10 p-3 lg:flex-row lg:items-center lg:justify-between">
      <div className="relative min-w-0 flex-1 lg:max-w-xl"><Search className="absolute left-2.5 top-2.5 size-3.5 text-muted-foreground" /><Input value={search} onChange={(event) => changeFilters(() => setSearch(event.target.value))} placeholder="Filter model, runtime package or evaluation run…" className="h-9 rounded-none pl-8 font-mono text-xs" /></div>
      <div className="flex min-w-0 flex-wrap gap-2"><select aria-label="Task filter" value={taskFilter} onChange={(event) => changeFilters(() => onTaskFilterChange(event.target.value as TaskType))} className="h-9 border border-input bg-background px-2 font-mono text-[10px] uppercase"><option value="all">All tasks</option><option value="candidate_vetting">Candidate vetting</option></select><div className="flex border border-border/70 bg-background p-0.5">{(['all', 'champion', 'validated', 'invalid'] as const).map((value) => <button key={value} type="button" onClick={() => changeFilters(() => setLifecycle(value))} className={`px-2.5 py-1.5 font-mono text-[9px] uppercase transition-colors ${lifecycle === value ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted/50'}`}>{value}</button>)}</div></div>
    </div>
    {loading ? <RegistryEmpty icon={<LoaderCircle className="size-5 animate-spin" />} title="Reading runtime manifests" detail="Verifying registry inventory…" /> : rows.length === 0 ? <RegistryEmpty icon={<Database className="size-5" />} title="No matching generation" detail="The current task, lifecycle and text filters returned no package." /> : <div className="overflow-x-auto"><table className="w-full min-w-[1040px] text-left"><thead className="border-b border-border/60 bg-muted/20 font-mono text-[9px] uppercase tracking-[0.1em] text-muted-foreground"><tr><th className="px-3 py-2.5">Generation</th><th className="px-3 py-2.5">Lifecycle</th><th className="px-3 py-2.5">Verification gates</th><th className="px-3 py-2.5">Runtime contract</th><th className="px-3 py-2.5">Created</th><th className="px-3 py-2.5 text-right">Serving control</th></tr></thead><tbody>{rows.map((model) => {
      const champion = model.status === 'champion';
      const parityPass = pass(model.parity_status);
      const integrityPass = pass(model.integrity_status);
      const promotable = model.status !== 'invalid' && parityPass && integrityPass;
      const selected = model.runtime_package_id === selectedRuntimeId;
      const activePromotion = promotion?.runtimePackageId === model.runtime_package_id ? promotion : undefined;
      return <Fragment key={model.runtime_package_id}><tr onClick={() => onSelectRuntimeId(model.runtime_package_id)} className={`cursor-pointer border-b border-border/50 transition-colors ${selected ? 'bg-primary/[0.07] shadow-[inset_3px_0_0_var(--primary)]' : 'hover:bg-muted/25'}`}><td className="max-w-[285px] px-3 py-3"><p className="truncate font-mono text-xs font-semibold" title={model.model_id}>{model.model_id}</p><p className="mt-1 truncate font-mono text-[9px] text-muted-foreground" title={model.runtime_package_id}>{model.runtime_package_id}</p><p className="mt-1 text-[10px] text-muted-foreground">{model.model_version || 'unversioned'}</p></td><td className="px-3 py-3"><Badge variant={statusVariant(model.status)} className="rounded-none font-mono text-[9px] uppercase">{champion && <Crown className="mr-1 size-3" />}{model.status}</Badge><p className="mt-1.5 max-w-40 truncate text-[9px] text-muted-foreground">{taskLabel[model.task] ?? model.task}</p></td><td className="px-3 py-3"><div className="flex gap-1.5"><GateBadge label="Parity" passed={parityPass} /><GateBadge label="Integrity" passed={integrityPass} /></div><p className="mt-1.5 truncate font-mono text-[9px] text-muted-foreground" title={model.evaluation_run_id}>{model.evaluation_run_id || 'evaluation not bound'}</p></td><td className="px-3 py-3"><p className="font-mono text-[10px]">{model.feature_count.toLocaleString()} features · θ {model.decision_threshold.toFixed(4)}</p><p className="mt-1 text-[9px] text-muted-foreground">{formatBytes(model.onnx_size_bytes)} ONNX</p></td><td className="px-3 py-3"><p className="max-w-32 text-[10px] text-muted-foreground">{formatDate(model.created_at)}</p></td><td className="px-3 py-3 text-right" onClick={(event) => event.stopPropagation()}>{champion ? <Button size="sm" variant="outline" className="h-7 rounded-none border-destructive/40 px-2 text-[10px] text-destructive" onClick={() => onDeployModel?.(model.runtime_package_id, model.task, false)} disabled={isDeploying}><Square className="size-3" />Deactivate</Button> : <Button size="sm" variant="outline" className="h-7 rounded-none px-2 text-[10px]" onClick={() => onDeployModel?.(model.runtime_package_id, model.task, true)} disabled={isDeploying || !promotable} title={!promotable ? 'Parity and integrity must both pass before promotion.' : 'Set this generation as Champion'}>{activePromotion?.status === 'running' ? <LoaderCircle className="size-3 animate-spin" /> : <Sparkles className="size-3" />}Set champion</Button>}</td></tr>{activePromotion && <tr className="border-b border-border/60"><td colSpan={6} className="p-0"><PromotionTrace promotion={activePromotion} /></td></tr>}</Fragment>;
    })}</tbody></table></div>}
    <footer className="flex items-center justify-between gap-3 border-t border-border/60 bg-muted/10 px-3 py-2.5 font-mono text-[9px] uppercase text-muted-foreground"><span>{filtered.length.toLocaleString()} matching · {models.length.toLocaleString()} total</span><div className="flex items-center gap-2"><Button variant="outline" size="sm" className="h-7 rounded-none px-2 text-[9px]" onClick={() => setPage((current) => Math.max(1, current - 1))} disabled={page === 1}>Previous</Button><span>Page {page} / {pageCount}</span><Button variant="outline" size="sm" className="h-7 rounded-none px-2 text-[9px]" onClick={() => setPage((current) => Math.min(pageCount, current + 1))} disabled={page === pageCount}>Next</Button></div></footer>
  </section>;
}

function RegistryStat({ icon, label, value, detail }: { icon: JSX.Element; label: string; value: string | number; detail: string }): JSX.Element { return <div className="min-w-0 bg-background/95 p-3"><p className="flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-[0.1em] text-muted-foreground">{icon}{label}</p><p className="mt-1 font-mono text-lg font-semibold">{value}</p><p className="mt-0.5 truncate text-[9px] text-muted-foreground">{detail}</p></div>; }
function GateBadge({ label, passed }: { label: string; passed: boolean }): JSX.Element { return <span className={`inline-flex items-center gap-1 border px-1.5 py-1 font-mono text-[8px] uppercase ${passed ? 'border-emerald-500/35 bg-emerald-500/8 text-emerald-700 dark:text-emerald-300' : 'border-red-500/35 bg-red-500/8 text-red-700 dark:text-red-300'}`}>{passed ? <ShieldCheck className="size-2.5" /> : <CircleAlert className="size-2.5" />}{label} {passed ? 'pass' : 'fail'}</span>; }
function PromotionTrace({ promotion }: { promotion: ModelPromotionState }): JSX.Element {
  const complete = promotion.status === 'completed';
  const failed = promotion.status === 'failed';
  const tone = failed ? 'border-red-500/35 bg-red-500/[0.06]' : complete ? 'border-emerald-500/35 bg-emerald-500/[0.06]' : 'border-primary/35 bg-primary/[0.05]';
  const bar = failed ? 'bg-red-500' : complete ? 'bg-emerald-500' : 'bg-primary';
  return <div className={`border-y px-4 py-3 ${tone}`} onClick={(event) => event.stopPropagation()}>
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="flex min-w-0 items-start gap-2">
        {failed ? <XCircle className="mt-0.5 size-4 shrink-0 text-red-500" /> : complete ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-500" /> : <LoaderCircle className="mt-0.5 size-4 shrink-0 animate-spin text-primary" />}
        <div className="min-w-0"><p className="font-mono text-[10px] font-semibold uppercase tracking-[0.08em]">{promotion.phase.replaceAll('_', ' ')}</p><p className="mt-0.5 text-[11px] text-muted-foreground">{promotion.message}</p></div>
      </div>
      <span className="font-mono text-[10px] font-semibold">{Math.max(0, Math.min(100, promotion.progressPercent))}%</span>
    </div>
    <div className="mt-2 h-1.5 overflow-hidden bg-muted"><div className={`h-full transition-[width] duration-300 ${bar}`} style={{ width: `${Math.max(0, Math.min(100, promotion.progressPercent))}%` }} /></div>
    {(promotion.parityCases !== undefined || promotion.runtimeValidationId) && <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 font-mono text-[9px] text-muted-foreground">
      {promotion.parityCases !== undefined && <span>Parity cases: <strong className="text-foreground">{promotion.parityCases}</strong></span>}
      {promotion.engine && <span>Engine: <strong className="text-foreground">{promotion.engine}</strong></span>}
      {promotion.runtimeValidationId && <span>Evidence: <strong className="text-foreground">{promotion.runtimeValidationId}</strong></span>}
      {promotion.maxAbsoluteError !== undefined && <span>Max |Δ|: <strong className="text-foreground">{promotion.maxAbsoluteError.toExponential(2)}</strong></span>}
    </div>}
  </div>;
}
function RegistryEmpty({ icon, title, detail }: { icon: JSX.Element; title: string; detail: string }): JSX.Element { return <div className="grid min-h-64 place-items-center p-6 text-center text-muted-foreground"><div className="grid justify-items-center">{icon}<p className="mt-2 text-sm font-medium text-foreground">{title}</p><p className="mt-1 text-xs">{detail}</p></div></div>; }
