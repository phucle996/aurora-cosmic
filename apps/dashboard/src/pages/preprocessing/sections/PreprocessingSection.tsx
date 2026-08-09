import { useCallback, useEffect, useMemo, useState } from 'react';
import type { JSX, MouseEvent } from 'react';
import { ArrowRight, Play, Square, Workflow, X } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from '@/components/ui/drawer';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { apiBase, apiFetch } from '@/lib/api';
import {
  Background,
  BackgroundVariant,
  BaseEdge,
  Controls,
  Handle,
  MarkerType,
  MiniMap,
  Position,
  ReactFlow,
  getBezierPath,
  useEdgesState,
  useNodesState,
  type EdgeProps,
  type NodeProps,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

type HopStatus = 'not_observed' | 'running' | 'completed' | 'retry' | 'failed';
type Hop = {
  id: string;
  label: string;
  description: string;
  contract: string;
  status: HopStatus;
  input: string;
  output: string;
  observed_at?: string;
  metrics?: Record<string, number>;
};
type HopNodeData = Hop & { onSelect?: () => void };

type PreprocessingGraph = {
  status: HopStatus;
  observation_scope: string;
  observed_at: string;
  run?: PreprocessingJob | null;
  progress: {
    checkpoint_total: number;
    checkpoint_completed: number;
    checkpoint_pending: number;
    backlog_pending: number;
    backlog_ack_pending: number;
    items_to_process: number;
    observed_at?: string;
  };
  hops: Array<Pick<Hop, 'id' | 'status' | 'observed_at' | 'metrics'>>;
  edges: Array<{ id: string; source: string; target: string; status: HopStatus }>;
};
type PreprocessingJob = { job_id: string; status: string; mode: string; ingest_run_id?: string; prefix?: string; started_at: string; updated_at: string; error?: string };

type CanvasSelection = { kind: 'hop' | 'edge'; id: string } | null;

const hops: Hop[] = [
  { id: 'bronze', label: 'Bronze FITS', description: 'Immutable source artifact', contract: 'bronze/tess/<product>/sector=<sector>/tic=<tic>/', status: 'not_observed', input: 'NASA FITS', output: 'Verified Bronze object' },
  { id: 'decode', label: 'Decode & validate', description: 'Read FITS and validate product shape', contract: 'product-kind validation', status: 'not_observed', input: 'Bronze FITS', output: 'Validated samples' },
  { id: 'transform', label: 'Scientific transform', description: 'Clean, normalize and derive masks', contract: 'lc-preprocess-v1 / tpf-preprocess-v1 / ffi-preprocess-v1', status: 'not_observed', input: 'Validated samples', output: 'Silver rows' },
  { id: 'silver', label: 'Silver Parquet', description: 'Write, upload and verify Silver', contract: 'silver/tess/<product>/processor=<version>/', status: 'not_observed', input: 'Silver rows', output: 'Verified Parquet' },
  { id: 'checkpoint', label: 'Checkpoint', description: 'Persist crash-safe processing state', contract: 'checkpoints/preprocessing/objects/<id>.json', status: 'not_observed', input: 'Silver verification', output: 'Completed checkpoint' },
  { id: 'lineage', label: 'Lineage commit', description: 'Commit source → Bronze → Silver identity', contract: 'lineage/v1/<lineage-id>.json', status: 'not_observed', input: 'Checkpoint + checksums', output: 'Committed lineage' },
  { id: 'event', label: 'Silver event', description: 'Publish downstream-ready event', contract: 'aurora.v1.silver.<product>.ready', status: 'not_observed', input: 'Committed lineage', output: 'Published event' },
  { id: 'ack', label: 'Bronze ACK', description: 'Acknowledge only after durable output', contract: 'NATS durable consumer ACK', status: 'not_observed', input: 'Published event', output: 'Bronze message ACKed' },
];

const statusCopy: Record<HopStatus, string> = {
  not_observed: 'Not observed', running: 'Running', completed: 'Completed', retry: 'Retrying', failed: 'Failed',
};

function statusClass(status: HopStatus): string {
  if (status === 'completed') return 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300';
  if (status === 'running') return 'border-emerald-500/60 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300';
  if (status === 'retry') return 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300';
  if (status === 'failed') return 'border-destructive/40 bg-destructive/10 text-destructive';
  return 'border-border bg-muted/40 text-muted-foreground';
}

function PreprocessNode({ data, selected }: NodeProps): JSX.Element {
  const hop = data as unknown as HopNodeData;
  const index = hops.findIndex((item) => item.id === hop.id);
  const targetPosition = index === 4 ? Position.Top : Position.Left;
  const sourcePosition = index === 3 ? Position.Bottom : Position.Right;
  return <div onClick={(event) => { event.stopPropagation(); hop.onSelect?.(); }} className={`relative w-[190px] border-2 bg-card px-4 py-3 text-left shadow-sm transition ${selected ? 'border-primary ring-2 ring-primary/20' : 'border-border hover:border-primary/60'}`}>
    <Handle type="target" position={targetPosition} className="!size-2 !border-0 !bg-muted-foreground/60" />
    <div className="flex items-start justify-between gap-2"><span className="flex size-7 items-center justify-center border border-border bg-muted/50 text-xs font-semibold">{index + 1}</span><span className={`mt-2 size-2 rounded-full ${hop.status === 'running' || hop.status === 'completed' ? 'bg-emerald-500' : hop.status === 'failed' ? 'bg-destructive' : hop.status === 'retry' ? 'bg-amber-500' : 'bg-muted-foreground/40'}`} /></div>
    <p className="mt-4 text-sm font-semibold">{hop.label}</p><p className="mt-1 min-h-8 text-xs leading-5 text-muted-foreground">{hop.description}</p><Badge className={`mt-3 border ${statusClass(hop.status)}`} variant="outline">{statusCopy[hop.status]}</Badge>
    <Handle type="source" position={sourcePosition} className="!size-2 !border-0 !bg-muted-foreground/60" />
  </div>;
}

function StatusEdge({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data }: EdgeProps): JSX.Element {
  const [path] = getBezierPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition });
  const status = (data as { status?: HopStatus } | undefined)?.status ?? 'not_observed';
  const color = status === 'running' || status === 'completed' ? '#22c55e' : status === 'retry' ? '#f59e0b' : status === 'failed' ? '#ef4444' : 'hsl(var(--muted-foreground) / 0.35)';
  return <BaseEdge id={id} path={path} markerEnd={{ type: MarkerType.ArrowClosed, color }} style={{ stroke: color, strokeWidth: 2 }} />;
}

const nodeTypes = { preprocess: PreprocessNode };
const edgeTypes = { status: StatusEdge };

export default function PreprocessingSection(): JSX.Element {
  const [selection, setSelection] = useState<CanvasSelection>(null);
  const [drawerSnap, setDrawerSnap] = useState<string | number>(0.45);
  const [graph, setGraph] = useState<PreprocessingGraph | null>(null);
  const [observationError, setObservationError] = useState<string | null>(null);
  const [startMode, setStartMode] = useState<'stream' | 'batch'>('stream');
  const [preprocessingJob, setPreprocessingJob] = useState<PreprocessingJob | null>(null);
  const [startBusy, setStartBusy] = useState(false);
  const [stopBusy, setStopBusy] = useState(false);
  useEffect(() => {
    let mounted = true;
    const loadGraph = () => {
      apiFetch<PreprocessingGraph>('/v1/preprocessing/graph')
        .then((next) => { if (mounted) { setGraph(next); if (next.run?.job_id) setPreprocessingJob(next.run); setObservationError(null); } })
        .catch((error: unknown) => { if (mounted) { setGraph(null); setObservationError(error instanceof Error ? error.message : 'Observation unavailable'); } });
    };
    loadGraph();
    const eventSource = new EventSource(`${apiBase}/v1/events?workflow=preprocessing`);
    eventSource.addEventListener('workflow', (event) => {
      const message = event as MessageEvent<string>;
      try {
        const update = JSON.parse(message.data) as { payload?: PreprocessingJob; status?: string };
        if (update.payload?.job_id) setPreprocessingJob(update.payload);
      } catch {
        // The next graph request remains the source of truth if an event is malformed.
      }
      loadGraph();
    });
    const timer = window.setInterval(loadGraph, 15_000);
    return () => { mounted = false; window.clearInterval(timer); eventSource.close(); };
  }, []);
  const liveHops = useMemo(() => {
    const updates = new Map((graph?.hops ?? []).map((hop) => [hop.id, hop]));
    return hops.map((hop) => ({ ...hop, ...(updates.get(hop.id) ?? {}) }));
  }, [graph]);
  const liveEdges = useMemo(() => {
    const updates = new Map((graph?.edges ?? []).map((edge) => [edge.id, edge]));
    return hops.slice(0, -1).map((hop, index) => ({
      id: `edge-${index}`,
      source: hop.id,
      target: hops[index + 1].id,
      status: updates.get(`edge-${index}`)?.status ?? liveHops[index].status,
    }));
  }, [graph, liveHops]);
  const selectNode = useCallback((id: string) => setSelection({ kind: 'hop', id }), []);
  const onNodeClick = useCallback((_: MouseEvent, node: { id: string }) => selectNode(node.id), [selectNode]);
  const onEdgeClick = useCallback((_: MouseEvent, edge: { id: string }) => setSelection({ kind: 'edge', id: edge.id }), []);
  const initialNodes = useMemo(() => hops.map((hop, index) => ({
    id: hop.id,
    type: 'preprocess',
    position: { x: (index % 4) * 245 + 100, y: index < 4 ? 90 : 330 },
    data: { ...hop, onSelect: () => selectNode(hop.id) },
  })), [selectNode]);
  const initialEdges = useMemo(() => hops.slice(0, -1).map((hop, index) => ({
    id: `edge-${index}`,
    source: hop.id,
    target: hops[index + 1].id,
    type: 'status',
    data: { status: hop.status },
    markerEnd: { type: MarkerType.ArrowClosed },
  })), []);
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);
  useEffect(() => {
    setNodes((current) => current.map((node) => {
      const hop = liveHops.find((item) => item.id === node.id);
      return hop ? { ...node, data: { ...hop, onSelect: (node.data as HopNodeData).onSelect } } : node;
    }));
    setEdges((current) => current.map((edge) => {
      const live = liveEdges.find((item) => item.id === edge.id);
      return live ? { ...edge, data: { status: live.status } } : edge;
    }));
  }, [liveEdges, liveHops, setEdges, setNodes]);
  const selectedHop = selection?.kind === 'hop' ? liveHops.find((hop) => hop.id === selection.id) : undefined;
  const selectedEdge = selection?.kind === 'edge' ? Number(selection.id.replace('edge-', '')) : undefined;
  const edgeFrom = selectedEdge === undefined ? undefined : liveHops[selectedEdge];
  const edgeTo = selectedEdge === undefined ? undefined : liveHops[selectedEdge + 1];
  const selectedEdgeStatus = selectedEdge === undefined ? undefined : liveEdges[selectedEdge]?.status;
  const activeRun = graph?.run ?? preprocessingJob;
  const preprocessingIsRunning = activeRun?.status === 'running' || activeRun?.status === 'accepted' || activeRun?.status === 'cancelling';
  const preprocessingCanStop = activeRun?.status === 'running' || activeRun?.status === 'accepted';

  async function startPreprocessing(): Promise<void> {
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
  }

  async function stopPreprocessing(): Promise<void> {
    if (!activeRun?.job_id) return;
    setStopBusy(true);
    setObservationError(null);
    try {
      const job = await apiFetch<PreprocessingJob>(`/v1/preprocessing/jobs/${encodeURIComponent(activeRun.job_id)}/stop`, { method: 'POST' });
      setPreprocessingJob(job);
      setGraph((current) => current ? { ...current, run: job } : current);
    } catch (error) {
      setObservationError(error instanceof Error ? error.message : 'Không thể dừng preprocessing');
    } finally {
      setStopBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
        <div>
          <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground"><Workflow className="size-4 text-primary" />Scientific pipeline map</div>
          <h2 className="font-heading text-2xl font-semibold tracking-tight md:text-3xl">Preprocessing &amp; Lineage</h2>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">Canvas mô tả từng hop Bronze → Silver và thứ tự commit bảo đảm dữ liệu downstream không bị mất.</p>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2"><select value={startMode} onChange={(event) => setStartMode(event.target.value as 'stream' | 'batch')} className="h-9 border border-border bg-background px-3 text-xs" disabled={preprocessingIsRunning}><option value="stream">Stream new Bronze events</option><option value="batch">Process retained Bronze backlog</option></select><Button onClick={() => void startPreprocessing()} disabled={startBusy || preprocessingIsRunning}><Play />{preprocessingIsRunning ? (activeRun?.status === 'cancelling' ? 'Stopping…' : 'Preprocessing running…') : startBusy ? 'Starting…' : 'Start preprocessing'}</Button>{preprocessingCanStop && <Button variant="destructive" onClick={() => void stopPreprocessing()} disabled={stopBusy}><Square />{stopBusy ? 'Stopping…' : 'Stop preprocessing'}</Button>}{activeRun && <Badge variant="outline">{activeRun.status} · {activeRun.mode}</Badge>}<span className="w-full text-right text-xs text-muted-foreground">{observationError ? 'Live observation unavailable · showing baseline' : graph ? `Live: ${statusCopy[graph.status] ?? graph.status} · ${graph.observation_scope}` : 'Loading live observation…'}</span></div>
      </div>

      {(startMode === 'batch' || activeRun?.mode === 'batch') && graph?.progress && <Card className="rounded-none border-primary/30"><CardHeader className="border-b border-border/60 py-4"><CardTitle className="text-base">{activeRun?.mode === 'batch' ? 'Backlog execution state' : 'Backlog preview'}</CardTitle><CardDescription>Batch bắt đầu từ checkpoint hiện có và chỉ xử lý phần còn lại trong JetStream.</CardDescription></CardHeader><CardContent className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-5"><DetailMetric label="Run / checkpoint" value={`${activeRun?.job_id ?? 'not started'} · ${graph.progress.checkpoint_completed}/${graph.progress.checkpoint_total}`} /><DetailMetric label="Checkpoint pending" value={String(graph.progress.checkpoint_pending)} /><DetailMetric label="JetStream pending" value={String(graph.progress.backlog_pending)} /><DetailMetric label="In-flight / ack pending" value={String(graph.progress.backlog_ack_pending)} /><DetailMetric label="Items to process" value={String(graph.progress.items_to_process)} /></CardContent></Card>}

      <Card className="overflow-hidden">
        <CardHeader className="gap-3 md:flex-row md:items-center md:justify-between"><div><CardTitle>Preprocessing canvas</CardTitle><CardDescription>Click vào node hoặc mũi tên để mở detail drawer từ cạnh dưới.</CardDescription></div><div className="flex flex-wrap gap-2 text-xs"><Legend color="bg-emerald-500" label="completed / running" /><Legend color="bg-amber-500" label="retry" /><Legend color="bg-muted-foreground/40" label="not observed" /></div></CardHeader>
        <CardContent className="p-0"><div className="h-[560px] w-full bg-muted/10"><ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} edgeTypes={edgeTypes} onNodesChange={onNodesChange} onEdgesChange={onEdgesChange} onNodeClick={onNodeClick} onEdgeClick={onEdgeClick} fitView fitViewOptions={{ padding: 0.18 }} minZoom={0.35} maxZoom={1.6} attributionPosition="bottom-left"><Background variant={BackgroundVariant.Dots} gap={22} size={1} /><Controls showInteractive={false} /><MiniMap nodeColor={(node) => node.data?.status === 'running' || node.data?.status === 'completed' ? '#22c55e' : node.data?.status === 'failed' ? '#ef4444' : '#94a3b8'} maskColor="rgb(15 23 42 / 0.08)" /></ReactFlow></div></CardContent>
      </Card>

      <Drawer open={selection !== null} snapPoints={[0.45, 0.82]} activeSnapPoint={drawerSnap} setActiveSnapPoint={(point) => { if (point !== null) setDrawerSnap(point); }} onOpenChange={(open) => { if (open) setDrawerSnap(0.45); else setSelection(null); }}>
        <DrawerContent className="h-[82vh] max-h-[82vh] rounded-none border-t-2 border-primary/30">
          <DrawerHeader className="border-b border-border pr-12 text-left"><div className="flex items-start justify-between gap-4"><div><DrawerTitle>{selectedHop ? selectedHop.label : edgeFrom && edgeTo ? `${edgeFrom.label} → ${edgeTo.label}` : 'Preprocessing detail'}</DrawerTitle><DrawerDescription>{selectedHop?.description ?? 'Transition contract and event boundary.'}</DrawerDescription></div><DrawerClose asChild><Button variant="ghost" size="icon-sm"><X /><span className="sr-only">Close</span></Button></DrawerClose></div></DrawerHeader>
          <div className="overflow-y-auto p-4 md:p-6">{selectedHop ? <HopDetail hop={selectedHop} /> : edgeFrom && edgeTo ? <EdgeDetail from={edgeFrom} to={edgeTo} status={selectedEdgeStatus ?? 'not_observed'} /> : <EmptyDetail />}</div>
        </DrawerContent>
      </Drawer>
    </div>
  );
}

function HopDetail({ hop }: { hop: Hop }): JSX.Element {
  const metricSummary = hop.metrics ? Object.entries(hop.metrics).map(([key, value]) => `${key}: ${value.toFixed(3)}`).join(' · ') : 'No Prometheus samples';
  return <Tabs defaultValue="summary" className="mx-auto max-w-5xl"><TabsList variant="line"><TabsTrigger value="summary">Summary</TabsTrigger><TabsTrigger value="compare">Before / After</TabsTrigger><TabsTrigger value="lineage">Artifacts &amp; lineage</TabsTrigger></TabsList><TabsContent value="summary" className="pt-5"><div className="grid gap-4 md:grid-cols-3"><DetailMetric label="Status" value={statusCopy[hop.status]} /><DetailMetric label="Input" value={hop.input} /><DetailMetric label="Output" value={hop.output} /></div><div className="mt-5 border border-border bg-muted/20 p-4"><p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Contract</p><p className="mt-2 break-all font-mono text-sm text-foreground">{hop.contract}</p></div><p className="mt-4 text-xs text-muted-foreground">Observed at {hop.observed_at ? new Date(hop.observed_at).toLocaleString() : '—'} · {metricSummary}</p></TabsContent><TabsContent value="compare" className="pt-5"><ComparisonEmpty hop={hop} /></TabsContent><TabsContent value="lineage" className="pt-5"><div className="grid gap-4 md:grid-cols-2"><DetailMetric label="Processor version" value={hop.id === 'transform' ? 'product-specific v1' : '—'} /><DetailMetric label="Schema version" value={hop.id === 'silver' ? 'silver-* -v1' : '—'} /><DetailMetric label="Checkpoint" value={hop.status === 'not_observed' ? 'Not observed' : 'Service telemetry only'} /><DetailMetric label="Lineage ID" value={hop.status === 'not_observed' ? 'Not observed' : 'Service telemetry only'} /></div></TabsContent></Tabs>;
}

function EdgeDetail({ from, to, status }: { from: Hop; to: Hop; status: HopStatus }): JSX.Element {
  return <div className="mx-auto max-w-5xl space-y-5"><div className="flex items-center gap-3 border border-border bg-muted/20 p-5"><Badge variant="outline">{from.label}</Badge><ArrowRight className="text-muted-foreground" /><Badge variant="outline">{to.label}</Badge></div><div className="grid gap-4 md:grid-cols-3"><DetailMetric label="Transition state" value={statusCopy[status]} /><DetailMetric label="Event source" value={from.output} /><DetailMetric label="Next contract" value={to.contract} /></div><p className="text-sm text-muted-foreground">Transition state is derived from the preprocessor service metrics.</p></div>;
}

function ComparisonEmpty({ hop }: { hop: Hop }): JSX.Element {
  return <div className="grid gap-4 md:grid-cols-2"><div className="border border-border bg-muted/20 p-5"><p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Before</p><p className="mt-3 text-sm font-medium">{hop.input}</p><p className="mt-1 text-sm text-muted-foreground">Chưa có artifact được chọn.</p></div><div className="border border-border bg-muted/20 p-5"><p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">After</p><p className="mt-3 text-sm font-medium">{hop.output}</p><p className="mt-1 text-sm text-muted-foreground">Chưa có artifact được chọn.</p></div></div>;
}

function DetailMetric({ label, value }: { label: string; value: string }): JSX.Element { return <div className="border border-border bg-muted/20 p-4"><p className="text-xs text-muted-foreground">{label}</p><p className="mt-1 break-all font-medium text-foreground">{value}</p></div>; }
function Legend({ color, label }: { color: string; label: string }): JSX.Element { return <span className="inline-flex items-center gap-1.5"><span className={`size-2 rounded-full ${color}`} />{label}</span>; }
function EmptyDetail(): JSX.Element { return <div className="py-8 text-center text-sm text-muted-foreground">Select a hop or transition.</div>; }
