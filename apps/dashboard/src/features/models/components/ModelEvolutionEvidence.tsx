import { useEffect, useMemo, useState, type JSX } from 'react';
import { Link } from 'react-router-dom';
import {
  Activity,
  ArrowRight,
  BadgeCheck,
  Box,
  BrainCircuit,
  CheckCircle2,
  CircleAlert,
  Database,
  GitBranch,
  LoaderCircle,
  Network,
  ShieldCheck,
} from 'lucide-react';
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

import { Badge } from '@/components/ui/badge';
import { apiFetch } from '@/lib/api';

import { formatBytes, formatDate, statusVariant, taskLabel, type InferenceJob, type ModelEvaluation, type ModelRecord } from '../types';

interface ModelEvolutionEvidenceProps {
  model?: ModelRecord;
  models?: ModelRecord[];
  jobs?: InferenceJob[];
  selectedRuntimeId?: string;
  onSelectRuntimeId?: (runtimePackageID: string) => void;
  compact?: boolean;
}

const jobColors: Record<string, string> = {
  completed: '#10b981',
  running: '#06b6d4',
  planned: '#f59e0b',
  failed: '#ef4444',
};

function score(value?: number): string {
  return value === undefined ? '—' : `${(value * 100).toFixed(2)}%`;
}

function short(value?: string, size = 14): string {
  if (!value) return '—';
  return value.length > size ? `${value.slice(0, size)}…` : value;
}

export function ModelEvolutionEvidence({ model, models = [], jobs = [], selectedRuntimeId, onSelectRuntimeId, compact = false }: ModelEvolutionEvidenceProps): JSX.Element {
  const subjects = models.length > 0 ? models : model ? [model] : [];
  const selected = subjects.find((item) => item.runtime_package_id === selectedRuntimeId) ?? model ?? subjects[0];
  const [evaluation, setEvaluation] = useState<ModelEvaluation>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    let active = true;
    if (!selected?.runtime_package_id) {
      setEvaluation(undefined);
      return () => { active = false; };
    }
    setLoading(true);
    setError(undefined);
    setEvaluation(undefined);
    void apiFetch<ModelEvaluation>(`/v1/models/${encodeURIComponent(selected.runtime_package_id)}/evaluation`)
      .then((value) => { if (active) setEvaluation(value); })
      .catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : 'Evolution evidence is unavailable'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [selected?.runtime_package_id]);

  const linkedJobs = useMemo(() => selected ? jobs.filter((job) => job.runtime_package_id === selected.runtime_package_id || job.model_id === selected.model_id) : [], [jobs, selected]);

  if (!selected) {
    return <section className="border border-border/80 bg-card"><header className="border-b border-border/60 p-5"><p className="flex items-center gap-2 font-mono text-xs uppercase tracking-[0.14em] text-primary"><GitBranch className="size-4" />Evolution evidence</p><h3 className="mt-1 text-lg font-semibold">No model generation registered</h3></header><div className="grid min-h-72 place-items-center p-6 text-center"><div><Network className="mx-auto size-8 text-muted-foreground/50" /><p className="mt-3 text-sm text-muted-foreground">Training, evaluation and runtime provenance will appear after the first model package is committed.</p></div></div></section>;
  }

  if (compact) {
    return <CompactEvolution model={selected} evaluation={evaluation} jobs={linkedJobs} loading={loading} />;
  }

  return <section className="overflow-hidden border border-border/80 bg-card">
    <header className="border-b border-border/60 p-4 sm:p-5">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between"><div><p className="flex items-center gap-2 font-mono text-xs uppercase tracking-[0.14em] text-primary"><GitBranch className="size-4" />Model evolution console</p><h3 className="mt-1 text-lg font-semibold">Immutable generation lineage</h3><p className="mt-1 text-sm text-muted-foreground">Theo dõi một thế hệ từ Gold evidence đến model đang phục vụ và các inference footprint đã tạo.</p></div><label><span className="mb-1 block font-mono text-[10px] uppercase text-muted-foreground">Generation subject</span><select value={selected.runtime_package_id} onChange={(event) => onSelectRuntimeId?.(event.target.value)} className="h-10 w-full border border-input bg-background px-3 font-mono text-xs outline-none focus:border-primary sm:w-[430px]">{subjects.map((item) => <option key={item.runtime_package_id} value={item.runtime_package_id}>{item.model_id} · {item.model_version || 'unversioned'} · {item.status}</option>)}</select></label></div>
    </header>

    {loading ? <State icon={<LoaderCircle className="size-5 animate-spin" />} title="Resolving provenance bindings" detail={selected.runtime_package_id} />
      : error || !evaluation ? <State icon={<CircleAlert className="size-5" />} title="Incomplete evolution chain" detail={error || 'The runtime package has no readable evaluation evidence.'} warning />
        : <EvolutionConsole model={selected} models={subjects} evaluation={evaluation} jobs={linkedJobs} onSelect={onSelectRuntimeId} />}
  </section>;
}

function EvolutionConsole({ model, models, evaluation, jobs, onSelect }: { model: ModelRecord; models: ModelRecord[]; evaluation: ModelEvaluation; jobs: InferenceJob[]; onSelect?: (id: string) => void }): JSX.Element {
  const completedJobs = jobs.filter((job) => job.status.toLowerCase() === 'completed').length;
  const inferenceSeries = [...jobs].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()).slice(-16).map((job, index) => ({
    label: jobs.length > 8 ? String(index + 1) : short(job.job_id, 8),
    rows: job.expected_prediction_count,
    status: job.status.toLowerCase(),
    job,
  }));

  return <div className="min-w-0">
    <section className="border-b border-border/60 p-4 sm:p-5"><div className="grid gap-3 xl:grid-cols-[1fr_auto_1fr_auto_1fr_auto_1fr_auto_1fr] xl:items-stretch">
      <EvolutionNode icon={Database} step="01 / DATA" title="Gold snapshot" tone="cyan" primary={evaluation.gold_snapshot_id || 'binding unavailable'} secondary={evaluation.dataset_view_version || 'dataset view not recorded'} link={evaluation.gold_snapshot_id ? `/gold/snapshots/${encodeURIComponent(evaluation.gold_snapshot_id)}` : undefined} />
      <RailArrow />
      <EvolutionNode icon={BrainCircuit} step="02 / TRAIN" title="Training run" tone="violet" primary={evaluation.training_run_id} secondary={`${evaluation.split_id || 'split unavailable'} · ${evaluation.feature_count} features`} />
      <RailArrow />
      <EvolutionNode icon={BadgeCheck} step="03 / EVALUATE" title="Frozen cohorts" tone="emerald" primary={evaluation.evaluation_run_id} secondary={`PR-AUC ${score(evaluation.golden.pr_auc)} · Recall ${score(evaluation.golden.recall)}`} />
      <RailArrow />
      <EvolutionNode icon={Box} step="04 / PACKAGE" title="ONNX runtime" tone="sky" primary={evaluation.runtime_package_id} secondary={`${formatBytes(evaluation.onnx_size_bytes)} · parity ${evaluation.parity_status}`} />
      <RailArrow />
      <EvolutionNode icon={ShieldCheck} step="05 / SERVE" title="Inference reach" tone="amber" primary={`${completedJobs}/${jobs.length} jobs completed`} secondary={`${model.status.toUpperCase()} · ${jobs.reduce((sum, job) => sum + job.expected_prediction_count, 0).toLocaleString()} expected rows`} />
    </div></section>

    <section className="grid min-w-0 gap-px border-b border-border/60 bg-border/60 2xl:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)]">
      <article className="min-w-0 bg-background/95"><PanelHeader icon={<Activity className="size-4" />} title="Inference footprint by job" detail="Expected prediction rows from immutable inference manifests; màu biểu thị trạng thái job." />{inferenceSeries.length === 0 ? <PanelEmpty text="Runtime package này chưa được gắn vào inference job nào." /> : <div className="h-[310px] p-3"><ResponsiveContainer width="100%" height="100%"><BarChart data={inferenceSeries} margin={{ top: 10, right: 12, bottom: 12, left: 4 }}><CartesianGrid strokeDasharray="3 3" vertical={false} opacity={0.25} /><XAxis dataKey="label" tick={{ fontSize: 10 }} /><YAxis tick={{ fontSize: 10 }} width={50} /><Tooltip formatter={(value) => `${Number(value).toLocaleString()} rows`} labelFormatter={(_, payload) => payload?.[0]?.payload?.job?.job_id ?? ''} /><Bar dataKey="rows" name="Expected predictions" maxBarSize={42}>{inferenceSeries.map((entry) => <Cell key={entry.job.job_id} fill={jobColors[entry.status] ?? '#64748b'} />)}</Bar></BarChart></ResponsiveContainer></div>}</article>

      <article className="min-w-0 bg-background/95"><PanelHeader icon={<GitBranch className="size-4" />} title="Artifact binding ledger" detail="Các ID và digest dùng để tái lập chính xác thế hệ model này." /><dl className="grid gap-px bg-border/60 sm:grid-cols-2"><Binding label="Gold manifest SHA" value={evaluation.gold_manifest_sha256} /><Binding label="Dataset fingerprint" value={evaluation.dataset_view_fingerprint} /><Binding label="Training manifest SHA" value={evaluation.training_run_manifest_sha256} /><Binding label="Evaluation manifest SHA" value={evaluation.evaluation_run_manifest_sha256} /><Binding label="Metrics SHA" value={evaluation.metrics_sha256} /><Binding label="ONNX SHA" value={evaluation.onnx_sha256} /><Binding label="Preprocessing" value={evaluation.preprocessing_version} /><Binding label="Threshold policy" value={evaluation.threshold_policy_version} /></dl></article>
    </section>

    <section className="min-w-0"><PanelHeader icon={<Database className="size-4" />} title="Generation ledger" detail="Tất cả runtime generation hiện có; chọn một dòng để đổi subject mà không rời trang." /><div className="overflow-x-auto"><table className="w-full min-w-[850px] text-left text-xs"><thead className="border-y border-border/60 bg-muted/20 font-mono text-[9px] uppercase text-muted-foreground"><tr><th className="p-3">Created</th><th className="p-3">Model generation</th><th className="p-3">Evaluation</th><th className="p-3">Parity</th><th className="p-3">Runtime package</th><th className="p-3">State</th></tr></thead><tbody>{models.map((item) => <tr key={item.runtime_package_id} onClick={() => onSelect?.(item.runtime_package_id)} className={`cursor-pointer border-b border-border/50 hover:bg-muted/30 ${item.runtime_package_id === model.runtime_package_id ? 'bg-primary/8' : ''}`}><td className="p-3 text-muted-foreground">{formatDate(item.created_at)}</td><td className="p-3"><p className="font-mono font-semibold">{item.model_id}</p><p className="text-[10px] text-muted-foreground">{item.model_version || 'unversioned'}</p></td><td className="p-3 font-mono text-[10px]">{item.evaluation_run_id || '—'}</td><td className="p-3"><EvidenceStatus value={item.parity_status} /></td><td className="max-w-56 truncate p-3 font-mono text-[10px]" title={item.runtime_package_id}>{item.runtime_package_id}</td><td className="p-3"><Badge variant={statusVariant(item.status)} className="rounded-none font-mono text-[9px] uppercase">{item.status}</Badge></td></tr>)}</tbody></table></div></section>

    <footer className="flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-border/60 bg-muted/10 px-4 py-3 text-[10px] text-muted-foreground"><span>{taskLabel[model.task] ?? model.task}</span><span>·</span><span>{evaluation.evaluation_policy_version}</span><span>·</span><span>created {formatDate(model.created_at)}</span><span>·</span><span className="font-mono">{evaluation.runtime_manifest_key}</span></footer>
  </div>;
}

function CompactEvolution({ model, evaluation, jobs, loading }: { model: ModelRecord; evaluation?: ModelEvaluation; jobs: InferenceJob[]; loading: boolean }): JSX.Element {
  return <section className="overflow-hidden border border-border/80 bg-card"><header className="flex items-center justify-between gap-3 border-b border-border/60 p-4"><div><p className="flex items-center gap-2 text-sm font-semibold"><GitBranch className="size-4 text-primary" />Evolution evidence</p><p className="mt-1 text-xs text-muted-foreground">Gold → evaluation → runtime → inference</p></div><Badge variant={statusVariant(model.status)} className="rounded-none font-mono text-[9px] uppercase">{model.status}</Badge></header><div className="grid gap-px bg-border/60 sm:grid-cols-4"><CompactNode label="Gold" value={loading ? 'loading' : evaluation?.gold_snapshot_id || '—'} /><CompactNode label="Evaluation" value={model.evaluation_run_id || '—'} /><CompactNode label="Runtime" value={short(model.runtime_package_id)} /><CompactNode label="Inference" value={`${jobs.filter((job) => job.status === 'completed').length}/${jobs.length} complete`} /></div></section>;
}

function EvolutionNode({ icon: Icon, step, title, primary, secondary, tone, link }: { icon: typeof Database; step: string; title: string; primary: string; secondary: string; tone: 'cyan' | 'violet' | 'emerald' | 'sky' | 'amber'; link?: string }): JSX.Element {
  const tones = { cyan: 'border-cyan-500/40 text-cyan-600 dark:text-cyan-300', violet: 'border-violet-500/40 text-violet-600 dark:text-violet-300', emerald: 'border-emerald-500/40 text-emerald-600 dark:text-emerald-300', sky: 'border-sky-500/40 text-sky-600 dark:text-sky-300', amber: 'border-amber-500/40 text-amber-700 dark:text-amber-300' };
  const content = <><p className="flex items-center gap-2 font-mono text-[9px] uppercase tracking-[0.12em]"><Icon className="size-3.5" />{step}</p><p className="mt-3 text-xs font-semibold text-foreground">{title}</p><p className="mt-1 truncate font-mono text-[11px] text-foreground" title={primary}>{primary}</p><p className="mt-1 text-[10px] text-muted-foreground">{secondary}</p></>;
  return link ? <Link to={link} className={`min-w-0 border bg-background/70 p-3 transition-colors hover:bg-muted/30 ${tones[tone]}`}>{content}</Link> : <div className={`min-w-0 border bg-background/70 p-3 ${tones[tone]}`}>{content}</div>;
}

function RailArrow(): JSX.Element { return <div className="hidden items-center justify-center text-muted-foreground xl:flex"><ArrowRight className="size-4" /></div>; }
function PanelHeader({ icon, title, detail }: { icon: JSX.Element; title: string; detail: string }): JSX.Element { return <header className="border-b border-border/60 px-4 py-3"><p className="flex items-center gap-2 text-sm font-medium">{icon}{title}</p><p className="mt-0.5 text-[11px] text-muted-foreground">{detail}</p></header>; }
function PanelEmpty({ text }: { text: string }): JSX.Element { return <div className="grid min-h-[260px] place-items-center p-6 text-center text-xs text-muted-foreground"><p>{text}</p></div>; }
function Binding({ label, value }: { label: string; value?: string }): JSX.Element { return <div className="min-w-0 bg-background p-3"><dt className="font-mono text-[9px] uppercase text-muted-foreground">{label}</dt><dd className="mt-1 truncate font-mono text-[11px]" title={value}>{value || 'not recorded'}</dd></div>; }
function CompactNode({ label, value }: { label: string; value: string }): JSX.Element { return <div className="min-w-0 bg-background p-3"><p className="font-mono text-[9px] uppercase text-muted-foreground">{label}</p><p className="mt-1 truncate font-mono text-xs font-medium" title={value}>{value}</p></div>; }
function EvidenceStatus({ value }: { value: string }): JSX.Element { const passed = ['PASS', 'PASSED'].includes(value.toUpperCase()); return <span className={`flex items-center gap-1 text-[10px] ${passed ? 'text-emerald-600 dark:text-emerald-300' : 'text-amber-700 dark:text-amber-300'}`}>{passed ? <CheckCircle2 className="size-3" /> : <CircleAlert className="size-3" />}{value || 'not recorded'}</span>; }
function State({ icon, title, detail, warning = false }: { icon: JSX.Element; title: string; detail: string; warning?: boolean }): JSX.Element { return <div className={`grid min-h-[520px] place-items-center p-6 text-center ${warning ? 'text-amber-700 dark:text-amber-300' : 'text-muted-foreground'}`}><div>{icon}<p className="mt-3 text-sm font-medium">{title}</p><p className="mt-1 max-w-lg text-xs opacity-80">{detail}</p></div></div>; }
