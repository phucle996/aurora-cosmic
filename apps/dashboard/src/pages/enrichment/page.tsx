import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { JSX } from 'react';
import { AlertCircle } from 'lucide-react';

import { apiBase, apiFetch } from '@/lib/api';
import { useRunnerTicket } from '@/lib/session';
import type { PipelineRunDetail } from '@/pages/runner-tickets/types';
import { CONFIG_KEY, loadLocalConfig } from './constants';
import type { ConnectionState, EventRow, GoldControlOverview, GoldLiveEvent, GoldWorkerTelemetry } from './types';
import {
  AssemblySequenceCard,
  EnrichmentControlCard,
  EnrichmentHeader,
  EnrichmentStatStrip,
  MaterializedSnapshotsTable,
  SynthesisActivityLog,
} from './components';

export default function EnrichmentPage(): JSX.Element {
  const { activeTicket, setActiveTicket, tickets } = useRunnerTicket();
  const initialConfig = useMemo(loadLocalConfig, []);
  const [overview, setOverview] = useState<GoldControlOverview | null>(null);
  const [runDetail, setRunDetail] = useState<PipelineRunDetail | null>(null);
  const [mode, setMode] = useState(initialConfig.mode);
  const [maxBatchRecords, setMaxBatchRecords] = useState(initialConfig.maxBatchRecords);
  const [idleFlushSeconds, setIdleFlushSeconds] = useState(initialConfig.idleFlushSeconds);
  const [liveWorkers, setLiveWorkers] = useState<Record<string, GoldWorkerTelemetry>>({});
  const [eventRows, setEventRows] = useState<EventRow[]>([]);
  const [pausedFeed, setPausedFeed] = useState(false);
  const pausedFeedRef = useRef(false);
  pausedFeedRef.current = pausedFeed;
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [connection, setConnection] = useState<ConnectionState>('connecting');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const latestOverview = useRef<GoldControlOverview | null>(null);
  const overviewRequestInFlight = useRef(false);
  const historyRequestInFlight = useRef(false);

  const copyId = useCallback((id: string) => {
    void navigator.clipboard.writeText(id);
    setCopiedId(id);
    setTimeout(() => {
      setCopiedId((current) => (current === id ? null : current));
    }, 2000);
  }, []);

  const loadOverview = useCallback(async (): Promise<GoldControlOverview | null> => {
    if (overviewRequestInFlight.current) return latestOverview.current;
    overviewRequestInFlight.current = true;
    try {
      const next = await apiFetch<GoldControlOverview>('/v1/enrichment/control');
      latestOverview.current = next;
      setOverview(next);
      setError(null);
      return next;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Enrichment control plane observation unavailable');
      return null;
    } finally {
      overviewRequestInFlight.current = false;
    }
  }, []);

  const loadHistory = useCallback(async (commandID?: string): Promise<void> => {
    if (!commandID) {
      setRunDetail(null);
      return;
    }
    if (historyRequestInFlight.current) return;
    historyRequestInFlight.current = true;
    setHistoryLoading(true);
    try {
      setRunDetail(await apiFetch<PipelineRunDetail>(`/v1/data-factory/runs/${encodeURIComponent(commandID)}`));
    } catch {
      setRunDetail(null);
    } finally {
      historyRequestInFlight.current = false;
      setHistoryLoading(false);
    }
  }, []);

  useEffect(() => {
    window.localStorage.setItem(CONFIG_KEY, JSON.stringify({ mode, maxBatchRecords, idleFlushSeconds }));
  }, [idleFlushSeconds, maxBatchRecords, mode]);

  useEffect(() => {
    void loadOverview();
    const stream = new EventSource(`${apiBase}/v1/events?topic=${encodeURIComponent(`gold:${activeTicket}`)}&topic=gold`);
    stream.onopen = () => setConnection('live');
    stream.onerror = () => setConnection('reconnecting');
    stream.addEventListener('ready', () => setConnection('live'));
    stream.addEventListener('workflow', (rawEvent) => {
      try {
        const message = JSON.parse((rawEvent as MessageEvent<string>).data) as GoldLiveEvent;
        const payload = message.payload;
        if (payload?.runtime) {
          setOverview((current) => {
            if (!current) return current;
            const next = { ...current, runtime: payload.runtime };
            latestOverview.current = next;
            return next;
          });
        }
        if (payload?.worker) {
          const worker = payload.worker;
          setLiveWorkers((current) => ({ ...current, [worker.worker_id]: worker }));
          const eventID = `${worker.worker_id}:${worker.updated_at}:${worker.action}`;
          if (!pausedFeedRef.current) {
            setEventRows((current) => current.some((row) => row.id === eventID)
              ? current
              : [{ id: eventID, worker, observedAt: payload.occurred_at ?? message.occurred_at ?? worker.updated_at }, ...current].slice(0, 80));
          }
          if (worker.action === 'SNAPSHOT_COMMITTED') void loadHistory(worker.ticket_id || worker.command_id);
        }
      } catch {
        // Malformed live messages never replace the durable runtime snapshot.
      }
    });
    const interval = setInterval(() => {
      void loadOverview();
    }, 5000);
    return () => {
      clearInterval(interval);
      stream.close();
    };
  }, [loadHistory, loadOverview, activeTicket]);

  useEffect(() => {
    void loadHistory(overview?.control.ticket_id || overview?.control.command_id);
  }, [loadHistory, overview?.control.ticket_id, overview?.control.command_id, overview?.runtime?.last_snapshot_id]);

  const start = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await apiFetch('/v1/enrichment/control/start', {
        method: 'POST',
        body: JSON.stringify({ mode, max_batch_records: maxBatchRecords, idle_flush_seconds: idleFlushSeconds, ticket_id: activeTicket }),
      });
      await loadOverview();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Failed to launch Enrichment run');
    } finally {
      setBusy(false);
    }
  };

  const stop = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await apiFetch('/v1/enrichment/control/stop', { method: 'POST' });
      await loadOverview();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Failed to freeze Enrichment Builder');
    } finally {
      setBusy(false);
    }
  };

  const runtime = overview?.runtime;
  const readiness = runtime?.readiness;
  const catalog = runtime?.catalog_sync;
  const isFrozen = overview?.control.mode === 'PAUSED';
  const runtimeState = runtime?.state ?? (isFrozen ? 'FROZEN' : 'IDLE');

  const workers = useMemo(() => {
    const merged = new Map<string, GoldWorkerTelemetry>();
    for (const worker of runtime?.workers ?? []) merged.set(worker.worker_id, worker);
    for (const worker of Object.values(liveWorkers)) merged.set(worker.worker_id, worker);
    return [...merged.values()].sort((left, right) => left.worker_id.localeCompare(right.worker_id));
  }, [liveWorkers, runtime?.workers]);

  const activeWorkers = workers.filter((worker) => worker.lifecycle !== 'KILLED').length;
  const latestBatches = [...(runDetail?.batches ?? [])].reverse().slice(0, 8);
  const observedRun = runDetail?.run;

  const pendingTotal = runtime?.pending_total ?? 0;
  const readyLightcurves = readiness?.ready_lightcurves ?? 0;
  const missingTpf = readiness?.missing_tpf ?? 0;
  const activeBuilds = runtime?.active_builds ?? 0;
  const lastSnapshotId = runtime?.last_snapshot_id;
  const totalInputObserved = pendingTotal + (observedRun?.input_records ? Number(observedRun.input_records) : 0);
  const completedInputRows = observedRun?.input_records ? Number(observedRun.input_records) : 0;
  const synthesisPercent = totalInputObserved > 0 ? Math.min(100, (completedInputRows / totalInputObserved) * 100) : (lastSnapshotId ? 100 : 0);

  const catalogDetail = useMemo(() => {
    if (!catalog) return 'No catalog sync record';
    if (catalog.error) return `Error: ${catalog.error}`;
    if (catalog.tic_records > 0 || catalog.toi_records > 0) {
      const hitLabel = catalog.cache_hit ? 'cache hit' : 'synced';
      return `${catalog.target_count} targets · ${catalog.tic_records.toLocaleString()} TIC / ${catalog.toi_records.toLocaleString()} TOI (${hitLabel})`;
    }
    return `${catalog.target_count ?? 0} TIC / TOI targets indexed`;
  }, [catalog]);

  const catalogTooltip = catalog
    ? `State: ${catalog.state} | Targets: ${catalog.target_count} | TIC Records: ${catalog.tic_records.toLocaleString()} | TOI Records: ${catalog.toi_records.toLocaleString()} | Cache Hit: ${catalog.cache_hit ? 'YES' : 'NO'}${catalog.error ? ` | Error: ${catalog.error}` : ''}`
    : undefined;

  return (
    <div className="space-y-5 pb-6">
      <EnrichmentHeader />

      {error && (
        <div className="flex items-start gap-3 border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
          <AlertCircle className="mt-0.5 size-4 shrink-0" />
          <div>
            <p className="font-medium">Observation Link Interrupted</p>
            <p className="mt-0.5 text-xs">{error}</p>
          </div>
        </div>
      )}

      <EnrichmentStatStrip
        pendingTotal={pendingTotal}
        readyLightcurves={readyLightcurves}
        missingTpf={missingTpf}
        lastSnapshotId={lastSnapshotId}
        catalogState={catalog?.state}
        catalogDetail={catalogDetail}
        catalogTooltip={catalogTooltip}
        activeWorkers={activeWorkers}
        activeBuilds={activeBuilds}
      />

      <section className="grid min-w-0 gap-5 xl:grid-cols-[minmax(0,1.45fr)_minmax(19rem,0.7fr)]">
        <AssemblySequenceCard
          runtimeState={runtimeState}
          synthesisPercent={synthesisPercent}
          readyLightcurves={readyLightcurves}
          pendingTotal={pendingTotal}
          workers={workers}
          nextFlushAt={runtime?.next_flush_at}
          connection={connection}
        />

        <EnrichmentControlCard
          activeTicket={activeTicket}
          setActiveTicket={setActiveTicket}
          tickets={tickets}
          mode={mode}
          setMode={setMode}
          maxBatchRecords={maxBatchRecords}
          setMaxBatchRecords={setMaxBatchRecords}
          idleFlushSeconds={idleFlushSeconds}
          setIdleFlushSeconds={setIdleFlushSeconds}
          busy={busy}
          isFrozen={isFrozen}
          onStart={start}
          onStop={stop}
          runtimeState={runtimeState}
          lastSignalAt={runtime?.updated_at}
        />
      </section>

      <SynthesisActivityLog
        eventRows={eventRows}
        pausedFeed={pausedFeed}
        onTogglePause={() => setPausedFeed((prev) => !prev)}
        onClear={() => setEventRows([])}
      />

      <MaterializedSnapshotsTable
        batches={latestBatches}
        historyLoading={historyLoading}
        runStatus={observedRun?.status}
        copiedId={copiedId}
        onCopyId={copyId}
      />
    </div>
  );
}
