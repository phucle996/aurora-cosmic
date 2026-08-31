import { useEffect, useRef, useState } from 'react';
import type { JSX } from 'react';
import {
  Activity,
  AlertCircle,
  Cpu,
  Database,
  Play,
  RefreshCw,
  Square,
  Workflow,
  Zap,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { apiBase, apiFetch } from '@/lib/api';

import { normalizePreprocessingGraph, type PreprocessingGraph, type PreprocessingJob } from './types';

export default function PreprocessingPage(): JSX.Element {
  // Operational state for the Bronze → Silver worker.
  const [graph, setGraph] = useState<PreprocessingGraph | null>(null);
  const [startMode, setStartMode] = useState<'stream' | 'batch'>('stream');
  const [workerCount, setWorkerCount] = useState(4);
  const [preprocessingJob, setPreprocessingJob] = useState<PreprocessingJob | null>(null);
  const [startBusy, setStartBusy] = useState(false);
  const [stopBusy, setStopBusy] = useState(false);
  const [observationError, setObservationError] = useState<string | null>(null);
  const refreshTimer = useRef<number | null>(null);

  // Load Graph & Subscribe to SSE Events
  useEffect(() => {
    let mounted = true;
    const loadGraph = () => {
      apiFetch<PreprocessingGraph>('/v1/preprocessing/graph')
        .then((next) => {
          if (mounted) {
            const normalized = normalizePreprocessingGraph(next);
            setGraph(normalized);
            if (normalized.run?.job_id) setPreprocessingJob(normalized.run);
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
      // NATS can emit several stage events per file. SSE is only an
      // invalidation signal, so coalesce refetches to keep the UI light.
      if (refreshTimer.current === null) {
        refreshTimer.current = window.setTimeout(() => {
          refreshTimer.current = null;
          loadGraph();
        }, 300);
      }
    });

    const timer = window.setInterval(loadGraph, 12_000);
    return () => {
      mounted = false;
      window.clearInterval(timer);
      if (refreshTimer.current !== null) window.clearTimeout(refreshTimer.current);
      eventSource.close();
    };
  }, []);

  const activeRun = graph?.run ?? preprocessingJob;
  const isRunning = activeRun?.status === 'running' || activeRun?.status === 'accepted';
  const bronzeInventoryReady = graph?.progress?.bronze_observed ?? false;

  const startPreprocessing = async (): Promise<void> => {
    setStartBusy(true);
    setObservationError(null);
    try {
      const job = await apiFetch<PreprocessingJob>('/v1/preprocessing/jobs', {
        method: 'POST',
        body: JSON.stringify({ mode: startMode, worker_count: workerCount }),
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
            Bronze to Silver Preprocessing
          </h2>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            Control plane cho worker Bronze FITS &rarr; Silver Parquet: chọn mode, bắt đầu/dừng và theo dõi tiến độ xử lý thực tế.
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
          <label className="flex h-9 items-center gap-2 rounded-md border border-border bg-background px-2.5 text-xs font-medium">
            Workers
            <input
              type="number"
              min={1}
              max={64}
              value={workerCount}
              onChange={(event) => setWorkerCount(Math.max(1, Math.min(64, Number(event.target.value) || 1)))}
              disabled={isRunning}
              className="w-12 bg-transparent font-mono outline-none"
              aria-label="Số worker preprocessing"
            />
          </label>

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
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
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
            {(graph?.runtime?.throughput ?? 0).toFixed(2)} files/s
          </p>
        </div>
        <div className="border border-border/60 bg-muted/15 p-3 rounded-lg">
          <p className="text-[11px] font-medium text-muted-foreground flex items-center gap-1.5">
            <Cpu className="size-3.5 text-emerald-500" /> Rust Workers
          </p>
          <p className="mt-1 font-mono text-sm font-semibold text-foreground">
            {graph?.runtime?.actual_workers ?? 0} / {graph?.runtime?.desired_workers ?? activeRun?.worker_count ?? workerCount}
          </p>
        </div>
        <div className="border border-border/60 bg-muted/15 p-3 rounded-lg">
          <p className="text-[11px] font-medium text-muted-foreground flex items-center gap-1.5">
            <Database className="size-3.5 text-sky-500" /> Bronze chờ xử lý
          </p>
          <p className="mt-1 font-mono text-sm font-semibold text-foreground">
            {bronzeInventoryReady ? `${(graph?.progress?.bronze_pending ?? 0).toLocaleString()} FITS` : 'Đang quét…'}
          </p>
          <p className="mt-1 text-[10px] text-muted-foreground">
            {bronzeInventoryReady
              ? `${(graph?.progress?.bronze_completed ?? 0).toLocaleString()} hoàn tất · ${(graph?.progress?.bronze_failed ?? 0).toLocaleString()} lỗi terminal`
              : 'Đang đếm Bronze FITS trong MinIO…'}
          </p>
        </div>
        <div className="border border-border/60 bg-muted/15 p-3 rounded-lg">
          <p className="text-[11px] font-medium text-muted-foreground flex items-center gap-1.5">
            <Activity className="size-3.5 text-emerald-400" /> Đang xử lý
          </p>
          <p className="mt-1 font-mono text-sm font-semibold text-foreground">{graph?.runtime?.processing ?? 0} file</p>
        </div>
        <div className="border border-border/60 bg-muted/15 p-3 rounded-lg">
          <p className="text-[11px] font-medium text-muted-foreground flex items-center gap-1.5">
            <AlertCircle className="size-3.5 text-rose-400" /> Kết quả runtime
          </p>
          <p className="mt-1 font-mono text-sm font-semibold text-foreground">{graph?.runtime?.completed ?? 0} xong · {graph?.runtime?.failed ?? 0} lỗi</p>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.4fr_0.6fr]">
        <Card>
          <CardHeader className="border-b border-border/60 pb-3">
            <CardTitle className="flex items-center gap-2 text-base"><Cpu className="size-4 text-primary" />Worker Runtime</CardTitle>
            <CardDescription>State thực nhận qua NATS Core; object key chỉ hiện khi worker đang xử lý.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-3">
            {(graph?.runtime?.workers ?? []).length === 0 ? <p className="col-span-full py-5 text-center text-sm text-muted-foreground">Chưa có worker runtime event. Khi Start, các worker spawn thật sẽ xuất hiện ở đây.</p> : (graph?.runtime?.workers ?? []).map((worker) => (
              <div key={worker.worker_id} className="rounded-lg border border-border/70 bg-muted/15 p-3">
                <div className="flex items-center justify-between gap-2"><span className="font-mono text-xs font-semibold">{worker.worker_id}</span><span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${worker.state === 'processing' ? 'bg-primary/15 text-primary' : worker.state === 'failed' ? 'bg-destructive/15 text-destructive' : 'bg-muted text-muted-foreground'}`}>{worker.state}</span></div>
                <p className="mt-2 truncate font-mono text-[11px] text-foreground" title={worker.object_key}>{worker.object_key || 'Không có file active'}</p>
                <p className="mt-1 text-[11px] text-muted-foreground">{worker.product_kind || '—'} · {worker.stage || 'idle'}</p>
                <div className="mt-2 flex justify-between border-t border-border/50 pt-2 font-mono text-[10px] text-muted-foreground"><span>{worker.completed} done · {worker.failed} fail</span><span>{worker.last_duration_ms ? `${worker.last_duration_ms} ms` : '—'}</span></div>
              </div>
            ))}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="border-b border-border/60 pb-3"><CardTitle className="text-base">Recent trace</CardTitle><CardDescription>Buffer tối đa 200 lifecycle events, không phải log stream.</CardDescription></CardHeader>
          <CardContent className="max-h-[360px] space-y-2 overflow-y-auto p-3">
            {(graph?.runtime?.trace ?? []).slice(-20).reverse().map((event, index) => <div key={`${event.occurred_at}-${index}`} className="border-l-2 border-primary/50 pl-2 text-[11px]"><p className="font-mono text-foreground">{event.worker_id || 'pool'} · {event.event}</p><p className="truncate text-muted-foreground" title={event.object_key}>{event.stage || '—'} {event.object_key ? `· ${event.object_key}` : ''} {event.elapsed_ms ? `· ${event.elapsed_ms} ms` : ''}</p></div>)}
            {(graph?.runtime?.trace ?? []).length === 0 && <p className="py-5 text-center text-sm text-muted-foreground">Chưa có trace runtime.</p>}
          </CardContent>
        </Card>
      </div>

    </div>
  );
}
