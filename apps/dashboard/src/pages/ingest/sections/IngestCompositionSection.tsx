import type { JSX } from 'react';
import type { IngestKindSummary } from '../types';

interface ProductKindItem {
  key: string;
  label: string;
  summary?: IngestKindSummary;
}

interface IngestCompositionSectionProps {
  productKinds: ProductKindItem[];
  observed?: boolean;
}

export function IngestCompositionSection({
  productKinds,
  observed,
}: IngestCompositionSectionProps): JSX.Element {
  return (
    <section className="grid gap-3 md:grid-cols-2">
      <div className="border border-border/70 bg-card p-4">
        <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-primary">Sample composition</p>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {productKinds.map(({ key, label, summary }) => (
            <div key={key} className="border-l-2 border-primary/60 bg-muted/20 px-3 py-2.5">
              <div className="flex justify-between gap-2 text-xs">
                <span className="font-medium text-foreground">{label}</span>
                <span className="font-mono text-muted-foreground">
                  {summary?.completed ?? 0}/{summary?.planned ?? 0}
                </span>
              </div>
              <p className="mt-1 text-[11px] text-muted-foreground">
                {summary?.downloading ?? 0} active · {summary?.failed ?? 0} failed
              </p>
            </div>
          ))}
        </div>
      </div>
      <div className="border border-border/70 bg-card p-4">
        <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-primary">Acquisition conditions</p>
        <div className="mt-3 grid gap-3 text-xs">
          <div>
            <p className="text-muted-foreground">Checkpoint status</p>
            <p className="mt-1 font-mono text-foreground">{observed ? 'OBSERVED' : 'AWAITING SIGNAL'}</p>
          </div>
        </div>
      </div>
    </section>
  );
}
