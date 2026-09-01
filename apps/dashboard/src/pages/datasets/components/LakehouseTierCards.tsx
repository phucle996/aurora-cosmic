import type { JSX } from 'react';
import { CheckCircle2, Database, Sparkles, TableProperties } from 'lucide-react';

import { Progress } from '@/components/ui/progress';
import { formatBytes, type StorageListing } from '@/features/datasets/types';

interface LakehouseTierCardsProps {
  activeTab: 'bronze' | 'silver' | 'gold';
  onTabChange: (tab: 'bronze' | 'silver' | 'gold') => void;
  bronzeData: StorageListing | null;
  silverData: StorageListing | null;
  goldData: StorageListing | null;
}

export function LakehouseTierCards({
  activeTab,
  onTabChange,
  bronzeData,
  silverData,
  goldData,
}: LakehouseTierCardsProps): JSX.Element {
  // Rolling storage budget for Bronze (100 GiB max policy)
  const bronzeBufferCapacity = 100 * 1024 * 1024 * 1024;
  const bronzeUsedPercent = Math.min(
    100,
    Math.round(((bronzeData?.total_bytes ?? 0) / bronzeBufferCapacity) * 100),
  );

  return (
    <section aria-label="Lakehouse tier inventory" className="grid gap-px overflow-hidden border border-border/70 bg-border/70 md:grid-cols-3">
      <button type="button" aria-pressed={activeTab === 'bronze'} onClick={() => onTabChange('bronze')} className={`min-w-0 p-4 text-left transition-colors sm:p-5 ${activeTab === 'bronze' ? 'bg-primary/[0.07]' : 'bg-background/80 hover:bg-muted/40'}`}>
        <div className="flex items-start justify-between gap-3"><div className="flex items-center gap-2"><Database className="size-4 text-primary" /><span className="font-mono text-[10px] uppercase tracking-[0.14em] text-primary">01 / source</span></div><span className="font-mono text-[10px] uppercase text-muted-foreground">Raw FITS</span></div>
        <p className="mt-4 text-sm font-medium text-foreground">Bronze observations</p>
        <div className="mt-1 flex items-baseline justify-between gap-3"><span className="font-mono text-2xl font-semibold tabular-nums">{(bronzeData?.total ?? 0).toLocaleString()}</span><span className="font-mono text-xs text-muted-foreground">{formatBytes(bronzeData?.total_bytes ?? 0)}</span></div>
        <div className="mt-4 space-y-1.5"><div className="flex justify-between font-mono text-[9px] uppercase tracking-[0.08em] text-muted-foreground"><span>100 GiB rolling buffer</span><span>{bronzeUsedPercent}%</span></div><Progress value={bronzeUsedPercent} className="h-1" /></div>
      </button>

      <button type="button" aria-pressed={activeTab === 'silver'} onClick={() => onTabChange('silver')} className={`min-w-0 p-4 text-left transition-colors sm:p-5 ${activeTab === 'silver' ? 'bg-primary/[0.07]' : 'bg-background/80 hover:bg-muted/40'}`}>
        <div className="flex items-start justify-between gap-3"><div className="flex items-center gap-2"><TableProperties className="size-4 text-primary" /><span className="font-mono text-[10px] uppercase tracking-[0.14em] text-primary">02 / prepared</span></div><span className="font-mono text-[10px] uppercase text-muted-foreground">Parquet</span></div>
        <p className="mt-4 text-sm font-medium text-foreground">Silver time series</p>
        <div className="mt-1 flex items-baseline justify-between gap-3"><span className="font-mono text-2xl font-semibold tabular-nums">{(silverData?.total ?? 0).toLocaleString()}</span><span className="font-mono text-xs text-muted-foreground">{formatBytes(silverData?.total_bytes ?? 0)}</span></div>
        <div className="mt-4 flex items-center gap-2 font-mono text-[9px] uppercase tracking-[0.08em] text-muted-foreground"><CheckCircle2 className="size-3.5 text-primary" /><span>Quality + lineage contract</span></div>
      </button>

      <button type="button" aria-pressed={activeTab === 'gold'} onClick={() => onTabChange('gold')} className={`min-w-0 p-4 text-left transition-colors sm:p-5 ${activeTab === 'gold' ? 'bg-primary/[0.07]' : 'bg-background/80 hover:bg-muted/40'}`}>
        <div className="flex items-start justify-between gap-3"><div className="flex items-center gap-2"><Sparkles className="size-4 text-primary" /><span className="font-mono text-[10px] uppercase tracking-[0.14em] text-primary">03 / features</span></div><span className="font-mono text-[10px] uppercase text-muted-foreground">ML input</span></div>
        <p className="mt-4 text-sm font-medium text-foreground">Gold feature store</p>
        <div className="mt-1 flex items-baseline justify-between gap-3"><span className="font-mono text-2xl font-semibold tabular-nums">{(goldData?.total ?? 0).toLocaleString()}</span><span className="font-mono text-xs text-muted-foreground">{formatBytes(goldData?.total_bytes ?? 0)}</span></div>
        <div className="mt-4 flex items-center gap-2 font-mono text-[9px] uppercase tracking-[0.08em] text-muted-foreground"><Sparkles className="size-3.5 text-primary" /><span>Versioned feature snapshots</span></div>
      </button>
    </section>
  );
}
