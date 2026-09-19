import type { JSX } from 'react';
import { RefreshCw } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { timeRanges, type MonitoringStatus } from '../types';

interface TelemetryHeaderProps {
  groupName: string;
  componentName: string;
  containerName?: string;
  status?: MonitoringStatus;
  activeRangeId: string;
  autoRefresh: 'off' | '15s' | '30s' | '60s';
  loading: boolean;
  onRangeChange: (rangeId: string) => void;
  onAutoRefreshChange: (interval: 'off' | '15s' | '30s' | '60s') => void;
  onRefresh: () => void;
}

export function TelemetryHeader({
  groupName,
  componentName,
  containerName,
  status,
  activeRangeId,
  autoRefresh,
  loading,
  onRangeChange,
  onAutoRefreshChange,
  onRefresh,
}: TelemetryHeaderProps): JSX.Element {
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
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-primary">
                Telemetry / {groupName}
              </p>
              {status ? renderStatusBadge(status) : null}
            </div>
            <CardTitle className="mt-1 text-xl">{componentName}</CardTitle>
            <CardDescription className="font-mono text-xs text-muted-foreground">
              {containerName ?? 'Component metadata unavailable'}
            </CardDescription>
          </div>

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
                  {interval}
                </button>
              ))}
            </div>

            {/* Refresh button */}
            <Button
              variant="outline"
              size="sm"
              onClick={onRefresh}
              disabled={loading}
              className="h-8 rounded-none font-mono text-[10px] uppercase tracking-[0.08em]"
            >
              <RefreshCw className={`mr-1.5 size-3.5 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
          </div>
        </div>
      </CardHeader>
    </Card>
  );
}
