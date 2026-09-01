import { type JSX } from 'react';
import { Activity, Calculator, FileText, Workflow, X } from 'lucide-react';

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
  GoldPhaseChart,
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
  scatterPoints?: Hop['scatter_points'],
  materializationPoints?: Hop['materialization_points'],
  encodeFailures?: Hop['encode_failures'],
): JSX.Element | null {
  switch (hopId) {
    case 'bronze':
    case 'route':
      return <CadenceTimelineChart mode={mode} totalFiles={totalFiles} metrics={metrics} telemetry={telemetry} />;
    case 'decode':
      return <QualityMaskChart mode={mode} totalFiles={totalFiles} metrics={metrics} telemetry={telemetry} />;
    case 'lc-quality':
      return <QualityMaskChart mode={mode} totalFiles={totalFiles} metrics={metrics} telemetry={telemetry} modality="lightcurve" />;
    case 'tpf-quality':
      return <QualityMaskChart mode={mode} totalFiles={totalFiles} metrics={metrics} telemetry={telemetry} modality="target-pixel" />;
    case 'transform':
      return <ResidualsDistributionChart metrics={metrics} telemetry={telemetry} scatterPoints={scatterPoints} />;
    case 'lc-transform':
      return <ResidualsDistributionChart metrics={metrics} telemetry={telemetry} focus="lightcurve" scatterPoints={scatterPoints} />;
    case 'tpf-transform':
      return <ResidualsDistributionChart metrics={metrics} telemetry={telemetry} focus="target-pixel" />;
    case 'silver':
      return <SilverMaterializationChart metrics={metrics} telemetry={telemetry} materializationPoints={materializationPoints} encodeFailures={encodeFailures} />;
    case 'lc-parquet':
      return <SilverMaterializationChart metrics={metrics} telemetry={telemetry} focus="lightcurve" materializationPoints={materializationPoints} encodeFailures={encodeFailures} />;
    case 'tpf-parquet':
      return <SilverMaterializationChart metrics={metrics} telemetry={telemetry} focus="target-pixel" materializationPoints={materializationPoints} encodeFailures={encodeFailures} />;
    case 'checkpoint':
      return <CheckpointMetricsChart metrics={metrics} telemetry={telemetry} />;
    case 'lineage':
      return <CompressionRatioChart mode={mode} totalFiles={totalFiles} metrics={metrics} scope="bronze-silver" />;
    case 'gold-pairing':
    case 'gold-catalog':
    case 'gold-lc-features':
    case 'gold-bls':
    case 'gold-tpf-evidence':
    case 'gold-candidate':
    case 'gold-parquet':
    case 'gold-index':
    case 'gold-commit':
      return <GoldPhaseChart metrics={metrics} telemetry={telemetry} phase={hopId} />;
    default:
      return <StageEvidence metrics={metrics} />;
  }
}

function StageEvidence({ metrics }: { metrics?: Record<string, number> }): JSX.Element {
  const observed = Object.entries(metrics ?? {}).filter(([, value]) => Number.isFinite(value) && value > 0).slice(0, 12);
  if (observed.length === 0) return <div className="border border-dashed border-border/70 p-8 text-center text-xs text-muted-foreground">Phase chưa có scalar evidence riêng.</div>;
  return <div className="grid gap-px border border-border/70 bg-border/70 sm:grid-cols-2 xl:grid-cols-3">{observed.map(([key, value]) => <div key={key} className="bg-background p-3"><p className="font-mono text-[9px] uppercase tracking-[0.1em] text-muted-foreground">{key.replaceAll('_', ' ')}</p><p className="mt-1 font-mono text-sm font-semibold">{value.toLocaleString(undefined, { maximumFractionDigits: 3 })}</p></div>)}</div>;
}

type ScientificReference = {
  formulas: Array<{ label: string; expression: string }>;
  terms: Array<{ term: string; meaning: string }>;
};

function scientificReference(hop: Hop): ScientificReference {
  const references: Record<string, ScientificReference> = {
    'lc-quality': {
      formulas: [
        { label: 'Tỷ lệ giữ lại', expression: 'retention = valid cadences / input cadences × 100%' },
        { label: 'Cadence hợp lệ', expression: 'quality = 0 ∧ finite(time, flux) ∧ time > 0' },
      ],
      terms: [
        { term: 'Cadence', meaning: 'Một thời điểm lấy mẫu độ sáng.' },
        { term: 'Quality flag', meaning: 'Cờ TESS đánh dấu mẫu có nguy cơ bị lỗi thiết bị hoặc quan sát.' },
      ],
    },
    'tpf-quality': {
      formulas: [
        { label: 'Tỷ lệ giữ lại', expression: 'retention = valid image cadences / input cadences × 100%' },
        { label: 'Cadence hợp lệ', expression: 'quality = 0 ∧ finite(time) ∧ time > 0' },
      ],
      terms: [
        { term: 'TPF', meaning: 'Chuỗi ảnh pixel nhỏ quanh một mục tiêu TESS.' },
        { term: 'Image cadence', meaning: 'Một khung pixel tại một thời điểm quan sát.' },
      ],
    },
    'lc-transform': {
      formulas: [
        { label: 'Median normalization', expression: 'fᵢ = Fᵢ / median(F) − 1' },
        { label: 'Scatter', expression: 'scatter_ppm = stddev(f) × 10⁶' },
        { label: 'Sigma clipping', expression: 'reject i when |fᵢ| / stddev(f) > k' },
      ],
      terms: [
        { term: 'Scatter', meaning: 'Mức dao động của flux đã chuẩn hoá quanh 0; thấp thường ổn định hơn.' },
        { term: 'ppm', meaning: 'Parts per million; 10,000 ppm tương đương 1% biến thiên flux.' },
        { term: 'σ (sigma)', meaning: 'Một độ lệch chuẩn tính trên flux đã chuẩn hoá.' },
        { term: 'y = x', meaning: 'Đường không đổi; điểm dưới đường có scatter giảm sau clipping.' },
      ],
    },
    'tpf-transform': {
      formulas: [
        { label: 'Temporal normalization', expression: 'p′ₜⱼ = pₜⱼ / medianₜ(pⱼ) − 1' },
        { label: 'Finite-pixel fraction', expression: 'finite pixels / total pixels × 100%' },
      ],
      terms: [
        { term: 'Temporal median', meaning: 'Median theo thời gian của cùng một pixel trong cube.' },
        { term: 'Finite pixel', meaning: 'Giá trị pixel là số hữu hạn, không phải NaN hoặc ±Inf.' },
        { term: 'Drift', meaning: 'Sự thay đổi có hệ thống của chất lượng pixel theo thời gian.' },
      ],
    },
    'lc-parquet': materializationReference('Light Curve'),
    'tpf-parquet': materializationReference('Target Pixel'),
    silver: materializationReference('Silver'),
    checkpoint: {
      formulas: [{ label: 'Tỷ lệ hoàn tất', expression: 'completed checkpoints / total checkpoints × 100%' }],
      terms: [{ term: 'Checkpoint', meaning: 'Bằng chứng bền vững rằng artifact đã được xác minh và có thể resume an toàn.' }],
    },
    lineage: {
      formulas: [{ label: 'Tỷ lệ dung lượng', expression: 'Silver bytes / Bronze bytes' }],
      terms: [{ term: 'Lineage', meaning: 'Quan hệ truy vết từ FITS nguồn tới artifact Silver.' }],
    },
  };
  if (references[hop.id]) return references[hop.id];
  return {
    formulas: hop.formula ? [{ label: 'Phép tính chính', expression: hop.formula }] : [],
    terms: [
      { term: 'Input', meaning: hop.input },
      { term: 'Output', meaning: hop.output },
    ],
  };
}

function materializationReference(scope: string): ScientificReference {
  return {
    formulas: [
      { label: 'Compression ratio', expression: 'input bytes / output bytes' },
      { label: 'Mean artifact size', expression: 'total bytes / artifact count' },
    ],
    terms: [
      { term: `${scope} artifact`, meaning: 'Đối tượng Parquet đã ghi xong và được kiểm tra kích thước/checksum.' },
      { term: 'Compression ratio', meaning: 'Lớn hơn 1 nghĩa là dữ liệu lưu trữ nhỏ hơn đầu vào.' },
    ],
  };
}

function ScientificMethodCard({ hop }: { hop: Hop }): JSX.Element {
  const reference = scientificReference(hop);
  return <div className="space-y-2 rounded-lg border border-border/60 bg-muted/15 p-3">
    <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
      <Calculator className="size-3.5 text-primary" /> Phương pháp tính & thuật ngữ
    </span>
    {reference.formulas.length > 0 && <div className="space-y-1.5">{reference.formulas.map((formula) => <div key={formula.label} className="border border-border/50 bg-background p-2"><p className="text-[9px] uppercase text-muted-foreground">{formula.label}</p><p className="mt-0.5 overflow-x-auto whitespace-nowrap font-mono text-[11px] text-primary">{formula.expression}</p></div>)}</div>}
    <dl className="divide-y divide-border/50 border border-border/50 bg-background">{reference.terms.map((item) => <div key={item.term} className="px-2 py-1.5"><dt className="font-mono text-[10px] font-semibold text-foreground">{item.term}</dt><dd className="mt-0.5 text-[10px] leading-4 text-muted-foreground">{item.meaning}</dd></div>)}</dl>
  </div>;
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
      <DrawerContent portalContainer={portalContainer} className="h-[84svh] !max-h-[84svh] border-t-2 border-primary/40">
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
                  {mode === 'stream' ? 'Continuous mode' : 'Backlog mode'}
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

        <div className="min-h-0 flex-1 overflow-y-auto p-3 text-xs md:p-4">
          {selectedHop ? (
            <div className="grid min-h-full items-start gap-3 xl:grid-cols-[minmax(270px,0.22fr)_minmax(0,0.78fr)]">
              {/* Left Column: status, scientific goal, formulas and terminology */}
              <div className="space-y-2">
                {/* Status, Input, Output Cards */}
                <div className="grid gap-2 sm:grid-cols-3 xl:grid-cols-1">
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

                {/* Astronomy Goal */}
                <div className="bg-muted/15 p-3 rounded-lg border border-border/60 space-y-1.5">
                  <span className="text-muted-foreground uppercase tracking-wider text-[10px] font-bold flex items-center gap-1.5">
                    <FileText className="size-3.5 text-primary" /> Mục tiêu Khoa học Thiên văn
                  </span>
                  <p className="text-xs font-medium text-foreground leading-relaxed">
                    {selectedHop.astronomyGoal}
                  </p>
                </div>

                <ScientificMethodCard hop={selectedHop} />
              </div>

              {/* Right Column: large scientific visualizer */}
              <div className="min-h-[480px] bg-muted/15 p-3 rounded-lg border border-border/80 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/40 pb-2">
                  <div className="flex items-center gap-2 text-foreground font-semibold text-xs">
                    <Activity className="size-4 text-primary" />
                    <span>{selectedHop.shortTitle}</span>
                  </div>
                  <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-muted-foreground">Observed evidence only</span>
                </div>

                  {renderHopChart(selectedHop.id, mode, totalFiles, selectedHop.metrics, selectedHop.telemetry, selectedHop.scatter_points, selectedHop.materialization_points, selectedHop.encode_failures)}
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
