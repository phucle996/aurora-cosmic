import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { JSX } from 'react';
import { AlertCircle, Clock3, Factory, GitBranch, History, LoaderCircle, RefreshCw } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import type { GoldControlOverview } from '@/features/enrichment/types';
import type { FactoryRun, FactoryRunDetail } from '@/features/factory-history/types';
import { HopDetailDrawer } from '@/features/preprocessing/components/HopDetailDrawer';
import { PipelineDagCanvas, type DagConnection } from '@/features/preprocessing/components/PipelineDagCanvas';
import { normalizePreprocessingGraph, type Hop, type HopStatus, type PreprocessingGraph } from '@/features/preprocessing/types';
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

function catalogSyncStatus(value?: string): HopStatus {
  const status = value?.toUpperCase();
  if (status === 'IDLE') return 'idle';
  if (status === 'SYNCING') return 'catalog_syncing';
  if (status === 'READY') return 'ready';
  if (status === 'RETRYING') return 'retry';
  if (status === 'FAILED') return 'failed';
  return 'not_observed';
}

function time(value?: string): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('vi-VN');
}

function duration(start?: string, end?: string): string {
  if (!start || !end) return 'in progress';
  const milliseconds = new Date(end).getTime() - new Date(start).getTime();
  if (!Number.isFinite(milliseconds) || milliseconds < 0) return '—';
  const seconds = milliseconds / 1000;
  if (seconds < 60) return `${seconds.toFixed(seconds < 10 ? 1 : 0)}s`;
  if (seconds < 3600) return `${(seconds / 60).toFixed(1)}m`;
  return `${(seconds / 3600).toFixed(1)}h`;
}

export default function PipelineDagPage(): JSX.Element {
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedRunID = searchParams.get('run_id') ?? '';
  const [graph, setGraph] = useState<PreprocessingGraph>();
  const [goldControl, setGoldControl] = useState<GoldControlOverview>();
  const [runs, setRuns] = useState<FactoryRun[]>([]);
  const [historicalRun, setHistoricalRun] = useState<FactoryRunDetail>();
  const [selectedHop, setSelectedHop] = useState<Hop>();
  const [drawerPortal, setDrawerPortal] = useState<HTMLElement | null>(null);
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [historyLoading, setHistoryLoading] = useState(false);
  const refreshTimer = useRef<number | undefined>(undefined);

  const loadOverview = useCallback(async (showLoading = true): Promise<void> => {
    if (showLoading) setLoading(true);
    try {
      const [nextGraph, nextGoldControl, nextRuns] = await Promise.all([
        apiFetch<PreprocessingGraph>('/v1/preprocessing/graph'),
        apiFetch<GoldControlOverview>('/v1/gold/control'),
        apiFetch<{ items: FactoryRun[] | null }>('/v1/data-factory/runs?pipeline=silver_to_gold&limit=100'),
      ]);
      setGraph(normalizePreprocessingGraph(nextGraph));
      setGoldControl(nextGoldControl);
      setRuns(nextRuns.items ?? []);
      setError(undefined);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Không tải được Data Factory footprint');
    } finally {
      if (showLoading) setLoading(false);
    }
  }, []);

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
      setError(cause instanceof Error ? cause.message : 'Không tải được lịch sử run');
    } finally {
      if (showLoading) setHistoryLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadOverview();
  }, [loadOverview]);

  useEffect(() => {
    setSelectedHop(undefined);
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
    const preprocessingEvents = new EventSource(`${apiBase}/v1/events?workflow=preprocessing`);
    const goldEvents = new EventSource(`${apiBase}/v1/events?workflow=gold`);
    preprocessingEvents.addEventListener('workflow', scheduleRefresh);
    goldEvents.addEventListener('workflow', scheduleRefresh);
    return () => {
      preprocessingEvents.close();
      goldEvents.close();
      if (refreshTimer.current) window.clearTimeout(refreshTimer.current);
    };
  }, [loadOverview, loadRun, selectedRunID]);

  const selectRun = (runID: string): void => {
    const next = new URLSearchParams(searchParams);
    if (runID) next.set('run_id', runID);
    else next.delete('run_id');
    setSearchParams(next);
  };

  const refresh = async (): Promise<void> => {
    await Promise.all([loadOverview(), selectedRunID ? loadRun(selectedRunID) : Promise.resolve()]);
  };

  const hops = useMemo<Hop[]>(() => {
    const isHistory = Boolean(selectedRunID);
    const bronzePending = isHistory ? 0 : graph?.progress?.bronze_pending ?? 0;
    const silverTotal = isHistory ? 0 : graph?.progress?.silver_total ?? 0;
    const goldTotal = historicalRun?.run.completed_batches ?? graph?.progress?.gold_total ?? 0;
    const runtimeStatuses = new Map((graph?.hops ?? []).map((hop) => [hop.id, hop.status]));
    const metricsByHop = new Map((graph?.hops ?? []).map((hop) => [hop.id, hop.metrics]));
    const telemetryByHop = new Map((graph?.hops ?? []).map((hop) => [hop.id, hop.telemetry]));
    const scatterByHop = new Map((graph?.hops ?? []).map((hop) => [hop.id, hop.scatter_points]));
    const tpfTransformByHop = new Map((graph?.hops ?? []).map((hop) => [hop.id, hop.tpf_transform_points]));
    const materializationByHop = new Map((graph?.hops ?? []).map((hop) => [hop.id, hop.materialization_points]));
    const encodeFailuresByHop = new Map((graph?.hops ?? []).map((hop) => [hop.id, hop.encode_failures]));
    const silverFailuresByHop = new Map((graph?.hops ?? []).map((hop) => [hop.id, hop.silver_failures]));
    const checkpointPointsByHop = new Map((graph?.hops ?? []).map((hop) => [hop.id, hop.checkpoint_points]));
    const historyEvents = historicalRun?.components ?? [];
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
      if (events.length === 0) return { input_records: fallbackInput, output_rows: fallbackOutput, indexed_rows: fallbackIndexed, completed_batches: historicalRun?.run.completed_batches ?? 0 };
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
    const completedBatchEvidence = (historicalRun?.batches ?? []).some((batch) => batch.status.toUpperCase() === 'COMPLETED' && batch.input_records > 0);
    const coarseFeatureEvidence = historyEvents.some((event) => event.component_id === 'gold-features' && event.status.toUpperCase() === 'COMPLETED' && event.input_records > 0 && event.output_rows > 0 && Boolean(event.snapshot_id));
    const commitEvidence = (historicalRun?.batches ?? []).some((batch) => batch.status.toUpperCase() === 'COMPLETED' && batch.candidate_rows > 0 && batch.indexed_rows > 0 && Boolean(batch.snapshot_id));
    const finePhaseStatus = (id: string): HopStatus => {
      const directEvidence = completedEvents(id).some((event) => event.input_records > 0 && Boolean(event.snapshot_id));
      return evidencedPhaseStatus(id, directEvidence || coarseFeatureEvidence, runStatus);
    };
    const goldCommitStatus = historicalRun ? evidencedPhaseStatus('gold-commit', commitEvidence, runStatus) : goldTotal > 0 ? 'completed' : runStatus;
    const historicalScope = 'Bronze→Silver không thuộc run được chọn; node được giữ để đọc quan hệ phụ thuộc.';
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
    const artifactCount = (historicalRun?.batches ?? []).reduce((sum, batch) => sum + batch.artifact_count, 0);

    const pipelineHops: Hop[] = [
      { id: 'bronze', stepNumber: '01', label: 'Bronze Verify & Fetch', shortTitle: 'Verified source FITS', description: 'Verifies Bronze object identity, size and checksum before local staging.', astronomyGoal: isHistory ? historicalScope : `${bronzePending.toLocaleString()} processable FITS remain without a completed Silver checkpoint.`, contract: 'bronze/tess/<product>/sector=<sector>/tic=<tic>/', status: upstreamStatus('bronze'), input: 'NASA MAST FITS', output: 'Verified local FITS', metrics: isHistory ? undefined : metricsByHop.get('bronze'), telemetry: isHistory ? undefined : telemetryByHop.get('bronze') },
      { id: 'route', stepNumber: '02', label: 'Product Router & FITS Reader', shortTitle: 'Typed scientific input', description: 'Routes each verified product to the full LC decoder or bounded-memory TPF chunk reader.', astronomyGoal: isHistory ? historicalScope : 'Preserve product-specific processing semantics before scientific filtering.', contract: 'fits-product-router-v1', status: upstreamStatus('route'), input: 'Verified local FITS', output: 'LC stream or TPF chunks', metrics: isHistory ? undefined : metricsByHop.get('route'), telemetry: isHistory ? undefined : telemetryByHop.get('route') },
      { id: 'lc-quality', stepNumber: '03A', label: 'LC Cadence Quality Control', shortTitle: 'Quality-valid LC cadences', description: 'Applies quality flags, finite checks, time validity and cadence deduplication to Light Curves.', astronomyGoal: isHistory ? historicalScope : 'Retain scientifically valid photometric cadences with explicit rejection reasons.', contract: 'quality-flag-bitmask-v1/lc', status: upstreamStatus('lc-quality'), input: 'Decoded Light Curve', output: 'Quality-valid LC cadences', metrics: isHistory ? undefined : metricsByHop.get('lc-quality'), telemetry: isHistory ? undefined : telemetryByHop.get('lc-quality') },
      { id: 'lc-transform', stepNumber: '04A', label: 'LC Normalization & Sigma Clip', shortTitle: 'Normalized LC scatter', description: 'Normalizes relative flux by its median and optionally removes configured sigma outliers.', astronomyGoal: isHistory ? historicalScope : 'Measure and reduce LC scatter without mixing pixel-cube semantics.', contract: 'lc-preprocess-v1', status: upstreamStatus('lc-transform'), input: 'Quality-valid LC cadences', output: 'Normalized LC samples', metrics: isHistory ? undefined : metricsByHop.get('lc-transform'), telemetry: isHistory ? undefined : telemetryByHop.get('lc-transform'), scatter_points: isHistory ? undefined : scatterByHop.get('lc-transform') },
      { id: 'lc-parquet', stepNumber: '05A', label: 'LC Parquet Encode', shortTitle: 'LC Parquet artifact', description: 'Encodes the complete normalized Light Curve as checksummed ZSTD Parquet.', astronomyGoal: isHistory ? historicalScope : 'Materialize one immutable columnar Light Curve artifact.', contract: 'silver-lightcurve-v1', status: upstreamStatus('lc-parquet'), input: 'Normalized LC samples', output: 'Finalized LC Parquet', metrics: isHistory ? undefined : metricsByHop.get('lc-parquet'), telemetry: isHistory ? undefined : telemetryByHop.get('lc-parquet'), materialization_points: isHistory ? undefined : materializationByHop.get('lc-parquet'), encode_failures: isHistory ? undefined : encodeFailuresByHop.get('lc-parquet') },
      { id: 'tpf-quality', stepNumber: '03B', label: 'TPF Chunk Decode & Cadence QC', shortTitle: 'Quality-valid TPF chunks', description: 'Reads bounded cadence chunks and applies quality and time-validity filters.', astronomyGoal: isHistory ? historicalScope : 'Validate pixel cadences without loading the full cube into memory.', contract: 'quality-flag-bitmask-v1/tpf-chunk', status: upstreamStatus('tpf-quality'), input: 'Target Pixel FITS', output: 'Quality-valid TPF chunks', metrics: isHistory ? undefined : metricsByHop.get('tpf-quality'), telemetry: isHistory ? undefined : telemetryByHop.get('tpf-quality') },
      { id: 'tpf-transform', stepNumber: '04B', label: 'TPF Temporal Pixel Normalization', shortTitle: 'Normalized pixel chunks', description: 'Normalizes each bounded Target Pixel chunk against its temporal pixel reference.', astronomyGoal: isHistory ? historicalScope : 'Preserve spatial evidence while measuring finite-pixel integrity.', contract: 'tpf-preprocess-v2-chunked', status: upstreamStatus('tpf-transform'), input: 'Quality-valid TPF chunk', output: 'Normalized TPF chunk', metrics: isHistory ? undefined : metricsByHop.get('tpf-transform'), telemetry: isHistory ? undefined : telemetryByHop.get('tpf-transform'), tpf_transform_points: isHistory ? undefined : tpfTransformByHop.get('tpf-transform') },
      { id: 'tpf-parquet', stepNumber: '05B', label: 'TPF Row-Group Append & Finalize', shortTitle: 'TPF Parquet artifact', description: 'Appends each normalized chunk as a Parquet row group, then finalizes the complete artifact.', astronomyGoal: isHistory ? historicalScope : 'Keep memory bounded while producing one durable TPF artifact.', contract: 'silver-target-pixel-v1/chunked', status: upstreamStatus('tpf-parquet'), input: 'Normalized TPF chunks', output: 'Finalized TPF Parquet', metrics: isHistory ? undefined : metricsByHop.get('tpf-parquet'), telemetry: isHistory ? undefined : telemetryByHop.get('tpf-parquet'), materialization_points: isHistory ? undefined : materializationByHop.get('tpf-parquet'), encode_failures: isHistory ? undefined : encodeFailuresByHop.get('tpf-parquet') },
      { id: 'silver', stepNumber: '06', label: 'Silver Upload & Integrity Verify', shortTitle: 'Verified Silver artifacts', description: 'Uploads finalized LC or TPF Parquet and verifies durable size, checksum and metadata.', astronomyGoal: isHistory ? historicalScope : `${silverTotal.toLocaleString()} Silver objects are currently verified.`, contract: 'silver/tess/<product>/processor=<version>/', status: upstreamStatus('silver'), input: 'Finalized local Parquet', output: 'Verified Silver object', metrics: isHistory ? undefined : metricsByHop.get('silver'), telemetry: isHistory ? undefined : telemetryByHop.get('silver'), materialization_points: isHistory ? undefined : materializationByHop.get('silver'), silver_failures: isHistory ? undefined : silverFailuresByHop.get('silver') },
      { id: 'checkpoint', stepNumber: '07', label: 'Crash-Safe Checkpoint Store', shortTitle: 'Durable recovery evidence', description: 'Persists idempotent state only after a Silver artifact has been verified.', astronomyGoal: isHistory ? historicalScope : 'Prove which products can resume by reuse, verification or deterministic reprocessing.', contract: 'checkpoints/preprocessing/objects/<id>.json', status: upstreamStatus('checkpoint'), input: 'Verified Silver object', output: 'Durable recovery decision', metrics: isHistory ? undefined : metricsByHop.get('checkpoint'), telemetry: isHistory ? undefined : telemetryByHop.get('checkpoint'), checkpoint_points: isHistory ? undefined : checkpointPointsByHop.get('checkpoint') },
      { id: 'lineage', stepNumber: '08', label: 'Lineage & Compression Accounting', shortTitle: 'Bronze → Silver storage reduction', description: 'Accounts for every source and output byte while preserving the immutable Bronze-to-Silver identity chain.', astronomyGoal: isHistory ? historicalScope : 'Measure exactly how many GB the Silver representation saves, with LC and TPF attributable separately.', contract: 'lineage/v1/<lineage-id>.json', status: upstreamStatus('lineage'), input: 'Durable checkpoint', output: 'Committed provenance + byte accounting', metrics: isHistory ? undefined : metricsByHop.get('lineage'), telemetry: isHistory ? undefined : telemetryByHop.get('lineage'), materialization_points: isHistory ? undefined : materializationByHop.get('lineage') },
      { id: 'event', stepNumber: '09', label: 'Silver-Ready Durable Publish', shortTitle: 'JetStream publication evidence', description: 'Publishes the verified Silver identity only after checkpoint and lineage commit, then accounts for recovery replays.', astronomyGoal: isHistory ? historicalScope : 'Release only durable, provenance-complete science artifacts and expose actual publish amplification.', contract: 'AURORA_SILVER · aurora.v1.silver.<product>.ready', status: upstreamStatus('event'), input: 'Committed provenance', output: 'Durable Silver-ready emission', metrics: isHistory ? undefined : metricsByHop.get('event'), telemetry: isHistory ? undefined : telemetryByHop.get('event') },
      { id: 'ack', stepNumber: '10', label: 'Bronze Delivery Finalization', shortTitle: 'Durable ACK reconciliation', description: 'Advances the durable consumer ACK floor only after Silver-ready publication succeeds.', astronomyGoal: isHistory ? historicalScope : 'Prove that every Bronze stream position is finalized without confusing redelivery attempts with new data.', contract: 'AURORA_BRONZE · aurora-rust-preprocessor ACK floor', status: upstreamStatus('ack'), input: 'Published Silver-ready event', output: 'Finalized Bronze delivery', metrics: isHistory ? undefined : metricsByHop.get('ack'), telemetry: isHistory ? undefined : telemetryByHop.get('ack') },
      { id: 'gold-pairing', stepNumber: 'G01', label: 'LC + TPF Pairing & Batch Readiness', shortTitle: 'Research-ready target pairs', description: 'Pairs each Silver light curve with its durable Target Pixel context before scientific enrichment.', astronomyGoal: historicalRun ? `${historicalInputs.toLocaleString()} targets entered completed Gold batches.` : `${liveReady.toLocaleString()} eligible LC/TPF pairs; ${(readiness?.missing_tpf ?? 0).toLocaleString()} LC still miss TPF evidence.`, contract: 'research-ready-target-pair-v4', status: historicalRun ? evidencedPhaseStatus('gold-pairing', completedEvents('gold-pairing').some((event) => event.input_records > 0) || completedBatchEvidence, runStatus) : liveFineStatus(0), input: 'Pending Silver Light Curves + TPF contexts', output: 'Eligible target pairs', metrics: historicalRun ? componentMetrics('gold-pairing', historicalInputs, historicalOutputs) : { readiness_observed: readiness ? 1 : 0, input_records: livePendingLC, output_rows: liveReady, pending_lightcurves: livePendingLC, pending_target_pixels: goldControl?.runtime?.pending_by_kind?.TARGET_PIXEL ?? 0, ready_lightcurves: liveReady, waiting_lightcurves: readiness?.waiting_lightcurves ?? 0, missing_tpf: readiness?.missing_tpf ?? 0, tpf_contexts: liveTPF, contracted_lightcurves: readiness?.contracted_lightcurves ?? 0, uncontracted_lightcurves: readiness?.uncontracted_lightcurves ?? 0, max_batch_records: goldControl?.runtime?.max_batch_records ?? 0, idle_flush_seconds: goldControl?.runtime?.idle_flush_seconds ?? 0, active_builds: goldControl?.runtime?.active_builds ?? 0, pending_total: livePending }, telemetry: historicalRun ? componentTelemetry('gold-pairing') : undefined },
      { id: 'gold-catalog', stepNumber: 8, label: 'TIC + TOI Catalog Resolution', shortTitle: 'Verified stellar context', description: 'Resolves immutable TIC stellar parameters and TOI reference evidence for the active target batch.', astronomyGoal: historicalRun ? `${historicalInputs.toLocaleString()} targets have durable catalog enrichment evidence in the selected run.` : catalog?.target_count ? `${catalog.tic_records.toLocaleString()}/${catalog.target_count.toLocaleString()} targets have required TIC context; ${catalog.toi_records.toLocaleString()} TOI association rows observed.` : 'No batch-scoped catalog sync has started.', contract: 'catalog-enrichment-v4', status: historicalRun ? phaseStatus('gold-catalog', 1) : catalogSyncStatus(catalog?.state), input: 'Eligible target pairs', output: 'Verified TIC + TOI context', metrics: historicalRun ? componentMetrics('gold-catalog', historicalInputs, 0) : { catalog_observed: catalog ? 1 : 0, input_records: catalog?.target_count ?? 0, output_rows: liveCatalogRecords, catalog_target_count: catalog?.target_count ?? 0, tic_records: catalog?.tic_records ?? 0, toi_records: catalog?.toi_records ?? 0, catalog_snapshot_count: Object.keys(catalog?.snapshot_ids ?? {}).length, catalog_cache_hit: catalog?.cache_hit ? 1 : 0 }, details: historicalRun ? undefined : { catalog_state: catalog?.state ?? 'IDLE', catalog_mode: catalog?.mode ?? 'ON_DEMAND', tic_snapshot_id: catalog?.snapshot_ids?.TIC ?? '', toi_snapshot_id: catalog?.snapshot_ids?.TOI ?? '', catalog_error: catalog?.error ?? '' }, telemetry: historicalRun ? componentTelemetry('gold-catalog') : undefined },
      { id: 'gold-lc-features', stepNumber: 9, label: 'Light-Curve Statistical Features', shortTitle: 'Cadence and variability evidence', description: 'Computes time coverage, cadence, robust flux distribution, uncertainty and variability summaries.', astronomyGoal: 'Produce deterministic light-curve feature records with a versioned scientific fingerprint.', contract: 'lc-features-v1', status: phaseStatus('gold-lc-features', 2), input: 'Paired Silver light curve', output: 'LC statistical feature rows', metrics: historicalRun ? componentMetrics('gold-lc-features', historicalInputs, historicalOutputs) : { input_records: liveReady, output_rows: 0 }, lc_feature_evidence: historicalRun?.scientific_evidence?.lc_features, telemetry: historicalRun ? componentTelemetry('gold-lc-features') : undefined },
      { id: 'gold-bls', stepNumber: 10, label: 'Box Least Squares Transit Search', shortTitle: 'Periodic transit evidence', description: 'Searches a bounded period-duration grid and records the strongest BLS period, epoch, duration, depth and power.', astronomyGoal: 'Separate an executed search from scientifically unavailable BLS evidence caused by insufficient baseline.', formula: 'arg max P_BLS(period, duration)', contract: 'astropy-box-least-squares / lc-features-v1', status: phaseStatus('gold-bls', 3), input: 'LC statistical feature rows', output: 'BLS transit-search evidence', metrics: historicalRun ? componentMetrics('gold-bls', historicalInputs, 0) : { input_records: liveReady, output_rows: 0 }, bls_search_evidence: historicalRun?.scientific_evidence?.bls_search, telemetry: historicalRun ? componentTelemetry('gold-bls') : undefined },
      { id: 'gold-tpf-evidence', stepNumber: 11, label: 'TPF Spatial Transit Evidence', shortTitle: 'Pixel-level source evidence', description: 'Measures transit-window pixel deficits, centroids and center offset from the paired Target Pixel cube.', astronomyGoal: 'Test whether the flux deficit is spatially consistent with the target rather than a nearby contaminant.', contract: 'tpf-vetting-v2', status: phaseStatus('gold-tpf-evidence', 4), input: 'Paired Silver TPF + BLS ephemeris', output: 'Spatial transit evidence', metrics: historicalRun ? componentMetrics('gold-tpf-evidence', historicalInputs, historicalOutputs) : { input_records: liveTPF, output_rows: 0 }, tpf_spatial_evidence: historicalRun?.scientific_evidence?.tpf_spatial, telemetry: historicalRun ? componentTelemetry('gold-tpf-evidence') : undefined },
      { id: 'gold-candidate', stepNumber: 12, label: 'Candidate Evidence Assembly', shortTitle: 'Research candidate rows', description: 'Combines LC, BLS, TPF and catalog evidence into the canonical candidate schema.', astronomyGoal: historicalRun ? `${historicalOutputs.toLocaleString()} canonical candidate rows are attributable to the selected run.` : 'No candidate assembly run is active.', contract: 'gold-candidate-v4', status: phaseStatus('gold-candidate', 5), input: 'LC features + paired TPF + catalog context', output: 'Canonical candidate rows', metrics: historicalRun ? componentMetrics('gold-candidate', historicalInputs, historicalOutputs) : { input_records: liveReady + liveTPF, output_rows: 0 }, candidate_assembly_evidence: historicalRun?.scientific_evidence?.candidate_assembly, telemetry: historicalRun ? componentTelemetry('gold-candidate') : undefined },
      { id: 'gold-parquet', stepNumber: 13, label: 'Gold Parquet Materialization', shortTitle: 'Immutable candidate artifacts', description: 'Writes partitioned candidate Parquet and verifies manifest, row accounting, object size and digest declarations.', astronomyGoal: historicalRun ? `${artifactCount.toLocaleString()} Gold Parquet artifacts are recorded for the selected run.` : 'No Gold materialization run is active.', contract: 'gold/snapshots/<snapshot-id>/data/candidate/', status: phaseStatus('gold-parquet', 6), input: 'Canonical candidate rows', output: 'Checksummed Gold Parquet', metrics: historicalRun ? componentMetrics('gold-parquet', historicalOutputs, artifactCount) : { input_records: liveReady, output_rows: goldTotal }, gold_materialization_evidence: historicalRun?.scientific_evidence?.gold_materialization, telemetry: historicalRun ? componentTelemetry('gold-parquet') : undefined },
      { id: 'gold-index', stepNumber: 14, label: 'Gold Analytical Projection', shortTitle: 'Queryable candidate rows', description: 'Projects candidate rows, exact Light Curve samples and reviewable cohorts into the analytical store.', astronomyGoal: historicalRun ? `${historicalRun.run.indexed_rows.toLocaleString()} candidate rows are recorded as indexed for this run.` : 'No Gold analytical projection run is active.', contract: 'candidate-features-v1', status: phaseStatus('gold-index', 7), input: 'Checksummed Gold Parquet', output: 'Queryable Gold rows', metrics: historicalRun ? componentMetrics('gold-index', historicalOutputs, historicalOutputs, historicalRun.run.indexed_rows) : { input_records: liveReady, indexed_rows: 0 }, gold_projection_evidence: historicalRun?.scientific_evidence?.gold_projection, telemetry: historicalRun ? componentTelemetry('gold-index') : undefined },
      { id: 'gold-commit', stepNumber: 15, label: 'Gold Snapshot Manifest Commit', shortTitle: 'Immutable Gold snapshot', description: 'Commits the snapshot manifest only after artifacts and analytical rows are verified.', astronomyGoal: historicalRun ? `${historicalRun.run.completed_batches.toLocaleString()} snapshots committed with complete provenance.` : `${goldTotal.toLocaleString()} Gold objects are currently stored.`, contract: 'gold/snapshots/<snapshot-id>/manifest.json', status: goldCommitStatus, input: 'Gold Parquet + analytical projection', output: 'Model-ready Gold footprint', metrics: historicalRun ? { input_records: historicalOutputs, output_rows: historicalOutputs, gold_rows: historicalOutputs, indexed_rows: historicalRun.run.indexed_rows, completed_batches: historicalRun.run.completed_batches } : { input_records: liveReady, gold_objects: goldTotal }, gold_commit_evidence: historicalRun?.scientific_evidence?.gold_commit, telemetry: historicalRun ? componentTelemetry('gold-commit') : undefined },
    ];
    const goldPhaseOrder = ['gold-pairing', 'gold-catalog', 'gold-lc-features', 'gold-bls', 'gold-tpf-evidence', 'gold-candidate', 'gold-parquet', 'gold-index', 'gold-commit'];
    return pipelineHops.map((hop) => {
      const goldIndex = goldPhaseOrder.indexOf(hop.id);
      return goldIndex >= 0 ? { ...hop, stepNumber: `G${String(goldIndex + 1).padStart(2, '0')}` } : hop;
    });
  }, [goldControl, graph, historicalRun, selectedRunID]);

  const run = historicalRun?.run;
  const summary = run ? [
    ['Run state', run.status, run.mode.toUpperCase()],
    ['Elapsed', duration(run.started_at, run.finished_at ?? run.updated_at), `${time(run.started_at)} → ${time(run.finished_at ?? run.updated_at)}`],
    ['Silver input', run.input_records.toLocaleString(), `${run.pending_inputs.toLocaleString()} pending at last state`],
    ['Gold output', run.output_rows.toLocaleString(), `${run.indexed_rows.toLocaleString()} indexed rows`],
    ['Committed batches', run.completed_batches.toLocaleString(), run.last_snapshot_id ?? 'no snapshot'],
  ] : selectedRunID ? [
    ['Run state', historyLoading ? 'LOADING' : 'UNAVAILABLE', selectedRunID],
    ['Elapsed', '—', 'waiting for durable timestamps'],
    ['Silver input', '—', 'waiting for run ledger'],
    ['Gold output', '—', 'waiting for run ledger'],
    ['Committed batches', '—', 'waiting for run ledger'],
  ] : [
    ['Mode', 'LIVE NOW', graph?.run?.mode ?? 'runtime'],
    ['Bronze pending', (graph?.progress?.bronze_pending ?? 0).toLocaleString(), `${(graph?.progress?.bronze_total ?? 0).toLocaleString()} FITS observed`],
    ['Silver artifacts', (graph?.progress?.silver_total ?? 0).toLocaleString(), graph?.progress?.footprint_observed ? 'durable footprint' : 'scanning footprint'],
    ['Gold objects', (graph?.progress?.gold_total ?? 0).toLocaleString(), graph?.progress?.footprint_observed ? 'durable footprint' : 'scanning footprint'],
    ['Gold runtime', goldControl?.runtime?.state ?? 'IDLE', `${goldControl?.runtime?.active_builds ?? 0} active builds`],
  ];

  return (
    <div className="space-y-5">
      <Card className="rounded-none border-border/80 shadow-none">
        <CardHeader className="border-b border-border/70 pb-4">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
            <div className="min-w-0"><p className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.14em] text-primary"><Factory className="size-3.5" />Data Factory analysis workspace</p><CardTitle className="mt-1 text-xl">Pipeline DAG</CardTitle><CardDescription className="mt-1">Nạp live pipeline hoặc một durable run để phân tích dependency, phase và record flow.</CardDescription></div>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <label><span className="sr-only">Pipeline run</span><select aria-label="Pipeline run" className="h-9 w-full rounded-none border border-input bg-background px-3 font-mono text-[10px] uppercase outline-none focus:border-ring sm:w-[400px]" value={selectedRunID} onChange={(event) => selectRun(event.target.value)}><option value="">LIVE NOW · CURRENT PIPELINE</option>{runs.map((item) => <option key={item.run_id} value={item.run_id}>{item.run_id.slice(-12)} · {time(item.started_at)} · {item.mode} · {item.status} · {item.completed_batches} batches</option>)}</select></label>
              <Button variant="outline" size="sm" onClick={() => void refresh()} disabled={loading || historyLoading} className="h-9 rounded-none font-mono text-[9px] uppercase"><RefreshCw className={`size-3.5 ${loading || historyLoading ? 'animate-spin' : ''}`} />Reload evidence</Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="grid gap-px bg-border/60 p-0 sm:grid-cols-2 xl:grid-cols-5">{summary.map(([label, value, detail]) => <SummaryCell key={label} label={label} value={value} detail={detail} />)}</CardContent>
      </Card>

      {selectedRunID ? <div className="flex flex-wrap items-center gap-2 border border-primary/30 bg-primary/5 px-3 py-2 text-xs"><History className="size-3.5 text-primary" /><span>Historical analysis</span><span className="font-mono text-primary">{selectedRunID}</span><span className="text-muted-foreground">· Silver→Gold run scope</span></div> : null}
      {error ? <div className="flex items-center gap-2 border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"><AlertCircle className="size-4" />{error}</div> : null}

      {loading && !graph ? <div className="flex items-center justify-center gap-2 border border-dashed border-border/70 py-24 text-sm text-muted-foreground"><LoaderCircle className="size-4 animate-spin" />Đang tải pipeline contracts…</div> : historyLoading && selectedRunID && !historicalRun ? <div className="flex items-center justify-center gap-2 border border-dashed border-border/70 py-24 text-sm text-muted-foreground"><LoaderCircle className="size-4 animate-spin" />Đang nạp durable run…</div> : selectedRunID && !historicalRun ? <div className="flex items-center justify-center border border-dashed border-destructive/40 py-24 text-sm text-destructive">Không thể nạp evidence cho run đã chọn; DAG live không được dùng thay thế.</div> : (
        <PipelineDagCanvas hops={hops} layout="branched" connections={dagConnections} onSelectHop={(id) => setSelectedHop(hops.find((hop) => hop.id === id))} onPortalContainerChange={setDrawerPortal} />
      )}

      {historicalRun ? <PhaseLedger detail={historicalRun} /> : null}
      <HopDetailDrawer selectedHop={selectedHop} onClose={() => setSelectedHop(undefined)} mode={graph?.run?.mode === 'stream' ? 'stream' : 'batch'} totalFiles={historicalRun?.run.input_records ?? graph?.progress?.bronze_total ?? 0} portalContainer={drawerPortal} />
    </div>
  );
}

function SummaryCell({ label, value, detail }: { label: string; value: string; detail: string }): JSX.Element {
  return <div className="min-w-0 bg-background/90 p-3"><p className="font-mono text-[9px] uppercase tracking-[0.12em] text-muted-foreground">{label}</p><p className="mt-1 truncate font-mono text-sm font-medium" title={value}>{value}</p><p className="mt-1 truncate text-[10px] text-muted-foreground" title={detail}>{detail}</p></div>;
}

function PhaseLedger({ detail }: { detail: FactoryRunDetail }): JSX.Element {
  return (
    <Card className="rounded-none border-border/80 shadow-none">
      <CardHeader className="border-b border-border/70 pb-3"><div className="flex items-end justify-between"><div><CardTitle className="flex items-center gap-2 text-sm"><GitBranch className="size-4 text-primary" />Phase history ledger</CardTitle><CardDescription>Chuỗi component events theo timestamp của run đã chọn.</CardDescription></div><span className="font-mono text-[10px] text-muted-foreground">{detail.components.length} events</span></div></CardHeader>
      <CardContent className="p-0">
        {detail.components.length === 0 ? <div className="p-8 text-center text-xs text-muted-foreground">Run chưa ghi component phase event.</div> : <div className="overflow-x-auto"><table className="w-full min-w-[760px] text-sm"><thead className="border-b bg-muted/30 text-left font-mono text-[9px] uppercase text-muted-foreground"><tr><th className="p-3">Occurred</th><th className="p-3">Phase</th><th className="p-3">State</th><th className="p-3 text-right">Input</th><th className="p-3 text-right">Output</th><th className="p-3 text-right">Indexed</th><th className="p-3">Evidence</th></tr></thead><tbody>{detail.components.map((event, index) => <tr key={`${event.component_id}-${event.occurred_at}-${index}`} className="border-b border-border/60 last:border-0"><td className="p-3 font-mono text-[10px] text-muted-foreground"><Clock3 className="mr-1 inline size-3" />{time(event.occurred_at)}</td><td className="p-3 font-mono text-xs">{event.component_id}</td><td className="p-3"><Badge variant={/FAILED|ERROR/.test(event.status) ? 'destructive' : /COMPLETED/.test(event.status) ? 'default' : 'secondary'} className="rounded-none font-mono text-[9px]">{event.status}</Badge></td><td className="p-3 text-right tabular-nums">{event.input_records.toLocaleString()}</td><td className="p-3 text-right tabular-nums">{event.output_rows.toLocaleString()}</td><td className="p-3 text-right tabular-nums">{event.indexed_rows.toLocaleString()}</td><td className="max-w-64 truncate p-3 font-mono text-[10px] text-muted-foreground" title={event.error || event.snapshot_id}>{event.error || event.snapshot_id || '—'}</td></tr>)}</tbody></table></div>}
      </CardContent>
    </Card>
  );
}
