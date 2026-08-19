import type { JSX } from 'react';
import { Database, Gauge } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { formatBytes, formatDate, statusVariant, taskLabel } from '../types';
import type { ModelRecord } from '../types';

interface SelectedModelDetailsProps {
  selectedModel?: ModelRecord;
}

export function SelectedModelDetails({ selectedModel }: SelectedModelDetailsProps): JSX.Element {
  return (
    <Card className="min-w-0 overflow-hidden">
      <CardHeader>
        <CardTitle className="text-base font-semibold">Chi tiết Mô hình được chọn</CardTitle>
        <CardDescription>Thông số kỹ thuật, tính toàn vẹn SHA-256 và lineage.</CardDescription>
      </CardHeader>
      <CardContent>
        {!selectedModel ? (
          <div className="flex flex-col items-center justify-center gap-2 py-12 text-center text-sm text-muted-foreground">
            <Database className="size-6 opacity-60" />
            <p>Chọn một model để xem chi tiết thông số.</p>
          </div>
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
