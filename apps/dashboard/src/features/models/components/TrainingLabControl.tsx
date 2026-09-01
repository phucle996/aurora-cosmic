import { useEffect, useMemo, useState, type JSX, type ReactNode } from 'react';
import { BrainCircuit, Cpu, FlaskConical, LoaderCircle, MonitorCog, Play, RefreshCw, Sparkles } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { apiFetch } from '@/lib/api';
import type { GoldSnapshotItem, ModelRecord } from '../types';

type TrainingParams = {
  task: 'candidate_vetting';
  baseModelId: string;
  mode: 'fine_tune' | 'scratch';
  snapshotIds: string[];
  epochs: number;
  learningRate: number;
  batchSize: number;
  seed: number;
  computeTarget: 'cpu' | 'gpu';
};

interface Props {
  models: ModelRecord[];
  availableSnapshots: GoldSnapshotItem[];
  snapshotsLoading: boolean;
  submitting: boolean;
  onRefreshSnapshots: () => void;
  onSubmitTraining: (params: TrainingParams) => Promise<void>;
}

type TrainingReadiness = {
  snapshot_id?: string;
  snapshot_ids: string[];
  total_rows: number;
  positive_rows: number;
  negative_rows: number;
  unresolved_rows: number;
  positive_targets: number;
  negative_targets: number;
  ready: boolean;
  policy_version: string;
  blocker?: string;
};

export function TrainingLabControl({ models, availableSnapshots, snapshotsLoading, submitting, onRefreshSnapshots, onSubmitTraining }: Props): JSX.Element {
  const [intent, setIntent] = useState<'new' | 'evolve'>('new');
  const task: TrainingParams['task'] = 'candidate_vetting';
  const [computeTarget, setComputeTarget] = useState<'cpu' | 'gpu'>('gpu');
  const [baseModelId, setBaseModelId] = useState('champion');
  const [snapshotIds, setSnapshotIds] = useState<string[]>([]);
  const [epochs, setEpochs] = useState('50');
  const [learningRate, setLearningRate] = useState('0.001');
  const [batchSize, setBatchSize] = useState('32');
  const [seed, setSeed] = useState('42');
  const [readiness, setReadiness] = useState<TrainingReadiness | null>(null);
  const [readinessLoading, setReadinessLoading] = useState(false);
  const unrunSnapshots = useMemo(() => availableSnapshots.filter((snapshot) => !snapshot.is_trained), [availableSnapshots]);
  const baseModels = useMemo(() => models.filter((model) => model.task === task), [models, task]);
  const allSnapshotsSelected = availableSnapshots.length > 0 && snapshotIds.length === availableSnapshots.length;

  useEffect(() => {
    if (snapshotsLoading) return;
    const available = new Set(availableSnapshots.map((snapshot) => snapshot.snapshot_id));
    setSnapshotIds((current) => current.filter((snapshotId) => available.has(snapshotId)));
  }, [availableSnapshots, snapshotsLoading]);

  useEffect(() => {
    let active = true;
    if (snapshotIds.length === 0) {
      setReadiness(null);
      return () => { active = false; };
    }
    const query = new URLSearchParams();
    snapshotIds.forEach((snapshotId) => query.append('snapshot_id', snapshotId));
    setReadinessLoading(true);
    void apiFetch<TrainingReadiness>(`/v1/models/training-readiness?${query.toString()}`)
      .then((value) => { if (active) setReadiness(value); })
      .catch(() => { if (active) setReadiness(null); })
      .finally(() => { if (active) setReadinessLoading(false); });
    return () => { active = false; };
  }, [snapshotIds]);

  const toggleSnapshot = (snapshotId: string, selected: boolean) => {
    setSnapshotIds((current) => selected
      ? [...new Set([...current, snapshotId])]
      : current.filter((value) => value !== snapshotId));
  };

  const submit = async () => {
    await onSubmitTraining({
      task,
      baseModelId: intent === 'new' ? '' : baseModelId,
      mode: intent === 'new' ? 'scratch' : 'fine_tune',
      snapshotIds,
      epochs: Number(epochs) || 50,
      learningRate: Number(learningRate) || 0.001,
      batchSize: Number(batchSize) || 32,
      seed: Number(seed) || 42,
      computeTarget,
    });
  };

  return <div className="grid min-w-0 gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
    <section className="rounded-xl border border-emerald-500/30 bg-emerald-500/[0.035] p-4">
      <div className="flex items-start justify-between gap-3"><div><div className="flex items-center gap-2"><Sparkles className="size-4 text-emerald-400" /><h3 className="text-sm font-semibold">Train New Model</h3></div><p className="mt-1 text-xs text-muted-foreground">Khởi tạo trọng số mới; không kế thừa model cũ.</p></div><Badge className="bg-emerald-500/15 text-emerald-300">Scratch</Badge></div>
      <Button type="button" variant={intent === 'new' ? 'default' : 'outline'} onClick={() => setIntent('new')} className="mt-4 w-full gap-2"><FlaskConical className="size-4" />{intent === 'new' ? 'Đang cấu hình model mới' : 'Chọn Train New Model'}</Button>
    </section>
    <section className="rounded-xl border border-violet-500/30 bg-violet-500/[0.035] p-4">
      <div className="flex items-start justify-between gap-3"><div><div className="flex items-center gap-2"><BrainCircuit className="size-4 text-violet-300" /><h3 className="text-sm font-semibold">Evolve Existing Model</h3></div><p className="mt-1 text-xs text-muted-foreground">Fine-tune từ Champion hoặc model registry, giữ lineage thế hệ.</p></div><Badge className="bg-violet-500/15 text-violet-200">Fine-tune</Badge></div>
      <Button type="button" variant={intent === 'evolve' ? 'default' : 'outline'} onClick={() => setIntent('evolve')} className="mt-4 w-full gap-2"><BrainCircuit className="size-4" />{intent === 'evolve' ? 'Đang cấu hình evolution' : 'Chọn Evolve Model'}</Button>
    </section>

    <section className="rounded-xl border bg-card p-4 xl:col-span-2">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2"><div><h3 className="text-sm font-semibold">{intent === 'new' ? 'New model specification' : 'Evolution specification'}</h3><p className="text-xs text-muted-foreground">Spec được lưu bất biến cùng Gold input, compute target và cấu hình train.</p></div><Badge variant="outline" className="font-mono text-[10px]">{intent === 'new' ? 'scratch → candidate' : 'base model → fine-tune → candidate'}</Badge></div>
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-4">
          <Field label="ML task"><div className="rounded-md border border-input bg-muted/20 px-3 py-2 text-xs">Candidate Vetting · TPF + Light Curve</div></Field>
          {intent === 'evolve' && <Field label="Base model to evolve"><select className="w-full rounded-md border border-input bg-background px-3 py-2 text-xs font-mono" value={baseModelId} onChange={(event) => setBaseModelId(event.target.value)}><option value="champion">👑 champion</option>{baseModels.map((model) => <option key={model.model_id} value={model.model_id}>{model.model_id} · {model.model_version}</option>)}</select></Field>}
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <Label className="text-xs">Gold snapshot sources</Label>
              <button type="button" onClick={onRefreshSnapshots} className="flex items-center gap-1 text-[11px] text-primary" disabled={snapshotsLoading}><RefreshCw className={`size-3 ${snapshotsLoading ? 'animate-spin' : ''}`} />Refresh</button>
            </div>
            <div className="overflow-hidden rounded-md border border-input bg-background">
              <div className="flex items-center justify-between border-b bg-muted/20 px-3 py-2">
                <label className="flex cursor-pointer items-center gap-2 text-xs font-medium">
                  <Checkbox
                    checked={allSnapshotsSelected ? true : snapshotIds.length > 0 ? 'indeterminate' : false}
                    onCheckedChange={(checked) => setSnapshotIds(checked === true ? availableSnapshots.map((snapshot) => snapshot.snapshot_id) : [])}
                    disabled={snapshotsLoading || availableSnapshots.length === 0}
                  />
                  Chọn tất cả
                </label>
                <span className="font-mono text-[10px] text-muted-foreground">{snapshotIds.length}/{availableSnapshots.length}</span>
              </div>
              <div className="max-h-44 overflow-y-auto p-1">
                {snapshotsLoading && <p className="px-2 py-3 text-xs text-muted-foreground">Loading committed snapshots…</p>}
                {!snapshotsLoading && availableSnapshots.length === 0 && <p className="px-2 py-3 text-xs text-muted-foreground">Không có committed Gold snapshot.</p>}
                {availableSnapshots.map((snapshot) => <label key={snapshot.snapshot_id} className="flex cursor-pointer items-center gap-2 rounded px-2 py-2 hover:bg-muted/40">
                  <Checkbox checked={snapshotIds.includes(snapshot.snapshot_id)} onCheckedChange={(checked) => toggleSnapshot(snapshot.snapshot_id, checked === true)} />
                  <span className="min-w-0 flex-1 truncate font-mono text-[11px]">{snapshot.snapshot_id}</span>
                  {snapshot.is_trained && <Badge variant="outline" className="shrink-0 text-[9px]">trained</Badge>}
                </label>)}
              </div>
            </div>
            <p className="text-[11px] text-muted-foreground">Một run pin toàn bộ {snapshotIds.length || 0} snapshot đã chọn vào một curated dataset bất biến; {unrunSnapshots.length} snapshot chưa từng được dùng để train.</p>
            {snapshotIds.length > 0 && <TrainingCohortReadiness readiness={readiness} loading={readinessLoading} />}
          </div>
        </div>
        <div className="space-y-4">
          <div className="space-y-2"><Label className="text-xs">Compute target</Label><div className="grid grid-cols-2 gap-2"><ComputeOption active={computeTarget === 'gpu'} icon={<MonitorCog className="size-4 text-cyan-400" />} title="GPU" detail="CUDA + AMP · VRAM capped" onClick={() => setComputeTarget('gpu')} /><ComputeOption active={computeTarget === 'cpu'} icon={<Cpu className="size-4 text-amber-400" />} title="CPU" detail="Baseline / reproducible debug" onClick={() => setComputeTarget('cpu')} /></div></div>
          <div className="grid grid-cols-2 gap-3"><Field label="Epochs"><Input type="number" value={epochs} onChange={(event) => setEpochs(event.target.value)} /></Field><Field label="Batch size"><Input type="number" value={batchSize} onChange={(event) => setBatchSize(event.target.value)} /></Field><Field label="Learning rate"><Input type="number" step="0.0001" value={learningRate} onChange={(event) => setLearningRate(event.target.value)} /></Field><Field label="Seed"><Input type="number" value={seed} onChange={(event) => setSeed(event.target.value)} /></Field></div>
          <div className="rounded-md border border-border/70 bg-muted/20 p-3 text-xs"><span className="font-medium">Promotion is a manual registry decision</span><span className="mt-0.5 block text-[11px] text-muted-foreground">Evaluation và runtime parity được ghi thành evidence; operator duyệt promotion trong Model Registry.</span></div>
        </div>
      </div>
      <div className="mt-5 flex justify-end"><Button type="button" onClick={() => void submit()} disabled={submitting || snapshotIds.length === 0 || !readiness?.ready} className="gap-2">{submitting ? <><LoaderCircle className="size-4 animate-spin" />Submitting {computeTarget.toUpperCase()} run…</> : <><Play className="size-4" />{readiness?.ready ? (intent === 'new' ? `Train with ${snapshotIds.length} snapshot${snapshotIds.length === 1 ? '' : 's'}` : `Evolve with ${snapshotIds.length} snapshot${snapshotIds.length === 1 ? '' : 's'}`) : 'Training cohort is not ready'}</>}</Button></div>
    </section>
  </div>;
}

function Field({ label, children }: { label: string; children: ReactNode }): JSX.Element { return <label className="block space-y-1.5"><span className="text-xs font-medium">{label}</span>{children}</label>; }
function ComputeOption({ active, icon, title, detail, onClick }: { active: boolean; icon: JSX.Element; title: string; detail: string; onClick: () => void }): JSX.Element { return <button type="button" onClick={onClick} className={`rounded-md border p-3 text-left ${active ? 'border-primary bg-primary/10 ring-1 ring-primary/30' : 'border-border bg-muted/20 hover:bg-muted/40'}`}><span className="flex items-center gap-2 text-xs font-semibold">{icon}{title}</span><span className="mt-1 block text-[10px] text-muted-foreground">{detail}</span></button>; }
function TrainingCohortReadiness({ readiness, loading }: { readiness: TrainingReadiness | null; loading: boolean }): JSX.Element { if (loading) return <div className="rounded-md border border-dashed p-2 text-[11px] text-muted-foreground">Checking cohort eligibility…</div>; if (!readiness) return <div className="rounded-md border border-destructive/40 bg-destructive/5 p-2 text-[11px] text-destructive">Unable to verify cohort eligibility; training remains locked.</div>; return <div className={`rounded-md border p-2 text-[11px] ${readiness.ready ? 'border-emerald-500/40 bg-emerald-500/5' : 'border-amber-500/40 bg-amber-500/5'}`}><div className="flex items-center justify-between gap-2"><span className="font-medium">{readiness.ready ? 'Auto-labelled cohort · ready' : 'Auto-labelled cohort · collecting evidence'}</span><Badge variant="outline" className="font-mono text-[9px]">{readiness.policy_version}</Badge></div><div className="mt-1 text-muted-foreground">{readiness.total_rows.toLocaleString()} cohort rows · {readiness.positive_targets.toLocaleString()} positive / {readiness.negative_targets.toLocaleString()} negative independent TICs.</div><p className="mt-1 text-muted-foreground">Gold remains label-free; auto labels are stored in the reviewable cohort.</p>{!readiness.ready && <p className="mt-1 text-amber-700 dark:text-amber-300">{readiness.blocker}</p>}</div>; }
