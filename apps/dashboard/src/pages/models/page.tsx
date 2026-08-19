import { useCallback, useEffect, useMemo, useState } from 'react';
import type { FormEvent, JSX } from 'react';
import {
  BrainCircuit,
  CheckCircle2,
  CircleAlert,
  Clock3,
  Database,
  Gauge,
  LoaderCircle,
  Play,
  Plus,
  RefreshCw,
  Rocket,
  ShieldCheck,
  Sparkles,
  Zap,
} from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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

type TrainingResponse = {
  job_id: string;
  task: string;
  gold_snapshot_id: string;
  status: string;
  created_at: string;
  message: string;
};

type ModelResponse = { models: ModelRecord[] };
type JobResponse = { jobs: InferenceJob[] };
type StorageResponse = { objects: { key: string }[] };

const taskLabel: Record<string, string> = {
  candidate_vetting: 'Candidate vetting (Exoplanets)',
  astronomical_anomaly_detection: 'Anomaly detection (Autoencoder)',
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

  // Training Dialog state
  const [trainDialogOpen, setTrainDialogOpen] = useState(false);
  const [trainTask, setTrainTask] = useState<'candidate_vetting' | 'astronomical_anomaly_detection'>('candidate_vetting');
  const [trainSnapshotId, setTrainSnapshotId] = useState('');
  const [trainEpochs, setTrainEpochs] = useState('50');
  const [trainLr, setTrainLr] = useState('0.001');
  const [trainBatchSize, setTrainBatchSize] = useState('32');
  const [trainSeed, setTrainSeed] = useState('42');
  const [trainAutoPromote, setTrainAutoPromote] = useState(true);
  const [trainingSubmitting, setTrainingSubmitting] = useState(false);

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
      setSelectedRuntimeId((current) =>
        current && modelResponse.models.some((model) => model.runtime_package_id === current)
          ? current
          : modelResponse.models[0]?.runtime_package_id,
      );
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

  const fetchLatestSnapshot = async () => {
    try {
      const storage = await apiFetch<StorageResponse>('/v1/storage?prefix=gold/snapshots/&limit=20');
      const objects = storage.objects ?? [];
      if (objects.length > 0) {
        // Extract snapshot directory name
        const match = objects[0].key.match(/gold\/snapshots\/([^/]+)/);
        if (match && match[1]) {
          setTrainSnapshotId(match[1]);
          return;
        }
      }
      setTrainSnapshotId('gold-candidate-snapshot-v1');
    } catch {
      setTrainSnapshotId('gold-candidate-snapshot-v1');
    }
  };

  const handleStartTraining = async (e: FormEvent) => {
    e.preventDefault();
    setTrainingSubmitting(true);
    setError(undefined);
    setNotice(undefined);
    try {
      const res = await apiFetch<TrainingResponse>('/v1/models/train', {
        method: 'POST',
        body: JSON.stringify({
          task: trainTask,
          gold_snapshot_id: trainSnapshotId.trim(),
          epochs: Number(trainEpochs) || 50,
          learning_rate: Number(trainLr) || 0.001,
          batch_size: Number(trainBatchSize) || 32,
          seed: Number(trainSeed) || 42,
          auto_promote: trainAutoPromote,
        }),
      });
      setNotice(`🚀 Training Job ${res.job_id} đã được gửi tới GPU Worker thành công! Quá trình huấn luyện, tối ưu ngưỡng và export ONNX đang chạy ngầm.`);
      setTrainDialogOpen(false);

      // Auto poll after a few seconds to update registry
      setTimeout(() => {
        void loadData(true);
      }, 3000);
    } catch (trainError) {
      setError(trainError instanceof Error ? trainError.message : 'Không thể khởi chạy training job');
    } finally {
      setTrainingSubmitting(false);
    }
  };

  const visibleModels = useMemo(
    () => (taskFilter === 'all' ? models : models.filter((model) => model.task === taskFilter)),
    [models, taskFilter],
  );
  const selectedModel = models.find((model) => model.runtime_package_id === selectedRuntimeId) ?? visibleModels[0];
  const selectedJobs = selectedModel
    ? jobs.filter(
        (job) => job.model_id === selectedModel.model_id || job.runtime_package_id === selectedModel.runtime_package_id,
      )
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
      {/* Page Header */}
      <div className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
        <div>
          <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
            <BrainCircuit className="size-4 text-primary" />
            PyTorch & ONNX ML Ops Platform
          </div>
          <h2 className="font-heading text-2xl font-semibold tracking-tight md:text-3xl">Models & Inference Engine</h2>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            Chủ động huấn luyện mô hình PyTorch trên GPU NVIDIA, tự động tối ưu ngưỡng phân loại, export ONNX và quản lý Champion Model.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Dialog open={trainDialogOpen} onOpenChange={setTrainDialogOpen}>
            <DialogTrigger asChild>
              <Button size="sm" className="gap-2 bg-gradient-to-r from-amber-500 to-primary text-primary-foreground font-semibold shadow-md">
                <Sparkles className="size-4" />
                Train New Model
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[540px]">
              <form onSubmit={handleStartTraining}>
                <DialogHeader>
                  <DialogTitle className="flex items-center gap-2 text-base font-semibold">
                    <Rocket className="size-5 text-primary" />
                    Huấn luyện Mô hình Học máy Mới (GPU)
                  </DialogTitle>
                  <DialogDescription className="text-xs">
                    Khởi chạy quy trình huấn luyện PyTorch, tối ưu Decision Threshold, kiểm thử Parity và tự động đăng ký Model Package vào MinIO.
                  </DialogDescription>
                </DialogHeader>

                <div className="grid gap-4 py-4 text-xs">
                  {/* Task Selection */}
                  <div className="space-y-1.5">
                    <Label htmlFor="train-task" className="text-xs font-medium">
                      Tác vụ Học máy (ML Task)
                    </Label>
                    <select
                      id="train-task"
                      className="w-full rounded-md border border-input bg-background px-3 py-2 text-xs ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      value={trainTask}
                      onChange={(e) => setTrainTask(e.target.value as any)}
                    >
                      <option value="candidate_vetting">Candidate Vetting (Phân loại ứng viên Ngoại hành tinh - Tabular MLP)</option>
                      <option value="astronomical_anomaly_detection">Astronomical Anomaly Detection (Phát hiện dị thường - Autoencoder)</option>
                    </select>
                  </div>

                  {/* Gold Snapshot Input */}
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <Label htmlFor="train-snapshot" className="text-xs font-medium">
                        Gold Snapshot Nguồn
                      </Label>
                      <button
                        type="button"
                        onClick={() => void fetchLatestSnapshot()}
                        className="text-[11px] text-primary hover:underline"
                      >
                        Lấy Snapshot mới nhất
                      </button>
                    </div>
                    <Input
                      id="train-snapshot"
                      placeholder="gold-candidate-snapshot-v1 (hoặc để trống để tự động)"
                      value={trainSnapshotId}
                      onChange={(e) => setTrainSnapshotId(e.target.value)}
                      className="text-xs font-mono"
                    />
                  </div>

                  {/* Hyperparameters Grid */}
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label htmlFor="train-epochs" className="text-xs font-medium">
                        Số Epochs
                      </Label>
                      <Input
                        id="train-epochs"
                        type="number"
                        min="5"
                        max="500"
                        value={trainEpochs}
                        onChange={(e) => setTrainEpochs(e.target.value)}
                        className="text-xs"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="train-lr" className="text-xs font-medium">
                        Learning Rate (Tốc độ học)
                      </Label>
                      <Input
                        id="train-lr"
                        type="number"
                        step="0.0001"
                        min="0.00001"
                        max="0.1"
                        value={trainLr}
                        onChange={(e) => setTrainLr(e.target.value)}
                        className="text-xs"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label htmlFor="train-batch" className="text-xs font-medium">
                        Batch Size
                      </Label>
                      <Input
                        id="train-batch"
                        type="number"
                        min="8"
                        max="256"
                        value={trainBatchSize}
                        onChange={(e) => setTrainBatchSize(e.target.value)}
                        className="text-xs"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="train-seed" className="text-xs font-medium">
                        Random Seed (Khởi tạo ngẫu nhiên)
                      </Label>
                      <Input
                        id="train-seed"
                        type="number"
                        value={trainSeed}
                        onChange={(e) => setTrainSeed(e.target.value)}
                        className="text-xs"
                      />
                    </div>
                  </div>

                  {/* Auto-promote Checkbox */}
                  <div className="flex items-center gap-2 rounded-md border border-border/60 bg-muted/20 p-3">
                    <input
                      type="checkbox"
                      id="auto-promote"
                      checked={trainAutoPromote}
                      onChange={(e) => setTrainAutoPromote(e.target.checked)}
                      className="size-4 rounded border-gray-300 text-primary focus:ring-primary"
                    />
                    <label htmlFor="auto-promote" className="cursor-pointer text-xs">
                      <span className="font-medium text-foreground">Tự động nâng cấp làm Champion Model</span>
                      <p className="text-[11px] text-muted-foreground">
                        Nếu mô hình vượt qua kiểm thử đối sánh Python-ONNX Parity, tự động chuyển hướng suy luận chính sang model mới này.
                      </p>
                    </label>
                  </div>
                </div>

                <DialogFooter>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setTrainDialogOpen(false)}
                    disabled={trainingSubmitting}
                  >
                    Hủy
                  </Button>
                  <Button type="submit" size="sm" disabled={trainingSubmitting} className="gap-2">
                    {trainingSubmitting ? (
                      <>
                        <LoaderCircle className="size-4 animate-spin" />
                        Đang phát lệnh GPU...
                      </>
                    ) : (
                      <>
                        <Play className="size-4" />
                        Bắt đầu Huấn luyện
                      </>
                    )}
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>

          <Button variant="outline" size="sm" onClick={() => void loadData(true)} disabled={loading || refreshing}>
            <RefreshCw className={`size-3.5 ${refreshing ? 'animate-spin' : ''}`} />
            Refresh Registry
          </Button>
        </div>
      </div>

      {error && (
        <div className="flex items-start gap-3 rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
          <CircleAlert className="mt-0.5 size-4 shrink-0" />
          <div>
            <p className="font-medium">Lỗi kết nối / Model Registry</p>
            <p className="mt-1 opacity-90">{error}</p>
          </div>
        </div>
      )}

      {notice && (
        <div className="flex items-start gap-3 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm text-emerald-300">
          <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-400" />
          <p>{notice}</p>
        </div>
      )}

      {/* Metric Cards */}
      <div className="grid min-w-0 gap-4 sm:grid-cols-2 lg:grid-cols-2 2xl:grid-cols-4">
        <MetricCard icon={BrainCircuit} label="Runtime packages" value={models.length} detail="Đã đăng ký trong MinIO" />
        <MetricCard icon={ShieldCheck} label="Validated" value={validatedCount} detail="Parity status PASS" />
        <MetricCard icon={Sparkles} label="Champions" value={championCount} detail="Mô hình phục vụ chính" />
        <MetricCard icon={Clock3} label="Planned jobs" value={plannedCount} detail="Sẵn sàng cho GPU Inference" />
      </div>

      {/* Main Grid: Registry Table & Details */}
      <div className="grid min-w-0 gap-6 2xl:grid-cols-[minmax(0,1.25fr)_minmax(0,0.75fr)]">
        <Card className="min-w-0 overflow-hidden">
          <CardHeader className="gap-4 md:flex-row md:items-center md:justify-between">
            <div className="min-w-0">
              <CardTitle className="text-base font-semibold">Model Registry & ONNX Packages</CardTitle>
              <CardDescription>Danh sách các package mô hình ML đã được đóng gói và kiểm thử đối sánh.</CardDescription>
            </div>
            <div className="flex shrink-0 flex-wrap gap-1 rounded-md border border-border p-1 text-xs">
              {(['all', 'candidate_vetting', 'astronomical_anomaly_detection'] as const).map((filter) => (
                <button
                  key={filter}
                  type="button"
                  onClick={() => setTaskFilter(filter)}
                  className={`whitespace-nowrap rounded px-2.5 py-1 transition-colors ${
                    taskFilter === filter ? 'bg-primary text-primary-foreground font-medium' : 'text-muted-foreground hover:bg-muted'
                  }`}
                >
                  {filter === 'all' ? 'All' : filter === 'candidate_vetting' ? 'Candidate Vetting' : 'Anomaly Autoencoder'}
                </button>
              ))}
            </div>
          </CardHeader>
          <CardContent>
            {loading ? (
              <LoadingState />
            ) : visibleModels.length === 0 ? (
              <EmptyState label="Chưa có runtime package hợp lệ trong MinIO. Hãy bấm 'Train New Model' để tạo mô hình đầu tiên." />
            ) : (
              <div className="overflow-x-auto">
                <Table className="min-w-[650px]">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Mô hình (Model ID)</TableHead>
                      <TableHead>Tác vụ (Task)</TableHead>
                      <TableHead>Trạng thái</TableHead>
                      <TableHead>Runtime Package</TableHead>
                      <TableHead className="text-right">Dung lượng ONNX</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {visibleModels.map((model) => (
                      <TableRow
                        key={`${model.runtime_package_id}-${model.model_id}`}
                        data-state={selectedModel?.runtime_package_id === model.runtime_package_id ? 'selected' : undefined}
                        className="cursor-pointer"
                        onClick={() => setSelectedRuntimeId(model.runtime_package_id)}
                      >
                        <TableCell>
                          <div className="min-w-44">
                            <p className="font-medium text-foreground">{model.model_id}</p>
                            <p className="mt-0.5 text-xs text-muted-foreground font-mono">{model.model_version}</p>
                          </div>
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">{taskLabel[model.task] ?? model.task}</TableCell>
                        <TableCell>
                          <Badge variant={statusVariant(model.status)}>
                            {model.status === 'champion' ? '👑 Champion' : model.status}
                          </Badge>
                        </TableCell>
                        <TableCell className="font-mono text-xs text-muted-foreground">{model.runtime_package_id}</TableCell>
                        <TableCell className="text-right font-mono text-xs text-muted-foreground">
                          {formatBytes(model.onnx_size_bytes)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Selected Model Details */}
        <Card className="min-w-0 overflow-hidden">
          <CardHeader>
            <CardTitle className="text-base font-semibold">Chi tiết Mô hình được chọn</CardTitle>
            <CardDescription>Thông số kỹ thuật, tính toàn vẹn SHA-256 và lineage.</CardDescription>
          </CardHeader>
          <CardContent>
            {!selectedModel ? (
              <EmptyState label="Chọn một model để xem chi tiết thông số." />
            ) : (
              <div className="space-y-4">
                <div className="rounded-lg border border-border bg-muted/30 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-medium">{selectedModel.model_id}</p>
                      <p className="mt-1 text-xs text-muted-foreground font-mono">{selectedModel.model_version}</p>
                    </div>
                    <Badge variant={statusVariant(selectedModel.status)}>
                      {selectedModel.status === 'champion' ? '👑 Champion Model' : selectedModel.status}
                    </Badge>
                  </div>
                  <Separator className="my-3" />
                  <dl className="grid grid-cols-2 gap-3 text-xs">
                    <InfoItem label="Task" value={taskLabel[selectedModel.task] ?? selectedModel.task} />
                    <InfoItem label="Số đặc trưng" value={`${selectedModel.feature_count} features`} />
                    <InfoItem label="Kích thước ONNX" value={formatBytes(selectedModel.onnx_size_bytes)} />
                    <InfoItem label="Parity Test" value={selectedModel.parity_status || 'PASS'} />
                    <InfoItem label="Ngưỡng Threshold" value={selectedModel.decision_threshold.toFixed(4)} />
                    <InfoItem label="Ngày tạo" value={formatDate(selectedModel.created_at)} />
                  </dl>
                </div>
                <div className="min-w-0">
                  <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Thứ tự đặc trưng (Feature Order)</p>
                  <p className="max-h-24 overflow-y-auto break-words font-mono text-[11px] leading-5 text-muted-foreground rounded bg-muted/20 p-2">
                    {selectedModel.feature_order.join(' · ') || 'Not provided'}
                  </p>
                </div>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Gauge className="size-4 text-primary" />
                  GPU-only Rust Inference Engine · ONNX Runtime v1.20
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Inference Jobs Table */}
      <Card className="min-w-0 overflow-hidden">
        <CardHeader>
          <CardTitle className="text-base font-semibold">Danh sách Inference Jobs</CardTitle>
          <CardDescription>Đưa các snapshot dữ liệu vào hàng đợi để GPU Rust Inference Engine chấm điểm hàng loạt.</CardDescription>
        </CardHeader>
        <CardContent>
          {!selectedModel ? (
            <EmptyState label="Chọn model để xem các Gold jobs tương thích." />
          ) : selectedJobs.length === 0 ? (
            <EmptyState label="Không có Gold job nào đã pin vào runtime này." />
          ) : (
            <div className="overflow-x-auto">
              <Table className="min-w-[800px]">
                <TableHeader>
                  <TableRow>
                    <TableHead>Mã Job</TableHead>
                    <TableHead>Gold Snapshot</TableHead>
                    <TableHead>Sector</TableHead>
                    <TableHead>Số lượng mẫu</TableHead>
                    <TableHead>Trạng thái</TableHead>
                    <TableHead className="text-right">Hành động</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {selectedJobs.map((job) => (
                    <TableRow key={job.job_id}>
                      <TableCell>
                        <p className="font-mono text-xs font-medium">{job.job_id}</p>
                        <p className="mt-1 text-xs text-muted-foreground">{formatDate(job.created_at)}</p>
                      </TableCell>
                      <TableCell>
                        <p className="font-mono text-xs">{job.gold_snapshot_id}</p>
                        <p className="mt-1 max-w-64 truncate text-xs text-muted-foreground">{job.gold_artifact_key}</p>
                      </TableCell>
                      <TableCell className="font-mono text-xs">{job.sector}</TableCell>
                      <TableCell className="font-mono text-xs">{job.expected_prediction_count.toLocaleString()}</TableCell>
                      <TableCell>
                        <Badge variant={statusVariant(job.status)}>{job.status}</Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          size="sm"
                          variant={job.status === 'completed' ? 'outline' : 'default'}
                          onClick={() => void queueJob(job)}
                          disabled={queueingJob === job.job_id || selectedModel.status === 'invalid'}
                        >
                          {queueingJob === job.job_id ? <LoaderCircle className="animate-spin size-3.5" /> : <Play className="size-3.5" />}
                          {queueingJob === job.job_id ? 'Đang xếp hàng…' : job.status === 'completed' ? 'Chạy lại' : 'Queue GPU'}
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function MetricCard({
  icon: Icon,
  label,
  value,
  detail,
}: {
  icon: typeof BrainCircuit;
  label: string;
  value: number;
  detail: string;
}): JSX.Element {
  return (
    <Card>
      <CardContent className="flex items-center gap-3 p-4">
        <div className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Icon className="size-5" />
        </div>
        <div>
          <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
          <p className="mt-0.5 text-xl font-semibold">{value}</p>
          <p className="text-xs text-muted-foreground">{detail}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function InfoItem({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 truncate font-medium text-foreground">{value}</dd>
    </div>
  );
}

function LoadingState(): JSX.Element {
  return (
    <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
      <LoaderCircle className="size-4 animate-spin" />
      Loading registry…
    </div>
  );
}

function EmptyState({ label }: { label: string }): JSX.Element {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-12 text-center text-sm text-muted-foreground">
      <Database className="size-6 opacity-60" />
      <p>{label}</p>
    </div>
  );
}
