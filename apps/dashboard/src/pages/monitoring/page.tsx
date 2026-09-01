import type { JSX } from 'react';
import { Activity, RadioTower } from 'lucide-react';

import HealthSection from './sections/HealthSection';

export default function MonitoringPage(): JSX.Element {
  return (
    <div className="space-y-5 pb-6">
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
              Quan sát pipeline, platform services và systemd workloads từ metric series do backend cung cấp.
            </p>
          </div>
          <div className="flex w-fit items-center gap-2 border border-border/70 bg-background/60 px-3 py-2 font-mono text-[10px] uppercase tracking-[0.1em] text-muted-foreground">
            <Activity className="size-3.5 text-primary" />
            Source / Prometheus
          </div>
        </div>
      </section>

      <HealthSection />
    </div>
  );
}
