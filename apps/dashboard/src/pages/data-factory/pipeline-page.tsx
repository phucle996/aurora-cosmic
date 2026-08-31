import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { JSX } from 'react';
import { AlertCircle, Boxes, Database, Factory, LoaderCircle, RefreshCw, Waves } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { apiBase, apiFetch } from '@/lib/api';
import type { GoldControlOverview } from '@/pages/enrichment/types';
import { HopDetailDrawer } from '@/pages/preprocessing/components/HopDetailDrawer';
import { PipelineDagCanvas } from '@/pages/preprocessing/components/PipelineDagCanvas';
import { normalizePreprocessingGraph, type Hop, type HopStatus, type PreprocessingGraph } from '@/pages/preprocessing/types';
import type { FactoryRun, FactoryRunDetail } from './history-types';

function goldBuilderStatus(overview?: GoldControlOverview): HopStatus {
  const state = overview?.runtime?.state;
  if (state === 'RUNNING' || state === 'DRAINING') return 'running';
  return 'not_observed';
}

export default function DataFactoryPipelinePage(): JSX.Element {
	const [searchParams, setSearchParams] = useSearchParams();
  const [graph, setGraph] = useState<PreprocessingGraph>();
  const [goldControl, setGoldControl] = useState<GoldControlOverview>();
  const [runs, setRuns] = useState<FactoryRun[]>([]);
  const [historicalRun, setHistoricalRun] = useState<FactoryRunDetail>();
  const [selectedHop, setSelectedHop] = useState<Hop>();
  const [drawerPortal, setDrawerPortal] = useState<HTMLElement | null>(null);
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(true);
  const refreshTimer = useRef<number | undefined>(undefined);

  const load = useCallback(async (showLoading = true): Promise<void> => {
    if (showLoading) setLoading(true);
    try {
      const [nextGraph, nextGoldControl, nextRuns] = await Promise.all([
        apiFetch<PreprocessingGraph>('/v1/preprocessing/graph'),
        apiFetch<GoldControlOverview>('/v1/gold/control'),
        apiFetch<{ items: FactoryRun[] }>('/v1/data-factory/runs?pipeline=silver_to_gold&limit=100'),
      ]);
      setGraph(normalizePreprocessingGraph(nextGraph));
      setGoldControl(nextGoldControl);
      setRuns(nextRuns.items);
      setError(undefined);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Không tải được Data Factory footprint');
    } finally {
      if (showLoading) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const scheduleRefresh = (): void => {
      if (refreshTimer.current) window.clearTimeout(refreshTimer.current);
      refreshTimer.current = window.setTimeout(() => { void load(false); }, 350);
    };
    const preprocessingEvents = new EventSource(`${apiBase}/v1/events?workflow=preprocessing`);
    const goldEvents = new EventSource(`${apiBase}/v1/events?workflow=gold`);
    preprocessingEvents.onmessage = scheduleRefresh;
    goldEvents.onmessage = scheduleRefresh;
    void load();
    const pollID = window.setInterval(() => { void load(false); }, 15_000);
    return () => {
      preprocessingEvents.close();
      goldEvents.close();
      window.clearInterval(pollID);
      if (refreshTimer.current) window.clearTimeout(refreshTimer.current);
    };
  }, [load]);

  const selectedRunID = searchParams.get('run_id') ?? '';
  useEffect(() => {
    if (!selectedRunID) { setHistoricalRun(undefined); return; }
    void apiFetch<FactoryRunDetail>(`/v1/data-factory/runs/${encodeURIComponent(selectedRunID)}`)
      .then(setHistoricalRun)
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : 'Không tải được lịch sử run'));
  }, [selectedRunID]);

  const hops = useMemo<Hop[]>(() => {
    const bronzePending = graph?.progress?.bronze_pending ?? 0;
    const silverTotal = graph?.progress?.silver_total ?? 0;
    const goldTotal = historicalRun?.run.completed_batches ?? graph?.progress?.gold_total ?? 0;
    const runtimeStatuses = new Map((graph?.hops ?? []).map((hop) => [hop.id, hop.status]));
    const metricsByHop = new Map((graph?.hops ?? []).map((hop) => [hop.id, hop.metrics]));
    const telemetryByHop = new Map((graph?.hops ?? []).map((hop) => [hop.id, hop.telemetry]));
    const lineageMetrics = metricsByHop.get('lineage');
    const goldFootprintMetrics = {
      inventory_observed: graph?.progress?.footprint_observed ? 1 : 0,
      gold_bytes: graph?.progress?.gold_bytes ?? 0,
      gold_objects: goldTotal,
    };
    const preprocessorStatus = (id: string): HopStatus => runtimeStatuses.get(id) ?? graph?.status ?? 'not_observed';
    const historicalStatus = historicalRun?.run.status.toLowerCase();
    const enrichmentStatus: HopStatus = historicalRun
      ? (historicalStatus === 'completed' || historicalStatus === 'frozen' ? 'completed' : historicalStatus === 'failed' ? 'failed' : 'running')
      : goldBuilderStatus(goldControl);
    const historicalComponentStatus = (componentID: string, fallback: HopStatus): HopStatus => {
      const status = historicalRun?.components.filter((event) => event.component_id === componentID).at(-1)?.status.toLowerCase();
      if (status === 'completed' || status === 'frozen') return 'completed';
      if (status === 'failed') return 'failed';
      if (status === 'running' || status === 'draining' || status === 'idle') return 'running';
      return fallback;
    };
    const goldFeatureStatus = historicalComponentStatus('gold-features', enrichmentStatus);
    const goldCommitStatus: HopStatus = historicalRun ? historicalComponentStatus('gold-commit', enrichmentStatus) : (goldTotal > 0 ? 'completed' : enrichmentStatus);
    const goldBatchStatus = historicalComponentStatus('gold-batch', enrichmentStatus);
    const goldBatchMetrics: Record<string, number> = {
      pending_inputs: historicalRun?.run.input_records ?? goldControl?.runtime?.pending_total ?? 0,
      completed_batches: historicalRun?.run.completed_batches ?? 0,
    };
    const goldCommitMetrics: Record<string, number> = historicalRun
      ? { gold_rows: historicalRun.run.output_rows, indexed_rows: historicalRun.run.indexed_rows, completed_batches: historicalRun.run.completed_batches }
      : goldFootprintMetrics;
    return [
      { id: 'bronze', stepNumber: 1, label: 'Bronze FITS Ingestion', shortTitle: 'Bronze source inventory', description: 'Immutable FITS products received from NASA MAST and persisted in the Bronze lakehouse tier.', astronomyGoal: `${bronzePending.toLocaleString()} processable FITS remain without a completed Silver checkpoint.`, contract: 'bronze/tess/<product>/sector=<sector>/tic=<tic>/', status: preprocessorStatus('bronze'), input: 'NASA MAST FITS', output: 'Bronze FITS footprint', metrics: metricsByHop.get('bronze'), telemetry: telemetryByHop.get('bronze') },
      { id: 'decode', stepNumber: 2, label: 'Decode, Quality Mask & Finite Filter', shortTitle: 'Quality-valid samples', description: 'Decodes FITS and filters invalid quality flags and non-finite samples.', astronomyGoal: 'Keep measured, quality-valid LC and TPF cadences.', contract: 'quality-flag-bitmask-v1', status: preprocessorStatus('decode'), input: 'Bronze FITS footprint', output: 'Quality-valid samples', metrics: metricsByHop.get('decode'), telemetry: telemetryByHop.get('decode') },
      { id: 'transform', stepNumber: 3, label: 'Median Normalization & Sigma Clip', shortTitle: 'Normalized science samples', description: 'Normalizes LC flux or TPF pixels and applies configured LC sigma clipping.', astronomyGoal: 'Produce normalized samples suitable for downstream candidate extraction.', contract: 'lc-preprocess-v1 / tpf-preprocess-v2-chunked', status: preprocessorStatus('transform'), input: 'Quality-valid samples', output: 'Normalized science samples', metrics: metricsByHop.get('transform'), telemetry: telemetryByHop.get('transform') },
      { id: 'silver', stepNumber: 4, label: 'Silver Parquet Export', shortTitle: 'Silver artifacts', description: 'Writes and verifies ZSTD Parquet artifacts after scientific preprocessing.', astronomyGoal: `${silverTotal.toLocaleString()} Silver objects are currently materialized.`, contract: 'silver/tess/<product>/processor=<version>/', status: preprocessorStatus('silver'), input: 'Normalized science samples', output: 'Silver Parquet footprint', metrics: metricsByHop.get('silver'), telemetry: telemetryByHop.get('silver') },
      { id: 'checkpoint', stepNumber: 5, label: 'Crash-Safe Checkpoint Store', shortTitle: 'Durable processing state', description: 'Persists idempotent state only after a Silver artifact has been verified.', astronomyGoal: 'Allow safe resume without duplicate processing.', contract: 'checkpoints/preprocessing/objects/<id>.json', status: preprocessorStatus('checkpoint'), input: 'Silver Parquet', output: 'Durable checkpoint', metrics: metricsByHop.get('checkpoint'), telemetry: telemetryByHop.get('checkpoint') },
      { id: 'lineage', stepNumber: 6, label: 'Lineage & Provenance Commit', shortTitle: 'Bronze → Silver provenance', description: 'Commits immutable evidence linking source, Bronze, processor version and Silver output.', astronomyGoal: 'Provide an auditable Bronze-to-Silver identity chain.', contract: 'lineage/v1/<lineage-id>.json', status: preprocessorStatus('lineage'), input: 'Durable checkpoint', output: 'Lineage-traced Silver batch', metrics: lineageMetrics, telemetry: telemetryByHop.get('lineage') },
      { id: 'gold-batch', stepNumber: 7, label: 'Silver Batch Collector', shortTitle: 'Silver → Gold input batch', description: 'Gold Builder collects only observed Silver inputs and waits for the configured stream window.', astronomyGoal: historicalRun ? `${historicalRun.run.input_records.toLocaleString()} Silver inputs were observed in this run.` : `${goldControl?.runtime?.pending_total ?? 0} Silver inputs are waiting for Gold enrichment.`, contract: 'aurora.v1.silver.<product>.ready / control/gold-builder.json', status: goldBatchStatus, input: 'Lineage-traced Silver batch', output: 'Gold build input batch', metrics: goldBatchMetrics },
      { id: 'gold-features', stepNumber: 8, label: 'Candidate Gold Feature Extraction', shortTitle: 'LC + TPF → Candidate', description: 'Combines transit-search features from each light curve with pixel-level TPF evidence.', astronomyGoal: 'Materialize one complete, model-ready candidate record per observed target.', contract: 'research-ready-target-pair-v2 / gold-candidate-v2', status: goldFeatureStatus, input: 'Paired Silver LC + TPF', output: 'Candidate Gold Parquet' },
      { id: 'gold-commit', stepNumber: 9, label: 'Gold Artifact & Manifest Commit', shortTitle: 'Immutable Gold snapshot', description: 'Commits checksummed Parquet artifacts and a manifest that records all Silver inputs.', astronomyGoal: historicalRun ? `${historicalRun.run.output_rows.toLocaleString()} Gold rows and ${historicalRun.run.indexed_rows.toLocaleString()} indexed rows were recorded for this run.` : `${goldTotal.toLocaleString()} Gold artifact objects are currently available.`, contract: 'gold/snapshots/<snapshot-id>/manifest.json', status: goldCommitStatus, input: 'Gold Parquet datasets', output: 'Model-ready Gold footprint', metrics: goldCommitMetrics },
    ];
  }, [goldControl, graph, historicalRun]);

  const bronzeReady = graph?.progress?.bronze_observed ?? false;
  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div><div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground"><Factory className="size-4 text-primary" /> Data Factory observability</div><h2 className="font-heading text-2xl font-semibold tracking-tight md:text-3xl">Pipeline DAG</h2><p className="mt-1 max-w-3xl text-sm text-muted-foreground">9 component xử lý từ Bronze đến Gold; mỗi cạnh biểu diễn footprint dữ liệu chuyển giao giữa các component.</p></div>
        <div className="flex flex-wrap items-center gap-2"><select aria-label="DAG run" className="h-9 max-w-[300px] rounded-md border border-input bg-background px-3 text-sm" value={selectedRunID} onChange={(event) => { const next = new URLSearchParams(searchParams); if (event.target.value) next.set('run_id', event.target.value); else next.delete('run_id'); setSearchParams(next); }}><option value="">Live now</option>{runs.map((run) => <option key={run.run_id} value={run.run_id}>{run.run_id} · {run.mode} · {run.status}</option>)}</select><Button variant="outline" size="sm" onClick={() => void load()} disabled={loading} className="gap-1.5"><RefreshCw className={`size-3.5 ${loading ? 'animate-spin' : ''}`} />Refresh footprint</Button></div>
      </div>
      {historicalRun && <div className="rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-sm text-muted-foreground">Đang phân tích lịch sử <span className="font-mono text-primary">{historicalRun.run.run_id}</span>: {historicalRun.run.input_records.toLocaleString()} Silver input → {historicalRun.run.output_rows.toLocaleString()} Gold rows, {historicalRun.run.completed_batches} batch.</div>}
      {error && <div className="flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"><AlertCircle className="size-4" />{error}</div>}
      <div className="grid gap-3 sm:grid-cols-3">
        <Metric icon={Database} label="Bronze FITS pending" value={bronzeReady ? (graph?.progress?.bronze_pending ?? 0).toLocaleString() : 'Scanning…'} detail={bronzeReady ? `${(graph?.progress?.bronze_total ?? 0).toLocaleString()} FITS in MinIO` : 'Counting processable FITS in MinIO'} />
        <Metric icon={Waves} label="Silver Parquet artifacts" value={(graph?.progress?.silver_total ?? 0).toLocaleString()} detail={graph?.progress?.footprint_observed ? 'observed under silver/' : 'MinIO footprint is scanning…'} />
        <Metric icon={Boxes} label="Gold artifact objects" value={(graph?.progress?.gold_total ?? 0).toLocaleString()} detail={graph?.progress?.footprint_observed ? 'observed under gold/' : 'MinIO footprint is scanning…'} />
      </div>
      {loading && !graph ? <div className="flex items-center justify-center gap-2 py-20 text-sm text-muted-foreground"><LoaderCircle className="animate-spin" />Đang tải Data Factory…</div> : <PipelineDagCanvas hops={hops} layout="reverse-c" edgeLabels={['Bronze FITS', 'Quality-valid samples', 'Normalized science samples', 'Silver Parquet', 'Durable checkpoints', 'Lineage-traced Silver batch', 'Gold feature datasets', 'Gold manifest + Parquet artifacts']} onSelectHop={(id) => setSelectedHop(hops.find((hop) => hop.id === id))} onPortalContainerChange={setDrawerPortal} />}
      <HopDetailDrawer selectedHop={selectedHop} onClose={() => setSelectedHop(undefined)} mode={graph?.run?.mode === 'stream' ? 'stream' : 'batch'} totalFiles={graph?.progress?.bronze_total ?? 0} portalContainer={drawerPortal} />
    </div>
  );
}

function Metric({ icon: Icon, label, value, detail }: { icon: typeof Database; label: string; value: string; detail: string }): JSX.Element {
  return <Card><CardHeader className="pb-2"><CardDescription>{label}</CardDescription><CardTitle className="flex items-center gap-2 text-lg"><Icon className="size-4 text-primary" />{value}</CardTitle></CardHeader><CardContent className="text-xs text-muted-foreground">{detail}</CardContent></Card>;
}
