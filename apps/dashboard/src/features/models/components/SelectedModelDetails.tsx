import { type JSX } from 'react';
import { Link } from 'react-router-dom';
import { Database, Gauge, LoaderCircle, Sparkles, Square } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { formatBytes, formatDate, statusVariant, taskLabel } from '../types';
import type { ModelRecord } from '../types';

interface SelectedModelDetailsProps {
  selectedModel?: ModelRecord;
  onDeployModel?: (modelId: string, task: string, active: boolean) => Promise<void>;
  isDeploying?: boolean;
}

export function SelectedModelDetails({
  selectedModel,
  onDeployModel,
  isDeploying,
}: SelectedModelDetailsProps): JSX.Element {
  const isChampion = selectedModel?.status === 'champion';

  return (
    <Card className="min-w-0 overflow-hidden">
      <CardHeader>
        <CardTitle className="text-base font-semibold">Chi tiết Mô hình được chọn</CardTitle>
        <CardDescription>Thông số kỹ thuật, trạng thái triển khai suy luận và lineage.</CardDescription>
      </CardHeader>
      <CardContent>
        {!selectedModel ? (
          <div className="flex flex-col items-center justify-center gap-2 py-12 text-center text-sm text-muted-foreground">
            <Database className="size-6 opacity-60" />
            <p>Chọn một model để xem chi tiết thông số.</p>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Active Inference Deployment Control Card */}
            {isChampion ? (
              <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-3.5 space-y-2.5 shadow-sm">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="relative flex size-2.5">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                      <span className="relative inline-flex rounded-full size-2.5 bg-emerald-500"></span>
                    </span>
                    <span className="text-xs font-semibold text-emerald-400 flex items-center gap-1">
                      👑 ĐANG PHỤC VỤ SUY LUẬN TRỰC TIẾP
                    </span>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs border-destructive/40 text-destructive hover:bg-destructive/10 gap-1.5 shrink-0"
                    onClick={() => onDeployModel?.(selectedModel.runtime_package_id, selectedModel.task, false)}
                    disabled={isDeploying}
                  >
                    {isDeploying ? <LoaderCircle className="size-3 animate-spin" /> : <Square className="size-3" />}
                    Hủy triển khai
                  </Button>
                </div>
                <p className="text-[11px] text-muted-foreground leading-relaxed">
                  Mô hình này đang giữ quyền Champion trong MinIO (<code className="text-foreground">champion.json</code>) và được Rust Inference Engine tự động tải để phân loại luồng dữ liệu thời gian thực.
                </p>
              </div>
            ) : (
              <div className="rounded-lg border border-border bg-muted/20 p-3.5 space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs text-muted-foreground font-medium flex items-center gap-1.5">
                    ⚪ Mô hình dự phòng (Chưa kích hoạt suy luận)
                  </span>
                  <Button
                    size="sm"
                    className="h-7 text-xs gap-1.5 bg-gradient-to-r from-emerald-600 to-primary text-primary-foreground font-semibold shadow-sm shrink-0"
                    onClick={() => onDeployModel?.(selectedModel.runtime_package_id, selectedModel.task, true)}
                    disabled={isDeploying || selectedModel.status === 'invalid'}
                  >
                    {isDeploying ? <LoaderCircle className="size-3 animate-spin" /> : <Sparkles className="size-3" />}
                    Triển khai mô hình này (Set Champion)
                  </Button>
                </div>
                <p className="text-[11px] text-muted-foreground leading-relaxed">
                  Nhấp để chuyển quyền suy luận chính cho mô hình này. Hệ thống sẽ cập nhật con trỏ <code className="text-foreground">champion.json</code> ngay lập tức.
                </p>
              </div>
            )}

            {/* Model Metadata Card */}
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
              <Link
                to={`/ai-factory/models/${encodeURIComponent(selectedModel.model_id)}`}
                className="mt-3 inline-flex text-xs font-medium text-primary hover:underline"
              >
                Mở trang Model Detail &amp; evidence →
              </Link>
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
