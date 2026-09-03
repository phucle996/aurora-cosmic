import { type JSX } from 'react';
import { Link } from 'react-router-dom';
import { Activity, Check, Circle, CircleAlert, Crown, Database, FileKey2, Fingerprint, LoaderCircle, PackageCheck, ShieldCheck, Sparkles, Square } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { formatBytes, formatDate, statusVariant, taskLabel, type ModelRecord } from '../types';

interface SelectedModelDetailsProps {
  selectedModel?: ModelRecord;
  onDeployModel?: (runtimePackageId: string, task: string, active: boolean) => Promise<void>;
  isDeploying?: boolean;
}

function pass(value?: string): boolean {
  return value?.toUpperCase() === 'PASS' || value?.toUpperCase() === 'PASSED';
}

export function SelectedModelDetails({ selectedModel, onDeployModel, isDeploying }: SelectedModelDetailsProps): JSX.Element {
  if (!selectedModel) return <section className="grid min-h-[520px] place-items-center border border-border/80 bg-card p-6 text-center"><div><Database className="mx-auto size-7 text-muted-foreground/50" /><p className="mt-3 text-sm font-medium">No registry subject selected</p><p className="mt-1 text-xs text-muted-foreground">Select a runtime generation to inspect its promotion evidence.</p></div></section>;

  const champion = selectedModel.status === 'champion';
  const parityPass = pass(selectedModel.parity_status);
  const integrityPass = pass(selectedModel.integrity_status);
  const promotable = selectedModel.status !== 'invalid' && parityPass && integrityPass;
  const stages = [
    { label: 'Evaluation bound', passed: Boolean(selectedModel.evaluation_run_id), detail: selectedModel.evaluation_run_id || 'missing' },
    { label: 'Runtime parity', passed: parityPass, detail: selectedModel.parity_status || 'unobserved' },
    { label: 'Artifact integrity', passed: integrityPass, detail: selectedModel.integrity_status || 'unobserved' },
    { label: 'Serving pointer', passed: champion, detail: champion ? 'CHAMPION' : 'standby', neutral: !champion },
  ];

  return <section className="min-w-0 overflow-hidden border border-border/80 bg-card">
    <header className="border-b border-border/60 p-4"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="font-mono text-[9px] uppercase tracking-[0.14em] text-primary">Selected generation</p><h3 className="mt-1 truncate font-mono text-sm font-semibold" title={selectedModel.model_id}>{selectedModel.model_id}</h3><p className="mt-1 truncate font-mono text-[9px] text-muted-foreground" title={selectedModel.runtime_package_id}>{selectedModel.runtime_package_id}</p></div><Badge variant={statusVariant(selectedModel.status)} className="shrink-0 rounded-none font-mono text-[9px] uppercase">{champion && <Crown className="mr-1 size-3" />}{selectedModel.status}</Badge></div></header>

    <div className={`border-b p-4 ${champion ? 'border-emerald-500/30 bg-emerald-500/[0.06]' : promotable ? 'border-primary/25 bg-primary/[0.035]' : 'border-red-500/30 bg-red-500/[0.045]'}`}>
      <div className="flex items-start gap-2">{champion ? <Crown className="mt-0.5 size-4 shrink-0 text-amber-500" /> : promotable ? <PackageCheck className="mt-0.5 size-4 shrink-0 text-emerald-500" /> : <CircleAlert className="mt-0.5 size-4 shrink-0 text-red-500" />}<div><p className="text-xs font-semibold">{champion ? 'Active serving generation' : promotable ? 'Eligible for promotion' : 'Promotion blocked'}</p><p className="mt-1 text-[10px] leading-4 text-muted-foreground">{champion ? 'This runtime package owns the active Champion pointer.' : promotable ? 'Parity and artifact integrity are verified; an operator may promote this package.' : 'Resolve every failed verification gate before this package can serve inference.'}</p></div></div>
      <div className="mt-3">{champion ? <Button type="button" variant="outline" className="h-8 w-full rounded-none border-destructive/40 text-xs text-destructive" disabled={isDeploying} onClick={() => onDeployModel?.(selectedModel.runtime_package_id, selectedModel.task, false)}>{isDeploying ? <LoaderCircle className="size-3.5 animate-spin" /> : <Square className="size-3.5" />}Deactivate champion</Button> : <Button type="button" className="h-8 w-full rounded-none text-xs" disabled={isDeploying || !promotable} onClick={() => onDeployModel?.(selectedModel.runtime_package_id, selectedModel.task, true)}>{isDeploying ? <LoaderCircle className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}Promote / restore generation</Button>}</div>
    </div>

    <div className="border-b border-border/60"><div className="border-b border-border/50 px-4 py-2.5"><p className="flex items-center gap-2 text-xs font-medium"><Activity className="size-3.5 text-primary" />Promotion evidence rail</p></div><div className="grid gap-px bg-border/60 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">{stages.map((stage) => <div key={stage.label} className="min-w-0 bg-background/95 p-3"><p className={`flex items-center gap-1.5 text-[10px] font-medium ${stage.neutral ? 'text-muted-foreground' : stage.passed ? 'text-emerald-600 dark:text-emerald-300' : 'text-red-600 dark:text-red-300'}`}>{stage.passed ? <Check className="size-3" /> : stage.neutral ? <Circle className="size-3" /> : <CircleAlert className="size-3" />}{stage.label}</p><p className="mt-1 truncate font-mono text-[9px] text-muted-foreground" title={stage.detail}>{stage.detail}</p></div>)}</div></div>

    <div className="border-b border-border/60 p-4"><p className="flex items-center gap-2 text-xs font-medium"><ShieldCheck className="size-3.5 text-primary" />Runtime contract</p><dl className="mt-3 grid gap-px border border-border/70 bg-border/70 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2"><Fact label="Task" value={taskLabel[selectedModel.task] ?? selectedModel.task} /><Fact label="Model version" value={selectedModel.model_version || '—'} /><Fact label="Preprocessing" value={selectedModel.preprocessing_version || '—'} /><Fact label="Feature vector" value={`${selectedModel.feature_count.toLocaleString()} ordered features`} /><Fact label="Decision threshold" value={selectedModel.decision_threshold.toFixed(6)} /><Fact label="ONNX artifact" value={formatBytes(selectedModel.onnx_size_bytes)} /><Fact label="Created" value={formatDate(selectedModel.created_at)} wide /></dl></div>

    <div className="space-y-3 border-b border-border/60 p-4"><p className="flex items-center gap-2 text-xs font-medium"><Fingerprint className="size-3.5 text-primary" />Immutable identity</p><Identity label="ONNX SHA-256" value={selectedModel.onnx_sha256} /><Identity label="Runtime manifest" value={selectedModel.runtime_manifest_key} /><Identity label="Evaluation run" value={selectedModel.evaluation_run_id} /></div>

    <details className="border-b border-border/60"><summary className="cursor-pointer px-4 py-3 text-xs font-medium"><FileKey2 className="mr-2 inline size-3.5 text-primary" />Ordered feature contract · {selectedModel.feature_count}</summary><div className="grid max-h-52 grid-cols-2 gap-px overflow-y-auto border-t border-border/60 bg-border/60 sm:grid-cols-3 xl:grid-cols-2">{selectedModel.feature_order.map((feature, index) => <div key={`${feature}-${index}`} className="min-w-0 bg-background px-2 py-1.5 font-mono text-[9px]"><span className="mr-1 text-muted-foreground">{String(index + 1).padStart(2, '0')}</span><span title={feature}>{feature}</span></div>)}</div></details>
    <div className="p-4"><Link to={`/ai-factory/models/${encodeURIComponent(selectedModel.model_id)}`} className="inline-flex text-xs font-medium text-primary hover:underline">Open full model detail and evidence →</Link></div>
  </section>;
}

function Fact({ label, value, wide = false }: { label: string; value: string; wide?: boolean }): JSX.Element { return <div className={`min-w-0 bg-background p-2.5 ${wide ? 'sm:col-span-2 xl:col-span-1 2xl:col-span-2' : ''}`}><dt className="font-mono text-[8px] uppercase text-muted-foreground">{label}</dt><dd className="mt-1 truncate text-[10px] font-medium" title={value}>{value}</dd></div>; }
function Identity({ label, value }: { label: string; value?: string }): JSX.Element { return <div className="min-w-0"><p className="font-mono text-[8px] uppercase text-muted-foreground">{label}</p><p className="mt-1 break-all border border-border/60 bg-muted/15 px-2 py-1.5 font-mono text-[9px] leading-4">{value || 'not recorded'}</p></div>; }
