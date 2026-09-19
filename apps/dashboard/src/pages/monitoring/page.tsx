import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { JSX } from 'react';
import { useSearchParams } from 'react-router-dom';

import { apiFetch } from '@/lib/api';

import { MonitoringHero } from './sections/MonitoringHero';
import { TelemetryGrid } from './sections/TelemetryGrid';
import { TelemetryHeader } from './sections/TelemetryHeader';
import {
  components,
  timeRanges,
  type MonitoringResponse,
  type MonitoringStatus,
} from './types';

export default function MonitoringPage(): JSX.Element {
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedComponent = searchParams.get('component') ?? searchParams.get('tab') ?? components[0].id;
  const activeComponent = components.some((c) => c.id === requestedComponent) ? requestedComponent : components[0].id;
  const requestedRange = searchParams.get('range') ?? '1h';
  const activeRange = timeRanges.find((range) => range.id === requestedRange) ?? timeRanges[1];

  const [response, setResponse] = useState<MonitoringResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState<'off' | '15s' | '30s' | '60s'>('30s');
  const [componentStatuses, setComponentStatuses] = useState<Record<string, MonitoringStatus>>({});

  const requestSequence = useRef(0);

  const componentMeta = useMemo(
    () => components.find((c) => c.id === activeComponent) ?? components[0],
    [activeComponent],
  );
  const selected = response?.components[0];
  const displayedMeta = components.find((c) => c.id === selected?.id) ?? componentMeta;

  const load = useCallback(async (): Promise<void> => {
    const requestID = ++requestSequence.current;
    setLoading(true);
    setError(null);
    try {
      const payload = await apiFetch<MonitoringResponse>(
        `/v1/monitoring?component=${encodeURIComponent(activeComponent)}&range=${encodeURIComponent(activeRange.id)}&step=${activeRange.step}`,
      );
      if (requestID === requestSequence.current) {
        setResponse(payload);
        if (payload.components.length > 0) {
          setComponentStatuses((prev) => {
            const next = { ...prev };
            for (const comp of payload.components) {
              next[comp.id] = comp.status;
            }
            return next;
          });
        }
      }
    } catch (requestError) {
      if (requestID === requestSequence.current) {
        setError(requestError instanceof Error ? requestError.message : 'Prometheus telemetry query failed');
      }
    } finally {
      if (requestID === requestSequence.current) setLoading(false);
    }
  }, [activeComponent, activeRange.id, activeRange.step]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (autoRefresh === 'off') return;
    const intervalMs = autoRefresh === '15s' ? 15000 : autoRefresh === '30s' ? 30000 : 60000;
    const timer = setInterval(() => {
      void load();
    }, intervalMs);
    return () => clearInterval(timer);
  }, [autoRefresh, load]);

  const updateQuery = (key: 'component' | 'range', value: string): void => {
    const next = new URLSearchParams(searchParams);
    next.set(key, value);
    if (key === 'component') {
      next.delete('tab');
    }
    setSearchParams(next);
  };

  return (
    <div className="space-y-5 pb-6">
      <MonitoringHero />

      <TelemetryHeader
        activeComponent={activeComponent}
        groupName={displayedMeta.group}
        componentName={selected?.name ?? componentMeta.label}
        containerName={selected?.container}
        status={selected?.status}
        componentStatuses={componentStatuses}
        activeRangeId={activeRange.id}
        autoRefresh={autoRefresh}
        loading={loading}
        onSelectComponent={(componentId) => updateQuery('component', componentId)}
        onRangeChange={(rangeId) => updateQuery('range', rangeId)}
        onAutoRefreshChange={setAutoRefresh}
        onRefresh={() => void load()}
      />

      <TelemetryGrid
        selected={selected}
        loading={loading}
        error={error}
        componentLabel={displayedMeta.label}
        onRetry={() => void load()}
      />
    </div>
  );
}
