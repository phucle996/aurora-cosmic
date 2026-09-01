import { useEffect, useMemo, useState, type JSX, type ReactNode } from 'react';
import { BrainCircuit, Cpu, Database, FlaskConical, LoaderCircle, MonitorCog, Play, RefreshCw, Search } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { apiFetch } from '@/lib/api';
import { formatBytes, formatDate, type GoldSnapshotItem, type ModelRecord } from '../types';

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

type StoredTrainingConfig = {
  intent: 'new' | 'evolve';
  computeTarget: 'cpu' | 'gpu';
  baseModelId: string;
  epochs: string;
  learningRate: string;
  batchSize: string;
  seed: string;
};

const TRAINING_CONFIG_KEY = 'aurora.training-lab.config.v1';
const DEFAULT_CONFIG: StoredTrainingConfig = { intent: 'new', computeTarget: 'gpu', baseModelId: 'champion', epochs: '50', learningRate: '0.001', batchSize: '32', seed: '42' };

function readStoredConfig(): StoredTrainingConfig {
  if (typeof window === 'undefined') return DEFAULT_CONFIG;
  try {
    const stored = JSON.parse(window.localStorage.getItem(TRAINING_CONFIG_KEY) ?? '{}') as Partial<StoredTrainingConfig>;
    return {
      intent: stored.intent === 'evolve' ? 'evolve' : 'new',
      computeTarget: stored.computeTarget === 'cpu' ? 'cpu' : 'gpu',
      baseModelId: stored.baseModelId || DEFAULT_CONFIG.baseModelId,
      epochs: stored.epochs || DEFAULT_CONFIG.epochs,
      learningRate: stored.learningRate || DEFAULT_CONFIG.learningRate,
      batchSize: stored.batchSize || DEFAULT_CONFIG.batchSize,
      seed: stored.seed || DEFAULT_CONFIG.seed,
    };
  } catch {
    return DEFAULT_CONFIG;
  }
}

export function TrainingLabControl({ models, availableSnapshots, snapshotsLoading, submitting, onRefreshSnapshots, onSubmitTraining }: Props): JSX.Element {
  const stored = useMemo(readStoredConfig, []);
  const [intent, setIntent] = useState<'new' | 'evolve'>(stored.intent);
  const task: TrainingParams['task'] = 'candidate_vetting';
  const [computeTarget, setComputeTarget] = useState<'cpu' | 'gpu'>(stored.computeTarget);
  const [baseModelId, setBaseModelId] = useState(stored.baseModelId);
  const [snapshotIds, setSnapshotIds] = useState<string[]>([]);
  const [epochs, setEpochs] = useState(stored.epochs);
  const [learningRate, setLearningRate] = useState(stored.learningRate);
  const [batchSize, setBatchSize] = useState(stored.batchSize);
  const [seed, setSeed] = useState(stored.seed);
  const [snapshotQuery, setSnapshotQuery] = useState('');
  const [readiness, setReadiness] = useState<TrainingReadiness | null>(null);
  const [readinessLoading, setReadinessLoading] = useState(false);
  const baseModels = useMemo(() => models.filter((model) => model.task === task), [models, task]);
  const filteredSnapshots = useMemo(() => {
    const query = snapshotQuery.trim().toLowerCase();
    return query ? availableSnapshots.filter((snapshot) => snapshot.snapshot_id.toLowerCase().includes(query) || snapshot.trained_model_id?.toLowerCase().includes(query)) : availableSnapshots;
  }, [availableSnapshots, snapshotQuery]);
  const allVisibleSelected = filteredSnapshots.length > 0 && filteredSnapshots.every((snapshot) => snapshotIds.includes(snapshot.snapshot_id));
  const selectedSnapshots = useMemo(() => availableSnapshots.filter((snapshot) => snapshotIds.includes(snapshot.snapshot_id)), [availableSnapshots, snapshotIds]);
  const selectedBytes = selectedSnapshots.reduce((sum, snapshot) => sum + snapshot.size_bytes, 0);

  useEffect(() => {
    window.localStorage.setItem(TRAINING_CONFIG_KEY, JSON.stringify({ intent, computeTarget, baseModelId, epochs, learningRate, batchSize, seed } satisfies StoredTrainingConfig));
  }, [intent, computeTarget, baseModelId, epochs, learningRate, batchSize, seed]);

  useEffect(() => {
    if (snapshotsLoading) return;
    const available = new Set(availableSnapshots.map((snapshot) => snapshot.snapshot_id));
    setSnapshotIds((current) => current.filter((snapshotId) => available.has(snapshotId)));
  }, [availableSnapshots, snapshotsLoading]);

  useEffect(() => {
    let active = true;
    if (snapshotIds.length === 0) {
      setReadiness(null);
      setReadinessLoading(false);
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
    setSnapshotIds((current) => selected ? [...new Set([...current, snapshotId])] : current.filter((value) => value !== snapshotId));
  };

  const toggleVisibleSnapshots = (selected: boolean) => {
    const visible = new Set(filteredSnapshots.map((snapshot) => snapshot.snapshot_id));
    setSnapshotIds((current) => selected ? [...new Set([...current, ...visible])] : current.filter((value) => !visible.has(value)));
  };

  const numericConfigValid = Number(epochs) > 0 && Number(batchSize) > 0 && Number(learningRate) > 0 && Number(seed) >= 0;
  const launchReady = snapshotIds.length > 0 && readiness?.ready === true && numericConfigValid && !submitting;
  const submit = async () => {
    if (!launchReady) return;
    await onSubmitTraining({ task, baseModelId: intent === 'new' ? '' : baseModelId, mode: intent === 'new' ? 'scratch' : 'fine_tune', snapshotIds, epochs: Number(epochs), learningRate: Number(learningRate), batchSize: Number(batchSize), seed: Number(seed), computeTarget });
  };

  return <section className="min-w-0 border border-border/80 bg-card">
    <header className="flex flex-col gap-3 border-b border-border/60 p-4 sm:flex-row sm:items-start sm:justify-between sm:p-5">
      <div><p className="font-mono text-[10px] uppercase tracking-[0.14em] text-primary">Experiment protocol / candidate vetting</p><h3 className="mt-1 text-lg font-semibold">Configure training run</h3><p className="mt-1 text-xs text-muted-foreground">Pin immutable Gold inputs, initialization strategy, compute target and reproducible hyperparameters.</p></div>
      <Badge variant="outline" className="w-fit rounded-none font-mono text-[10px]">{intent === 'new' ? 'SCRATCH' : 'FINE-TUNE'} · {computeTarget.toUpperCase()}</Badge>
    </header>

    <div className="grid min-w-0 xl:grid-cols-[minmax(0,1.25fr)_minmax(22rem,0.75fr)]">
      <div className="min-w-0 border-b border-border/60 p-4 sm:p-5 xl:border-b-0 xl:border-r">
        <SectionLabel index="01" title="Immutable dataset selection" detail="Only committed Gold snapshots are eligible." />
        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
          <div className="relative min-w-0 flex-1"><Search className="absolute left-2.5 top-2.5 size-3.5 text-muted-foreground" /><Input value={snapshotQuery} onChange={(event) => setSnapshotQuery(event.target.value)} placeholder="Filter snapshot or trained model…" className="h-9 rounded-none pl-8 font-mono text-xs" /></div>
          <Button type="button" variant="outline" size="sm" onClick={onRefreshSnapshots} disabled={snapshotsLoading} className="rounded-none"><RefreshCw className={`size-3.5 ${snapshotsLoading ? 'animate-spin' : ''}`} />Rescan Gold</Button>
        </div>
        <div className="mt-2 overflow-hidden border border-border/70">
          <div className="flex items-center justify-between border-b border-border/60 bg-muted/20 px-3 py-2">
            <label className="flex cursor-pointer items-center gap-2 text-xs font-medium"><Checkbox checked={allVisibleSelected ? true : filteredSnapshots.some((snapshot) => snapshotIds.includes(snapshot.snapshot_id)) ? 'indeterminate' : false} onCheckedChange={(checked) => toggleVisibleSnapshots(checked === true)} disabled={snapshotsLoading || filteredSnapshots.length === 0} />Select visible snapshots</label>
            <span className="font-mono text-[10px] text-muted-foreground">{snapshotIds.length} selected · {formatBytes(selectedBytes)}</span>
          </div>
          <div className="max-h-[300px] overflow-y-auto">
            {snapshotsLoading && <EmptyDataset label="Reading committed snapshot inventory…" />}
            {!snapshotsLoading && filteredSnapshots.length === 0 && <EmptyDataset label={availableSnapshots.length === 0 ? 'No committed Gold snapshot is available for training.' : 'No snapshot matches the current filter.'} />}
            {!snapshotsLoading && filteredSnapshots.map((snapshot) => <label key={snapshot.snapshot_id} className="grid cursor-pointer grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 border-b border-border/50 px-3 py-2.5 last:border-b-0 hover:bg-muted/30">
              <Checkbox checked={snapshotIds.includes(snapshot.snapshot_id)} onCheckedChange={(checked) => toggleSnapshot(snapshot.snapshot_id, checked === true)} />
              <span className="min-w-0"><span className="block truncate font-mono text-[11px] font-medium" title={snapshot.snapshot_id}>{snapshot.snapshot_id}</span><span className="mt-0.5 block truncate text-[10px] text-muted-foreground">{formatDate(snapshot.last_modified)} · {snapshot.key}</span></span>
              <span className="text-right"><span className="block font-mono text-[10px]">{formatBytes(snapshot.size_bytes)}</span><Badge variant="outline" className={`mt-1 rounded-none text-[8px] ${snapshot.is_trained ? '' : 'border-primary/30 text-primary'}`}>{snapshot.is_trained ? 'USED' : 'UNUSED'}</Badge></span>
            </label>)}
          </div>
        </div>
        <div className="mt-3"><TrainingCohortReadiness readiness={readiness} loading={readinessLoading} selectedCount={snapshotIds.length} /></div>
      </div>

      <div className="min-w-0 p-4 sm:p-5">
        <SectionLabel index="02" title="Experiment specification" detail="Stored locally and pinned into the submitted job." />
        <div className="mt-3 space-y-4">
          <div className="grid grid-cols-2 gap-px border border-border/70 bg-border/70">
            <IntentOption active={intent === 'new'} title="Train new" detail="Random initialization" icon={<FlaskConical className="size-4" />} onClick={() => setIntent('new')} />
            <IntentOption active={intent === 'evolve'} title="Evolve" detail="Fine-tune a base model" icon={<BrainCircuit className="size-4" />} onClick={() => setIntent('evolve')} />
          </div>
          {intent === 'evolve' && <Field label="Base model"><select className="h-9 w-full rounded-none border border-input bg-background px-3 font-mono text-xs" value={baseModelId} onChange={(event) => setBaseModelId(event.target.value)}><option value="champion">Current champion</option>{baseModels.map((model) => <option key={model.model_id} value={model.model_id}>{model.model_id} · {model.model_version}</option>)}</select></Field>}
          <div><Label className="text-xs">Compute target</Label><div className="mt-1.5 grid grid-cols-2 gap-px border border-border/70 bg-border/70"><ComputeOption active={computeTarget === 'gpu'} icon={<MonitorCog className="size-4" />} title="GPU" detail="CUDA + AMP" onClick={() => setComputeTarget('gpu')} /><ComputeOption active={computeTarget === 'cpu'} icon={<Cpu className="size-4" />} title="CPU" detail="Reproducible baseline" onClick={() => setComputeTarget('cpu')} /></div></div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Epochs"><Input type="number" min="1" value={epochs} onChange={(event) => setEpochs(event.target.value)} className="rounded-none font-mono" /></Field>
            <Field label="Batch size"><Input type="number" min="1" value={batchSize} onChange={(event) => setBatchSize(event.target.value)} className="rounded-none font-mono" /></Field>
            <Field label="Learning rate"><Input type="number" min="0.000001" step="0.0001" value={learningRate} onChange={(event) => setLearningRate(event.target.value)} className="rounded-none font-mono" /></Field>
            <Field label="Random seed"><Input type="number" min="0" value={seed} onChange={(event) => setSeed(event.target.value)} className="rounded-none font-mono" /></Field>
          </div>
          <div className="border-l-2 border-primary bg-muted/20 px-3 py-2 text-[10px] leading-4 text-muted-foreground"><span className="font-medium text-foreground">Reproducibility contract.</span> Snapshot IDs, base model, seed and all hyperparameters are submitted as one immutable experiment specification.</div>
        </div>
      </div>
    </div>

    <footer className="flex flex-col gap-3 border-t border-border/60 bg-muted/15 p-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
      <div className="min-w-0"><p className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">Launch envelope</p><p className="mt-1 truncate text-xs" title={`${snapshotIds.length} snapshots · ${epochs} epochs · batch ${batchSize} · lr ${learningRate} · seed ${seed}`}>{snapshotIds.length} snapshots · {epochs} epochs · batch {batchSize} · lr {learningRate} · seed {seed}</p>{!numericConfigValid && <p className="mt-1 text-[10px] text-destructive">Hyperparameters must contain valid positive values.</p>}</div>
      <Button type="button" onClick={() => void submit()} disabled={!launchReady} className="min-w-[220px] rounded-none gap-2">{submitting ? <><LoaderCircle className="size-4 animate-spin" />Submitting run…</> : <><Play className="size-4 fill-current" />{readiness?.ready ? `Launch ${intent === 'new' ? 'training' : 'evolution'} run` : 'Cohort is not ready'}</>}</Button>
    </footer>
  </section>;
}

function SectionLabel({ index, title, detail }: { index: string; title: string; detail: string }): JSX.Element { return <div><p className="font-mono text-[9px] uppercase tracking-[0.14em] text-primary">{index} / {title}</p><p className="mt-1 text-xs text-muted-foreground">{detail}</p></div>; }
function Field({ label, children }: { label: string; children: ReactNode }): JSX.Element { return <label className="block space-y-1.5"><span className="text-xs font-medium">{label}</span>{children}</label>; }
function IntentOption({ active, icon, title, detail, onClick }: { active: boolean; icon: JSX.Element; title: string; detail: string; onClick: () => void }): JSX.Element { return <button type="button" onClick={onClick} className={`p-3 text-left transition-colors ${active ? 'bg-primary text-primary-foreground' : 'bg-background hover:bg-muted/40'}`}><span className="flex items-center gap-2 text-xs font-semibold">{icon}{title}</span><span className={`mt-1 block text-[10px] ${active ? 'text-primary-foreground/75' : 'text-muted-foreground'}`}>{detail}</span></button>; }
function ComputeOption({ active, icon, title, detail, onClick }: { active: boolean; icon: JSX.Element; title: string; detail: string; onClick: () => void }): JSX.Element { return <button type="button" onClick={onClick} className={`p-3 text-left transition-colors ${active ? 'bg-sky-500 text-white' : 'bg-background hover:bg-muted/40'}`}><span className="flex items-center gap-2 text-xs font-semibold">{icon}{title}</span><span className={`mt-1 block text-[10px] ${active ? 'text-white/75' : 'text-muted-foreground'}`}>{detail}</span></button>; }
function EmptyDataset({ label }: { label: string }): JSX.Element { return <div className="flex min-h-32 flex-col items-center justify-center px-5 text-center"><Database className="mb-2 size-5 text-muted-foreground/60" /><p className="text-xs text-muted-foreground">{label}</p></div>; }

function TrainingCohortReadiness({ readiness, loading, selectedCount }: { readiness: TrainingReadiness | null; loading: boolean; selectedCount: number }): JSX.Element {
  if (selectedCount === 0) return <div className="border border-dashed border-border/70 px-3 py-4 text-center text-[11px] text-muted-foreground">Select a snapshot to calculate cohort evidence.</div>;
  if (loading) return <div className="border border-dashed border-border/70 px-3 py-4 text-[11px] text-muted-foreground">Calculating cohort eligibility…</div>;
  if (!readiness) return <div className="border border-destructive/40 bg-destructive/5 px-3 py-3 text-[11px] text-destructive">Cohort evidence is unavailable; launch remains locked.</div>;
  const total = readiness.total_rows;
  const ratio = (value: number) => total > 0 ? value / total * 100 : 0;
  return <div className={`border px-3 py-3 ${readiness.ready ? 'border-emerald-500/40 bg-emerald-500/5' : 'border-amber-500/40 bg-amber-500/5'}`}>
    <div className="flex items-center justify-between gap-3"><p className="text-xs font-medium">Training cohort · {readiness.ready ? 'READY' : 'BLOCKED'}</p><Badge variant="outline" className="rounded-none font-mono text-[9px]">{readiness.policy_version}</Badge></div>
    <div className="mt-3 flex h-2 overflow-hidden bg-muted"><span className="bg-emerald-500" style={{ width: `${ratio(readiness.positive_rows)}%` }} /><span className="bg-sky-500" style={{ width: `${ratio(readiness.negative_rows)}%` }} /><span className="bg-amber-500" style={{ width: `${ratio(readiness.unresolved_rows)}%` }} /></div>
    <div className="mt-2 grid grid-cols-3 gap-2 text-[10px]"><CohortValue label="Positive" value={readiness.positive_rows} percent={ratio(readiness.positive_rows)} tone="bg-emerald-500" /><CohortValue label="Negative" value={readiness.negative_rows} percent={ratio(readiness.negative_rows)} tone="bg-sky-500" /><CohortValue label="Unresolved" value={readiness.unresolved_rows} percent={ratio(readiness.unresolved_rows)} tone="bg-amber-500" /></div>
    <p className="mt-2 text-[10px] text-muted-foreground">{readiness.positive_targets.toLocaleString()} positive and {readiness.negative_targets.toLocaleString()} negative independent TIC targets.</p>
    {!readiness.ready && <p className="mt-1 text-[10px] text-amber-700 dark:text-amber-300">{readiness.blocker}</p>}
  </div>;
}

function CohortValue({ label, value, percent, tone }: { label: string; value: number; percent: number; tone: string }): JSX.Element { return <div><p className="flex items-center gap-1.5 text-muted-foreground"><span className={`size-1.5 ${tone}`} />{label}</p><p className="mt-0.5 font-mono font-medium">{value.toLocaleString()} · {percent.toFixed(1)}%</p></div>; }
