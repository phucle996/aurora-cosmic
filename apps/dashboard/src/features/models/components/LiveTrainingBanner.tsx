import { type JSX } from 'react';
import { BrainCircuit, LoaderCircle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import type { ActiveTrainingState } from '../types';

interface LiveTrainingBannerProps {
  activeTraining: ActiveTrainingState;
  trainingElapsed: number;
}

export function LiveTrainingBanner({
  activeTraining,
  trainingElapsed,
}: LiveTrainingBannerProps): JSX.Element {
  return (
    <div className="relative overflow-hidden rounded-xl border border-primary/50 bg-gradient-to-r from-primary/15 via-purple-500/10 to-primary/5 p-4 shadow-lg shadow-primary/5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-start sm:items-center gap-3">
          <div className="relative flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/20 text-primary border border-primary/40">
            <BrainCircuit className="size-5 animate-pulse text-primary" />
            <span className="absolute -top-1 -right-1 flex size-3">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full size-3 bg-emerald-500"></span>
            </span>
          </div>
          <div className="space-y-0.5">
            <div className="flex items-center gap-2">
              <h4 className="text-sm font-semibold text-foreground flex items-center gap-1.5">
                ⚡ {activeTraining.computeTarget?.toUpperCase() || 'GPU'} Worker đang huấn luyện Deep Neural Network
              </h4>
              <Badge variant="outline" className="bg-primary/20 text-primary border-primary/40 text-[10px] animate-pulse font-mono">
                Đang chạy: {trainingElapsed}s
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground">
              Đang xử lý & gộp <strong className="text-foreground">{activeTraining.snapshotCount} Gold Snapshots</strong> • Epochs: <strong className="text-foreground">{activeTraining.epochs}</strong> • Compute: <strong className="text-foreground">{activeTraining.computeTarget?.toUpperCase() || 'GPU'}</strong> • Base: <span className="font-mono text-primary">{activeTraining.baseModel || 'Scratch'}</span> • AdamW + Cosine Annealing LR
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <LoaderCircle className="size-4 animate-spin text-primary" />
          <span className="text-xs text-muted-foreground font-mono">Tự động nạp khi hoàn tất...</span>
        </div>
      </div>
      {/* Subtle animated progress indicator */}
      <div className="absolute bottom-0 left-0 h-1 bg-gradient-to-r from-primary via-emerald-400 to-primary w-full animate-pulse opacity-80" />
    </div>
  );
}
