import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent, JSX } from 'react';
import { AlertCircle } from 'lucide-react';
import { RunnerTicketBar } from '@/components/RunnerTicketBar';
import { useRunnerTicket } from '@/lib/session';
import { apiBase, apiFetch } from '@/lib/api';

import type { IngestControlJob, IngestStatus, PlanningSignal, WorkerSignal } from './types';
import { IngestHeroSection } from './sections/IngestHeroSection';
import { IngestMetricCardsSection } from './sections/IngestMetricCardsSection';
import { IngestWorkerTelemetrySection } from './sections/IngestWorkerTelemetrySection';
import { IngestControlSection } from './sections/IngestControlSection';
import { IngestProductTableSection } from './sections/IngestProductTableSection';

const SECTOR_STORAGE_KEY = 'aurora.ingest.sector';
const CONCURRENCY_STORAGE_KEY = 'aurora.ingest.concurrency';

export default function IngestPage(): JSX.Element {
  const { activeTicket } = useRunnerTicket();
  const [status, setStatus] = useState<IngestStatus | null>(null);
  const [, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [controlJob, setControlJob] = useState<IngestControlJob | null>(null);
  const [sector, setSector] = useState(() => {
    if (typeof window === 'undefined') return '1';
    const savedSector = window.localStorage.getItem(SECTOR_STORAGE_KEY);
    const value = Number(savedSector);
    return Number.isInteger(value) && value >= 1 && value <= 100 ? String(value) : '1';
  });
  const [concurrency, setConcurrency] = useState(() => {
    if (typeof window === 'undefined') return '8';
    const savedConcurrency = window.localStorage.getItem(CONCURRENCY_STORAGE_KEY);
    const value = Number(savedConcurrency);
    return Number.isInteger(value) && value >= 1 && value <= 32 ? String(value) : '8';
  });
  const [controlBusy, setControlBusy] = useState(false);
  const [planningSignal, setPlanningSignal] = useState<PlanningSignal | null>(null);
  const [workerSignals, setWorkerSignals] = useState<Record<number, WorkerSignal>>({});
  const loadInFlight = useRef<Promise<void> | null>(null);

  const load = useCallback(() => {
    if (loadInFlight.current) return loadInFlight.current;
    const request = (async () => {
      setError(null);
      try {
        const nextStatus = await apiFetch<IngestStatus>('/v1/ingest/status?products_limit=100');
        setStatus(nextStatus);
      } catch (requestError) {
        setError(requestError instanceof Error ? requestError.message : 'Failed to load ingest status');
      } finally {
        setLoading(false);
        loadInFlight.current = null;
      }
    })();
    loadInFlight.current = request;
    return request;
  }, []);

  useEffect(() => {
    void load();

    const sseTopic = activeTicket ? `ingest:${activeTicket}` : 'ingest';
    const eventSource = new EventSource(`${apiBase}/v1/events?topic=${encodeURIComponent(sseTopic)}`);
    eventSource.addEventListener('ready', () => {
      void load();
    });
    eventSource.addEventListener('workflow', (event) => {
      let consumedRuntimeProgress = false;
      try {
        const message = JSON.parse((event as MessageEvent<string>).data) as {
          status?: string;
          occurred_at?: string;
          payload?: {
            status?: string;
            planning_stage?: string;
            planning_completed?: number;
            planning_total?: number;
            planning_products?: number;
            worker_id?: number;
            product_id?: string;
            product_kind?: string;
            product_bytes?: number;
            product_expected_bytes?: number;
            occurred_at?: string;
          };
        };
        const runtimeStatus = message.payload?.status ?? message.status;
        if (runtimeStatus === 'planning') {
          const signal = {
            stage: message.payload?.planning_stage,
            completed: message.payload?.planning_completed,
            total: message.payload?.planning_total,
            products: message.payload?.planning_products,
            occurredAt: message.payload?.occurred_at ?? message.occurred_at,
          };
          setPlanningSignal(signal);
          if (signal.stage === 'DISCOVERING_MAST_TARGETS' || signal.stage === 'RESOLVING_MAST_PRODUCTS') {
            consumedRuntimeProgress = true;
            setStatus((current) => current?.manifest_progress ? {
              ...current,
              observed: true,
              status: 'planning',
              observed_at: signal.occurredAt ?? current.observed_at,
              manifest_progress: {
                ...current.manifest_progress,
                state: 'RUNNING',
                stage: signal.stage!,
                stage_completed: signal.completed ?? 0,
                stage_total: signal.total ?? 0,
                discovered_products: signal.products ?? current.manifest_progress.discovered_products,
                updated_at: signal.occurredAt ?? current.manifest_progress.updated_at,
              },
            } : current);
          }
        }
        if (runtimeStatus === 'transfer' && message.payload?.worker_id && message.payload.product_id) {
          const workerId = message.payload.worker_id;
          setWorkerSignals((current) => ({
            ...current,
            [workerId]: {
              workerId,
              productId: message.payload!.product_id!,
              productKind: message.payload?.product_kind,
              bytesRead: Math.max(0, message.payload?.product_bytes ?? 0),
              expectedBytes: Math.max(0, message.payload?.product_expected_bytes ?? 0),
              occurredAt: message.payload?.occurred_at ?? message.occurred_at,
            },
          }));
          consumedRuntimeProgress = true;
        }
        if (runtimeStatus === 'transfer_complete' && message.payload?.worker_id) {
          const workerId = message.payload.worker_id;
          setWorkerSignals((current) => {
            const next = { ...current };
            delete next[workerId];
            return next;
          });
          consumedRuntimeProgress = true;
        }
      } catch {
        // Unknown events fall back to an authoritative snapshot below.
      }
      if (!consumedRuntimeProgress) {
        void load();
      }
    });

    return () => {
      eventSource.close();
    };
  }, [load, activeTicket]);

  useEffect(() => {
    window.localStorage.setItem(SECTOR_STORAGE_KEY, sector);
  }, [sector]);

  useEffect(() => {
    window.localStorage.setItem(CONCURRENCY_STORAGE_KEY, concurrency);
  }, [concurrency]);

  const reportedStatus = status?.status ?? controlJob?.status;

  const isIngesting = useMemo(() => {
    const s = (reportedStatus ?? '').toLowerCase();
    return (
      s === 'running' ||
      s === 'planning' ||
      s === 'downloading' ||
      s === 'draining' ||
      s === 'cancelling' ||
      (status?.downloading ?? 0) > 0 ||
      (status?.inflight_products ?? 0) > 0
    );
  }, [reportedStatus, status?.downloading, status?.inflight_products]);

  const isDraining = (reportedStatus ?? '').toLowerCase() === 'draining';

  useEffect(() => {
    if (!isIngesting) setWorkerSignals({});
  }, [isIngesting]);

  const handleStart = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setControlBusy(true);
    setError(null);
    setWorkerSignals({});
    try {
      const job = await apiFetch<IngestControlJob>('/v1/ingest/jobs', {
        method: 'POST',
        body: JSON.stringify({ sector: Number(sector), concurrency: Number(concurrency), ticket_id: activeTicket }),
      });
      setControlJob(job);
      await load();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Failed to start ingestion job');
    } finally {
      setControlBusy(false);
    }
  };

  const handleCancel = async (): Promise<void> => {
    setControlBusy(true);
    setError(null);
    try {
      const ticketId = activeTicket || controlJob?.ticket_id || status?.ticket_id || 'active';
      const job = await apiFetch<IngestControlJob>(`/v1/ingest/jobs/${encodeURIComponent(ticketId)}/cancel`, { method: 'POST' });
      setControlJob(job);
      await load();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Failed to stop ingestion job');
    } finally {
      setControlBusy(false);
    }
  };

  const percent = useMemo(() => {
    if (!status?.total_products) return 0;
    return Math.min(100, Math.round((status.completed_products / status.total_products) * 100));
  }, [status?.completed_products, status?.total_products]);

  const downloadingProducts = useMemo(
    () => (status?.products ?? []).filter((product) => product.state === 'downloading' || product.state === 'running'),
    [status?.products],
  );
  const signaledWorkerCount = Object.keys(workerSignals).length;
  const spawnedWorkerCount = Math.max(0, Math.round(status?.downloading ?? 0), signaledWorkerCount);

  const activeStatus = reportedStatus?.toLowerCase() === 'not_observed' ? undefined : reportedStatus;
  const manifestDiscoveryActive = activeStatus === 'planning' && (status?.manifest_progress?.stage === 'DISCOVERING_MAST_PRODUCTS' || status?.manifest_progress?.stage === 'DISCOVERING_MAST_TARGETS' || status?.manifest_progress?.stage === 'RESOLVING_MAST_PRODUCTS');
  const manifestStageCompleted = status?.manifest_progress?.stage_completed ?? planningSignal?.completed ?? 0;
  const manifestStageTotal = status?.manifest_progress?.stage_total ?? planningSignal?.total ?? 0;
  const manifestProgressPercent = manifestDiscoveryActive && manifestStageTotal > 0
    ? (manifestStageCompleted / manifestStageTotal) * 100
    : status?.manifest_progress?.total
      ? (status.manifest_progress.completed / status.manifest_progress.total) * 100
      : 0;

  return (
    <div className="space-y-5 pb-6">
      {/* 1. Page Header / Hero Section */}
      <IngestHeroSection />

      {/* 2. Runner Ticket Bar Section */}
      <RunnerTicketBar />

      {/* Observation link error alert */}
      {error && (
        <div className="flex items-start gap-3 border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
          <AlertCircle className="mt-0.5 size-4 shrink-0" />
          <div>
            <p className="font-medium">Observation link interrupted</p>
            <p className="mt-0.5 text-xs">{error}</p>
          </div>
        </div>
      )}

      {/* 3. Metrics Summary Section */}
      <IngestMetricCardsSection
        status={status}
        percent={percent}
        spawnedWorkerCount={spawnedWorkerCount}
      />

      {/* 4. Live Telemetry & Acquisition Control Grid Section */}
      <section className="grid min-w-0 gap-5 xl:grid-cols-[minmax(0,1.45fr)_minmax(19rem,0.7fr)]">
        <IngestWorkerTelemetrySection
          status={status}
          percent={percent}
          activeTicket={activeTicket}
          activeStatus={activeStatus}
          spawnedWorkerCount={spawnedWorkerCount}
          workerSignals={workerSignals}
          downloadingProducts={downloadingProducts}
        />
        <IngestControlSection
          sector={sector}
          setSector={setSector}
          concurrency={concurrency}
          setConcurrency={setConcurrency}
          isIngesting={isIngesting}
          isDraining={isDraining}
          controlBusy={controlBusy}
          activeTicket={activeTicket}
          activeStatus={activeStatus}
          status={status}
          planningSignal={planningSignal}
          manifestDiscoveryActive={manifestDiscoveryActive}
          manifestStageCompleted={manifestStageCompleted}
          manifestStageTotal={manifestStageTotal}
          manifestProgressPercent={manifestProgressPercent}
          onStart={handleStart}
          onCancel={handleCancel}
        />
      </section>

      {/* 5. Observed FITS Products Table Section */}
      <IngestProductTableSection products={status?.products} />
    </div>
  );
}
