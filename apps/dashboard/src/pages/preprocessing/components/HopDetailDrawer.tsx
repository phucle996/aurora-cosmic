import type { JSX } from 'react';
import { Activity, Database, FileText, Workflow, X } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from '@/components/ui/drawer';
import type { Hop } from '../types';
import {
  BlsPeriodogramChart,
  CadenceTimelineChart,
  CheckpointMetricsChart,
  CompressionRatioChart,
  QualityMaskChart,
  ResidualsDistributionChart,
} from './hop-charts';

// Hàm render chart tương ứng với từng Hop id kèm mode, metrics và số tệp cộng dồn
function renderHopChart(
  hopId: string,
  mode: 'stream' | 'batch' = 'batch',
  totalFiles: number = 3125,
  metrics?: Record<string, number>
): JSX.Element | null {
  switch (hopId) {
    case 'bronze':
      return <CadenceTimelineChart mode={mode} totalFiles={totalFiles} metrics={metrics} />;
    case 'decode':
      return <QualityMaskChart mode={mode} totalFiles={totalFiles} metrics={metrics} />;
    case 'transform':
      return <ResidualsDistributionChart />;
    case 'silver':
      return <BlsPeriodogramChart />;
    case 'checkpoint':
      return <CheckpointMetricsChart />;
    case 'lineage':
      return <CompressionRatioChart mode={mode} totalFiles={totalFiles} metrics={metrics} />;
    default:
      return null;
  }
}

export function HopDetailDrawer({
  selectedHop,
  onClose,
  mode = 'batch',
  totalFiles = 3125,
}: {
  selectedHop: Hop | undefined;
  onClose: () => void;
  mode?: 'stream' | 'batch';
  totalFiles?: number;
}): JSX.Element {
  return (
    <Drawer
      open={selectedHop !== undefined}
      snapPoints={[0.6, 0.9]}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DrawerContent className="h-[90vh] max-h-[90vh] border-t-2 border-primary/40">
        <DrawerHeader className="border-b border-border px-6 py-3 text-left">
          <div className="flex items-center justify-between gap-4 max-w-[1440px] mx-auto w-full">
            <div>
              <DrawerTitle className="text-base font-bold flex items-center gap-2">
                <Workflow className="size-4 text-primary" />
                {selectedHop ? `Bước ${selectedHop.stepNumber}: ${selectedHop.label}` : 'Chi tiết bước xử lý'}
                {selectedHop && (
                  <Badge variant="outline" className="ml-2 font-mono text-[10px] uppercase">
                    {selectedHop.status}
                  </Badge>
                )}
                <Badge variant="secondary" className="font-mono text-[10px] uppercase">
                  {mode === 'stream' ? 'Live Stream Mode (NATS)' : 'Batch Backlog Mode (MinIO)'}
                </Badge>
              </DrawerTitle>
              <DrawerDescription className="text-xs mt-0.5">
                {selectedHop?.description ?? 'Đặc tả hợp đồng và dữ liệu đầu vào/đầu ra.'}
              </DrawerDescription>
            </div>
            <DrawerClose asChild>
              <Button variant="ghost" size="icon-sm">
                <X className="size-4" />
                <span className="sr-only">Close</span>
              </Button>
            </DrawerClose>
          </div>
        </DrawerHeader>

        <div className="overflow-y-auto p-6 max-w-[1440px] mx-auto text-xs w-full">
          {selectedHop ? (
            <div className="grid gap-6 lg:grid-cols-12 items-start">
              {/* Left Column: Status, Input/Output, Astronomy Goal, and Contract (5 cols) */}
              <div className="lg:col-span-5 space-y-4">
                {/* Status, Input, Output Cards */}
                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="bg-muted/20 p-3 rounded-lg border border-border/50">
                    <span className="text-muted-foreground block text-[10px] font-semibold uppercase">
                      Trạng thái Pipeline
                    </span>
                    <span className="font-mono font-bold text-foreground text-xs uppercase mt-0.5 block">
                      {selectedHop.status}
                    </span>
                  </div>
                  <div className="bg-muted/20 p-3 rounded-lg border border-border/50">
                    <span className="text-muted-foreground block text-[10px] font-semibold uppercase">
                      Đầu vào (Input)
                    </span>
                    <span className="font-semibold text-foreground text-xs truncate block mt-0.5" title={selectedHop.input}>
                      {selectedHop.input}
                    </span>
                  </div>
                  <div className="bg-muted/20 p-3 rounded-lg border border-border/50">
                    <span className="text-muted-foreground block text-[10px] font-semibold uppercase">
                      Đầu ra (Output)
                    </span>
                    <span className="font-semibold text-foreground text-xs truncate block mt-0.5" title={selectedHop.output}>
                      {selectedHop.output}
                    </span>
                  </div>
                </div>

                {/* Astronomy Goal & Mathematical Formulation */}
                <div className="bg-muted/15 p-4 rounded-lg border border-border/60 space-y-2">
                  <span className="text-muted-foreground uppercase tracking-wider text-[10px] font-bold flex items-center gap-1.5">
                    <FileText className="size-3.5 text-primary" /> Mục tiêu Khoa học Thiên văn
                  </span>
                  <p className="text-xs font-medium text-foreground leading-relaxed">
                    {selectedHop.astronomyGoal}
                  </p>
                  {selectedHop.formula && (
                    <div className="mt-2 bg-background p-2.5 rounded font-mono text-xs text-primary border border-border/50 overflow-x-auto">
                      {selectedHop.formula}
                    </div>
                  )}
                </div>

                {/* Data Contract URI */}
                <div className="bg-muted/15 p-4 rounded-lg border border-border/60 space-y-1.5">
                  <span className="text-muted-foreground uppercase tracking-wider text-[10px] font-bold flex items-center gap-1.5">
                    <Database className="size-3.5 text-primary" /> Hợp đồng Dữ liệu (Data Contract URI)
                  </span>
                  <p className="font-mono text-[11px] text-foreground bg-background p-2.5 rounded border border-border/50 break-all select-all">
                    {selectedHop.contract}
                  </p>
                </div>
              </div>

              {/* Right Column: Dynamic Interactive Scientific Chart (7 cols) */}
              <div className="lg:col-span-7 bg-muted/15 p-4 rounded-lg border border-border/80 space-y-3">
                <div className="flex items-center gap-2 text-foreground font-semibold text-xs border-b border-border/40 pb-2.5">
                  <Activity className="size-4 text-primary" />
                  <span>Trực quan hóa Dữ liệu Thuật toán (Scientific Visualizer)</span>
                </div>

                {renderHopChart(selectedHop.id, mode, totalFiles, selectedHop.metrics)}
              </div>
            </div>
          ) : (
            <div className="py-12 text-center text-muted-foreground">Chọn một node để xem chi tiết.</div>
          )}
        </div>
      </DrawerContent>
    </Drawer>
  );
}
