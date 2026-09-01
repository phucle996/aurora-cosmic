import { useCallback, useEffect, useState } from 'react';
import { ArrowRight, Beaker, Database, GitBranch, LoaderCircle, Microscope, RefreshCw, Sparkles, Target } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { JSX } from 'react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { apiFetch } from '@/lib/api';

type GoldControlResponse = { runtime?: { state?: string; last_snapshot_id?: string; pending_total?: number; active_builds?: number } };
type TargetCountResponse = { count: number };
type InferenceJobsResponse = { jobs: Array<{ status: string }> };

const workbenches = [
  { path: '/research-factory/discovery', title: 'TESS Target Discovery', detail: 'Define a research sample from the live observed-target index.', icon: Target },
  { path: '/research-factory/workbench', title: 'Observation Workbench', detail: 'Inspect LC, BLS, TPF evidence, stellar physics and the 3D system in one target workspace.', icon: Microscope },
  { path: '/research-factory/candidates', title: 'Candidate Review', detail: 'Rank ML candidates, inspect immutable evidence and persist a human training decision.', icon: Sparkles },
  { path: '/research-factory/history', title: 'Research History', detail: 'Trace Gold build runs, snapshots, models and inference provenance.', icon: GitBranch },
];

function ActualMetric({ label, value, detail }: { label: string; value: string; detail: string }): JSX.Element {
  return <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">{label}</p><p className="mt-1 font-mono text-xl font-semibold tabular-nums">{value}</p><p className="mt-1 text-xs text-muted-foreground">{detail}</p></CardContent></Card>;
}

export default function ResearchOverviewPage(): JSX.Element {
  const [gold, setGold] = useState<GoldControlResponse>();
  const [observedTargets, setObservedTargets] = useState<number>();
  const [completedInference, setCompletedInference] = useState<number>();
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (): Promise<void> => {
    setLoading(true); setError(undefined);
    try {
      const [goldControl, targets, inference] = await Promise.all([
        apiFetch<GoldControlResponse>('/v1/gold/control'),
        apiFetch<TargetCountResponse>('/v1/targets?has_lightcurve=true&limit=1'),
        apiFetch<InferenceJobsResponse>('/v1/inference/jobs?task=candidate_vetting'),
      ]);
      setGold(goldControl); setObservedTargets(targets.count); setCompletedInference((inference.jobs ?? []).filter((job) => job.status === 'completed').length);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Không tải được trạng thái research factory.'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);
  const snapshot = gold?.runtime?.last_snapshot_id;

  return <div className="space-y-6">
    <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between"><div><div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground"><Beaker className="size-4 text-primary" /> Scientific Research Factory</div><h2 className="font-heading text-2xl font-semibold tracking-tight md:text-3xl">Research Factory</h2><p className="mt-1 max-w-3xl text-sm text-muted-foreground">A live scientific workspace backed by indexed observations, immutable Gold snapshots and model evidence. It never manufactures measurements when a source is missing.</p></div><Button variant="outline" onClick={() => void load()} disabled={loading}><RefreshCw className={loading ? 'animate-spin' : ''} /> Refresh live state</Button></div>
    {error && <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">{error}</div>}
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{loading ? <div className="col-span-full flex items-center justify-center gap-2 rounded-lg border border-dashed py-10 text-sm text-muted-foreground"><LoaderCircle className="animate-spin" /> Reading research state…</div> : <><ActualMetric label="Gold snapshot" value={snapshot || 'Not committed'} detail={snapshot ? 'Latest immutable enrichment output' : 'No research evidence is available yet'} /><ActualMetric label="Observed targets" value={observedTargets?.toLocaleString() ?? '0'} detail="Targets with an indexed measured light curve" /><ActualMetric label="Completed vetting runs" value={completedInference?.toLocaleString() ?? '0'} detail="Completed candidate inference jobs" /><ActualMetric label="Gold runtime" value={gold?.runtime?.state || 'Not observed'} detail={`${gold?.runtime?.pending_total ?? 0} pending Silver records · ${gold?.runtime?.active_builds ?? 0} active builds`} /></>}</div>
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">{workbenches.map((item) => { const Icon = item.icon; return <Card key={item.path} className="flex min-w-0 flex-col"><CardHeader><Icon className="size-5 text-primary" /><CardTitle className="mt-3 text-base">{item.title}</CardTitle><CardDescription>{item.detail}</CardDescription></CardHeader><CardContent className="mt-auto"><Button asChild variant="outline" size="sm"><Link to={item.path}>Open <ArrowRight /></Link></Button></CardContent></Card>; })}</div>
    <Card className="border-primary/20 bg-primary/5"><CardHeader><CardTitle className="flex items-center gap-2 text-base"><Database className="size-4 text-primary" /> Reproducibility boundary</CardTitle><CardDescription>{snapshot ? <>Current Gold evidence is pinned at <Link className="font-mono text-primary underline-offset-4 hover:underline" to={`/gold/snapshots/${encodeURIComponent(snapshot)}`}>{snapshot}</Link>. Research views preserve source limitations instead of filling absent TIC, TPF or BLS fields.</> : 'A reproducible research result begins only after Gold has committed an immutable snapshot.'}</CardDescription></CardHeader></Card>
  </div>;
}
