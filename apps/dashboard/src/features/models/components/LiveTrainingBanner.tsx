import { type JSX } from 'react';
import { Activity, BrainCircuit } from 'lucide-react';
import type { ActiveTrainingState } from '../types';

interface LiveTrainingBannerProps {
  activeTraining: ActiveTrainingState;
  trainingElapsed: number;
}

function elapsed(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor(seconds % 3600 / 60);
  const remaining = seconds % 60;
  return hours > 0 ? `${hours}h ${String(minutes).padStart(2, '0')}m ${String(remaining).padStart(2, '0')}s` : `${minutes}m ${String(remaining).padStart(2, '0')}s`;
}

export function LiveTrainingBanner({ activeTraining, trainingElapsed }: LiveTrainingBannerProps): JSX.Element {
  const facts = [
    ['Job', activeTraining.jobId],
    ['Gold inputs', `${activeTraining.snapshotCount} snapshots`],
    ['Compute', activeTraining.computeTarget?.toUpperCase() || 'GPU'],
    ['Epoch budget', activeTraining.epochs.toLocaleString()],
    ['Initialization', activeTraining.baseModel || 'SCRATCH'],
    ['Elapsed', elapsed(trainingElapsed)],
  ];
  return <section className="border border-primary/50 bg-primary/[0.035]">
    <div className="flex flex-col gap-3 border-b border-primary/20 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-3"><span className="relative flex size-8 items-center justify-center border border-primary/40 bg-primary/10"><BrainCircuit className="size-4 text-primary" /><span className="absolute -right-1 -top-1 size-2 rounded-full bg-emerald-500" /></span><div><p className="font-mono text-[10px] uppercase tracking-[0.14em] text-primary">Active experiment</p><p className="mt-0.5 text-sm font-semibold">Candidate-vetting training run</p></div></div>
      <span className="flex w-fit items-center gap-1.5 border border-emerald-500/40 bg-emerald-500/10 px-2 py-1 font-mono text-[10px] text-emerald-700 dark:text-emerald-300"><Activity className="size-3" />RUNNING</span>
    </div>
    <div className="grid gap-px bg-border/60 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">{facts.map(([label, value]) => <div key={label} className="min-w-0 bg-card px-3 py-2.5"><p className="font-mono text-[9px] uppercase tracking-wide text-muted-foreground">{label}</p><p className="mt-1 truncate font-mono text-xs font-medium" title={value}>{value}</p></div>)}</div>
    <div className="h-1 overflow-hidden bg-muted"><div className="h-full w-1/3 animate-pulse bg-primary" /></div>
  </section>;
}
