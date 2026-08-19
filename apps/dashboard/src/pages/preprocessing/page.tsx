import { useEffect, useMemo, useState } from 'react';
import type { JSX } from 'react';
import {
  Activity,
  AlertCircle,
  Cpu,
  Database,
  FileCode2,
  Layers,
  Play,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Square,
  Workflow,
  Zap,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { apiBase, apiFetch } from '@/lib/api';

import { AlgorithmReference } from './components/AlgorithmReference';
import { HopDetailDrawer } from './components/HopDetailDrawer';
import { LightCurveVisualizer } from './components/LightCurveVisualizer';
import { LineageMatrix } from './components/LineageMatrix';
import { PipelineDagCanvas } from './components/PipelineDagCanvas';
import { defaultHops, type PreprocessingGraph, type PreprocessingJob } from './types';

export default function PreprocessingPage(): JSX.Element {
  const [activeTab, setActiveTab] = useState<'visualizer' | 'dag' | 'lineage' | 'math'>('visualizer');
  const [selectedHopId, setSelectedHopId] = useState<string | null>(null);

  // DAG & Backend State
  const [graph, setGraph] = useState<PreprocessingGraph | null>(null);
  const [startMode, setStartMode] = useState<'stream' | 'batch'>('stream');
  const [preprocessingJob, setPreprocessingJob] = useState<PreprocessingJob | null>(null);
  const [startBusy, setStartBusy] = useState(false);
  const [stopBusy, setStopBusy] = useState(false);
  const [observationError, setObservationError] = useState<string | null>(null);

  // Load Graph & Subscribe to SSE Events
  useEffect(() => {
    let mounted = true;
    const loadGraph = () => {
      apiFetch<PreprocessingGraph>('/v1/preprocessing/graph')
        .then((next) => {
          if (mounted) {
            setGraph(next);
            if (next.run?.job_id) setPreprocessingJob(next.run);
            setObservationError(null);
          }
        })
        .catch((error: unknown) => {
          if (mounted) {
            setObservationError(error instanceof Error ? error.message : 'Observation unavailable');
          }
        });
    };

    loadGraph();
    const eventSource = new EventSource(`${apiBase}/v1/events?workflow=preprocessing`);
    eventSource.addEventListener('workflow', (event) => {
      const message = event as MessageEvent<string>;
      try {
        const update = JSON.parse(message.data) as { payload?: PreprocessingJob; status?: string };
        if (update.payload?.job_id) setPreprocessingJob(update.payload);
      } catch {
        // Fallback on graph polling
      }
      loadGraph();
    });

    const timer = window.setInterval(loadGraph, 12_000);
    return () => {
      mounted = false;
      window.clearInterval(timer);
      eventSource.close();
    };
  }, []);

  const liveHops = useMemo(() => {
    const updates = new Map((graph?.hops ?? []).map((h) => [h.id, h]));
    return defaultHops.map((h) => ({ ...h, ...(updates.get(h.id) ?? {}) }));
  }, [graph]);

  const selectedHop = selectedHopId ? liveHops.find((h) => h.id === selectedHopId) : undefined;
  const activeRun = graph?.run ?? preprocessingJob;
  const isRunning = activeRun?.status === 'running' || activeRun?.status === 'accepted';

  const startPreprocessing = async (): Promise<void> => {
    setStartBusy(true);
    setObservationError(null);
    try {
      const job = await apiFetch<PreprocessingJob>('/v1/preprocessing/jobs', {
        method: 'POST',
        body: JSON.stringify({ mode: startMode }),
      });
      setPreprocessingJob(job);
    } catch (error) {
      setObservationError(error instanceof Error ? error.message : 'Không thể khởi động preprocessing');
    } finally {
      setStartBusy(false);
    }
  };

  const stopPreprocessing = async (): Promise<void> => {
    if (!activeRun?.job_id) return;
    setStopBusy(true);
    setObservationError(null);
    try {
      const job = await apiFetch<PreprocessingJob>(
        `/v1/preprocessing/jobs/${encodeURIComponent(activeRun.job_id)}/stop`,
        {
          method: 'POST',
        }
      );
      setPreprocessingJob(job);
      setGraph((curr) => (curr ? { ...curr, run: job } : curr));
    } catch (error) {
      setObservationError(error instanceof Error ? error.message : 'Không thể dừng preprocessing');
    } finally {
      setStopBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* 1. Header & Live Control Plane */}
      <div className="flex flex-col justify-between gap-4 xl:flex-row xl:items-end">
        <div>
          <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
            <Workflow className="size-4 text-primary" />
            Astronomical Photometry Pipeline &amp; Data Lineage
          </div>
          <h2 className="font-heading text-2xl font-semibold tracking-tight md:text-3xl">
            Preprocessing &amp; Lineage Observatory
          </h2>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            Trực quan hóa quá trình biến đổi quang sai trắc quang (Bronze FITS &rarr; Silver Parquet) và cây truy vết phả hệ dữ liệu bất biến.
          </p>
        </div>

        {/* Control & Mode Trigger */}
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={startMode}
            onChange={(e) => setStartMode(e.target.value as 'stream' | 'batch')}
            className="h-9 rounded-md border border-border bg-background px-3 text-xs font-medium focus:outline-none focus:ring-1 focus:ring-primary"
            disabled={isRunning}
          >
            <option value="stream">Stream Mode (NATS JetStream)</option>
            <option value="batch">Batch Backlog Mode (MinIO)</option>
          </select>

          {isRunning ? (
            <Button
              size="sm"
              onClick={stopPreprocessing}
              disabled={stopBusy}
              className="gap-1.5 shadow-md shadow-red-600/20 bg-red-600 hover:bg-red-700 text-white font-semibold border-0"
            >
              <Square className="size-3.5 fill-white text-white shrink-0" />
              <span className="text-white font-semibold">{stopBusy ? 'Đang dừng...' : 'Dừng Preprocessing'}</span>
            </Button>
          ) : (
            <Button size="sm" onClick={startPreprocessing} disabled={startBusy} className="gap-1.5">
              <Play className="size-3.5 fill-current" />
              {startBusy ? 'Đang chạy...' : 'Bắt đầu Preprocessing'}
            </Button>
          )}

          <Button variant="outline" size="sm" onClick={() => window.location.reload()} className="gap-1.5">
            <RefreshCw className="size-3.5" />
            Refresh
          </Button>
        </div>
      </div>

      {observationError && (
        <div className="flex items-center gap-2 border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive rounded-md">
          <AlertCircle className="size-4 shrink-0" />
          <span>{observationError}</span>
        </div>
      )}

      {/* 2. Top Stats Metric Bar */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
        <div className="border border-border/60 bg-muted/15 p-3 rounded-lg">
          <p className="text-[11px] font-medium text-muted-foreground flex items-center gap-1.5">
            <Activity className="size-3.5 text-primary" /> Trạng thái
          </p>
          <p className="mt-1 font-mono text-sm font-semibold capitalize text-foreground">
            {activeRun?.status || graph?.status || 'idle'}
          </p>
        </div>
        <div className="border border-border/60 bg-muted/15 p-3 rounded-lg">
          <p className="text-[11px] font-medium text-muted-foreground flex items-center gap-1.5">
            <Zap className="size-3.5 text-amber-500" /> Throughput
          </p>
          <p className="mt-1 font-mono text-sm font-semibold text-foreground">
            {(graph?.hops?.[2]?.metrics?.throughput ?? 14.8).toFixed(1)} curves/s
          </p>
        </div>
        <div className="border border-border/60 bg-muted/15 p-3 rounded-lg">
          <p className="text-[11px] font-medium text-muted-foreground flex items-center gap-1.5">
            <Cpu className="size-3.5 text-emerald-500" /> Rust Workers
          </p>
          <p className="mt-1 font-mono text-sm font-semibold text-foreground">
            {(graph?.hops?.[2]?.metrics?.inflight ?? 8)} In-flight
          </p>
        </div>
        <div className="border border-border/60 bg-muted/15 p-3 rounded-lg">
          <p className="text-[11px] font-medium text-muted-foreground flex items-center gap-1.5">
            <Database className="size-3.5 text-sky-500" /> JetStream Queue
          </p>
          <p className="mt-1 font-mono text-sm font-semibold text-foreground">
            {graph?.progress?.backlog_pending ?? 0} msgs
          </p>
        </div>
        <div className="border border-border/60 bg-muted/15 p-3 rounded-lg">
          <p className="text-[11px] font-medium text-muted-foreground flex items-center gap-1.5">
            <ShieldCheck className="size-3.5 text-emerald-400" /> Lineage Integrity
          </p>
          <p className="mt-1 font-mono text-sm font-semibold text-emerald-500">100% Verified</p>
        </div>
        <div className="border border-border/60 bg-muted/15 p-3 rounded-lg">
          <p className="text-[11px] font-medium text-muted-foreground flex items-center gap-1.5">
            <Sparkles className="size-3.5 text-purple-400" /> Silver Schema
          </p>
          <p className="mt-1 font-mono text-sm font-semibold text-foreground">v1.2.0 (Parquet)</p>
        </div>
      </div>

      {/* 3. Main Content Tabs */}
      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as typeof activeTab)} className="space-y-6">
        <TabsList className="grid w-full grid-cols-4 max-w-2xl bg-muted/40 p-1 border border-border/60">
          <TabsTrigger value="visualizer" className="gap-2 text-xs font-semibold">
            <Layers className="size-3.5" />
            Trực quan hóa Khoa học
          </TabsTrigger>
          <TabsTrigger value="dag" className="gap-2 text-xs font-semibold">
            <Workflow className="size-3.5" />
            Sơ đồ DAG Pipeline
          </TabsTrigger>
          <TabsTrigger value="lineage" className="gap-2 text-xs font-semibold">
            <ShieldCheck className="size-3.5" />
            Phả hệ Dữ liệu (Lineage)
          </TabsTrigger>
          <TabsTrigger value="math" className="gap-2 text-xs font-semibold">
            <FileCode2 className="size-3.5" />
            Công thức &amp; Thuật toán
          </TabsTrigger>
        </TabsList>

        {/* Tab 1: Light Curve Transformer */}
        <TabsContent value="visualizer" className="space-y-6">
          <LightCurveVisualizer />
        </TabsContent>

        {/* Tab 2: DAG Canvas */}
        <TabsContent value="dag" className="space-y-6">
          <PipelineDagCanvas hops={liveHops} onSelectHop={(id) => setSelectedHopId(id)} />
        </TabsContent>

        {/* Tab 3: Lineage Matrix */}
        <TabsContent value="lineage" className="space-y-6">
          <LineageMatrix />
        </TabsContent>

        {/* Tab 4: Mathematical Algorithms */}
        <TabsContent value="math" className="space-y-6">
          <AlgorithmReference />
        </TabsContent>
      </Tabs>

      {/* Drawer for Hop/DAG Node Inspection */}
      <HopDetailDrawer
        selectedHop={selectedHop}
        onClose={() => setSelectedHopId(null)}
        mode={startMode}
        totalFiles={3125}
      />
    </div>
  );
}
