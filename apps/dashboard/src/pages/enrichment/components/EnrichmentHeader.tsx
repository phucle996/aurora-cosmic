import type { JSX } from 'react';
import { Sparkles } from 'lucide-react';

export function EnrichmentHeader(): JSX.Element {
  return (
    <section className="relative overflow-hidden border border-border/70 bg-card px-4 py-5 shadow-sm sm:px-6">
      <div className="pointer-events-none absolute inset-0 opacity-[0.18] [background-image:linear-gradient(to_right,var(--border)_1px,transparent_1px),linear-gradient(to_bottom,var(--border)_1px,transparent_1px)] [background-size:28px_28px]" />
      <div className="relative">
        <div className="mb-3 flex items-center gap-2 font-mono text-[10px] font-medium uppercase tracking-[0.18em] text-primary">
          <Sparkles className="size-4" aria-hidden="true" />
          Data Factory / Data Enrichment
        </div>
        <h2 className="font-heading text-2xl font-semibold tracking-tight md:text-3xl">Data Enrichment</h2>
        <p className="mt-2 text-sm leading-6 text-muted-foreground xl:whitespace-nowrap">
          Synthesize Silver light curves and TPFs with TIC/TOI catalogs into analysis-ready Gold features and anomaly projections.
        </p>
      </div>
    </section>
  );
}
