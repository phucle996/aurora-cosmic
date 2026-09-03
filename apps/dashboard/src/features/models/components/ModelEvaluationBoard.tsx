import { useEffect, useMemo, useState, type JSX } from 'react';
import {
  Activity,
  AlertTriangle,
  Binary,
  CheckCircle2,
  CircleAlert,
  Database,
  FlaskConical,
  Gauge,
  GitCompareArrows,
  LoaderCircle,
  ShieldCheck,
} from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { Badge } from '@/components/ui/badge';
import { apiFetch } from '@/lib/api';

import { formatDate, statusVariant, taskLabel, type ModelEvaluation, type ModelRecord } from '../types';

type Props = {
  models: ModelRecord[];
  selectedRuntimeId?: string;
  onSelect: (runtimePackageID: string) => void;
};

const metricDefinitions = [
  { key: 'pr_auc', label: 'PR-AUC' },
  { key: 'roc_auc', label: 'ROC-AUC' },
  { key: 'precision', label: 'Precision' },
  { key: 'recall', label: 'Recall' },
  { key: 'f1', label: 'F1' },
] as const;

function percent(value?: number): string {
  return value === undefined ? '—' : `${(value * 100).toFixed(2)}%`;
}

function statusPass(value: string): boolean {
  return ['PASS', 'PASSED'].includes(value.toUpperCase());
}

export function ModelEvaluationBoard({ models, selectedRuntimeId, onSelect }: Props): JSX.Element {
  const selected = models.find((model) => model.runtime_package_id === selectedRuntimeId) ?? models[0];
  const [evaluation, setEvaluation] = useState<ModelEvaluation>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    let active = true;
    if (!selected?.runtime_package_id) {
      setEvaluation(undefined);
      setError(undefined);
      return () => { active = false; };
    }
    setLoading(true);
    setEvaluation(undefined);
    setError(undefined);
    void apiFetch<ModelEvaluation>(`/v1/models/${encodeURIComponent(selected.runtime_package_id)}/evaluation`)
      .then((value) => { if (active) setEvaluation(value); })
      .catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : 'Evaluation evidence is unavailable'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [selected?.runtime_package_id]);

  if (models.length === 0) {
    return <section className="border border-border/80 bg-card">
      <header className="border-b border-border/60 p-5"><p className="flex items-center gap-2 font-mono text-xs uppercase tracking-[0.14em] text-primary"><FlaskConical className="size-4" />Evaluation console</p><h3 className="mt-1 text-lg font-semibold">No registered evaluation subject</h3></header>
      <div className="grid min-h-80 place-items-center p-6 text-center"><div><Database className="mx-auto size-8 text-muted-foreground/50" /><p className="mt-3 text-sm font-medium">Chưa có runtime package trong Model Registry</p><p className="mt-1 max-w-lg text-xs text-muted-foreground">Sau khi training hoàn tất, evaluator sẽ ghi Golden/Recent cohort metrics, threshold evidence và confusion matrix vào immutable evaluation run.</p></div></div>
    </section>;
  }

  return <section className="overflow-hidden border border-border/80 bg-card">
    <header className="border-b border-border/60 p-4 sm:p-5">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div><p className="flex items-center gap-2 font-mono text-xs uppercase tracking-[0.14em] text-primary"><FlaskConical className="size-4" />Evaluation console</p><h3 className="mt-1 text-lg font-semibold">Frozen-cohort model evidence</h3><p className="mt-1 text-sm text-muted-foreground">Threshold selection, classifier quality, error topology, cohort drift and runtime parity from durable evaluator artifacts.</p></div>
        <label className="block"><span className="mb-1 block font-mono text-[10px] uppercase text-muted-foreground">Evaluation subject</span><select value={selected?.runtime_package_id ?? ''} onChange={(event) => onSelect(event.target.value)} className="h-10 w-full min-w-0 border border-input bg-background px-3 font-mono text-xs outline-none focus:border-primary sm:w-[430px]">{models.map((model) => <option key={model.runtime_package_id} value={model.runtime_package_id}>{model.model_id} · {model.model_version || 'unversioned'} · {model.status}</option>)}</select></label>
      </div>
    </header>

    <div className="grid min-w-0 xl:grid-cols-[300px_minmax(0,1fr)]">
      <aside className="min-w-0 border-b border-border/60 xl:border-b-0 xl:border-r">
        <div className="border-b border-border/60 bg-muted/20 px-3 py-2 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">{models.length} registered packages</div>
        <div className="max-h-[720px] overflow-y-auto">{models.map((model) => {
          const active = model.runtime_package_id === selected?.runtime_package_id;
          const parity = statusPass(model.parity_status);
          return <button key={model.runtime_package_id} type="button" onClick={() => onSelect(model.runtime_package_id)} className={`w-full border-b border-border/50 p-3 text-left transition-colors ${active ? 'bg-primary/10 shadow-[inset_3px_0_0_var(--primary)]' : 'hover:bg-muted/30'}`}>
            <div className="flex items-start justify-between gap-2"><span className="min-w-0"><span className="block truncate font-mono text-xs font-semibold">{model.model_id}</span><span className="mt-1 block truncate text-[11px] text-muted-foreground">{taskLabel[model.task] ?? model.task}</span></span><Badge variant={statusVariant(model.status)} className="rounded-none font-mono text-[9px] uppercase">{model.status}</Badge></div>
            <div className="mt-2 flex items-center justify-between gap-2 text-[10px] text-muted-foreground"><span className="truncate font-mono">{model.evaluation_run_id || 'NO EVALUATION'}</span><span className={`flex shrink-0 items-center gap-1 ${parity ? 'text-emerald-600 dark:text-emerald-300' : 'text-amber-700 dark:text-amber-300'}`}>{parity ? <CheckCircle2 className="size-3" /> : <CircleAlert className="size-3" />}parity</span></div>
          </button>;
        })}</div>
      </aside>

      <main className="min-w-0">
        {loading ? <EvidenceState icon={<LoaderCircle className="size-5 animate-spin" />} title="Loading immutable evaluation evidence" detail={selected?.evaluation_run_id || selected?.runtime_package_id || ''} />
          : error || !evaluation ? <EvidenceState icon={<AlertTriangle className="size-5" />} title="Evaluation evidence unavailable" detail={error || 'This runtime package does not reference a durable evaluation run.'} destructive />
            : <EvaluationAnalysis evaluation={evaluation} />}
      </main>
    </div>
  </section>;
}

function EvaluationAnalysis({ evaluation }: { evaluation: ModelEvaluation }): JSX.Element {
  const comparison = useMemo(() => metricDefinitions.map(({ key, label }) => ({
    metric: label,
    golden: evaluation.golden[key] === undefined ? undefined : evaluation.golden[key]! * 100,
    recent: evaluation.recent?.[key] === undefined ? undefined : evaluation.recent[key]! * 100,
  })), [evaluation]);
  const matrix = evaluation.golden.confusion_matrix;
  const matrixObserved = matrix?.length === 2 && matrix[0]?.length === 2 && matrix[1]?.length === 2;
  const tn = matrixObserved ? matrix[0][0] : 0;
  const fp = matrixObserved ? matrix[0][1] : 0;
  const fn = matrixObserved ? matrix[1][0] : 0;
  const tp = matrixObserved ? matrix[1][1] : 0;
  const falsePositiveRate = tn + fp > 0 ? fp / (tn + fp) : undefined;
  const falseNegativeRate = tp + fn > 0 ? fn / (tp + fn) : undefined;
  const parityPass = statusPass(evaluation.parity_status);
  const integrityPass = statusPass(evaluation.integrity_status);

  return <div className="min-w-0">
    <section className="grid gap-px border-b border-border/60 bg-border/60 sm:grid-cols-2 2xl:grid-cols-5">
      <Summary label="Golden PR-AUC" value={percent(evaluation.golden.pr_auc)} detail={`${evaluation.golden.row_count.toLocaleString()} frozen rows`} />
      <Summary label="Golden recall" value={percent(evaluation.golden.recall)} detail={falseNegativeRate === undefined ? 'false-negative rate unavailable' : `${percent(falseNegativeRate)} false-negative rate`} />
      <Summary label="Decision threshold" value={evaluation.decision_threshold.toFixed(4)} detail={`${evaluation.validation_row_count.toLocaleString()} validation rows`} />
      <Summary label="Runtime parity" value={evaluation.parity_status || '—'} detail="PyTorch ↔ ONNX" tone={parityPass ? 'positive' : 'negative'} />
      <Summary label="Artifact integrity" value={evaluation.integrity_status || '—'} detail="manifest-bound hashes" tone={integrityPass ? 'positive' : 'negative'} />
    </section>

    <section className="grid min-w-0 gap-px border-b border-border/60 bg-border/60 2xl:grid-cols-[minmax(0,1.35fr)_minmax(360px,0.65fr)]">
      <ChartPanel title="Golden vs recent quality profile" subtitle={evaluation.recent ? 'Cùng metric scale 0–100%; chênh lệch phản ánh cohort shift.' : 'Golden cohort được đo; evaluator chưa ghi Recent holdout cho run này.'} icon={<GitCompareArrows className="size-4" />}>
        <div className="h-[330px] p-3"><ResponsiveContainer width="100%" height="100%"><BarChart data={comparison} margin={{ top: 12, right: 18, bottom: 8, left: 0 }}><CartesianGrid strokeDasharray="3 3" vertical={false} opacity={0.25} /><XAxis dataKey="metric" tick={{ fontSize: 11 }} /><YAxis domain={[0, 100]} tickFormatter={(value) => `${value}%`} width={42} tick={{ fontSize: 10 }} /><Tooltip formatter={(value) => `${Number(value).toFixed(2)}%`} /><Legend /><ReferenceLine y={50} stroke="var(--muted-foreground)" strokeDasharray="4 4" /><Bar dataKey="golden" name="Golden" fill="#06b6d4" maxBarSize={48} /><Bar dataKey="recent" name="Recent" fill="#f59e0b" maxBarSize={48} /></BarChart></ResponsiveContainer></div>
      </ChartPanel>

      <ChartPanel title="Golden confusion matrix" subtitle="Hàng là nhãn thật; cột là dự đoán tại decision threshold." icon={<Binary className="size-4" />}>
        {matrixObserved ? <div className="p-4"><div className="grid grid-cols-[92px_1fr_1fr] gap-px bg-border/70 text-center text-xs"><div className="bg-background p-2" /><div className="bg-muted/30 p-2 font-mono text-[10px] uppercase">Pred negative</div><div className="bg-muted/30 p-2 font-mono text-[10px] uppercase">Pred positive</div><MatrixLabel label="Actual negative" /><MatrixCell label="TN" value={tn} positive /><MatrixCell label="FP" value={fp} /><MatrixLabel label="Actual positive" /><MatrixCell label="FN" value={fn} /><MatrixCell label="TP" value={tp} positive /></div><div className="mt-3 grid grid-cols-2 gap-px border border-border/70 bg-border/70"><Rate label="False-positive rate" value={falsePositiveRate} /><Rate label="False-negative rate" value={falseNegativeRate} /></div></div> : <PanelEmpty text="Evaluator chưa ghi confusion matrix cho Golden cohort." />}
      </ChartPanel>
    </section>

    <section className="grid min-w-0 gap-px border-b border-border/60 bg-border/60 xl:grid-cols-2">
      <ChartPanel title="Validation threshold evidence" subtitle={`Threshold được chọn bởi ${evaluation.threshold_policy_version || 'recorded policy'}, không tối ưu lại trong trình duyệt.`} icon={<Gauge className="size-4" />}>
        <div className="space-y-4 p-4"><div><div className="flex justify-between font-mono text-[10px] text-muted-foreground"><span>0.00</span><span>decision boundary · {evaluation.decision_threshold.toFixed(4)}</span><span>1.00</span></div><div className="relative mt-2 h-3 bg-muted"><span className="absolute inset-y-0 left-0 bg-primary/30" style={{ width: `${Math.max(0, Math.min(100, evaluation.decision_threshold * 100))}%` }} /><span className="absolute -top-1 h-5 w-0.5 bg-primary" style={{ left: `${Math.max(0, Math.min(100, evaluation.decision_threshold * 100))}%` }} /></div></div><MetricBar label="Validation precision" value={evaluation.validation_precision} /><MetricBar label="Validation recall" value={evaluation.validation_recall} /><MetricBar label="Validation F1" value={evaluation.validation_f1} /><p className="border-l-2 border-primary/50 pl-3 text-xs text-muted-foreground">{evaluation.validation_row_count.toLocaleString()} validation rows selected the threshold; Golden metrics above remain out-of-selection evidence.</p></div>
      </ChartPanel>

      <ChartPanel title="Cohort stability" subtitle="Delta = Recent − Golden; âm nghĩa là chất lượng giảm trên dữ liệu gần đây." icon={<Activity className="size-4" />}>
        {evaluation.recent ? <div className="grid gap-px bg-border/60 p-px sm:grid-cols-2"><DriftMetric label="PR-AUC drift" value={evaluation.pr_auc_drift} /><DriftMetric label="Recall drift" value={evaluation.recall_drift} /><CohortCount label="Golden composition" cohort={evaluation.golden} /><CohortCount label="Recent composition" cohort={evaluation.recent} /></div> : <PanelEmpty text="Không có Recent cohort trong evaluation manifest; không thể kết luận drift." />}
      </ChartPanel>
    </section>

    <section className="p-4 sm:p-5"><div className="flex items-center gap-2"><ShieldCheck className="size-4 text-primary" /><p className="text-sm font-medium">Immutable evaluation provenance</p></div><dl className="mt-3 grid gap-px border border-border/70 bg-border/70 sm:grid-cols-2 xl:grid-cols-3"><Provenance label="Evaluation run" value={evaluation.evaluation_run_id} /><Provenance label="Training run" value={evaluation.training_run_id} /><Provenance label="Golden cohort" value={evaluation.golden_cohort_id} /><Provenance label="Recent cohort" value={evaluation.recent_cohort_id || 'not attached'} /><Provenance label="Evaluation policy" value={evaluation.evaluation_policy_version} /><Provenance label="Metrics SHA-256" value={evaluation.metrics_sha256} /></dl><p className="mt-2 truncate font-mono text-[10px] text-muted-foreground" title={evaluation.evaluation_manifest_key}>{evaluation.evaluation_manifest_key} · {formatDate(evaluation.created_at)}</p></section>
  </div>;
}

function EvidenceState({ icon, title, detail, destructive = false }: { icon: JSX.Element; title: string; detail: string; destructive?: boolean }): JSX.Element {
  return <div className={`grid min-h-[480px] place-items-center p-6 text-center ${destructive ? 'text-destructive' : 'text-muted-foreground'}`}><div>{icon}<p className="mt-3 text-sm font-medium">{title}</p><p className="mt-1 max-w-xl text-xs opacity-80">{detail}</p></div></div>;
}

function Summary({ label, value, detail, tone = 'neutral' }: { label: string; value: string; detail: string; tone?: 'neutral' | 'positive' | 'negative' }): JSX.Element {
  return <div className="min-w-0 bg-background/95 p-3"><p className="font-mono text-[9px] uppercase tracking-[0.12em] text-muted-foreground">{label}</p><p className={`mt-1 truncate font-mono text-base font-semibold ${tone === 'positive' ? 'text-emerald-600 dark:text-emerald-300' : tone === 'negative' ? 'text-red-600 dark:text-red-300' : ''}`}>{value}</p><p className="mt-1 truncate text-[10px] text-muted-foreground">{detail}</p></div>;
}

function ChartPanel({ title, subtitle, icon, children }: { title: string; subtitle: string; icon: JSX.Element; children: JSX.Element }): JSX.Element {
  return <article className="min-w-0 bg-background/95"><header className="border-b border-border/60 px-4 py-3"><p className="flex items-center gap-2 text-sm font-medium">{icon}{title}</p><p className="mt-0.5 text-[11px] text-muted-foreground">{subtitle}</p></header>{children}</article>;
}

function MatrixLabel({ label }: { label: string }): JSX.Element { return <div className="grid place-items-center bg-muted/30 p-2 font-mono text-[10px] uppercase">{label}</div>; }
function MatrixCell({ label, value, positive = false }: { label: string; value: number; positive?: boolean }): JSX.Element { return <div className={`p-4 ${positive ? 'bg-emerald-500/8' : 'bg-red-500/8'}`}><p className={`font-mono text-[10px] ${positive ? 'text-emerald-600 dark:text-emerald-300' : 'text-red-600 dark:text-red-300'}`}>{label}</p><p className="mt-1 font-mono text-xl font-semibold">{value.toLocaleString()}</p></div>; }
function Rate({ label, value }: { label: string; value?: number }): JSX.Element { return <div className="bg-background p-3"><p className="text-[10px] text-muted-foreground">{label}</p><p className="mt-1 font-mono text-sm font-semibold">{percent(value)}</p></div>; }
function PanelEmpty({ text }: { text: string }): JSX.Element { return <div className="grid min-h-[230px] place-items-center p-6 text-center text-xs text-muted-foreground"><p className="max-w-md">{text}</p></div>; }

function MetricBar({ label, value }: { label: string; value?: number }): JSX.Element {
  return <div><div className="mb-1 flex items-center justify-between text-xs"><span>{label}</span><span className="font-mono font-medium">{percent(value)}</span></div><div className="h-2 bg-muted"><div className="h-full bg-cyan-500" style={{ width: `${Math.max(0, Math.min(100, (value ?? 0) * 100))}%` }} /></div></div>;
}

function DriftMetric({ label, value }: { label: string; value?: number }): JSX.Element {
  const observed = value !== undefined;
  const negative = observed && value < 0;
  return <div className="bg-background p-4"><p className="font-mono text-[10px] uppercase text-muted-foreground">{label}</p><p className={`mt-1 font-mono text-xl font-semibold ${!observed ? '' : negative ? 'text-red-600 dark:text-red-300' : 'text-emerald-600 dark:text-emerald-300'}`}>{observed ? `${value >= 0 ? '+' : ''}${(value * 100).toFixed(2)} pp` : '—'}</p></div>;
}

function CohortCount({ label, cohort }: { label: string; cohort: ModelEvaluation['golden'] }): JSX.Element {
  return <div className="bg-background p-4"><p className="font-mono text-[10px] uppercase text-muted-foreground">{label}</p><p className="mt-1 font-mono text-sm font-semibold">{cohort.row_count.toLocaleString()} rows</p><p className="mt-1 text-[10px] text-muted-foreground">{cohort.positive_count.toLocaleString()} positive · {cohort.negative_count.toLocaleString()} negative</p></div>;
}

function Provenance({ label, value }: { label: string; value: string }): JSX.Element { return <div className="min-w-0 bg-background p-3"><dt className="font-mono text-[9px] uppercase text-muted-foreground">{label}</dt><dd className="mt-1 truncate font-mono text-xs" title={value}>{value || '—'}</dd></div>; }
