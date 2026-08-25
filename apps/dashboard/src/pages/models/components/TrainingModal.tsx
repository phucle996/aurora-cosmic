import { useState } from 'react';
import type { FormEvent, JSX } from 'react';
import {
  BrainCircuit,
  LoaderCircle,
  Play,
  RefreshCw,
  Rocket,
  Sparkles,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
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
import { formatBytes, formatDate } from '../types';
import type { GoldSnapshotItem, ModelRecord } from '../types';

interface TrainingModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  models: ModelRecord[];
  availableSnapshots: GoldSnapshotItem[];
  snapshotsLoading: boolean;
  onRefreshSnapshots: () => void;
  onSubmitTraining: (params: {
    task: 'candidate_vetting' | 'astronomical_anomaly_detection';
    baseModelId: string;
    mode: 'fine_tune' | 'scratch';
    snapshotId: string;
    epochs: number;
    learningRate: number;
    batchSize: number;
    seed: number;
    autoPromote: boolean;
    unrunSnapshots: GoldSnapshotItem[];
  }) => Promise<void>;
  submitting: boolean;
}

export function TrainingModal({
  open,
  onOpenChange,
  models,
  availableSnapshots,
  snapshotsLoading,
  onRefreshSnapshots,
  onSubmitTraining,
  submitting,
}: TrainingModalProps): JSX.Element {
  const [trainTask, setTrainTask] = useState<'candidate_vetting' | 'astronomical_anomaly_detection'>('candidate_vetting');
  const [trainBaseModelId, setTrainBaseModelId] = useState('champion');
  const [trainMode, setTrainMode] = useState<'fine_tune' | 'scratch'>('fine_tune');
  const [trainSnapshotId, setTrainSnapshotId] = useState('__all_unrun__');
  const [isCustomSnapshot, setIsCustomSnapshot] = useState(false);

  const [trainEpochs, setTrainEpochs] = useState('50');
  const [trainLr, setTrainLr] = useState('0.001');
  const [trainBatchSize, setTrainBatchSize] = useState('32');
  const [trainSeed, setTrainSeed] = useState('42');
  const [trainAutoPromote, setTrainAutoPromote] = useState(true);

  const unrunSnapshots = availableSnapshots.filter((s) => !s.is_trained);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const effectiveBaseModel = trainBaseModelId === '__scratch__' ? '' : trainBaseModelId;
    const effectiveMode = trainBaseModelId === '__scratch__' ? 'scratch' : trainMode;

    await onSubmitTraining({
      task: trainTask,
      baseModelId: effectiveBaseModel,
      mode: effectiveMode,
      snapshotId: trainSnapshotId,
      epochs: Number(trainEpochs) || 50,
      learningRate: Number(trainLr) || 0.001,
      batchSize: Number(trainBatchSize) || 32,
      seed: Number(trainSeed) || 42,
      autoPromote: trainAutoPromote,
      unrunSnapshots,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button size="sm" className="gap-2 bg-gradient-to-r from-amber-500 to-primary text-primary-foreground font-semibold shadow-md">
          <Sparkles className="size-4" />
          Train New Model
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[560px]">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base font-semibold">
              <Rocket className="size-5 text-primary" />
              Huấn luyện Mô hình Học máy Mới (GPU)
            </DialogTitle>
            <DialogDescription className="text-xs">
              Khởi chạy quy trình huấn luyện PyTorch trên GPU NVIDIA từ các Gold Snapshots trong Lakehouse.
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

            {/* Base Model Selection (Continual Learning & Transfer Learning) */}
            <div className="space-y-2 rounded-md border border-primary/20 bg-primary/5 p-3">
              <div className="flex items-center justify-between">
                <Label htmlFor="train-base-model" className="text-xs font-semibold text-primary flex items-center gap-1.5">
                  <BrainCircuit className="size-3.5" />
                  Mô hình Nền tảng (Continual Learning / Transfer Learning)
                </Label>
                <Badge variant="outline" className="text-[10px] bg-primary/10 text-primary border-primary/30 font-medium">
                  {trainBaseModelId === '__scratch__' ? 'Random Init' : 'Kế thừa tri thức'}
                </Badge>
              </div>

              <select
                id="train-base-model"
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-xs font-mono ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                value={trainBaseModelId}
                onChange={(e) => {
                  setTrainBaseModelId(e.target.value);
                  if (e.target.value === '__scratch__') {
                    setTrainMode('scratch');
                  } else {
                    setTrainMode('fine_tune');
                  }
                }}
              >
                <option value="champion">👑 Champion Model Hiện Tại (Khuyên dùng — Kế thừa tri thức tốt nhất)</option>
                {models.filter((m) => m.task === trainTask).length > 0 && (
                  <optgroup label="📦 CHỌN MODEL CỤ THỂ TRONG REGISTRY">
                    {models
                      .filter((m) => m.task === trainTask)
                      .map((m) => (
                        <option key={m.model_id} value={m.model_id}>
                          {m.model_id} ({m.status === 'champion' ? '👑 Champion' : m.status}) — Ver {m.model_version}
                        </option>
                      ))}
                  </optgroup>
                )}
                <option value="__scratch__">🆕 Huấn luyện từ đầu (Train from scratch / Random weights)</option>
              </select>

              <p className="text-[10.5px] text-muted-foreground pt-0.5 leading-relaxed">
                {trainBaseModelId === '__scratch__'
                  ? '⚡ Khởi tạo ngẫu nhiên toàn bộ trọng số mạng nơ-ron (không kế thừa tri thức trước).'
                  : '🎯 Kế thừa toàn bộ đặc trưng đã học từ Base Model và tiến hành tinh chỉnh (Fine-tuning) trên các Gold Snapshots mới để mô hình liên tục thông minh và chính xác hơn.'}
              </p>
            </div>

            {/* Dynamic Gold Snapshot Selector */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Label htmlFor="train-snapshot" className="text-xs font-medium">
                    Gold Snapshot Nguồn (Feature Store)
                  </Label>
                  {unrunSnapshots.length > 0 && (
                    <Badge variant="outline" className="bg-emerald-500/10 text-emerald-400 border-emerald-500/30 text-[10px] py-0 px-1.5 font-mono">
                      {unrunSnapshots.length} mới chưa chạy
                    </Badge>
                  )}
                </div>
                <button
                  type="button"
                  onClick={onRefreshSnapshots}
                  disabled={snapshotsLoading}
                  className="flex items-center gap-1 text-[11px] text-primary hover:underline disabled:opacity-50"
                >
                  <RefreshCw className={`size-3 ${snapshotsLoading ? 'animate-spin' : ''}`} />
                  Làm mới danh sách
                </button>
              </div>

              {snapshotsLoading ? (
                <div className="flex items-center justify-center p-3 border rounded-md text-xs text-muted-foreground bg-muted/20">
                  <LoaderCircle className="size-3.5 animate-spin mr-2" />
                  Đang nạp danh sách Gold Snapshots chưa chạy từ Lakehouse...
                </div>
              ) : (
                <select
                  id="train-snapshot-select"
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-xs font-mono ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  value={isCustomSnapshot ? '__custom__' : trainSnapshotId}
                  onChange={(e) => {
                    if (e.target.value === '__custom__') {
                      setIsCustomSnapshot(true);
                    } else {
                      setIsCustomSnapshot(false);
                      setTrainSnapshotId(e.target.value);
                    }
                  }}
                >
                  {/* Option 1: Huấn luyện gộp toàn bộ các snapshot chưa chạy thành 1 model duy nhất */}
                  {unrunSnapshots.length > 0 && (
                    <option value="__all_unrun__" className="font-semibold text-primary">
                      ⚡ [GỘP TẤT CẢ] Huấn luyện gộp toàn bộ {unrunSnapshots.length} Snapshots thành 1 Model duy nhất (Khuyên dùng)
                    </option>
                  )}

                  {/* Group 2: Danh sách từng Snapshot Chưa Chạy */}
                  <optgroup label={`🌟 SNAPSHOTS MỚI CHƯA CHẠY (${unrunSnapshots.length})`}>
                    {unrunSnapshots.map((snap) => (
                      <option key={snap.snapshot_id} value={snap.snapshot_id}>
                        [Chưa chạy] {snap.snapshot_id} ({formatBytes(snap.size_bytes)}) — {formatDate(snap.last_modified)}
                      </option>
                    ))}
                  </optgroup>

                  {/* Group 3: Snapshots Đã Huấn Luyện */}
                  {availableSnapshots.filter((s) => s.is_trained).length > 0 && (
                    <optgroup label={`✅ SNAPSHOTS ĐÃ HUẤN LUYỆN (${availableSnapshots.filter((s) => s.is_trained).length})`}>
                      {availableSnapshots
                        .filter((s) => s.is_trained)
                        .map((snap) => (
                          <option key={snap.snapshot_id} value={snap.snapshot_id}>
                            [Đã train: {snap.trained_model_id}] {snap.snapshot_id}
                          </option>
                        ))}
                    </optgroup>
                  )}

                  <optgroup label="⚙️ TÙY CHỌN">
                    <option value="__custom__">✏️ Nhập Snapshot ID thủ công...</option>
                  </optgroup>
                </select>
              )}

              {/* Custom Snapshot Input */}
              {isCustomSnapshot && (
                <Input
                  id="train-snapshot-custom"
                  placeholder="gold-v1-xxxxxxxxxxxx (hoặc tên snapshot bất kỳ)"
                  value={trainSnapshotId}
                  onChange={(e) => setTrainSnapshotId(e.target.value)}
                  className="text-xs font-mono mt-1.5"
                />
              )}

              {/* Snapshot Metadata Preview Card */}
              {(() => {
                if (trainSnapshotId === '__all_unrun__') {
                  const totalBytes = unrunSnapshots.reduce((acc, s) => acc + s.size_bytes, 0);
                  return (
                    <div className="rounded-md border border-primary/40 bg-primary/5 p-2.5 space-y-1 text-[11px]">
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-primary flex items-center gap-1">
                          <Sparkles className="size-3.5" />
                          Chế độ: Huấn luyện Gộp Tối ưu (Single Model Unified Batch)
                        </span>
                        <Badge variant="outline" className="bg-primary/10 text-primary border-primary/30 text-[10px]">
                          {unrunSnapshots.length} Snapshots
                        </Badge>
                      </div>
                      <div className="flex items-center justify-between text-muted-foreground">
                        <span>Tổng dung lượng dữ liệu:</span>
                        <span className="font-mono text-foreground font-medium">{formatBytes(totalBytes)}</span>
                      </div>
                      <p className="text-muted-foreground text-[10.5px] pt-1 border-t border-border/50">
                        Hệ thống sẽ tải và gộp dữ liệu từ toàn bộ {unrunSnapshots.length} Gold Snapshots thành một tập huấn luyện lớn duy nhất trên GPU.
                      </p>
                    </div>
                  );
                }

                const snap = availableSnapshots.find((s) => s.snapshot_id === trainSnapshotId);
                if (!snap) return null;
                return (
                  <div className="rounded-md border border-border/70 bg-muted/20 p-2.5 space-y-1 text-[11px]">
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground font-medium">Trạng thái Snapshot:</span>
                      {snap.is_trained ? (
                        <Badge variant="outline" className="text-[10px] text-muted-foreground">
                          Đã train với model: {snap.trained_model_id}
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="bg-emerald-500/10 text-emerald-400 border-emerald-500/30 text-[10px]">
                          🟢 Sẵn sàng huấn luyện (Chưa chạy)
                        </Badge>
                      )}
                    </div>
                    <div className="flex items-center justify-between text-muted-foreground">
                      <span>Dung lượng Parquet:</span>
                      <span className="font-mono text-foreground font-medium">{formatBytes(snap.size_bytes)}</span>
                    </div>
                    <div className="flex items-center justify-between text-muted-foreground">
                      <span>Thời gian tạo:</span>
                      <span className="font-mono text-foreground">{formatDate(snap.last_modified)}</span>
                    </div>
                  </div>
                );
              })()}
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
              onClick={() => onOpenChange(false)}
              disabled={submitting}
            >
              Hủy
            </Button>
            <Button type="submit" size="sm" disabled={submitting} className="gap-2">
              {submitting ? (
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
  );
}
