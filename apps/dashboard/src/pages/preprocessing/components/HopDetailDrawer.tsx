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
  CadenceTimelineChart,
  CheckpointMetricsChart,
  CompressionRatioChart,
  QualityMaskChart,
  ResidualsDistributionChart,
  SilverMaterializationChart,
} from './hop-charts';

// Hàm render chart tương ứng với từng Hop id kèm mode, metrics và số tệp cộng dồn
function renderHopChart(
  hopId: string,
  mode: 'stream' | 'batch' = 'batch',
  totalFiles: number = 0,
  metrics?: Record<string, number>,
  telemetry?: Record<string, Array<{ timestamp: number; value: number }>>,
): JSX.Element | null {
  switch (hopId) {
    case 'bronze':
      return <CadenceTimelineChart mode={mode} totalFiles={totalFiles} metrics={metrics} telemetry={telemetry} />;
    case 'decode':
      return <QualityMaskChart mode={mode} totalFiles={totalFiles} metrics={metrics} telemetry={telemetry} />;
    case 'transform':
      return <ResidualsDistributionChart metrics={metrics} telemetry={telemetry} />;
    case 'silver':
      return <SilverMaterializationChart metrics={metrics} telemetry={telemetry} />;
    case 'checkpoint':
      return <CheckpointMetricsChart metrics={metrics} telemetry={telemetry} />;
    case 'lineage':
      return <CompressionRatioChart mode={mode} totalFiles={totalFiles} metrics={metrics} scope="bronze-silver" />;
    case 'gold-commit':
      return <CompressionRatioChart mode={mode} metrics={metrics} scope="gold" />;
    default:
      return null;
  }
}

export function HopDetailDrawer({
  selectedHop,
  onClose,
  mode = 'batch',
  totalFiles = 0,
  portalContainer,
}: {
  selectedHop: Hop | undefined;
  onClose: () => void;
  mode?: 'stream' | 'batch';
  totalFiles?: number;
  portalContainer?: HTMLElement | null;
}): JSX.Element {
  return (
    <Drawer
      open={selectedHop !== undefined}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DrawerContent portalContainer={portalContainer} className="h-[52svh] !max-h-[52svh] border-t-2 border-primary/40">
        <DrawerHeader className="border-b border-border px-4 py-3 text-left md:px-6">
          <div className="flex w-full items-center justify-between gap-4">
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

        <div className="min-h-0 flex-1 overflow-hidden p-3 text-xs md:p-4">
          {selectedHop ? (
            <div className="grid h-full items-stretch gap-3 xl:grid-cols-[minmax(300px,0.27fr)_minmax(0,0.73fr)]">
              {/* Left Column: status, input/output, contract */}
              <div className="space-y-2">
                {/* Status, Input, Output Cards */}
                <div className="grid gap-2 sm:grid-cols-3">
                  <div className="bg-muted/20 p-2.5 rounded-lg border border-border/50">
                    <span className="text-muted-foreground block text-[10px] font-semibold uppercase">
                      Trạng thái Pipeline
                    </span>
                    <span className="font-mono font-bold text-foreground text-xs uppercase mt-0.5 block">
                      {selectedHop.status}
                    </span>
                  </div>
                  <div className="bg-muted/20 p-2.5 rounded-lg border border-border/50">
                    <span className="text-muted-foreground block text-[10px] font-semibold uppercase">
                      Đầu vào (Input)
                    </span>
                    <span className="font-semibold text-foreground text-xs truncate block mt-0.5" title={selectedHop.input}>
                      {selectedHop.input}
                    </span>
                  </div>
                  <div className="bg-muted/20 p-2.5 rounded-lg border border-border/50">
                    <span className="text-muted-foreground block text-[10px] font-semibold uppercase">
                      Đầu ra (Output)
                    </span>
                    <span className="font-semibold text-foreground text-xs truncate block mt-0.5" title={selectedHop.output}>
                      {selectedHop.output}
                    </span>
                  </div>
                </div>

                {/* Astronomy Goal & Mathematical Formulation */}
                <div className="bg-muted/15 p-3 rounded-lg border border-border/60 space-y-1.5">
                  <span className="text-muted-foreground uppercase tracking-wider text-[10px] font-bold flex items-center gap-1.5">
                    <FileText className="size-3.5 text-primary" /> Mục tiêu Khoa học Thiên văn
                  </span>
                  <p className="line-clamp-3 text-xs font-medium text-foreground leading-relaxed">
                    {selectedHop.astronomyGoal}
                  </p>
                  {selectedHop.formula && (
                    <div className="mt-1.5 bg-background p-2 rounded font-mono text-xs text-primary border border-border/50 overflow-hidden text-ellipsis whitespace-nowrap">
                      {selectedHop.formula}
                    </div>
                  )}
                </div>

                {/* Data Contract URI */}
                <div className="bg-muted/15 p-3 rounded-lg border border-border/60 space-y-1.5">
                  <span className="text-muted-foreground uppercase tracking-wider text-[10px] font-bold flex items-center gap-1.5">
                    <Database className="size-3.5 text-primary" /> Hợp đồng Dữ liệu (Data Contract URI)
                  </span>
                  <p className="font-mono text-[11px] text-foreground bg-background p-2 rounded border border-border/50 truncate select-all" title={selectedHop.contract}>
                    {selectedHop.contract}
                  </p>
                </div>
              </div>

              {/* Right Column: large scientific visualizer */}
              <div className="min-h-0 bg-muted/15 p-3 rounded-lg border border-border/80 space-y-2">
                <div className="flex items-center gap-2 text-foreground font-semibold text-xs border-b border-border/40 pb-2">
                  <Activity className="size-4 text-primary" />
                  <span>Trực quan hóa Dữ liệu Thuật toán (Scientific Visualizer)</span>
                </div>

                {renderHopChart(selectedHop.id, mode, totalFiles, selectedHop.metrics, selectedHop.telemetry)}
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
