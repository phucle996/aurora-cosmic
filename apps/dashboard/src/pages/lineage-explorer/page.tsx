import type { JSX } from 'react';
import { GitBranch, Network } from 'lucide-react';

import { LineageExplorerConsole } from './components/LineageExplorerConsole';

export default function LineageExplorerPage(): JSX.Element {
  return (
    <div className="space-y-5 pb-6">
      <section className="relative overflow-hidden border border-border/70 bg-card px-4 py-5 shadow-none sm:px-6">
        <div className="pointer-events-none absolute inset-0 opacity-[0.18] [background-image:linear-gradient(to_right,var(--border)_1px,transparent_1px),linear-gradient(to_bottom,var(--border)_1px,transparent_1px)] [background-size:28px_28px]" />
        <div className="relative flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="min-w-0">
            <div className="mb-3 flex items-center gap-2 font-mono text-[10px] font-medium uppercase tracking-[0.18em] text-primary">
              <GitBranch className="size-4" aria-hidden="true" />
              Provenance observatory / immutable evidence
            </div>
            <h2 className="font-heading text-2xl font-semibold tracking-tight md:text-3xl">Lineage Explorer</h2>
            <p className="mt-2 max-w-4xl text-sm leading-6 text-muted-foreground">
              Truy vết từng FITS product từ NASA MAST qua Bronze, Rust preprocessing, Silver Parquet và Gold manifest bằng evidence đã lưu trữ.
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2 border border-primary/25 bg-primary/5 px-3 py-2 font-mono text-[10px] uppercase tracking-[0.12em] text-primary">
            <Network className="size-3.5" aria-hidden="true" />
            Source → Bronze → Silver → Gold
          </div>
        </div>
      </section>

      <LineageExplorerConsole />
    </div>
  );
}
