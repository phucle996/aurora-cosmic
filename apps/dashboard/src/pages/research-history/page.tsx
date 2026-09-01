import { useCallback, useEffect, useState } from 'react';
import type { JSX } from 'react';
import { Activity, AlertCircle, BrainCircuit, Clock3, Database, GitBranch, LoaderCircle, RefreshCw } from 'lucide-react';
import { Link } from 'react-router-dom';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { apiFetch } from '@/lib/api';
import type { FactoryRun } from '@/features/factory-history/types';

type GoldControl = { runtime?: { state?: string; last_snapshot_id?: string } };
type InferenceJob = { job_id: string; task: string; model_id: string; model_version: string; gold_snapshot_id: string; status: string; created_at: string };
type TrainingReview = { snapshot_id: string; source_product_id: string; tic_id: number; sector: number; training_label: string; review_status: string; updated_at: string };

function date(value?: string): string {
  if (!value) return '—';
  const parsed = new Date(value.includes('T') ? value : `${value.replace(' ', 'T')}Z`);
  return Number.isNaN(parsed.valueOf()) ? value : parsed.toLocaleString('vi-VN');
}

export default function ResearchHistoryPage(): JSX.Element {
  const [gold, setGold] = useState<GoldControl>();
  const [factoryRuns, setFactoryRuns] = useState<FactoryRun[]>([]);
  const [inferenceRuns, setInferenceRuns] = useState<InferenceJob[]>([]);
  const [reviews, setReviews] = useState<TrainingReview[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(undefined);
    try {
      const [control, factory, inference, reviewHistory] = await Promise.all([
        apiFetch<GoldControl>('/v1/gold/control'),
        apiFetch<{ items: FactoryRun[] }>('/v1/data-factory/runs?pipeline=silver_to_gold&limit=100'),
        apiFetch<{ jobs: InferenceJob[] }>('/v1/inference/jobs'),
        apiFetch<{ items: TrainingReview[] }>('/v1/models/training-cohort/reviews?limit=100'),
      ]);
      setGold(control);
      setFactoryRuns(factory.items ?? []);
      setInferenceRuns(inference.jobs ?? []);
      setReviews(reviewHistory.items ?? []);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Không tải được research history.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const snapshot = gold?.runtime?.last_snapshot_id;
  const completedInference = inferenceRuns.filter((run) => run.status === 'completed').length;

  return <div className="space-y-6">
    <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between"><div><div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground"><GitBranch className="size-4 text-primary" /> Scientific Research Factory · durable provenance</div><h2 className="font-heading text-2xl font-semibold tracking-tight md:text-3xl">Research History</h2><p className="mt-1 max-w-3xl text-sm text-muted-foreground">Một timeline thật nối Gold build run với snapshot và inference đã sử dụng snapshot đó. Không tạo lịch sử từ state phía trình duyệt.</p></div><Button variant="outline" onClick={() => void load()} disabled={loading}><RefreshCw className={loading ? 'animate-spin' : ''} />Refresh history</Button></div>
    {error && <div className="flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"><AlertCircle className="size-4" />{error}</div>}
    {loading ? <div className="flex items-center justify-center gap-2 rounded-lg border border-dashed py-20 text-sm text-muted-foreground"><LoaderCircle className="animate-spin" />Loading durable research runs…</div> : <>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><Metric icon={Database} label="Current Gold snapshot" value={snapshot || 'None'} /><Metric icon={Activity} label="Gold build runs" value={factoryRuns.length.toLocaleString()} /><Metric icon={BrainCircuit} label="Inference runs" value={inferenceRuns.length.toLocaleString()} /><Metric icon={Clock3} label="Completed inference" value={completedInference.toLocaleString()} /></div>
      <Card><CardHeader><CardTitle>Gold evidence runs</CardTitle><CardDescription>Chọn run để mở đúng telemetry DAG; snapshot đã commit mở được trực tiếp từ ID.</CardDescription></CardHeader><CardContent>{factoryRuns.length === 0 ? <Empty label="Chưa có Gold build run nào được ghi vào ClickHouse." /> : <div className="overflow-x-auto"><table className="w-full min-w-[860px] text-sm"><thead className="border-b text-left text-xs text-muted-foreground"><tr><th className="p-3">Run</th><th className="p-3">State</th><th className="p-3">Started</th><th className="p-3 text-right">Silver in</th><th className="p-3 text-right">Gold rows</th><th className="p-3" /></tr></thead><tbody>{factoryRuns.map((run) => <tr key={run.run_id} className="border-b border-border/60"><td className="p-3 font-mono text-xs text-primary">{run.run_id}</td><td className="p-3"><Badge variant="outline">{run.mode} · {run.status}</Badge></td><td className="p-3 text-xs text-muted-foreground">{date(run.started_at)}</td><td className="p-3 text-right tabular-nums">{run.input_records.toLocaleString()}</td><td className="p-3 text-right tabular-nums">{run.indexed_rows.toLocaleString()}</td><td className="p-3 text-right"><Button asChild size="sm" variant="outline"><Link to={`/data-factory/pipeline?run_id=${encodeURIComponent(run.run_id)}`}>Open DAG</Link></Button></td></tr>)}</tbody></table></div>}</CardContent></Card>
      <Card><CardHeader><CardTitle>Inference bound to Gold</CardTitle><CardDescription>Mỗi kết quả ML giữ nguyên model version và Gold snapshot đầu vào để review có thể tái lập.</CardDescription></CardHeader><CardContent>{inferenceRuns.length === 0 ? <Empty label="Chưa có inference run nào." /> : <div className="overflow-x-auto"><table className="w-full min-w-[860px] text-sm"><thead className="border-b text-left text-xs text-muted-foreground"><tr><th className="p-3">Task</th><th className="p-3">Status</th><th className="p-3">Gold snapshot</th><th className="p-3">Model</th><th className="p-3">Created</th></tr></thead><tbody>{inferenceRuns.map((run) => <tr key={run.job_id} className="border-b border-border/60"><td className="p-3 font-mono text-xs">{run.task}</td><td className="p-3"><Badge variant={run.status === 'completed' ? 'default' : 'outline'}>{run.status}</Badge></td><td className="p-3">{run.gold_snapshot_id ? <Link className="font-mono text-xs text-primary hover:underline" to={`/gold/snapshots/${encodeURIComponent(run.gold_snapshot_id)}`}>{run.gold_snapshot_id}</Link> : '—'}</td><td className="p-3 font-mono text-xs">{run.model_id} · {run.model_version}</td><td className="p-3 text-xs text-muted-foreground">{date(run.created_at)}</td></tr>)}</tbody></table></div>}</CardContent></Card>
      <Card><CardHeader><CardTitle>Human review decisions</CardTitle><CardDescription>Durable decisions from Candidate Review. These rows update the training cohort, never the immutable Candidate Gold file.</CardDescription></CardHeader><CardContent>{reviews.length === 0 ? <Empty label="Chưa có candidate nào được con người review." /> : <div className="overflow-x-auto"><table className="w-full min-w-[860px] text-sm"><thead className="border-b text-left text-xs text-muted-foreground"><tr><th className="p-3">Target</th><th className="p-3">Decision</th><th className="p-3">Gold snapshot</th><th className="p-3">Source product</th><th className="p-3">Reviewed</th></tr></thead><tbody>{reviews.map((review) => <tr key={`${review.snapshot_id}:${review.source_product_id}`} className="border-b border-border/60"><td className="p-3"><Link className="font-mono text-primary hover:underline" to={`/research-factory/workbench/${review.tic_id}?sector=${review.sector}&snapshot_id=${encodeURIComponent(review.snapshot_id)}`}>TIC {review.tic_id} · S{review.sector}</Link></td><td className="p-3"><Badge variant={review.training_label === 'POSITIVE' ? 'default' : review.training_label === 'NEGATIVE' ? 'destructive' : 'outline'}>{review.training_label}</Badge></td><td className="p-3"><Link className="font-mono text-xs text-primary hover:underline" to={`/gold/snapshots/${encodeURIComponent(review.snapshot_id)}`}>{review.snapshot_id}</Link></td><td className="max-w-72 truncate p-3 font-mono text-xs text-muted-foreground">{review.source_product_id}</td><td className="p-3 text-xs text-muted-foreground">{date(review.updated_at)}</td></tr>)}</tbody></table></div>}</CardContent></Card>
    </>}
  </div>;
}

function Metric({ icon: Icon, label, value }: { icon: typeof Database; label: string; value: string }): JSX.Element { return <Card><CardContent className="p-4"><p className="flex items-center gap-2 text-xs text-muted-foreground"><Icon className="size-4 text-primary" />{label}</p><p className="mt-2 truncate font-mono text-lg font-semibold">{value}</p></CardContent></Card>; }
function Empty({ label }: { label: string }): JSX.Element { return <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">{label}</div>; }
