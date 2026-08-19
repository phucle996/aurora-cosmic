import { useCallback, useEffect, useMemo } from 'react';
import type { JSX, MouseEvent } from 'react';
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

import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { defaultHops, type Hop, type HopNodeData, type HopStatus } from '../types';

function PreprocessNode({ data, selected }: NodeProps): JSX.Element {
  const hop = data as unknown as HopNodeData;
  return (
    <div
      onClick={(event) => {
        event.stopPropagation();
        hop.onSelect?.();
      }}
      className={`relative w-[230px] rounded-lg border-2 bg-card/95 p-3.5 text-left shadow-lg backdrop-blur transition-all ${
        selected
          ? 'border-primary ring-2 ring-primary/30 shadow-primary/20'
          : 'border-border/80 hover:border-primary/60'
      }`}
    >
      <Handle type="target" position={Position.Left} className="!size-2.5 !border-0 !bg-primary" />
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
      <Handle type="source" position={Position.Right} className="!size-2.5 !border-0 !bg-primary" />
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
  const [path] = getBezierPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition });
  const status = (data as { status?: HopStatus } | undefined)?.status ?? 'not_observed';
  const color =
    status === 'running' || status === 'completed' ? '#10b981' : status === 'failed' ? '#ef4444' : '#64748b';
  return (
    <BaseEdge
      id={id}
      path={path}
      markerEnd={{ type: MarkerType.ArrowClosed, color }}
      style={{ stroke: color, strokeWidth: 2.5, strokeDasharray: status === 'running' ? '4 4' : undefined }}
    />
  );
}

const nodeTypes = { preprocess: PreprocessNode };
const edgeTypes = { status: StatusEdge };

export function PipelineDagCanvas({
  hops,
  onSelectHop,
}: {
  hops: Hop[];
  onSelectHop: (id: string) => void;
}): JSX.Element {
  const onNodeClick = useCallback(
    (_: MouseEvent, node: { id: string }) => onSelectHop(node.id),
    [onSelectHop]
  );

  const initialNodes = useMemo(
    () =>
      hops.map((hop, index) => ({
        id: hop.id,
        type: 'preprocess',
        position: { x: (index % 3) * 270 + 50, y: Math.floor(index / 3) * 200 + 40 },
        data: { ...hop, onSelect: () => onSelectHop(hop.id) },
      })),
    [hops, onSelectHop]
  );

  const initialEdges = useMemo(
    () =>
      defaultHops.slice(0, -1).map((hop, index) => ({
        id: `edge-${index}`,
        source: hop.id,
        target: defaultHops[index + 1].id,
        type: 'status',
        data: { status: hop.status },
        markerEnd: { type: MarkerType.ArrowClosed },
      })),
    []
  );

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  useEffect(() => {
    setNodes((current) =>
      current.map((node) => {
        const hop = hops.find((item) => item.id === node.id);
        return hop ? { ...node, data: { ...hop, onSelect: () => onSelectHop(hop.id) } } : node;
      })
    );
  }, [hops, onSelectHop, setNodes]);

  return (
    <Card className="overflow-hidden border-border/80 shadow-sm">
      <CardHeader className="gap-3 md:flex-row md:items-center md:justify-between border-b border-border/60 py-3">
        <div>
          <CardTitle className="text-base font-semibold">Sơ đồ Luồng Pipeline DAG (Interactive Graph)</CardTitle>
          <CardDescription className="text-xs">
            Click vào từng node để mở chi tiết hợp đồng dữ liệu, tham số và liên kết đầu vào/đầu ra.
          </CardDescription>
        </div>
        <div className="flex flex-wrap gap-2 text-xs">
          <span className="inline-flex items-center gap-1.5">
            <span className="size-2 rounded-full bg-emerald-500" /> Completed / Running
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="size-2 rounded-full bg-amber-500" /> Retrying / Stopping
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="size-2 rounded-full bg-muted-foreground/40" /> Standby
          </span>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <div className="h-[520px] w-full bg-muted/10">
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
            <Background variant={BackgroundVariant.Dots} gap={24} size={1} />
            <Controls showInteractive={false} />
            <MiniMap
              nodeColor={(n) =>
                n.data?.status === 'running' || n.data?.status === 'completed'
                  ? '#10b981'
                  : n.data?.status === 'failed'
                  ? '#ef4444'
                  : '#64748b'
              }
              maskColor="rgb(15 23 42 / 0.15)"
            />
          </ReactFlow>
        </div>
      </CardContent>
    </Card>
  );
}
