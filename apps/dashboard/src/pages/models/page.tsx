import { useCallback, useEffect, useMemo, useState } from 'react';
import type { JSX } from 'react';
import {
  BrainCircuit,
  CircleAlert,
  Clock3,
  Database,
  Gauge,
  LoaderCircle,
  Play,
  RefreshCw,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { apiFetch } from '@/lib/api';

type ModelRecord = {
  model_id: string;
  runtime_package_id: string;
  task: string;
  model_version: string;
  status: string;
  runtime_manifest_key: string;
  preprocessing_version: string;
  feature_count: number;
  feature_order: string[];
  onnx_size_bytes: number;
  onnx_sha256: string;
  decision_threshold: number;
  parity_status: string;
  evaluation_run_id: string;
  created_at: string;
};

type InferenceJob = {
  job_id: string;
  task: string;
  model_id: string;
  model_version: string;
  runtime_package_id: string;
  gold_snapshot_id: string;
  gold_artifact_key: string;
  sector: number;
  expected_prediction_count: number;
  created_at: string;
  status: string;
  output_key?: string;
};

type ModelResponse = { models: ModelRecord[] };
type JobResponse = { jobs: InferenceJob[] };

const taskLabel: Record<string, string> = {
  candidate_vetting: 'Candidate vetting',
  astronomical_anomaly_detection: 'Anomaly detection',
};

function formatBytes(bytes: number): string {
  if (!bytes) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(value: string): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? value : date.toLocaleString();
}

function statusVariant(status: string): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (status === 'champion' || status === 'completed') return 'default';
  if (status === 'invalid') return 'destructive';
  if (status === 'validated' || status === 'planned') return 'secondary';
  return 'outline';
}

export default function ModelsPage(): JSX.Element {
  const [models, setModels] = useState<ModelRecord[]>([]);
  const [jobs, setJobs] = useState<InferenceJob[]>([]);
  const [selectedRuntimeId, setSelectedRuntimeId] = useState<string>();
  const [taskFilter, setTaskFilter] = useState<'all' | 'candidate_vetting' | 'astronomical_anomaly_detection'>('all');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string>();
  const [queueingJob, setQueueingJob] = useState<string>();
  const [notice, setNotice] = useState<string>();

  const loadData = useCallback(async (isRefresh = false) => {
    setError(undefined);
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    try {
      const [modelResponse, jobResponse] = await Promise.all([
        apiFetch<ModelResponse>('/v1/models'),
        apiFetch<JobResponse>('/v1/inference/jobs'),
      ]);
      setModels(modelResponse.models ?? []);
      setJobs(jobResponse.jobs ?? []);
      setSelectedRuntimeId((current) => current && modelResponse.models.some((model) => model.runtime_package_id === current)
        ? current
        : modelResponse.models[0]?.runtime_package_id);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Unable to load model registry');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const visibleModels = useMemo(
    () => taskFilter === 'all' ? models : models.filter((model) => model.task === taskFilter),
    [models, taskFilter],
  );
  const selectedModel = models.find((model) => model.runtime_package_id === selectedRuntimeId) ?? visibleModels[0];
  const selectedJobs = selectedModel
    ? jobs.filter((job) => job.model_id === selectedModel.model_id || job.runtime_package_id === selectedModel.runtime_package_id)
    : [];
  const validatedCount = models.filter((model) => model.status === 'validated' || model.status === 'champion').length;
  const championCount = models.filter((model) => model.status === 'champion').length;
  const plannedCount = jobs.filter((job) => job.status === 'planned').length;

  async function queueJob(job: InferenceJob): Promise<void> {
    setQueueingJob(job.job_id);
    setNotice(undefined);
    try {
      await apiFetch(`/v1/inference/jobs/${encodeURIComponent(job.job_id)}/retry`, { method: 'POST' });
      setNotice(`Job ${job.job_id} đã được đưa vào hàng đợi GPU.`);
    } catch (queueError) {
      setError(queueError instanceof Error ? queueError.message : 'Unable to queue inference job');
    } finally {
      setQueueingJob(undefined);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
        <div>
          <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
            <BrainCircuit className="size-4 text-primary" />
            Model control plane
          </div>
          <h2 className="font-heading text-2xl font-semibold tracking-tight md:text-3xl">Models & inference</h2>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            Chọn runtime package đã được parity-check, ghim vào Gold job bất biến và đưa inference lên GPU worker.
          </p>
        </div>
        <Button variant="outline" onClick={() => void loadData(true)} disabled={loading || refreshing}>
          <RefreshCw className={refreshing ? 'animate-spin' : ''} />
          Refresh registry
        </Button>
      </div>

      {error && (
        <div className="flex items-start gap-3 rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
          <CircleAlert className="mt-0.5 size-4 shrink-0" />
          <div><p className="font-medium">Không tải được model registry</p><p className="mt-1 opacity-90">{error}</p></div>
        </div>
      )}
      {notice && <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm text-emerald-700 dark:text-emerald-300">{notice}</div>}

      <div className="grid min-w-0 gap-4 sm:grid-cols-2 lg:grid-cols-2 2xl:grid-cols-4">
        <MetricCard icon={BrainCircuit} label="Runtime packages" value={models.length} detail="Discovered from MinIO" />
        <MetricCard icon={ShieldCheck} label="Validated" value={validatedCount} detail="Parity status PASS" />
        <MetricCard icon={Sparkles} label="Champions" value={championCount} detail="Active registry pointers" />
        <MetricCard icon={Clock3} label="Planned jobs" value={plannedCount} detail="Ready for GPU dispatch" />
      </div>

      <div className="grid min-w-0 gap-6 2xl:grid-cols-[minmax(0,1.25fr)_minmax(0,0.75fr)]">
        <Card className="min-w-0 overflow-hidden">
          <CardHeader className="gap-4 md:flex-row md:items-center md:justify-between">
            <div className="min-w-0"><CardTitle>Runtime registry</CardTitle><CardDescription>Chỉ các manifest runtime đã commit mới xuất hiện ở đây.</CardDescription></div>
            <div className="flex shrink-0 flex-wrap gap-1 rounded-md border border-border p-1 text-xs">
              {(['all', 'candidate_vetting', 'astronomical_anomaly_detection'] as const).map((filter) => (
                <button
                  key={filter}
                  type="button"
                  onClick={() => setTaskFilter(filter)}
                  className={`whitespace-nowrap rounded px-2 py-1 transition-colors ${taskFilter === filter ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted'}`}
                >
                  {filter === 'all' ? 'All' : filter === 'candidate_vetting' ? 'Candidate' : 'Anomaly'}
                </button>
              ))}
            </div>
          </CardHeader>
          <CardContent>
            {loading ? <LoadingState /> : visibleModels.length === 0 ? <EmptyState label="Chưa có runtime package hợp lệ trong MinIO." /> : (
              <Table className="min-w-[720px]">
                <TableHeader><TableRow><TableHead>Model</TableHead><TableHead>Task</TableHead><TableHead>Status</TableHead><TableHead>Runtime</TableHead><TableHead className="text-right">Size</TableHead></TableRow></TableHeader>
                <TableBody>
                  {visibleModels.map((model) => (
                    <TableRow key={`${model.runtime_package_id}-${model.model_id}`} data-state={selectedModel?.runtime_package_id === model.runtime_package_id ? 'selected' : undefined} className="cursor-pointer" onClick={() => setSelectedRuntimeId(model.runtime_package_id)}>
                      <TableCell><div className="min-w-44"><p className="font-medium text-foreground">{model.model_id}</p><p className="mt-1 text-xs text-muted-foreground">{model.model_version}</p></div></TableCell>
                      <TableCell className="text-muted-foreground">{taskLabel[model.task] ?? model.task}</TableCell>
                      <TableCell><Badge variant={statusVariant(model.status)}>{model.status}</Badge></TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">{model.runtime_package_id}</TableCell>
                      <TableCell className="text-right text-muted-foreground">{formatBytes(model.onnx_size_bytes)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card className="min-w-0 overflow-hidden">
          <CardHeader><CardTitle>Selected runtime</CardTitle><CardDescription>Compatibility và lineage trước khi dispatch.</CardDescription></CardHeader>
          <CardContent>
            {!selectedModel ? <EmptyState label="Chọn một model để xem chi tiết." /> : (
              <div className="space-y-4">
                <div className="rounded-lg border border-border bg-muted/30 p-4">
                  <div className="flex items-start justify-between gap-3"><div><p className="font-medium">{selectedModel.model_id}</p><p className="mt-1 text-xs text-muted-foreground">{selectedModel.model_version}</p></div><Badge variant={statusVariant(selectedModel.status)}>{selectedModel.status}</Badge></div>
                  <Separator className="my-3" />
                  <dl className="grid grid-cols-2 gap-3 text-xs"><InfoItem label="Task" value={taskLabel[selectedModel.task] ?? selectedModel.task} /><InfoItem label="Features" value={`${selectedModel.feature_count}`} /><InfoItem label="ONNX" value={formatBytes(selectedModel.onnx_size_bytes)} /><InfoItem label="Parity" value={selectedModel.parity_status || '—'} /><InfoItem label="Threshold" value={selectedModel.decision_threshold.toFixed(4)} /><InfoItem label="Created" value={formatDate(selectedModel.created_at)} /></dl>
                </div>
                <div className="min-w-0"><p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Feature order</p><p className="max-h-20 overflow-y-auto break-words font-mono text-xs leading-5 text-muted-foreground">{selectedModel.feature_order.join(' · ') || 'Not provided'}</p></div>
                <div className="flex items-center gap-2 text-xs text-muted-foreground"><Gauge className="size-4" />GPU-only Rust inference · runtime pinned by package ID</div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="min-w-0 overflow-hidden">
        <CardHeader><CardTitle>Inference jobs</CardTitle><CardDescription>Job manifest đã được planner tạo sẵn; dispatch sẽ gửi đúng manifest này tới NATS/GPU worker.</CardDescription></CardHeader>
        <CardContent>
          {!selectedModel ? <EmptyState label="Chọn model để xem các Gold jobs tương thích." /> : selectedJobs.length === 0 ? <EmptyState label="Không có Gold job nào đã pin vào runtime này." /> : (
            <Table className="min-w-[900px]">
              <TableHeader><TableRow><TableHead>Job</TableHead><TableHead>Gold snapshot</TableHead><TableHead>Sector</TableHead><TableHead>Rows</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Action</TableHead></TableRow></TableHeader>
              <TableBody>{selectedJobs.map((job) => <TableRow key={job.job_id}><TableCell><p className="font-mono text-xs font-medium">{job.job_id}</p><p className="mt-1 text-xs text-muted-foreground">{formatDate(job.created_at)}</p></TableCell><TableCell><p className="font-mono text-xs">{job.gold_snapshot_id}</p><p className="mt-1 max-w-64 truncate text-xs text-muted-foreground">{job.gold_artifact_key}</p></TableCell><TableCell>{job.sector}</TableCell><TableCell>{job.expected_prediction_count.toLocaleString()}</TableCell><TableCell><Badge variant={statusVariant(job.status)}>{job.status}</Badge></TableCell><TableCell className="text-right"><Button size="sm" variant={job.status === 'completed' ? 'outline' : 'default'} onClick={() => void queueJob(job)} disabled={queueingJob === job.job_id || selectedModel.status === 'invalid'}>{queueingJob === job.job_id ? <LoaderCircle className="animate-spin" /> : <Play />}{queueingJob === job.job_id ? 'Queueing…' : job.status === 'completed' ? 'Run again' : 'Queue GPU'}</Button></TableCell></TableRow>)}</TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function MetricCard({ icon: Icon, label, value, detail }: { icon: typeof BrainCircuit; label: string; value: number; detail: string }): JSX.Element {
  return <Card><CardContent className="flex items-center gap-3 p-4"><div className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary"><Icon className="size-5" /></div><div><p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p><p className="mt-0.5 text-xl font-semibold">{value}</p><p className="text-xs text-muted-foreground">{detail}</p></div></CardContent></Card>;
}

function InfoItem({ label, value }: { label: string; value: string }): JSX.Element {
  return <div><dt className="text-muted-foreground">{label}</dt><dd className="mt-0.5 truncate font-medium text-foreground">{value}</dd></div>;
}

function LoadingState(): JSX.Element {
  return <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground"><LoaderCircle className="animate-spin" />Loading registry…</div>;
}

function EmptyState({ label }: { label: string }): JSX.Element {
  return <div className="flex flex-col items-center justify-center gap-2 py-12 text-center text-sm text-muted-foreground"><Database className="size-6 opacity-60" /><p>{label}</p></div>;
}
