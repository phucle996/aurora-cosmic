import { useCallback, useEffect, useMemo, useRef, useState, type JSX, type MouseEvent } from 'react';
import { Maximize2, Minimize2 } from 'lucide-react';
import {
  Background,
  BackgroundVariant,
  BaseEdge,
  Controls,
  EdgeLabelRenderer,
  Handle,
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

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { type Hop, type HopNodeData, type HopStatus } from '../types';

type DagLayout = 'grid' | 'reverse-c' | 'branched';
export type DagLane = 'shared' | 'catalog' | 'light-curve' | 'target-pixel' | 'merge' | 'output';
export type DagConnection = { source: string; target: string; label?: string; lane?: DagLane };
type DagNodeData = HopNodeData & { targetHandle?: Position; sourceHandle?: Position };

const BRANCHED_POSITIONS: Record<string, { x: number; y: number }> = {
  bronze: { x: 20, y: 420 },
  route: { x: 390, y: 420 },
  'lc-quality': { x: 780, y: 20 },
  'lc-transform': { x: 1160, y: 20 },
  'lc-parquet': { x: 1540, y: 20 },
  'tpf-quality': { x: 780, y: 820 },
  'tpf-transform': { x: 1160, y: 820 },
  'tpf-parquet': { x: 1540, y: 820 },
  silver: { x: 1940, y: 420 },
  checkpoint: { x: 2320, y: 420 },
  lineage: { x: 2700, y: 420 },
  event: { x: 3080, y: 420 },
  ack: { x: 3460, y: 80 },
  'gold-pairing': { x: 3460, y: 1050 },
  'gold-catalog': { x: 3000, y: 1400 },
  'gold-lc-features': { x: 3460, y: 1400 },
  'gold-bls': { x: 3460, y: 1750 },
  'gold-tpf-evidence': { x: 3920, y: 1750 },
  'gold-candidate': { x: 3460, y: 2100 },
  'gold-parquet': { x: 3000, y: 2100 },
  'gold-index': { x: 2540, y: 2100 },
  'gold-commit': { x: 2080, y: 2100 },
};

function nodePosition(index: number, layout: DagLayout, id?: string): { x: number; y: number } {
  if (layout === 'branched' && id && BRANCHED_POSITIONS[id]) return BRANCHED_POSITIONS[id];
  if (layout === 'reverse-c') {
    const row = Math.floor(index / 4);
    const positionInRow = index % 4;
    const column = row % 2 === 0 ? positionInRow : 3 - positionInRow;
    return { x: 50 + column * 350, y: 60 + row * 250 };
  }
  return { x: (index % 3) * 270 + 50, y: Math.floor(index / 3) * 200 + 40 };
}

function handleDirection(from: { x: number; y: number }, to: { x: number; y: number }): Position {
  if (Math.abs(to.x - from.x) >= Math.abs(to.y - from.y)) return to.x >= from.x ? Position.Right : Position.Left;
  return to.y >= from.y ? Position.Bottom : Position.Top;
}

function averagePosition(positions: Array<{ x: number; y: number }>): { x: number; y: number } | undefined {
  if (positions.length === 0) return undefined;
  return {
    x: positions.reduce((sum, position) => sum + position.x, 0) / positions.length,
    y: positions.reduce((sum, position) => sum + position.y, 0) / positions.length,
  };
}

function PreprocessNode({ data, selected }: NodeProps): JSX.Element {
  const hop = data as unknown as DagNodeData;
  const statusLabel = hop.status === 'not_observed' ? 'standby' : hop.status;
  return (
    <div
      onClick={(event) => {
        event.stopPropagation();
        hop.onSelect?.();
      }}
      className={`relative w-[250px] border bg-card p-3.5 text-left transition-all ${selected
          ? 'border-primary ring-1 ring-primary/30'
          : 'border-border/80 hover:border-primary/60'
        }`}
    >
      <Handle type="target" position={hop.targetHandle ?? Position.Left} className="!size-2.5 !border-0 !bg-primary" />
      <div className="flex items-center justify-between gap-2 border-b border-border/60 pb-2">
        <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-primary">
          Phase {String(hop.stepNumber).padStart(2, '0')}
        </span>
        <Badge
          variant={
            hop.status === 'completed' || hop.status === 'running'
              ? 'default'
              : hop.status === 'failed'
                ? 'destructive'
                : 'outline'
          }
          className="rounded-none px-1.5 py-0 font-mono text-[9px] uppercase"
        >
          {statusLabel}
        </Badge>
      </div>
      <p className="mt-2 line-clamp-1 text-xs font-semibold text-foreground">{hop.label}</p>
      <p className="mt-1 line-clamp-2 text-[10px] leading-4 text-muted-foreground">{hop.astronomyGoal}</p>
      <div className="mt-2.5 border-t border-border/60 pt-2 font-mono text-[9px] text-muted-foreground">
        <p className="truncate" title={hop.input}>{hop.input}</p>
        <p className="my-0.5 text-primary">↓ transforms to</p>
        <p className="truncate" title={hop.output}>{hop.output}</p>
      </div>
      <div className="mt-2 flex items-center justify-between text-[9px] text-muted-foreground/80">
        <span className="max-w-[150px] truncate font-mono">{hop.contract.split('/')[0]}</span>
        <span className="flex items-center gap-0.5 font-medium text-primary">Inspect &rarr;</span>
      </div>
      <Handle type="source" position={hop.sourceHandle ?? Position.Right} className="!size-2.5 !border-0 !bg-primary" />
    </div>
  );
}

function StatusEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
}: EdgeProps): JSX.Element {
  const [path, labelX, labelY] = getBezierPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition });
  const edgeData = data as { status?: HopStatus; label?: string; lane?: DagLane } | undefined;
  const status = edgeData?.status ?? 'not_observed';
  const laneColor: Record<DagLane, string> = {
    shared: '#0ea5e9',
    catalog: '#f59e0b',
    'light-curve': '#22c55e',
    'target-pixel': '#a855f7',
    merge: '#06b6d4',
    output: '#3b82f6',
  };
  const color = status === 'failed' ? '#ef4444' : laneColor[edgeData?.lane ?? 'shared'];
  const markerID = `pipeline-arrow-${id}`;
  return <>
    <defs><marker id={markerID} markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M 0 0 L 8 4 L 0 8 z" fill={color} /></marker></defs>
    <BaseEdge id={id} path={path} markerEnd={`url(#${markerID})`} style={{ stroke: color, strokeWidth: 2.5, strokeDasharray: status === 'running' ? '4 4' : undefined }} />
    {edgeData?.label && <EdgeLabelRenderer><div className="nodrag nopan pointer-events-none absolute whitespace-nowrap rounded border border-border/70 bg-background px-2 py-1 text-[10px] font-medium text-muted-foreground shadow-sm" style={{ transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)` }}>{edgeData.label}</div></EdgeLabelRenderer>}
  </>;
}

const nodeTypes = { preprocess: PreprocessNode };
const edgeTypes = { status: StatusEdge };

export function PipelineDagCanvas({
  hops,
  onSelectHop,
  edgeLabels = [],
  layout = 'grid',
  connections,
  onPortalContainerChange,
}: {
  hops: Hop[];
  onSelectHop: (id: string) => void;
  edgeLabels?: string[];
  layout?: DagLayout;
  connections?: DagConnection[];
  onPortalContainerChange?: (container: HTMLElement | null) => void;
}): JSX.Element {
  const canvasRef = useRef<HTMLDivElement>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const canvasHeight = layout === 'branched' ? 2450 : Math.max(680, Math.ceil(hops.length / 4) * 250 + 100);
  const openHop = useCallback((id: string): void => {
    onSelectHop(id);
  }, [onSelectHop]);
  const onNodeClick = useCallback(
    (_: MouseEvent, node: { id: string }) => { openHop(node.id); },
    [openHop]
  );

  const graphConnections = useMemo<DagConnection[]>(
    () => connections ?? hops.slice(0, -1).map((hop, index) => ({ source: hop.id, target: hops[index + 1].id, label: edgeLabels[index], lane: 'shared' })),
    [connections, edgeLabels, hops]
  );

  const positions = useMemo(
    () => new Map(hops.map((hop, index) => [hop.id, nodePosition(index, layout, hop.id)])),
    [hops, layout]
  );

  const initialNodes = useMemo(
    () =>
      hops.map((hop) => {
        const position = positions.get(hop.id) ?? { x: 0, y: 0 };
        const incoming = graphConnections
          .filter((connection) => connection.target === hop.id)
          .map((connection) => positions.get(connection.source))
          .filter((item): item is { x: number; y: number } => Boolean(item));
        const outgoing = graphConnections
          .filter((connection) => connection.source === hop.id)
          .map((connection) => positions.get(connection.target))
          .filter((item): item is { x: number; y: number } => Boolean(item));
        const incomingCenter = averagePosition(incoming);
        const outgoingCenter = averagePosition(outgoing);
        return {
          id: hop.id,
          type: 'preprocess',
          position,
          data: {
            ...hop,
            onSelect: () => { openHop(hop.id); },
            targetHandle: incomingCenter ? handleDirection(position, incomingCenter) : Position.Left,
            sourceHandle: outgoingCenter ? handleDirection(position, outgoingCenter) : Position.Right,
          },
        };
      }),
    [graphConnections, hops, openHop, positions]
  );

  const initialEdges = useMemo(
    () =>
      graphConnections.map((connection) => ({
        id: `edge-${connection.source}-${connection.target}`,
        source: connection.source,
        target: connection.target,
        type: 'status',
        data: { status: hops.find((hop) => hop.id === connection.source)?.status, label: connection.label, lane: connection.lane },
      })),
    [graphConnections, hops]
  );

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  useEffect(() => {
    setNodes((current) =>
      current.map((node) => {
        const hop = hops.find((item) => item.id === node.id);
        if (!hop) return node;
        const position = positions.get(hop.id) ?? node.position;
        const incomingCenter = averagePosition(graphConnections
          .filter((connection) => connection.target === hop.id)
          .map((connection) => positions.get(connection.source))
          .filter((item): item is { x: number; y: number } => Boolean(item)));
        const outgoingCenter = averagePosition(graphConnections
          .filter((connection) => connection.source === hop.id)
          .map((connection) => positions.get(connection.target))
          .filter((item): item is { x: number; y: number } => Boolean(item)));
        return {
          ...node,
          position,
          data: {
            ...hop,
            onSelect: () => { openHop(hop.id); },
            targetHandle: incomingCenter ? handleDirection(position, incomingCenter) : Position.Left,
            sourceHandle: outgoingCenter ? handleDirection(position, outgoingCenter) : Position.Right,
          },
        };
      })
    );
  }, [graphConnections, hops, openHop, positions, setNodes]);

  useEffect(() => {
    setEdges(
      graphConnections.map((connection) => ({
        id: `edge-${connection.source}-${connection.target}`,
        source: connection.source,
        target: connection.target,
        type: 'status',
        data: { status: hops.find((hop) => hop.id === connection.source)?.status, label: connection.label, lane: connection.lane },
      }))
    );
  }, [graphConnections, hops, setEdges]);

  useEffect(() => {
    const syncFullscreen = () => setFullscreen(document.fullscreenElement === canvasRef.current);
    document.addEventListener('fullscreenchange', syncFullscreen);
    return () => document.removeEventListener('fullscreenchange', syncFullscreen);
  }, []);

  useEffect(() => {
    onPortalContainerChange?.(canvasRef.current);
    return () => onPortalContainerChange?.(null);
  }, [onPortalContainerChange]);

  const toggleFullscreen = async (): Promise<void> => {
    if (document.fullscreenElement === canvasRef.current) {
      await document.exitFullscreen();
      return;
    }
    await canvasRef.current?.requestFullscreen();
  };

  return (
    <Card ref={canvasRef} className={`overflow-hidden rounded-none border-border/80 shadow-none ${fullscreen ? 'h-full w-full' : ''}`}>
      <CardHeader className="gap-3 md:flex-row md:items-center md:justify-between border-b border-border/60 py-3">
        <div>
          <CardTitle className="text-sm font-semibold">Data footprint dependency graph</CardTitle>
          <CardDescription className="text-xs">
            LC, BLS, TPF và catalog được tách thành các nhánh phụ thuộc; các nhánh chỉ hội tụ khi candidate evidence được lắp ráp.
          </CardDescription>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          {layout === 'branched' ? <>
            <span className="inline-flex items-center gap-1.5"><span className="size-2 bg-amber-500" /> Catalog</span>
            <span className="inline-flex items-center gap-1.5"><span className="size-2 bg-emerald-500" /> Light Curve / BLS</span>
            <span className="inline-flex items-center gap-1.5"><span className="size-2 bg-purple-500" /> Target Pixel</span>
            <span className="inline-flex items-center gap-1.5"><span className="size-2 bg-cyan-500" /> Evidence merge</span>
          </> : <>
            <span className="inline-flex items-center gap-1.5"><span className="size-2 rounded-full bg-emerald-500" /> Completed / running</span>
            <span className="inline-flex items-center gap-1.5"><span className="size-2 rounded-full bg-muted-foreground/40" /> Outside scope / standby</span>
          </>}
          <Button variant="outline" size="sm" className="h-8 rounded-none gap-1.5 font-mono text-[9px] uppercase" onClick={() => void toggleFullscreen()} title={fullscreen ? 'Thoát toàn màn hình' : 'Mở toàn màn hình'}>
            {fullscreen ? <Minimize2 className="size-3.5" /> : <Maximize2 className="size-3.5" />}
            {fullscreen ? 'Thoát full screen' : 'Full screen'}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <div className={`${fullscreen ? 'h-[calc(100svh-104px)]' : ''} w-full bg-muted/10`} style={fullscreen ? undefined : { height: layout === 'branched' ? 900 : layout === 'reverse-c' ? canvasHeight : 520 }}>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onNodeClick={onNodeClick}
            fitView
            fitViewOptions={{ padding: 0.2 }}
            minZoom={0.3}
            maxZoom={1.5}
          >
          <Background variant={BackgroundVariant.Dots} gap={24} size={1} color="#315364" />
            <Controls showInteractive={false} />
            <MiniMap
              nodeColor={(n) =>
                n.data?.status === 'running' || n.data?.status === 'completed'
                  ? '#10b981'
                  : n.data?.status === 'failed'
                    ? '#ef4444'
                    : '#64748b'
              }
              maskColor="rgb(3 12 18 / 0.72)"
            />
          </ReactFlow>
        </div>
      </CardContent>
    </Card>
  );
}
