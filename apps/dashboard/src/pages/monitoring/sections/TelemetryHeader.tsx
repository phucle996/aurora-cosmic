import type { JSX } from 'react';
import { RefreshCw } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { components, timeRanges, type MonitoringStatus } from '../types';

interface TelemetryHeaderProps {
  activeComponent: string;
  groupName: string;
  componentName: string;
  containerName?: string;
  status?: MonitoringStatus;
  componentStatuses: Record<string, MonitoringStatus>;
  activeRangeId: string;
  autoRefresh: 'off' | '15s' | '30s' | '60s';
  loading: boolean;
  onSelectComponent: (componentId: string) => void;
  onRangeChange: (rangeId: string) => void;
  onAutoRefreshChange: (interval: 'off' | '15s' | '30s' | '60s') => void;
  onRefresh: () => void;
}

export function TelemetryHeader({
  activeComponent,
  groupName,
  componentName,
  containerName,
  status,
  componentStatuses,
  activeRangeId,
  autoRefresh,
  loading,
  onSelectComponent,
  onRangeChange,
  onAutoRefreshChange,
  onRefresh,
}: TelemetryHeaderProps): JSX.Element {
  const pipelineComponents = components.filter((c) => c.group === 'Pipeline');
  const platformComponents = components.filter((c) => c.group === 'Platform');

  const renderStatusDot = (s?: MonitoringStatus) => {
    switch (s) {
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

  const renderStatusBadge = (s?: MonitoringStatus) => {
    if (s === 'up') {
      return (
        <Badge
          variant="outline"
          className="rounded-none border-emerald-500/40 bg-emerald-500/10 font-mono text-[9px] uppercase text-emerald-500"
        >
          <span className="mr-1.5 size-1.5 rounded-full bg-emerald-500" />
          Healthy
        </Badge>
      );
    }
    if (s === 'degraded') {
      return (
        <Badge
          variant="outline"
          className="rounded-none border-amber-500/40 bg-amber-500/10 font-mono text-[9px] uppercase text-amber-500"
        >
          <span className="mr-1.5 size-1.5 rounded-full bg-amber-500" />
          Degraded
        </Badge>
      );
    }
    return (
      <Badge
        variant="outline"
        className="rounded-none border-muted-foreground/30 bg-muted/40 font-mono text-[9px] uppercase text-muted-foreground"
      >
        <span className="mr-1.5 size-1.5 rounded-full bg-muted-foreground" />
        No data
      </Badge>
    );
  };

  return (
    <Card className="rounded-none border-border/80 shadow-none">
      <CardHeader className="py-4">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
          {/* Left: Component selector dropdown + status + container info */}
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-primary">
                  Telemetry / {groupName}
                </span>
                {status ? renderStatusBadge(status) : null}
              </div>

              <div className="flex flex-wrap items-center gap-2.5 pt-0.5">
                <Select value={activeComponent} onValueChange={onSelectComponent}>
                  <SelectTrigger className="h-9 min-w-56 rounded-none font-mono text-xs bg-background border-border/80">
                    <SelectValue placeholder="Select component" />
                  </SelectTrigger>
                  <SelectContent className="rounded-none font-mono text-xs">
                    <SelectGroup>
                      <SelectLabel className="text-[10px] uppercase tracking-wider text-muted-foreground font-mono">
                        Pipeline Services
                      </SelectLabel>
                      {pipelineComponents.map((c) => {
                        const compStatus = componentStatuses[c.id] ?? (activeComponent === c.id ? status : undefined);
                        return (
                          <SelectItem key={c.id} value={c.id} className="cursor-pointer">
                            <span className="flex items-center gap-2">
                              <span className={`size-2 rounded-full ${renderStatusDot(compStatus)}`} />
                              <span className="font-medium">{c.label}</span>
                            </span>
                          </SelectItem>
                        );
                      })}
                    </SelectGroup>
                    <SelectSeparator />
                    <SelectGroup>
                      <SelectLabel className="text-[10px] uppercase tracking-wider text-muted-foreground font-mono">
                        Platform Services
                      </SelectLabel>
                      {platformComponents.map((c) => {
                        const compStatus = componentStatuses[c.id] ?? (activeComponent === c.id ? status : undefined);
                        return (
                          <SelectItem key={c.id} value={c.id} className="cursor-pointer">
                            <span className="flex items-center gap-2">
                              <span className={`size-2 rounded-full ${renderStatusDot(compStatus)}`} />
                              <span className="font-medium">{c.label}</span>
                            </span>
                          </SelectItem>
                        );
                      })}
                    </SelectGroup>
                  </SelectContent>
                </Select>

                {containerName && (
                  <span className="font-mono text-xs text-muted-foreground">
                    ({containerName})
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Right: Time ranges & live refresh */}
          <div className="flex flex-wrap items-center gap-2">
            {/* Range buttons */}
            <div className="flex border border-border/70 bg-background">
              {timeRanges.map((range) => (
                <button
                  key={range.id}
                  type="button"
                  aria-pressed={activeRangeId === range.id}
                  onClick={() => onRangeChange(range.id)}
                  className={`px-3 py-1.5 font-mono text-[10px] uppercase transition-colors ${
                    activeRangeId === range.id
                      ? 'bg-primary text-primary-foreground font-medium'
                      : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground'
                  }`}
                >
                  {range.label}
                </button>
              ))}
            </div>

            {/* Auto refresh */}
            <div className="flex items-center border border-border/70 bg-background">
              <span className="px-2 font-mono text-[9px] uppercase tracking-[0.08em] text-muted-foreground">
                Live:
              </span>
              {(['off', '15s', '30s', '60s'] as const).map((interval) => (
                <button
                  key={interval}
                  type="button"
                  onClick={() => onAutoRefreshChange(interval)}
                  className={`px-2 py-1.5 font-mono text-[10px] uppercase transition-colors ${
                    autoRefresh === interval
                      ? 'bg-primary/20 text-primary font-medium'
                      : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground'
                  }`}
                >
                  {interval === 'off' ? 'Off' : interval}
                </button>
              ))}
            </div>

            {/* Refresh button */}
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onRefresh}
              disabled={loading}
              className="h-8 rounded-none border-border/70 px-2.5 font-mono text-[10px] uppercase gap-1.5"
            >
              <RefreshCw className={`size-3 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
          </div>
        </div>
      </CardHeader>
    </Card>
  );
}
