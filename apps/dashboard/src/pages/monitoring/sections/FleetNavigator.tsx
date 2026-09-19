import type { JSX } from 'react';
import { components, type MonitoringStatus } from '../types';

interface FleetNavigatorProps {
  activeTab: string;
  selectedStatus?: MonitoringStatus;
  componentStatuses: Record<string, MonitoringStatus>;
  onSelectComponent: (componentId: string) => void;
}

export function FleetNavigator({
  activeTab,
  selectedStatus,
  componentStatuses,
  onSelectComponent,
}: FleetNavigatorProps): JSX.Element {
  const pipelineComponents = components.filter((c) => c.group === 'Pipeline');
  const platformComponents = components.filter((c) => c.group === 'Platform');

  const renderStatusDot = (status?: MonitoringStatus) => {
    switch (status) {
      case 'up':
        return 'bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.5)]';
      case 'degraded':
        return 'bg-amber-500 shadow-[0_0_6px_rgba(245,158,11,0.5)]';
      case 'no_data':
        return 'bg-rose-500';
      default:
        return 'bg-muted-foreground/40';
    }
  };

  return (
    <div className="border border-border/80 bg-card p-4 sm:p-5">
      <div className="space-y-3.5">
        {/* Pipeline Services */}
        <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center">
          <span className="w-20 shrink-0 font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-primary">
            Pipeline
          </span>
          <div className="flex flex-wrap gap-1.5">
            {pipelineComponents.map((c) => {
              const isActive = activeTab === c.id;
              const status = componentStatuses[c.id] ?? (isActive ? selectedStatus : undefined);
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => onSelectComponent(c.id)}
                  aria-pressed={isActive}
                  className={`flex items-center gap-2 border px-3 py-1.5 font-mono text-xs transition-colors ${
                    isActive
                      ? 'border-primary bg-primary/[0.08] text-primary font-medium'
                      : 'border-border/70 bg-background/80 text-muted-foreground hover:border-border hover:bg-muted/40 hover:text-foreground'
                  }`}
                >
                  <span className={`size-2 shrink-0 rounded-full ${renderStatusDot(status)}`} />
                  <span>{c.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Platform Services */}
        <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center">
          <span className="w-20 shrink-0 font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            Platform
          </span>
          <div className="flex flex-wrap gap-1.5">
            {platformComponents.map((c) => {
              const isActive = activeTab === c.id;
              const status = componentStatuses[c.id] ?? (isActive ? selectedStatus : undefined);
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => onSelectComponent(c.id)}
                  aria-pressed={isActive}
                  className={`flex items-center gap-2 border px-3 py-1.5 font-mono text-xs transition-colors ${
                    isActive
                      ? 'border-primary bg-primary/[0.08] text-primary font-medium'
                      : 'border-border/70 bg-background/80 text-muted-foreground hover:border-border hover:bg-muted/40 hover:text-foreground'
                  }`}
                >
                  <span className={`size-2 shrink-0 rounded-full ${renderStatusDot(status)}`} />
                  <span>{c.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
