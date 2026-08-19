import { useMemo, useState } from 'react';
import type { JSX } from 'react';
import { Database, LoaderCircle, Sparkles, Square } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatBytes, statusVariant, taskLabel } from '../types';
import type { ModelRecord, TaskType } from '../types';

interface ModelRegistryTableProps {
  models: ModelRecord[];
  selectedRuntimeId?: string;
  onSelectRuntimeId: (runtimePackageId: string) => void;
  taskFilter: TaskType;
  onTaskFilterChange: (filter: TaskType) => void;
  loading: boolean;
  onDeployModel?: (modelId: string, task: string, active: boolean) => Promise<void>;
  isDeploying?: boolean;
}

export function ModelRegistryTable({
  models,
  selectedRuntimeId,
  onSelectRuntimeId,
  taskFilter,
  onTaskFilterChange,
  loading,
  onDeployModel,
  isDeploying,
}: ModelRegistryTableProps): JSX.Element {
  const [modelSearch, setModelSearch] = useState('');
  const [modelPage, setModelPage] = useState(1);
  const MODEL_PAGE_SIZE = 8;

  const filteredModels = useMemo(() => {
    let list = taskFilter === 'all' ? models : models.filter((model) => model.task === taskFilter);
    if (modelSearch.trim()) {
      const q = modelSearch.toLowerCase();
      list = list.filter(
        (m) =>
          m.model_id.toLowerCase().includes(q) ||
          m.runtime_package_id.toLowerCase().includes(q) ||
          (taskLabel[m.task] ?? m.task).toLowerCase().includes(q),
      );
    }
    return list;
  }, [models, taskFilter, modelSearch]);

  const totalModelPages = Math.ceil(filteredModels.length / MODEL_PAGE_SIZE) || 1;
  const pagedModels = useMemo(() => {
    const start = (modelPage - 1) * MODEL_PAGE_SIZE;
    return filteredModels.slice(start, start + MODEL_PAGE_SIZE);
  }, [filteredModels, modelPage]);

  return (
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
              onClick={() => {
                onTaskFilterChange(filter);
                setModelPage(1);
              }}
              className={`whitespace-nowrap rounded px-2.5 py-1 transition-colors ${taskFilter === filter ? 'bg-primary text-primary-foreground font-medium' : 'text-muted-foreground hover:bg-muted'
                }`}
            >
              {filter === 'all' ? 'All' : filter === 'candidate_vetting' ? 'Candidate Vetting' : 'Anomaly Autoencoder'}
            </button>
          ))}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Search filter bar */}
        <div className="flex items-center justify-between gap-3">
          <div className="relative flex-1 max-w-sm">
            <Input
              placeholder="Tìm theo Model ID, Package ID hoặc Task..."
              value={modelSearch}
              onChange={(e) => {
                setModelSearch(e.target.value);
                setModelPage(1);
              }}
              className="h-8 text-xs pl-3"
            />
          </div>
          <div className="text-xs text-muted-foreground font-mono">
            Hiển thị {pagedModels.length} / {filteredModels.length} models
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
            <LoaderCircle className="size-4 animate-spin" />
            Loading registry…
          </div>
        ) : filteredModels.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-12 text-center text-sm text-muted-foreground">
            <Database className="size-6 opacity-60" />
            <p>Chưa có runtime package phù hợp với bộ lọc.</p>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <Table className="min-w-[700px]">
                <TableHeader>
                  <TableRow>
                    <TableHead>Mô hình (Model ID)</TableHead>
                    <TableHead>Tác vụ (Task)</TableHead>
                    <TableHead>Trạng thái</TableHead>
                    <TableHead>Dung lượng ONNX</TableHead>
                    <TableHead className="text-right">Triển khai Suy luận</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pagedModels.map((model) => {
                    const isChamp = model.status === 'champion';
                    return (
                      <TableRow
                        key={`${model.runtime_package_id}-${model.model_id}`}
                        data-state={selectedRuntimeId === model.runtime_package_id ? 'selected' : undefined}
                        className="cursor-pointer"
                        onClick={() => onSelectRuntimeId(model.runtime_package_id)}
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
                            {isChamp ? '👑 Champion' : model.status}
                          </Badge>
                        </TableCell>
                        <TableCell className="font-mono text-xs text-muted-foreground">
                          {formatBytes(model.onnx_size_bytes)}
                        </TableCell>
                        <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                          {isChamp ? (
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-6 px-2 text-[11px] border-destructive/40 text-destructive hover:bg-destructive/10 gap-1"
                              onClick={() => onDeployModel?.(model.model_id, model.task, false)}
                              disabled={isDeploying}
                            >
                              <Square className="size-2.5" />
                              Hủy triển khai
                            </Button>
                          ) : (
                            <Button
                              size="sm"
                              variant="secondary"
                              className="h-6 px-2 text-[11px] gap-1 hover:bg-primary hover:text-primary-foreground"
                              onClick={() => onDeployModel?.(model.model_id, model.task, true)}
                              disabled={isDeploying || model.status === 'invalid'}
                            >
                              <Sparkles className="size-2.5 text-amber-400" />
                              Triển khai
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>

            {/* Pagination Controls */}
            {totalModelPages > 1 && (
              <div className="flex items-center justify-between border-t border-border/60 pt-3 text-xs">
                <span className="text-muted-foreground">
                  Trang <span className="font-medium text-foreground">{modelPage}</span> / {totalModelPages}
                </span>
                <div className="flex items-center gap-1.5">
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 px-2.5 text-xs"
                    onClick={() => setModelPage((p) => Math.max(1, p - 1))}
                    disabled={modelPage <= 1}
                  >
                    Trước
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 px-2.5 text-xs"
                    onClick={() => setModelPage((p) => Math.min(totalModelPages, p + 1))}
                    disabled={modelPage >= totalModelPages}
                  >
                    Sau
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
