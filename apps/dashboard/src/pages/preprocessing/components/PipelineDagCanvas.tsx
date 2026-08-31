import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { JSX, MouseEvent } from 'react';
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

type DagLayout = 'grid' | 'reverse-c';
type DagNodeData = HopNodeData & { targetHandle?: Position; sourceHandle?: Position };

function nodePosition(index: number, layout: DagLayout): { x: number; y: number } {
  if (layout === 'reverse-c') {
    const reverseC = [
      { x: 50, y: 60 }, { x: 450, y: 60 }, { x: 850, y: 60 }, { x: 1250, y: 60 },
      { x: 1250, y: 400 }, { x: 1250, y: 740 }, { x: 850, y: 740 }, { x: 450, y: 740 }, { x: 50, y: 740 },
    ];
    return reverseC[index] ?? { x: 50 + (index % 4) * 300, y: 835 + Math.floor((index - 9) / 4) * 260 };
  }
  return { x: (index % 3) * 270 + 50, y: Math.floor(index / 3) * 200 + 40 };
}

function handleDirection(from: { x: number; y: number }, to: { x: number; y: number }): Position {
  if (Math.abs(to.x - from.x) >= Math.abs(to.y - from.y)) return to.x >= from.x ? Position.Right : Position.Left;
  return to.y >= from.y ? Position.Bottom : Position.Top;
}

function opposite(position: Position): Position {
  return { [Position.Top]: Position.Bottom, [Position.Bottom]: Position.Top, [Position.Left]: Position.Right, [Position.Right]: Position.Left }[position];
}

function PreprocessNode({ data, selected }: NodeProps): JSX.Element {
  const hop = data as unknown as DagNodeData;
  return (
    <div
      onClick={(event) => {
        event.stopPropagation();
        hop.onSelect?.();
      }}
      className={`relative w-[230px] rounded-lg border-2 bg-card p-3.5 text-left shadow-lg transition-all ${selected
          ? 'border-primary ring-2 ring-primary/30 shadow-primary/20'
          : 'border-border/80 hover:border-primary/60'
        }`}
    >
      <Handle type="target" position={hop.targetHandle ?? Position.Left} className="!size-2.5 !border-0 !bg-primary" />
      <div className="flex items-center justify-between gap-2 border-b border-border/60 pb-2">
        <span className="flex size-6 items-center justify-center rounded-md bg-primary/15 font-mono text-xs font-bold text-primary">
          {hop.stepNumber}
        </span>
        <Badge
          variant={
            hop.status === 'completed' || hop.status === 'running'
              ? 'default'
              : hop.status === 'failed'
                ? 'destructive'
                : 'outline'
          }
          className="text-[10px] px-1.5 py-0"
        >
          {hop.status}
        </Badge>
      </div>
      <p className="mt-2 text-xs font-bold text-foreground line-clamp-1">{hop.label}</p>
      <p className="mt-1 text-[11px] leading-4 text-muted-foreground line-clamp-2">{hop.astronomyGoal}</p>
      <div className="mt-2.5 flex items-center justify-between text-[10px] text-muted-foreground/80">
        <span className="truncate max-w-[120px] font-mono">{hop.contract.split('/')[0]}</span>
        <span className="text-primary font-medium flex items-center gap-0.5">Chi tiết &rarr;</span>
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
  const edgeData = data as { status?: HopStatus; label?: string } | undefined;
  const status = edgeData?.status ?? 'not_observed';
  const color =
    status === 'running' || status === 'completed' ? '#10b981' : status === 'failed' ? '#ef4444' : '#64748b';
  const markerID = `pipeline-arrow-${id}`;
  return <>
    <defs><marker id={markerID} markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M 0 0 L 8 4 L 0 8 z" fill={color} /></marker></defs>
    <BaseEdge id={id} path={path} markerEnd={`url(#${markerID})`} style={{ stroke: color, strokeWidth: 2.5, strokeDasharray: status === 'running' ? '4 4' : undefined }} />
    {edgeData?.label && <EdgeLabelRenderer><div className="nodrag nopan absolute rounded border border-border/70 bg-background px-2 py-1 text-[10px] font-medium text-muted-foreground shadow-sm" style={{ transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)` }}>{edgeData.label}</div></EdgeLabelRenderer>}
  </>;
}

const nodeTypes = { preprocess: PreprocessNode };
const edgeTypes = { status: StatusEdge };

export function PipelineDagCanvas({
  hops,
  onSelectHop,
  edgeLabels = [],
  layout = 'grid',
  onPortalContainerChange,
}: {
  hops: Hop[];
  onSelectHop: (id: string) => void;
  edgeLabels?: string[];
  layout?: DagLayout;
  onPortalContainerChange?: (container: HTMLElement | null) => void;
}): JSX.Element {
  const canvasRef = useRef<HTMLDivElement>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const openHop = useCallback((id: string): void => {
    onSelectHop(id);
  }, [onSelectHop]);
  const onNodeClick = useCallback(
    (_: MouseEvent, node: { id: string }) => { openHop(node.id); },
    [openHop]
  );

  const initialNodes = useMemo(
    () =>
      hops.map((hop, index) => {
        const position = nodePosition(index, layout);
        const previousPosition = index > 0 ? nodePosition(index - 1, layout) : undefined;
        const nextPosition = index < hops.length - 1 ? nodePosition(index + 1, layout) : undefined;
        return {
          id: hop.id,
          type: 'preprocess',
          position,
          data: {
            ...hop,
            onSelect: () => { openHop(hop.id); },
            targetHandle: previousPosition ? opposite(handleDirection(previousPosition, position)) : Position.Left,
            sourceHandle: nextPosition ? handleDirection(position, nextPosition) : Position.Right,
          },
        };
      }),
    [hops, layout, openHop]
  );

  const initialEdges = useMemo(
    () =>
      hops.slice(0, -1).map((hop, index) => ({
        id: `edge-${index}`,
        source: hop.id,
        target: hops[index + 1].id,
        type: 'status',
        data: { status: hop.status, label: edgeLabels[index] },
      })),
    [edgeLabels, hops]
  );

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  useEffect(() => {
    setNodes((current) =>
      current.map((node) => {
        const hop = hops.find((item) => item.id === node.id);
        if (!hop) return node;
        const index = hops.findIndex((item) => item.id === hop.id);
        const position = nodePosition(index, layout);
        const previousPosition = index > 0 ? nodePosition(index - 1, layout) : undefined;
        const nextPosition = index < hops.length - 1 ? nodePosition(index + 1, layout) : undefined;
        return {
          ...node,
          position,
          data: {
            ...hop,
            onSelect: () => { openHop(hop.id); },
            targetHandle: previousPosition ? opposite(handleDirection(previousPosition, position)) : Position.Left,
            sourceHandle: nextPosition ? handleDirection(position, nextPosition) : Position.Right,
          },
        };
      })
    );
  }, [hops, layout, openHop, setNodes]);

  useEffect(() => {
    setEdges(
      hops.slice(0, -1).map((hop, index) => ({
        id: `edge-${index}`,
        source: hop.id,
        target: hops[index + 1].id,
        type: 'status',
        data: { status: hop.status, label: edgeLabels[index] },
      }))
    );
  }, [edgeLabels, hops, setEdges]);

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
    <Card ref={canvasRef} className={`overflow-hidden border-border/80 shadow-sm ${fullscreen ? 'h-full w-full rounded-none' : ''}`}>
      <CardHeader className="gap-3 md:flex-row md:items-center md:justify-between border-b border-border/60 py-3">
        <div>
          <CardTitle className="text-base font-semibold">Sơ đồ Data Footprint DAG</CardTitle>
          <CardDescription className="text-xs">
            Node là footprint dữ liệu; cạnh là bước biến đổi giữa các tầng. Click node để xem contract và metadata.
          </CardDescription>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="inline-flex items-center gap-1.5">
            <span className="size-2 rounded-full bg-emerald-500" /> Completed / Running
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="size-2 rounded-full bg-amber-500" /> Retrying / Stopping
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="size-2 rounded-full bg-muted-foreground/40" /> Standby
          </span>
          <Button variant="outline" size="sm" className="h-8 gap-1.5" onClick={() => void toggleFullscreen()} title={fullscreen ? 'Thoát toàn màn hình' : 'Mở toàn màn hình'}>
            {fullscreen ? <Minimize2 className="size-3.5" /> : <Maximize2 className="size-3.5" />}
            {fullscreen ? 'Thoát full screen' : 'Full screen'}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <div className={`${fullscreen ? 'h-[calc(100svh-104px)]' : layout === 'reverse-c' ? 'h-[940px]' : 'h-[520px]'} w-full bg-muted/10`}>
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
