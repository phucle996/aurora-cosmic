import type { JSX } from 'react';
import { RadioTower } from 'lucide-react';

export function MonitoringHero(): JSX.Element {
  return (
    <section className="relative overflow-hidden border border-border/70 bg-card px-4 py-5 shadow-sm sm:px-6">
      <div className="pointer-events-none absolute inset-0 opacity-[0.18] [background-image:linear-gradient(to_right,var(--border)_1px,transparent_1px),linear-gradient(to_bottom,var(--border)_1px,transparent_1px)] [background-size:28px_28px]" />
      <div className="relative flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          <div className="mb-3 flex items-center gap-2 font-mono text-[10px] font-medium uppercase tracking-[0.18em] text-primary">
            <RadioTower className="size-4" aria-hidden="true" />
            Observatory / Prometheus signal plane
          </div>
          <h2 className="font-heading text-2xl font-semibold tracking-tight md:text-3xl">Monitoring</h2>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            Observe real-time pipeline runtimes, storage layers, and platform services from native Prometheus telemetry.
          </p>
        </div>
      </div>
    </section>
  );
}
