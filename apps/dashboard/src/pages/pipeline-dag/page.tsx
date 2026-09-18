import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { JSX } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Clock3,
  Database,
  Factory,
  GitBranch,
  History,
  LoaderCircle,
  Ticket,
} from 'lucide-react';
import { useSearchParams } from 'react-router-dom';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import type { GoldControlOverview } from '@/pages/enrichment/types';
import { RunnerTicketBar } from '@/components/RunnerTicketBar';
import { useRunnerTicket } from '@/lib/session';
import type { FactoryRunDetail } from '@/types/ticket';
import { HopDetailDrawer } from './components/HopDetailDrawer';
import { PipelineDagCanvas, type DagConnection } from './components/PipelineDagCanvas';
import { normalizePreprocessingGraph, type Hop, type HopStatus, type PreprocessingGraph } from './types';
import { apiBase, apiFetch } from '@/lib/api';

const dagConnections: DagConnection[] = [
  { source: 'bronze', target: 'route', label: 'Verified FITS', lane: 'shared' },
  { source: 'route', target: 'lc-quality', label: 'Light Curve', lane: 'light-curve' },
  { source: 'lc-quality', target: 'lc-transform', label: 'Quality-valid LC', lane: 'light-curve' },
  { source: 'lc-transform', target: 'lc-parquet', label: 'Normalized LC', lane: 'light-curve' },
  { source: 'lc-parquet', target: 'silver', label: 'Finalized LC Parquet', lane: 'light-curve' },
  { source: 'route', target: 'tpf-quality', label: 'Target Pixel chunks', lane: 'target-pixel' },
  { source: 'tpf-quality', target: 'tpf-transform', label: 'Quality-valid chunk', lane: 'target-pixel' },
  { source: 'tpf-transform', target: 'tpf-parquet', label: 'Append row group × N', lane: 'target-pixel' },
  { source: 'tpf-parquet', target: 'silver', label: 'Finalized TPF Parquet', lane: 'target-pixel' },
  { source: 'silver', target: 'checkpoint', label: 'Verified Silver object', lane: 'shared' },
  { source: 'checkpoint', target: 'lineage', label: 'Verified checkpoint', lane: 'shared' },
  { source: 'lineage', target: 'event', label: 'Committed provenance', lane: 'shared' },
  { source: 'event', target: 'ack', label: 'Durable publish complete', lane: 'shared' },
  { source: 'event', target: 'gold-pairing', label: 'Silver-ready LC + TPF', lane: 'shared' },
  { source: 'gold-pairing', target: 'gold-catalog', label: 'Target identity', lane: 'catalog' },
  { source: 'gold-pairing', target: 'gold-lc-features', label: 'Silver Light Curve', lane: 'light-curve' },
  { source: 'gold-lc-features', target: 'gold-bls', label: 'LC statistical features', lane: 'light-curve' },
  { source: 'gold-pairing', target: 'gold-tpf-evidence', label: 'Paired Target Pixel', lane: 'target-pixel' },
  { source: 'gold-bls', target: 'gold-tpf-evidence', label: 'Transit ephemeris', lane: 'target-pixel' },
  { source: 'gold-catalog', target: 'gold-candidate', label: 'TIC + TOI context', lane: 'merge' },
  { source: 'gold-bls', target: 'gold-candidate', label: 'BLS evidence', lane: 'merge' },
  { source: 'gold-tpf-evidence', target: 'gold-candidate', label: 'Spatial evidence', lane: 'merge' },
  { source: 'gold-candidate', target: 'gold-parquet', label: 'Candidate rows', lane: 'output' },
  { source: 'gold-parquet', target: 'gold-index', label: 'Verified Gold Parquet', lane: 'output' },
  { source: 'gold-index', target: 'gold-commit', label: 'Indexed projection', lane: 'output' },
];

function goldBuilderStatus(overview?: GoldControlOverview): HopStatus {
  const state = overview?.runtime?.state?.toUpperCase();
  if (state === 'RUNNING') return 'running';
  if (state === 'DRAINING') return 'draining';
  if (state === 'FROZEN') return 'frozen';
  if (state === 'IDLE') return 'idle';
  if (state === 'CATALOG_SYNCING') return 'catalog_syncing';
  if (state === 'FAILED') return 'failed';
  return 'not_observed';
}

function hopStatus(value?: string, fallback: HopStatus = 'not_observed'): HopStatus {
  const status = value?.toLowerCase();
  if (status === 'completed') return 'completed';
  if (status === 'failed' || status === 'error') return 'failed';
  if (status === 'running' || status === 'draining' || status === 'idle' || status === 'catalog_syncing' || status === 'frozen') return status;
  return fallback;
}

function time(value?: string): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('en-US');
}

function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '—';
  if (value < 1024) return `${value} B`;
  if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 ** 3) return `${(value / 1024 ** 2).toFixed(1)} MB`;
  return `${(value / 1024 ** 3).toFixed(2)} GB`;
}

export default function PipelineDagPage(): JSX.Element {
  const { activeTicket } = useRunnerTicket();
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedRunID = searchParams.get('run_id') ?? '';
  const [graph, setGraph] = useState<PreprocessingGraph>();
  const [goldControl, setGoldControl] = useState<GoldControlOverview>();
  const [historicalRun, setHistoricalRun] = useState<FactoryRunDetail>();
  const [liveEvidenceRun, setLiveEvidenceRun] = useState<FactoryRunDetail>();
  const [selectedHopID, setSelectedHopID] = useState<string>();
  const [drawerPortal, setDrawerPortal] = useState<HTMLElement | null>(null);
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [historyLoading, setHistoryLoading] = useState(false);
  const refreshTimer = useRef<number | undefined>(undefined);
  const liveEvidenceCache = useRef<{ key: string; detail: FactoryRunDetail }>();

  const loadOverview = useCallback(async (showLoading = true): Promise<void> => {
    if (showLoading) setLoading(true);
    try {
      const [nextGraph, nextGoldControl] = await Promise.all([
        apiFetch<PreprocessingGraph>('/v1/preprocessing/graph'),
        apiFetch<GoldControlOverview>('/v1/gold/control'),
      ]);
      setGraph(normalizePreprocessingGraph(nextGraph));
      setGoldControl(nextGoldControl);
      const liveRunID = nextGoldControl.runtime?.command_id || nextGoldControl.control?.command_id || activeTicket;
      const committedSnapshotID = nextGoldControl.runtime?.last_snapshot_id ?? '';
      if (liveRunID && committedSnapshotID) {
        const evidenceKey = `${liveRunID}:${committedSnapshotID}`;
        if (liveEvidenceCache.current?.key === evidenceKey) {
          setLiveEvidenceRun(liveEvidenceCache.current.detail);
        } else {
          try {
            const detail = await apiFetch<FactoryRunDetail>(`/v1/data-factory/runs/${encodeURIComponent(liveRunID)}`);
            liveEvidenceCache.current = { key: evidenceKey, detail };
            setLiveEvidenceRun(detail);
          } catch {
            setLiveEvidenceRun(undefined);
          }
        }
      } else {
        liveEvidenceCache.current = undefined;
        setLiveEvidenceRun(undefined);
      }
      setError(undefined);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Failed to load Data Factory footprint');
    } finally {
      if (showLoading) setLoading(false);
    }
  }, [activeTicket]);

  const loadRun = useCallback(async (runID: string, showLoading = true): Promise<void> => {
    if (!runID) {
      setHistoricalRun(undefined);
      return;
    }
    if (showLoading) {
      setHistoryLoading(true);
      setHistoricalRun(undefined);
    }
    try {
      setHistoricalRun(await apiFetch<FactoryRunDetail>(`/v1/data-factory/runs/${encodeURIComponent(runID)}`));
      setError(undefined);
    } catch (cause) {
      setHistoricalRun(undefined);
      setError(cause instanceof Error ? cause.message : 'Failed to load run history');
    } finally {
      if (showLoading) setHistoryLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadOverview();
  }, [loadOverview]);

  useEffect(() => {
    setSelectedHopID(undefined);
    void loadRun(selectedRunID);
  }, [loadRun, selectedRunID]);

  useEffect(() => {
    const scheduleRefresh = (): void => {
      if (refreshTimer.current) window.clearTimeout(refreshTimer.current);
      refreshTimer.current = window.setTimeout(() => {
        void loadOverview(false);
        if (selectedRunID) void loadRun(selectedRunID, false);
      }, 350);
    };
    const preprocessingEvents = new EventSource(`${apiBase}/v1/events?topic=${encodeURIComponent(`preprocessing:${activeTicket}`)}&topic=preprocessing`);
    const goldEvents = new EventSource(`${apiBase}/v1/events?topic=${encodeURIComponent(`gold:${activeTicket}`)}&topic=gold`);
    preprocessingEvents.addEventListener('workflow', scheduleRefresh);
    goldEvents.addEventListener('workflow', scheduleRefresh);
    return () => {
      preprocessingEvents.close();
      goldEvents.close();
      if (refreshTimer.current) window.clearTimeout(refreshTimer.current);
    };
  }, [loadOverview, loadRun, selectedRunID, activeTicket]);

  const selectRun = (runID: string): void => {
    const next = new URLSearchParams(searchParams);
    if (runID) next.set('run_id', runID);
    else next.delete('run_id');
    setSearchParams(next);
  };

  const hops = useMemo<Hop[]>(() => {
    const isHistory = Boolean(selectedRunID);
    const evidenceRun = historicalRun ?? (isHistory ? undefined : liveEvidenceRun);
    const bronzePending = isHistory ? 0 : graph?.progress?.bronze_pending ?? 0;
    const runtimeStatuses = new Map((graph?.hops ?? []).map((hop) => [hop.id, hop.status]));
    const metricsByHop = new Map((graph?.hops ?? []).map((hop) => [hop.id, hop.metrics]));
    const telemetryByHop = new Map((graph?.hops ?? []).map((hop) => [hop.id, hop.telemetry]));
    const historyEvents = evidenceRun?.components ?? [];
    const upstreamEvidence = (id: string): boolean => {
      if (id === 'bronze') return (graph?.progress?.bronze_total ?? 0) > 0 && (graph?.progress?.bronze_bytes ?? 0) > 0;
      if (id === 'route') return (graph?.progress?.bronze_total ?? 0) > 0;
      if (id.startsWith('lc-')) return (graph?.progress?.completed_lightcurves ?? 0) > 0 || (graph?.progress?.silver_lightcurves ?? 0) > 0;
      if (id.startsWith('tpf-')) return (graph?.progress?.completed_target_pixels ?? 0) > 0 || (graph?.progress?.silver_target_pixels ?? 0) > 0;
      if (id === 'silver') return (graph?.progress?.silver_total ?? 0) > 0 && (graph?.progress?.silver_bytes ?? 0) > 0;
      if (id === 'checkpoint') return (graph?.progress?.checkpoint_completed ?? 0) > 0;
      if (id === 'lineage' || id === 'event' || id === 'ack') return (graph?.progress?.checkpoint_completed ?? 0) > 0 && (graph?.progress?.silver_total ?? 0) > 0;
      return false;
    };
    const upstreamStatus = (id: string): HopStatus => {
      if (isHistory) return 'not_observed';
      const reported = runtimeStatuses.get(id) ?? graph?.status ?? 'not_observed';
      return reported === 'completed' && !upstreamEvidence(id) ? 'not_observed' : reported;
    };
    const liveGoldStatus = goldBuilderStatus(goldControl);
    const runStatus = historicalRun ? hopStatus(historicalRun.run.status) : liveGoldStatus;
    const evidencedPhaseStatus = (id: string, evidence: boolean, fallback: HopStatus): HopStatus => {
      const latest = [...historyEvents].reverse().find((event) => event.component_id === id);
      const reported = hopStatus(latest?.status, fallback);
      if (evidence) return 'completed';
      return reported === 'completed' ? 'not_observed' : reported;
    };
    const completedEvents = (id: string) => historyEvents.filter((event) => event.component_id === id && event.status.toUpperCase() === 'COMPLETED');
    const componentMetrics = (id: string, fallbackInput = 0, fallbackOutput = 0, fallbackIndexed = 0): Record<string, number> => {
      const events = completedEvents(id);
      if (events.length === 0) return { input_records: fallbackInput, output_rows: fallbackOutput, indexed_rows: fallbackIndexed, completed_batches: evidenceRun?.run.completed_batches ?? 0 };
      return {
        input_records: events.reduce((sum, event) => sum + event.input_records, 0),
        output_rows: events.reduce((sum, event) => sum + event.output_rows, 0),
        indexed_rows: events.reduce((sum, event) => sum + event.indexed_rows, 0),
        completed_batches: events.length,
      };
    };
    const componentTelemetry = (id: string): Hop['telemetry'] => {
      const events = completedEvents(id);
      if (events.length === 0) return undefined;
      const points = (key: 'input_records' | 'output_rows' | 'indexed_rows') => events.map((event) => ({
        timestamp: new Date(event.occurred_at).getTime() / 1000,
        value: event[key],
        labels: { snapshot_id: event.snapshot_id ?? '', status: event.status },
      })).filter((point) => Number.isFinite(point.timestamp));
      return { input_records: points('input_records'), output_rows: points('output_rows'), indexed_rows: points('indexed_rows') };
    };
    const coarseFeatureEvidence = historyEvents.some((event) => event.component_id === 'gold-features' && event.status.toUpperCase() === 'COMPLETED' && event.input_records > 0 && event.output_rows > 0 && Boolean(event.snapshot_id));
    const commitEvidence = (evidenceRun?.batches ?? []).some((batch) => batch.status.toUpperCase() === 'COMPLETED' && batch.candidate_rows > 0 && batch.indexed_rows > 0 && Boolean(batch.snapshot_id));
    const finePhaseStatus = (id: string): HopStatus => {
      const directEvidence = completedEvents(id).some((event) => event.input_records > 0 && Boolean(event.snapshot_id));
      return evidencedPhaseStatus(id, directEvidence || coarseFeatureEvidence, runStatus);
    };
    const goldTotal = historicalRun?.run.completed_batches ?? graph?.progress?.gold_total ?? 0;
    const goldCommitStatus = historicalRun ? evidencedPhaseStatus('gold-commit', commitEvidence, runStatus) : goldTotal > 0 ? 'completed' : runStatus;
    const historicalScope = 'Bronze→Silver was not part of this ticket execution; retained for topology reference.';
    const readiness = goldControl?.runtime?.readiness;
    const catalog = goldControl?.runtime?.catalog_sync;
    const actions = new Set((goldControl?.runtime?.workers ?? []).filter((worker) => worker.lifecycle !== 'KILLED').map((worker) => worker.action));
    const liveFineStatus = (stage: number): HopStatus => {
      if (actions.has('SNAPSHOT_COMMITTED')) return 'completed';
      if (actions.has('COMMITTING_SNAPSHOT')) return stage < 8 ? 'completed' : stage === 8 ? 'running' : 'not_observed';
      if (actions.has('MATERIALIZING_AND_INDEXING')) return stage < 2 ? 'completed' : stage < 8 ? 'running' : 'not_observed';
      if (actions.has('SYNCING_CATALOGS')) return stage === 0 ? 'completed' : stage === 1 ? 'running' : 'not_observed';
      if (actions.has('RETRYING_CATALOG_SYNC') || actions.has('FAILED_RETRY_SCHEDULED')) return stage === 1 ? 'retry' : 'not_observed';
      return stage === 0 ? liveGoldStatus : 'not_observed';
    };
    const phaseStatus = (id: string, stage: number): HopStatus => historicalRun ? finePhaseStatus(id) : liveFineStatus(stage);
    const liveReady = readiness?.ready_lightcurves ?? 0;
    const liveTPF = readiness?.tpf_contexts ?? 0;
    const livePending = goldControl?.runtime?.pending_total ?? 0;
    const livePendingLC = goldControl?.runtime?.pending_by_kind?.LIGHT_CURVE ?? liveReady + (readiness?.missing_tpf ?? 0);
    const liveCatalogRecords = (catalog?.tic_records ?? 0) + (catalog?.toi_records ?? 0);
    const historicalInputs = historicalRun?.run.input_records ?? 0;
    const historicalOutputs = historicalRun?.run.output_rows ?? 0;
    const evidenceInputs = evidenceRun?.run.input_records ?? 0;
    const evidenceOutputs = evidenceRun?.run.output_rows ?? 0;
    const artifactCount = (evidenceRun?.batches ?? []).reduce((sum, batch) => sum + batch.artifact_count, 0);

    const pipelineHops: Hop[] = [
      { id: 'bronze', stepNumber: '01', label: 'Bronze Verify & Fetch', shortTitle: 'Verified source FITS', description: 'Verifies Bronze object identity, size and checksum before local staging.', astronomyGoal: isHistory ? historicalScope : `${bronzePending.toLocaleString()} processable FITS remain without a completed Silver checkpoint.`, contract: 'bronze/tess/<product>/sector=<sector>/tic=<tic>/', status: upstreamStatus('bronze'), input: 'NASA MAST FITS', output: 'Verified local FITS', metrics: isHistory ? undefined : metricsByHop.get('bronze'), telemetry: isHistory ? undefined : telemetryByHop.get('bronze') },
      { id: 'route', stepNumber: '02', label: 'Product Route & Demux', shortTitle: 'Demuxed raw product', description: 'Routes FITS products to either Light Curve or Target Pixel calibration paths.', astronomyGoal: isHistory ? historicalScope : 'Isolates Light Curve time series from 11×11 Target Pixel image cutouts.', contract: 'bronze/tess/<product>/sector=<sector>/tic=<tic>/<filename>', status: upstreamStatus('route'), input: 'Verified local FITS', output: 'Typed FITS route', metrics: isHistory ? undefined : metricsByHop.get('route'), telemetry: isHistory ? undefined : telemetryByHop.get('route') },
      { id: 'lc-quality', stepNumber: '03A', label: 'LC Quality Bitmask Filter', shortTitle: 'LC Bitmask Verified', description: 'Filters out telemetry dropouts, cosmic ray hits, and Earth-shine flares.', astronomyGoal: isHistory ? historicalScope : 'Discards known bad cadences before spline detrending.', contract: 'BITMASK 0x0001 | 0x0002 | 0x0008 | 0x0020 | 0x0040', status: upstreamStatus('lc-quality'), input: 'Light Curve FITS', output: 'Quality-filtered cadences', metrics: isHistory ? undefined : metricsByHop.get('lc-quality'), telemetry: isHistory ? undefined : telemetryByHop.get('lc-quality') },
      { id: 'lc-transform', stepNumber: '04A', label: 'PDC-SAP Detrend & Clean', shortTitle: 'Detrended Flux Series', description: 'Normalizes Pre-search Data Conditioning flux with robust outlier clipping.', astronomyGoal: isHistory ? historicalScope : 'Preserves transit depth while removing instrumental thermal drift.', contract: 'flux_norm = pdcsap_flux / median(pdcsap_flux)', status: upstreamStatus('lc-transform'), input: 'Filtered cadences', output: 'Normalized flux array', metrics: isHistory ? undefined : metricsByHop.get('lc-transform'), telemetry: isHistory ? undefined : telemetryByHop.get('lc-transform') },
      { id: 'lc-parquet', stepNumber: '05A', label: 'LC Parquet Serialization', shortTitle: 'LC Parquet Segment', description: 'Serializes calibrated light curves into Snappy-compressed columnar Parquet format.', astronomyGoal: isHistory ? historicalScope : 'Encodes time, normalized flux, error, and quality flag.', contract: 'silver/tess/lightcurves/sector=<sector>/tic=<tic>/part.parquet', status: upstreamStatus('lc-parquet'), input: 'Normalized flux array', output: 'Silver LC Parquet', metrics: isHistory ? undefined : metricsByHop.get('lc-parquet'), telemetry: isHistory ? undefined : telemetryByHop.get('lc-parquet') },
      { id: 'tpf-quality', stepNumber: '03B', label: 'TPF Quality & WCS Resolve', shortTitle: 'TPF Quality Verified', description: 'Extracts World Coordinate System (WCS) headers and validates image dimensions.', astronomyGoal: isHistory ? historicalScope : 'Ensures valid spatial astrometry for centroid motion analysis.', contract: '11×11 pixel postage stamps; WCS RA/Dec solution verified', status: upstreamStatus('tpf-quality'), input: 'Target Pixel FITS', output: 'Quality-filtered TPF', metrics: isHistory ? undefined : metricsByHop.get('tpf-quality'), telemetry: isHistory ? undefined : telemetryByHop.get('tpf-quality') },
      { id: 'tpf-transform', stepNumber: '04B', label: 'TPF Flux Calibration', shortTitle: 'Calibrated TPF Frames', description: 'Applies background subtraction, aperture mask verification, and cosmic ray excision.', astronomyGoal: isHistory ? historicalScope : 'Isolates stellar PSF from background blending.', contract: 'flux_cal = raw_flux - background_model', status: upstreamStatus('tpf-transform'), input: 'Filtered TPF stamps', output: 'Calibrated image cube', metrics: isHistory ? undefined : metricsByHop.get('tpf-transform'), telemetry: isHistory ? undefined : telemetryByHop.get('tpf-transform') },
      { id: 'tpf-parquet', stepNumber: '05B', label: 'TPF Parquet Serialization', shortTitle: 'TPF Parquet Segment', description: 'Encodes calibrated 11×11 pixel frames into flattened array columns within Parquet.', astronomyGoal: isHistory ? historicalScope : 'Enables vector similarity and centroid vetting at analytical query speed.', contract: 'silver/tess/target_pixels/sector=<sector>/tic=<tic>/part.parquet', status: upstreamStatus('tpf-parquet'), input: 'Calibrated image cube', output: 'Silver TPF Parquet', metrics: isHistory ? undefined : metricsByHop.get('tpf-parquet'), telemetry: isHistory ? undefined : telemetryByHop.get('tpf-parquet') },
      { id: 'silver', stepNumber: '06', label: 'Silver Commit & Seal', shortTitle: 'Finalized Silver Product', description: 'Verifies schema conformance, writes object metadata, and marks the Silver partition durable.', astronomyGoal: isHistory ? historicalScope : 'Guarantees immutable input state before Gold feature extraction.', contract: 'silver/tess/<product>/sector=<sector>/tic=<tic>/', status: upstreamStatus('silver'), input: 'Finalized Parquet parts', output: 'Durable Silver object', metrics: isHistory ? undefined : metricsByHop.get('silver'), telemetry: isHistory ? undefined : telemetryByHop.get('silver') },
      { id: 'checkpoint', stepNumber: '07', label: 'Checkpoint Persist', shortTitle: 'Committed Checkpoint', description: 'Persists pipeline state checkpoint to MinIO storage for reliable restart and lineage tracking.', astronomyGoal: isHistory ? historicalScope : 'Enables resumption from the last verified Silver product.', contract: 'checkpoints/preprocessing/sector=<sector>/checkpoint.json', status: upstreamStatus('checkpoint'), input: 'Silver object metadata', output: 'Persisted checkpoint', metrics: isHistory ? undefined : metricsByHop.get('checkpoint'), telemetry: isHistory ? undefined : telemetryByHop.get('checkpoint') },
      { id: 'lineage', stepNumber: '08', label: 'Lineage Ledger Update', shortTitle: 'Recorded Lineage Record', description: 'Records input-to-output provenance relationships in ClickHouse lineage ledger.', astronomyGoal: isHistory ? historicalScope : 'Full provenance tracking: Bronze FITS hash to Silver Parquet hash.', contract: 'lineage/preprocessing/<run_id>.json', status: upstreamStatus('lineage'), input: 'Checkpoint metadata', output: 'Committed provenance record', metrics: isHistory ? undefined : metricsByHop.get('lineage'), telemetry: isHistory ? undefined : telemetryByHop.get('lineage') },
      { id: 'event', stepNumber: '09', label: 'Event Publish to NATS', shortTitle: 'Published NATS Event', description: 'Publishes preprocessing completed notification to NATS JetStream topic for Gold Builder.', astronomyGoal: isHistory ? historicalScope : 'Triggers downstream candidate feature extraction and catalog lookup.', contract: 'aurora.events.preprocessing.completed.v1', status: upstreamStatus('event'), input: 'Lineage record ID', output: 'Published JetStream event', metrics: isHistory ? undefined : metricsByHop.get('event'), telemetry: isHistory ? undefined : telemetryByHop.get('event') },
      { id: 'ack', stepNumber: '10', label: 'Pipeline Acknowledge', shortTitle: 'Workflow Acknowledged', description: 'Finalizes preprocessing run execution and logs completion metrics.', astronomyGoal: isHistory ? historicalScope : 'Preprocessing workflow successfully completed for the batch.', contract: 'status: COMPLETED; duration logged to metrics', status: upstreamStatus('ack'), input: 'Published event confirmation', output: 'Run completion entry', metrics: isHistory ? undefined : metricsByHop.get('ack'), telemetry: isHistory ? undefined : telemetryByHop.get('ack') },
      { id: 'gold-pairing', stepNumber: 'G01', label: 'Silver Pairing & Worker Dequeue', shortTitle: 'Paired Silver Multimodal Inputs', description: 'Worker claims a Silver batch and pairs normalized light curve cadences with 11×11 target pixel context.', astronomyGoal: historicalRun ? `${historicalInputs.toLocaleString()} input records were claimed for this historical ticket.` : `${liveReady.toLocaleString()} Silver light curves and ${liveTPF.toLocaleString()} TPF contexts currently observed ready.`, contract: 'silver/tess/{lightcurves,target_pixels}/sector=<sector>/tic=<tic>/part.parquet', status: phaseStatus('gold-pairing', 0), input: 'Silver LC + TPF Parquet', output: 'Paired Silver input record', metrics: componentMetrics('gold-pairing', historicalInputs || liveReady, historicalInputs || liveReady), telemetry: componentTelemetry('gold-pairing') },
      { id: 'gold-catalog', stepNumber: 'G02', label: 'Target Identity & TOI Catalog Sync', shortTitle: 'TIC Astrometry & Curated TOI Match', description: 'Matches candidate targets against TIC stellar parameters and resolves curated TOI cross-references.', astronomyGoal: historicalRun ? 'Stellar parameters and TOI ephemerides resolved at execution time.' : `${liveCatalogRecords.toLocaleString()} catalog records currently synchronized in worker memory.`, contract: 'aurora.targets + NASA Exoplanet Archive TOI ephemerides', status: phaseStatus('gold-catalog', 1), input: 'Target TIC ID', output: 'TIC params + TOI match context', metrics: componentMetrics('gold-catalog', historicalInputs || liveCatalogRecords, historicalInputs || liveCatalogRecords), telemetry: componentTelemetry('gold-catalog') },
      { id: 'gold-lc-features', stepNumber: 'G03', label: 'Light Curve Statistical Features', shortTitle: 'Extracted LC Morphology Vectors', description: 'Computes variance, skewness, kurtosis, amplitude, and variability indicators on normalized flux.', astronomyGoal: 'Quantifies variability and transit morphology prior to period searches.', contract: 'n_points, flux_std, flux_skewness, flux_kurtosis, flux_amplitude, flux_mad', status: phaseStatus('gold-lc-features', 2), input: 'Paired normalized flux series', output: 'LC feature vector', metrics: componentMetrics('gold-lc-features', historicalInputs || liveReady, historicalInputs || liveReady), telemetry: componentTelemetry('gold-lc-features') },
      { id: 'gold-bls', stepNumber: 'G04', label: 'BLS Transit Period Search', shortTitle: 'Box Least Squares Ephemeris', description: 'Runs Box Least Squares periodogram to detect periodic box-shaped dips matching planetary transits.', astronomyGoal: 'Finds candidate period, duration, depth, and signal detection power.', contract: 'bls_period, bls_duration, bls_depth, bls_power, bls_transit_time', status: phaseStatus('gold-bls', 3), input: 'Normalized flux + time array', output: 'BLS candidate ephemeris', metrics: componentMetrics('gold-bls', historicalInputs || liveReady, historicalInputs || liveReady), telemetry: componentTelemetry('gold-bls') },
      { id: 'gold-tpf-evidence', stepNumber: 'G05', label: 'TPF Centroid Motion & Deficit Vetting', shortTitle: 'Pixel MAD & In-Transit Deficit Centroid', description: 'Measures in-transit flux deficit centroid against stellar position to detect background eclipsing binaries.', astronomyGoal: 'Rejects false positives caused by nearby eclipsing binary contamination.', contract: 'pixel_mad_median, variability_peak_fraction, transit_deficit_sum, center_offset_px', status: phaseStatus('gold-tpf-evidence', 4), input: 'TPF image cube + BLS ephemeris', output: 'TPF spatial vetting vector', metrics: componentMetrics('gold-tpf-evidence', historicalInputs || liveTPF, historicalInputs || liveTPF), telemetry: componentTelemetry('gold-tpf-evidence') },
      { id: 'gold-candidate', stepNumber: 'G06', label: 'Multimodal Candidate Assembly', shortTitle: 'Assembled Candidate Discovery Record', description: 'Combines LC features, BLS ephemeris, TPF spatial evidence, and TIC context into a unified candidate row.', astronomyGoal: historicalRun ? `${historicalOutputs.toLocaleString()} candidate records were assembled for this historical ticket.` : 'Unifies multimodal discovery evidence before serialization.', contract: 'Candidate discovery schema with strict tier-based validation gates', status: phaseStatus('gold-candidate', 5), input: 'LC + BLS + TPF + TIC records', output: 'Candidate Gold record', metrics: componentMetrics('gold-candidate', historicalInputs || livePendingLC, historicalOutputs || livePendingLC), telemetry: componentTelemetry('gold-candidate') },
      { id: 'gold-parquet', stepNumber: 'G07', label: 'Gold Candidate Parquet Materialize', shortTitle: 'Gold Discovery Parquet Object', description: 'Writes Snappy-compressed columnar Parquet files containing full candidate feature rows to object storage.', astronomyGoal: historicalRun ? `${artifactCount} Gold Parquet artifacts were written for this ticket.` : 'Commits immutable Gold data layer artifacts for ML inference and analysis.', contract: 'gold/tess/candidates/snapshot=<id>/sector=<sector>/part-*.parquet', status: phaseStatus('gold-parquet', 6), input: 'Candidate Gold records', output: 'Gold Parquet artifact', metrics: componentMetrics('gold-parquet', historicalOutputs || livePending, historicalOutputs || livePending), telemetry: componentTelemetry('gold-parquet') },
      { id: 'gold-index', stepNumber: 'G08', label: 'ClickHouse Analytical Indexing', shortTitle: 'ReplacingMergeTree Candidate Index', description: 'Inserts candidate rows into candidate_features_v1 and updates gold_snapshots_v1 ledger in ClickHouse.', astronomyGoal: historicalRun ? `${(historicalRun.run.indexed_rows ?? 0).toLocaleString()} candidate rows were indexed into ClickHouse.` : 'Enables low-latency SQL queries and ML inference feature retrieval.', contract: 'aurora.candidate_features_v1 (ReplacingMergeTree)', status: phaseStatus('gold-index', 7), input: 'Gold Parquet artifact', output: 'Indexed ClickHouse rows', metrics: componentMetrics('gold-index', historicalOutputs || livePending, historicalRun?.run.indexed_rows || livePending, historicalRun?.run.indexed_rows || livePending), telemetry: componentTelemetry('gold-index') },
      { id: 'gold-commit', stepNumber: 'G09', label: 'Atomic Snapshot Commit & Lineage', shortTitle: 'Committed Snapshot & Provenance Seal', description: 'Emits atomic manifest pointer to MinIO, seals data lineage ledger, and updates pipeline state.', astronomyGoal: historicalRun ? (historicalRun.run.last_snapshot_id ? `Committed snapshot ${historicalRun.run.last_snapshot_id} as immutable release.` : 'Durable run completed without an active snapshot seal.') : (goldControl?.runtime?.last_snapshot_id ? `Committed snapshot ${goldControl.runtime.last_snapshot_id} as immutable release.` : 'Awaiting complete batch before committing immutable snapshot.'), contract: 'gold/control/gold-builder.json pointer + lineage/gold/<snapshot_id>.json', status: goldCommitStatus, input: 'Indexed projection confirmation', output: 'Atomic snapshot commit', metrics: componentMetrics('gold-commit', historicalOutputs || evidenceOutputs, historicalOutputs || evidenceOutputs, historicalRun?.run.indexed_rows || livePending), telemetry: componentTelemetry('gold-commit') },
    ];

    const goldPhaseOrder = ['gold-pairing', 'gold-catalog', 'gold-lc-features', 'gold-bls', 'gold-tpf-evidence', 'gold-candidate', 'gold-parquet', 'gold-index', 'gold-commit'];
    const numberedHops = pipelineHops.map((hop, index) => ({
      ...hop,
      stepNumber: String(index + 1).padStart(2, '0'),
    }));
    return isHistory ? numberedHops.filter((hop) => goldPhaseOrder.includes(hop.id)) : numberedHops;
  }, [goldControl, graph, historicalRun, liveEvidenceRun, selectedRunID]);

  const selectedHop = selectedHopID ? hops.find((hop) => hop.id === selectedHopID) : undefined;
  const visibleConnections = useMemo(() => {
    const visibleHopIDs = new Set(hops.map((hop) => hop.id));
    return dagConnections.filter((connection) => visibleHopIDs.has(connection.source) && visibleHopIDs.has(connection.target));
  }, [hops]);

  const effectiveTicketID = selectedRunID || activeTicket;
  const isHistorical = Boolean(selectedRunID && historicalRun);

  // 1. Ticket & Topology KPI
  const ticketKpiValue = effectiveTicketID || 'None';
  const ticketKpiDetail = isHistorical
    ? `${hops.length} Hops · ${historicalRun?.run?.mode?.toUpperCase() ?? 'BATCH'} Historical Run`
    : `${hops.length} Hops · ${graph?.run?.mode?.toUpperCase() ?? 'STREAM'} Mode`;

  // 2. Bronze Ingestion KPI
  const bronzeCount = graph?.progress?.bronze_total ?? 0;
  const bronzePending = graph?.progress?.bronze_pending ?? 0;
  const bronzeBytes = graph?.progress?.bronze_bytes ?? 0;
  const bronzeKpiValue = isHistorical
    ? `${(historicalRun?.run?.input_records ?? 0).toLocaleString()} Inputs`
    : bronzeCount > 0
    ? `${bronzeCount.toLocaleString()} FITS`
    : 'Standby';
  const bronzeKpiDetail = isHistorical
    ? 'Historical source scope'
    : bronzeCount > 0
    ? `${bronzePending.toLocaleString()} pending · ${formatBytes(bronzeBytes)}`
    : 'Bronze telemetry verified';

  // 3. Silver Preprocessing KPI
  const silverTotal = graph?.progress?.silver_total ?? 0;
  const lcCount = graph?.progress?.completed_lightcurves ?? 0;
  const tpfCount = graph?.progress?.completed_target_pixels ?? 0;
  const silverKpiValue = isHistorical
    ? `${(historicalRun?.run?.completed_batches ?? 0).toLocaleString()} Batches`
    : silverTotal > 0
    ? `${silverTotal.toLocaleString()} Artifacts`
    : (graph?.status?.toUpperCase() ?? 'IDLE');
  const silverKpiDetail = isHistorical
    ? 'Silver verified footprint'
    : `${lcCount.toLocaleString()} Lightcurves · ${tpfCount.toLocaleString()} TPFs`;

  // 4. Gold Enrichment KPI
  const goldKpiValue = isHistorical
    ? (historicalRun?.run?.status?.toUpperCase() ?? 'COMPLETED')
    : (goldControl?.runtime?.state?.toUpperCase() ?? 'IDLE');
  const goldSnapshot = historicalRun?.run?.last_snapshot_id || goldControl?.runtime?.last_snapshot_id;
  const goldKpiDetail = goldSnapshot
    ? `Snapshot: ${goldSnapshot}`
    : `${goldControl?.runtime?.active_builds ?? 0} active builds · ${goldControl?.runtime?.workers?.length ?? 0} workers`;

  return (
    <div className="space-y-5">
      {/* Hero Banner with Blueprint Grid */}
      <section className="relative overflow-hidden border border-border/70 bg-card px-4 py-5 shadow-sm sm:px-6">
        <div className="pointer-events-none absolute inset-0 opacity-[0.18] [background-image:linear-gradient(to_right,var(--border)_1px,transparent_1px),linear-gradient(to_bottom,var(--border)_1px,transparent_1px)] [background-size:28px_28px]" />
        <div className="relative">
          <div className="mb-3 flex items-center gap-2 font-mono text-[10px] font-medium uppercase tracking-[0.18em] text-primary">
            <Factory className="size-4" aria-hidden="true" />
            Data Factory / Topological Analysis Workspace
          </div>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="font-heading text-2xl font-semibold tracking-tight md:text-3xl">Pipeline DAG</h2>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                End-to-end topological execution graph and reactive telemetry across Ingestion, Preprocessing, and Enrichment.
              </p>
            </div>
            {effectiveTicketID && (
              <Badge variant="outline" className="h-8 rounded-none border-primary/40 bg-primary/10 px-3 font-mono text-xs text-primary">
                Ticket: {effectiveTicketID}
              </Badge>
            )}
          </div>
        </div>
      </section>

      {/* Top 4 KPI Stat Strip */}
      <section aria-label="Pipeline DAG summary" className="grid gap-px overflow-hidden border border-border/70 bg-border/70 sm:grid-cols-2 xl:grid-cols-4">
        <Stat
          icon={Ticket}
          label="Pipeline Ticket"
          value={ticketKpiValue}
          detail={ticketKpiDetail}
        />
        <Stat
          icon={Database}
          label="Bronze Ingestion"
          value={bronzeKpiValue}
          detail={bronzeKpiDetail}
        />
        <Stat
          icon={GitBranch}
          label="Silver Preprocessing"
          value={silverKpiValue}
          detail={silverKpiDetail}
        />
        <Stat
          icon={CheckCircle2}
          label="Gold Enrichment"
          value={goldKpiValue}
          detail={goldKpiDetail}
        />
      </section>

      <RunnerTicketBar />

      {selectedRunID ? (
        <div className="flex flex-wrap items-center justify-between gap-2 border border-primary/30 bg-primary/5 px-3 py-2 text-xs">
          <div className="flex items-center gap-2">
            <History className="size-3.5 text-primary" />
            <span>Historical analysis for ticket:</span>
            <span className="font-mono text-primary">{selectedRunID}</span>
            <span className="text-muted-foreground">· G01–G09 topology view</span>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 rounded-none px-2 font-mono text-[10px] uppercase text-primary hover:bg-primary/10"
            onClick={() => selectRun('')}
          >
            Return to Live DAG
          </Button>
        </div>
      ) : null}

      {error ? (
        <div className="flex items-center gap-2 border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          <AlertCircle className="size-4" />
          {error}
        </div>
      ) : null}

      {loading && !graph ? (
        <div className="flex items-center justify-center gap-2 border border-dashed border-border/70 py-24 text-sm text-muted-foreground">
          <LoaderCircle className="size-4 animate-spin" />
          Loading pipeline topology contracts…
        </div>
      ) : historyLoading && selectedRunID && !historicalRun ? (
        <div className="flex items-center justify-center gap-2 border border-dashed border-border/70 py-24 text-sm text-muted-foreground">
          <LoaderCircle className="size-4 animate-spin" />
          Loading runner ticket data…
        </div>
      ) : selectedRunID && !historicalRun ? (
        <div className="flex items-center justify-center border border-dashed border-destructive/40 py-24 text-sm text-destructive">
          Unable to load evidence for selected ticket; live DAG is not used as fallback.
        </div>
      ) : (
        <PipelineDagCanvas
          hops={hops}
          layout="branched"
          connections={visibleConnections}
          onSelectHop={setSelectedHopID}
          onPortalContainerChange={setDrawerPortal}
        />
      )}

      {historicalRun ? <PhaseLedger detail={historicalRun} /> : null}
      <HopDetailDrawer
        selectedHop={selectedHop}
        onClose={() => setSelectedHopID(undefined)}
        mode={graph?.run?.mode === 'stream' ? 'stream' : 'batch'}
        totalFiles={historicalRun?.run.input_records ?? liveEvidenceRun?.run.input_records ?? graph?.progress?.bronze_total ?? 0}
        portalContainer={drawerPortal}
      />
    </div>
  );
}

function Stat({
  icon: Icon,
  label,
  value,
  detail,
}: {
  icon: typeof Ticket;
  label: string;
  value: string;
  detail: string;
}): JSX.Element {
  return (
    <div className="min-w-0 border border-border/70 bg-background/45 p-3.5">
      <div className="flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.13em] text-primary">
        <Icon className="size-4 text-primary" />
        {label}
      </div>
      <p className="mt-2 truncate font-mono text-lg font-semibold tabular-nums text-foreground sm:text-xl">
        {value}
      </p>
      <p className="mt-1 truncate text-[11px] text-muted-foreground" title={detail}>
        {detail}
      </p>
    </div>
  );
}

function PhaseLedger({ detail }: { detail: FactoryRunDetail }): JSX.Element {
  return (
    <Card className="rounded-none border-border/80 shadow-none">
      <CardHeader className="border-b border-border/70 pb-3">
        <div className="flex items-end justify-between">
          <div>
            <CardTitle className="flex items-center gap-2 text-sm">
              <GitBranch className="size-4 text-primary" />
              Phase history ledger
            </CardTitle>
            <CardDescription>
              Chronological sequence of component phase events for the selected runner ticket.
            </CardDescription>
          </div>
          <span className="font-mono text-[10px] text-muted-foreground">
            {detail.components.length} events
          </span>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {detail.components.length === 0 ? (
          <div className="p-8 text-center text-xs text-muted-foreground">
            No component phase events recorded for this runner ticket.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead className="border-b bg-muted/30 text-left font-mono text-[9px] uppercase text-muted-foreground">
                <tr>
                  <th className="p-3">Occurred</th>
                  <th className="p-3">Phase</th>
                  <th className="p-3">State</th>
                  <th className="p-3 text-right">Input</th>
                  <th className="p-3 text-right">Output</th>
                  <th className="p-3 text-right">Indexed</th>
                  <th className="p-3">Evidence</th>
                </tr>
              </thead>
              <tbody>
                {detail.components.map((event, index) => (
                  <tr
                    key={`${event.component_id}-${event.occurred_at}-${index}`}
                    className="border-b border-border/60 last:border-0"
                  >
                    <td className="p-3 font-mono text-[10px] text-muted-foreground">
                      <Clock3 className="mr-1 inline size-3" />
                      {time(event.occurred_at)}
                    </td>
                    <td className="p-3 font-mono text-xs">{event.component_id}</td>
                    <td className="p-3">
                      <Badge
                        variant={
                          /FAILED|ERROR/.test(event.status)
                            ? 'destructive'
                            : /COMPLETED/.test(event.status)
                            ? 'default'
                            : 'secondary'
                        }
                        className="rounded-none font-mono text-[9px]"
                      >
                        {event.status}
                      </Badge>
                    </td>
                    <td className="p-3 text-right tabular-nums">{event.input_records.toLocaleString()}</td>
                    <td className="p-3 text-right tabular-nums">{event.output_rows.toLocaleString()}</td>
                    <td className="p-3 text-right tabular-nums">{event.indexed_rows.toLocaleString()}</td>
                    <td
                      className="max-w-64 truncate p-3 font-mono text-[10px] text-muted-foreground"
                      title={event.error || event.snapshot_id}
                    >
                      {event.error || event.snapshot_id || '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
