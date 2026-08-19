import { useCallback, useEffect, useMemo, useState } from 'react';
import type { JSX } from 'react';
import {
  Activity,
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  ChevronRight,
  Cpu,
  Database,
  Eye,
  FileCode2,
  Filter,
  Layers,
  Orbit,
  Play,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  Square,
  Wand2,
  Workflow,
  X,
  Zap,
} from 'lucide-react';
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

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
import { Input } from '@/components/ui/input';
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

// ============================================================================
// TYPES & DATA DEFINITIONS
// ============================================================================

type HopStatus = 'not_observed' | 'running' | 'completed' | 'retry' | 'failed' | 'cancelling' | 'canceled';

type Hop = {
  id: string;
  stepNumber: number;
  label: string;
  shortTitle: string;
  description: string;
  astronomyGoal: string;
  formula?: string;
  contract: string;
  status: HopStatus;
  input: string;
  output: string;
  observed_at?: string;
  metrics?: Record<string, number>;
  details?: Record<string, string>;
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

type PreprocessingJob = {
  job_id: string;
  status: string;
  mode: string;
  ingest_run_id?: string;
  prefix?: string;
  started_at: string;
  updated_at: string;
  error?: string;
};

type LineageRecord = {
  tic_id: string;
  sector: number;
  target_name: string;
  planet_type: string;
  source_fits_key: string;
  source_sha256: string;
  preprocessor_version: string;
  run_id: string;
  silver_parquet_key: string;
  silver_sha256: string;
  silver_records: number;
  processed_at: string;
  integrity: 'VERIFIED' | 'PENDING' | 'CORRUPTED';
  features: {
    transit_depth_ppm: number;
    period_days: number;
    duration_hours: number;
    snr: number;
    odd_even_mismatch: number;
    radius_earth: number;
  };
};

const defaultHops: Hop[] = [
  {
    id: 'bronze',
    stepNumber: 1,
    label: 'Bronze FITS Ingestion',
    shortTitle: '1. FITS Header & Flux',
    description: 'Đọc tệp FITS nhị phân nguyên bản từ NASA MAST, kiểm tra tính toàn vẹn HDU.',
    astronomyGoal: 'Trích xuất cột thời gian BJD (Barycentric Julian Date), SAP_FLUX và PDCSAP_FLUX.',
    contract: 'bronze/tess/<product>/sector=<sector>/tic=<tic>/',
    status: 'not_observed',
    input: 'NASA MAST FITS (Binary Table)',
    output: 'Raw Time Series & Metadata',
  },
  {
    id: 'decode',
    stepNumber: 2,
    label: 'Quality Masking & NaN Filter',
    shortTitle: '2. Lọc Cờ Chất Lượng',
    description: 'Loại bỏ các điểm đo bị lỗi định hướng vệ tinh, momentum dump, hoặc tia vũ trụ trực tiếp.',
    astronomyGoal: 'Áp dụng bitmask QUALITY == 0 và loại bỏ NaN/Inf để đảm bảo chuỗi dữ liệu liên tục.',
    formula: 'Flag \\& 0b1011111111111111 == 0',
    contract: 'quality-flag-bitmask-v1',
    status: 'not_observed',
    input: 'Raw Time Series (17,649 pts)',
    output: 'Valid Photometry Points',
  },
  {
    id: 'transform',
    stepNumber: 3,
    label: 'Spline Detrending & 5σ Outlier Rejection',
    shortTitle: '3. Khử Xu Hướng & Nhiễu 5σ',
    description: 'Khử biến thiên chu kỳ dài của sao mẹ và loại bỏ nhiễu cực đại bằng Spline / Median Filter.',
    astronomyGoal: 'Chuẩn hóa thông lượng quanh mức 1.0 (Relative Flux) và loại bỏ hiện tượng trôi nhiệt camera.',
    formula: 'F_{norm}(t) = \\frac{F(t)}{S_{trend}(t)}, \\quad |F_{norm} - 1.0| < 5\\sigma',
    contract: 'lc-preprocess-v1 / tpf-preprocess-v1',
    status: 'not_observed',
    input: 'Valid Photometry Points',
    output: 'Detrended Normalized Flux',
  },
  {
    id: 'silver',
    stepNumber: 4,
    label: 'BLS Search & Silver Parquet Export',
    shortTitle: '4. Gập Pha & Silver Parquet',
    description: 'Thuật toán Box Least Squares (BLS) dò tìm tín hiệu transit định kỳ và gập pha từ 0 đến 1.',
    astronomyGoal: 'Trích xuất độ sâu trũng sáng (Transit Depth), chu kỳ quỹ đạo P và xuất file Parquet nén Snappy.',
    formula: '\\phi(t) = \\left( \\frac{t - T_0}{P} \\right) \\bmod 1.0',
    contract: 'silver/tess/<product>/processor=v1.2.0/',
    status: 'not_observed',
    input: 'Detrended Normalized Flux',
    output: 'Silver Parquet & Phase Dips',
  },
  {
    id: 'checkpoint',
    stepNumber: 5,
    label: 'Crash-Safe Checkpoint Store',
    shortTitle: '5. Lưu Vết Checkpoint',
    description: 'Ghi nhận trạng thái hoàn tất vào MinIO để đảm bảo tính an toàn chống sập (Idempotent).',
    astronomyGoal: 'Bảo đảm pipeline có thể resume bất kỳ lúc nào mà không xử lý trùng lặp đối tượng.',
    contract: 'checkpoints/preprocessing/objects/<id>.json',
    status: 'not_observed',
    input: 'Silver Verification',
    output: 'Durable MinIO Checkpoint',
  },
  {
    id: 'lineage',
    stepNumber: 6,
    label: 'Lineage & Provenance Commit',
    shortTitle: '6. Khóa Phả Hệ Lineage',
    description: 'Tạo liên kết bất biến giữa Bronze Hash (SHA-256) → Thuật toán Rust v1.2.0 → Silver Hash.',
    astronomyGoal: 'Truy vết 100% nguồn gốc khoa học cho mọi ứng viên hành tinh downstream ML.',
    contract: 'lineage/v1/<lineage-id>.json',
    status: 'not_observed',
    input: 'Bronze + Silver Hashes',
    output: 'Committed Lineage Proof',
  },
];

// Dữ liệu mẫu thực tế cho 3 loại thiên thể khác nhau
const sampleTargets: Record<
  string,
  {
    name: string;
    description: string;
    type: string;
    period: number;
    depth: number;
    duration: number;
    radius: number;
    snr: number;
    rawNoise: number;
    stellarDriftAmp: number;
  }
> = {
  'TIC 246980040': {
    name: 'TIC 246980040 (TOI-700 d / Super-Earth Transit)',
    description: 'Ứng viên siêu Trái Đất trong vùng có thể sống được (Habitable Zone), độ sâu trũng 1,420 ppm.',
    type: 'Super-Earth Exoplanet Candidate',
    period: 3.842,
    depth: 0.0142,
    duration: 2.35,
    radius: 1.18,
    snr: 28.4,
    rawNoise: 0.0055,
    stellarDriftAmp: 0.028,
  },
  'TIC 246980806': {
    name: 'TIC 246980806 (Hot Jupiter Giant Transit)',
    description: 'Hành tinh khí khổng lồ chu kỳ siêu ngắn (Hot Jupiter) quay sát sao mẹ, trũng transit sâu 2.1%.',
    type: 'Hot Jupiter Gas Giant',
    period: 1.825,
    depth: 0.0215,
    duration: 3.12,
    radius: 11.2,
    snr: 46.8,
    rawNoise: 0.0042,
    stellarDriftAmp: 0.035,
  },
  'TIC 246979427': {
    name: 'TIC 246979427 (Detached Eclipsing Binary Star)',
    description: 'Hệ sao đôi che khuất (Eclipsing Binary) với trũng sáng chính sâu và trũng phụ chu kỳ 5.2 ngày.',
    type: 'Eclipsing Binary Variable',
    period: 5.214,
    depth: 0.045,
    duration: 4.8,
    radius: 18.5,
    snr: 64.2,
    rawNoise: 0.006,
    stellarDriftAmp: 0.018,
  },
};

// Dữ liệu Lineage mẫu để người dùng tra cứu
const sampleLineageRecords: LineageRecord[] = [
  {
    tic_id: '246980040',
    sector: 42,
    target_name: 'TIC 246980040',
    planet_type: 'Super-Earth Candidate',
    source_fits_key: 'bronze/tess/lightcurve/sector=0042/tic=246980040/tess2021232031932-s0042-0000000246980040-0213-s_lc.fits',
    source_sha256: '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08',
    preprocessor_version: 'rust-preprocessor:v1.2.0 (ASTRO-VET-OPSET17)',
    run_id: 'preprocess-job-7b914ca2',
    silver_parquet_key: 'silver/tess/lightcurve/processor=v1.2.0/sector=0042/tic=246980040.parquet',
    silver_sha256: '5e884898da28047151d0e56f8dc6292773603d0d6aabbdd62a11ef721d1542d8',
    silver_records: 17420,
    processed_at: '2026-08-19T05:30:15Z',
    integrity: 'VERIFIED',
    features: {
      transit_depth_ppm: 1420,
      period_days: 3.842,
      duration_hours: 2.35,
      snr: 28.4,
      odd_even_mismatch: 0.02,
      radius_earth: 1.18,
    },
  },
  {
    tic_id: '246980806',
    sector: 42,
    target_name: 'TIC 246980806',
    planet_type: 'Hot Jupiter Giant',
    source_fits_key: 'bronze/tess/lightcurve/sector=0042/tic=246980806/tess2021232031932-s0042-0000000246980806-0213-s_lc.fits',
    source_sha256: '4b227777d4dd1fc61c6f884f48641d02b4d121d3fd328cb08b5531fcacdabf8a',
    preprocessor_version: 'rust-preprocessor:v1.2.0 (ASTRO-VET-OPSET17)',
    run_id: 'preprocess-job-7b914ca2',
    silver_parquet_key: 'silver/tess/lightcurve/processor=v1.2.0/sector=0042/tic=246980806.parquet',
    silver_sha256: 'ef2d127de37b942baad06145e54b0c619a1f22327b2ebbcfbec78f5564afe39d',
    silver_records: 17510,
    processed_at: '2026-08-19T05:30:18Z',
    integrity: 'VERIFIED',
    features: {
      transit_depth_ppm: 21500,
      period_days: 1.825,
      duration_hours: 3.12,
      snr: 46.8,
      odd_even_mismatch: 0.01,
      radius_earth: 11.2,
    },
  },
  {
    tic_id: '246979427',
    sector: 42,
    target_name: 'TIC 246979427',
    planet_type: 'Eclipsing Binary',
    source_fits_key: 'bronze/tess/lightcurve/sector=0042/tic=246979427/tess2021232031932-s0042-0000000246979427-0213-s_lc.fits',
    source_sha256: 'ef2d127de37b942baad06145e54b0c619a1f22327b2ebbcfbec78f5564afe39d',
    preprocessor_version: 'rust-preprocessor:v1.2.0 (ASTRO-VET-OPSET17)',
    run_id: 'preprocess-job-7b914ca2',
    silver_parquet_key: 'silver/tess/lightcurve/processor=v1.2.0/sector=0042/tic=246979427.parquet',
    silver_sha256: '8c6976e5b5410415bde908bd4dee15dfb167a9c873fc4bb8a81f6f2ab448a918',
    silver_records: 17380,
    processed_at: '2026-08-19T05:30:22Z',
    integrity: 'VERIFIED',
    features: {
      transit_depth_ppm: 45000,
      period_days: 5.214,
      duration_hours: 4.8,
      snr: 64.2,
      odd_even_mismatch: 0.15,
      radius_earth: 18.5,
    },
  },
];

// Helper sinh chuỗi đường cong ánh sáng mô phỏng toán học thực tế
function generateLightCurvePoints(
  targetKey: string,
  isPhaseFolded: boolean,
) {
  const target = sampleTargets[targetKey] || sampleTargets['TIC 246980040'];
  const points = [];
  const count = isPhaseFolded ? 120 : 180;
  const timeSpanDays = 14.0; // 14 ngày quan sát TESS Sector

  for (let i = 0; i < count; i++) {
    let t = (i / (count - 1)) * timeSpanDays;
    let phase = 0;

    if (isPhaseFolded) {
      // Phase từ -0.5 đến 0.5
      phase = (i / (count - 1)) - 0.5;
      t = phase * target.period;
    } else {
      phase = ((t % target.period) / target.period) - 0.5;
    }

    // 1. Stellar background drift (xu hướng sao biến quang chu kỳ dài + trôi nhiệt)
    const drift = 1.0 + target.stellarDriftAmp * Math.sin((2 * Math.PI * t) / 7.2) + 0.008 * Math.cos((2 * Math.PI * t) / 3.1);

    // 2. Transit dip model (Box / U-shape Transit Dip khi phase quanh 0.0)
    const transitWidthPhase = (target.duration / 24.0) / target.period;
    let transitDip = 0;
    if (Math.abs(phase) < transitWidthPhase / 2) {
      // Làm mềm góc đáy trũng
      const edge = Math.abs(phase) / (transitWidthPhase / 2);
      const ingressFactor = edge > 0.7 ? 1.0 - (edge - 0.7) / 0.3 : 1.0;
      transitDip = target.depth * ingressFactor;
    }

    // 3. Outlier spike (5 sigma cosmic rays) xuất hiện ngẫu nhiên ở 3-4 điểm
    let outlierSpike = 0;
    const isOutlier = !isPhaseFolded && (i === 28 || i === 85 || i === 142);
    if (isOutlier) {
      outlierSpike = (i % 2 === 0 ? 1 : -1) * (0.028 + Math.random() * 0.015);
    }

    // 4. White noise
    const pseudoRandom = Math.sin(i * 999.13 + t * 45.2) * 0.5 + Math.cos(i * 333.7) * 0.5;
    const noise = pseudoRandom * target.rawNoise;

    const rawFlux = drift - transitDip * drift + noise + outlierSpike;
    const trendFlux = drift;
    const normalizedFlux = (rawFlux - outlierSpike) / drift;
    const foldedFlux = 1.0 - transitDip + noise * 0.8;

    points.push({
      index: i,
      timeBjd: Number((2459000 + t).toFixed(3)),
      phase: Number(phase.toFixed(4)),
      rawFlux: Number(rawFlux.toFixed(5)),
      trendFlux: Number(trendFlux.toFixed(5)),
      normalizedFlux: Number(normalizedFlux.toFixed(5)),
      foldedFlux: Number(foldedFlux.toFixed(5)),
      outlierPoint: isOutlier ? Number(rawFlux.toFixed(5)) : null,
      isOutlier,
    });
  }

  return points;
}

// ============================================================================
// REACT FLOW CUSTOM NODES & EDGES
// ============================================================================

function PreprocessNode({ data, selected }: NodeProps): JSX.Element {
  const hop = data as unknown as HopNodeData;
  return (
    <div
      onClick={(event) => {
        event.stopPropagation();
        hop.onSelect?.();
      }}
      className={`relative w-[230px] rounded-lg border-2 bg-card/95 p-3.5 text-left shadow-lg backdrop-blur transition-all ${
        selected ? 'border-primary ring-2 ring-primary/30 shadow-primary/20' : 'border-border/80 hover:border-primary/60'
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

function StatusEdge({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data }: EdgeProps): JSX.Element {
  const [path] = getBezierPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition });
  const status = (data as { status?: HopStatus } | undefined)?.status ?? 'not_observed';
  const color = status === 'running' || status === 'completed' ? '#10b981' : status === 'failed' ? '#ef4444' : '#64748b';
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

// ============================================================================
// MAIN PREPROCESSING SECTION COMPONENT
// ============================================================================

export default function PreprocessingSection(): JSX.Element {
  const [activeTab, setActiveTab] = useState<'visualizer' | 'dag' | 'lineage' | 'math'>('visualizer');
  const [selectedTargetKey, setSelectedTargetKey] = useState<string>('TIC 246980040');
  const [isPhaseFolded, setIsPhaseFolded] = useState<boolean>(false);
  const [activeStep, setActiveStep] = useState<number>(3); // Bước đang chọn trong walkthrough

  // Layer Toggles
  const [showRawFlux, setShowRawFlux] = useState<boolean>(true);
  const [showTrend, setShowTrend] = useState<boolean>(true);
  const [showNormalized, setShowNormalized] = useState<boolean>(true);
  const [showOutliers, setShowOutliers] = useState<boolean>(true);

  // Lineage search state
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedLineageRecord, setSelectedLineageRecord] = useState<LineageRecord | null>(sampleLineageRecords[0]);

  // DAG & Backend State
  const [selection, setSelection] = useState<{ kind: 'hop'; id: string } | null>(null);
  const [drawerSnap, setDrawerSnap] = useState<string | number>(0.5);
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

  const selectNode = useCallback((id: string) => setSelection({ kind: 'hop', id }), []);
  const onNodeClick = useCallback((_: React.MouseEvent, node: { id: string }) => selectNode(node.id), [selectNode]);

  const initialNodes = useMemo(
    () =>
      liveHops.map((hop, index) => ({
        id: hop.id,
        type: 'preprocess',
        position: { x: (index % 3) * 270 + 50, y: Math.floor(index / 3) * 200 + 40 },
        data: { ...hop, onSelect: () => selectNode(hop.id) },
      })),
    [liveHops, selectNode]
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
        const hop = liveHops.find((item) => item.id === node.id);
        return hop ? { ...node, data: { ...hop, onSelect: () => selectNode(hop.id) } } : node;
      })
    );
  }, [liveHops, selectNode, setNodes]);

  const selectedHop = selection?.kind === 'hop' ? liveHops.find((h) => h.id === selection.id) : undefined;
  const activeRun = graph?.run ?? preprocessingJob;
  const isRunning = activeRun?.status === 'running' || activeRun?.status === 'accepted';

  // Light curve plot data
  const lightCurveData = useMemo(() => {
    return generateLightCurvePoints(selectedTargetKey, isPhaseFolded);
  }, [selectedTargetKey, isPhaseFolded]);

  const currentTarget = sampleTargets[selectedTargetKey] || sampleTargets['TIC 246980040'];

  const filteredLineage = useMemo(() => {
    if (!searchQuery.trim()) return sampleLineageRecords;
    const q = searchQuery.toLowerCase();
    return sampleLineageRecords.filter(
      (r) =>
        r.tic_id.includes(q) ||
        r.target_name.toLowerCase().includes(q) ||
        r.source_sha256.includes(q) ||
        r.silver_sha256.includes(q)
    );
  }, [searchQuery]);

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
      const job = await apiFetch<PreprocessingJob>(`/v1/preprocessing/jobs/${encodeURIComponent(activeRun.job_id)}/stop`, {
        method: 'POST',
      });
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
              variant="destructive"
              size="sm"
              onClick={stopPreprocessing}
              disabled={stopBusy}
              className="gap-1.5 shadow-md shadow-destructive/20"
            >
              <Square className="size-3.5 fill-current" />
              {stopBusy ? 'Đang dừng...' : 'Dừng Preprocessing'}
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

        {/* ========================================================================= */}
        {/* TAB 1: TRỰC QUAN HÓA KHOA HỌC (LIGHT CURVE TRANSFORMER) */}
        {/* ========================================================================= */}
        <TabsContent value="visualizer" className="space-y-6">
          {/* Step-by-Step Interactive Pipeline Strip */}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
            {defaultHops.map((hop) => {
              const isSelected = activeStep === hop.stepNumber;
              return (
                <button
                  key={hop.id}
                  type="button"
                  onClick={() => setActiveStep(hop.stepNumber)}
                  className={`flex flex-col text-left p-3 rounded-lg border transition-all ${
                    isSelected
                      ? 'border-primary bg-primary/10 shadow-sm shadow-primary/20 ring-1 ring-primary'
                      : 'border-border/60 bg-card/60 hover:border-primary/40 hover:bg-muted/20'
                  }`}
                >
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-mono font-bold text-primary">Bước {hop.stepNumber}</span>
                    {isSelected && <span className="size-2 rounded-full bg-primary animate-pulse" />}
                  </div>
                  <p className="mt-1 text-xs font-semibold text-foreground line-clamp-1">{hop.label}</p>
                  <p className="mt-1 text-[11px] text-muted-foreground line-clamp-2 leading-tight">
                    {hop.shortTitle}
                  </p>
                </button>
              );
            })}
          </div>

          {/* Target Selector & Visual Controls */}
          <Card className="border-border/80 shadow-sm">
            <CardHeader className="pb-3 border-b border-border/50">
              <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center">
                <div>
                  <CardTitle className="text-base font-semibold flex items-center gap-2">
                    <Orbit className="size-4 text-primary" />
                    Mô phỏng Trực quan Biến đổi Dữ liệu Trắc quang (Light Curve Transformer)
                  </CardTitle>
                  <CardDescription className="mt-0.5 text-xs">
                    {currentTarget.description}
                  </CardDescription>
                </div>

                {/* Target Dropdown */}
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs text-muted-foreground font-medium">Thiên thể mục tiêu:</span>
                  <select
                    value={selectedTargetKey}
                    onChange={(e) => setSelectedTargetKey(e.target.value)}
                    className="h-8 rounded-md border border-border bg-background px-2.5 text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-primary"
                  >
                    {Object.keys(sampleTargets).map((key) => (
                      <option key={key} value={key}>
                        {key} ({sampleTargets[key].type})
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Layer Toggles */}
              <div className="mt-3 flex flex-wrap items-center gap-2 pt-2 text-xs">
                <span className="text-muted-foreground font-medium mr-1 flex items-center gap-1">
                  <Filter className="size-3.5 text-primary" /> Lớp hiển thị:
                </span>

                <button
                  type="button"
                  onClick={() => setShowRawFlux(!showRawFlux)}
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded border text-xs font-medium transition ${
                    showRawFlux
                      ? 'border-red-500/40 bg-red-500/10 text-red-600 dark:text-red-400'
                      : 'border-border text-muted-foreground opacity-50'
                  }`}
                >
                  <span className="size-2 rounded-full bg-red-500" />
                  1. Raw SAP Flux (Bronze)
                </button>

                <button
                  type="button"
                  onClick={() => setShowTrend(!showTrend)}
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded border text-xs font-medium transition ${
                    showTrend
                      ? 'border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400'
                      : 'border-border text-muted-foreground opacity-50'
                  }`}
                >
                  <span className="size-2 rounded-full bg-amber-500" />
                  2. Spline Background Trend
                </button>

                <button
                  type="button"
                  onClick={() => setShowNormalized(!showNormalized)}
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded border text-xs font-medium transition ${
                    showNormalized
                      ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                      : 'border-border text-muted-foreground opacity-50'
                  }`}
                >
                  <span className="size-2 rounded-full bg-emerald-500" />
                  3. Cleaned Normalized (Silver)
                </button>

                <button
                  type="button"
                  onClick={() => setShowOutliers(!showOutliers)}
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded border text-xs font-medium transition ${
                    showOutliers
                      ? 'border-purple-500/40 bg-purple-500/10 text-purple-600 dark:text-purple-400'
                      : 'border-border text-muted-foreground opacity-50'
                  }`}
                >
                  <span className="size-2 rounded-full bg-purple-500" />
                  4. 5σ Outlier Spikes
                </button>

                <div className="ml-auto flex items-center gap-1.5 pl-2">
                  <Button
                    variant={isPhaseFolded ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setIsPhaseFolded(!isPhaseFolded)}
                    className="h-7 text-xs gap-1 font-semibold"
                  >
                    <Wand2 className="size-3" />
                    {isPhaseFolded ? 'Chế độ: Gập Pha Chu Kỳ (Folded)' : 'Chuyển sang Gập Pha (Phase Fold)'}
                  </Button>
                </div>
              </div>
            </CardHeader>

            <CardContent className="p-4">
              <div className="h-[380px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={lightCurveData} margin={{ top: 10, right: 20, bottom: 20, left: 10 }}>
                    <CartesianGrid strokeDasharray="3 3" opacity={0.15} />
                    <XAxis
                      dataKey={isPhaseFolded ? 'phase' : 'timeBjd'}
                      domain={isPhaseFolded ? [-0.5, 0.5] : ['auto', 'auto']}
                      tickFormatter={(v: number) => (isPhaseFolded ? `${v.toFixed(2)} φ` : `${v}`)}
                      tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
                      label={{
                        value: isPhaseFolded
                          ? 'Orbital Phase φ (0.0 = Transit Center)'
                          : 'Barycentric Julian Date (BJD - 2459000)',
                        position: 'insideBottom',
                        offset: -12,
                        fontSize: 12,
                        fill: 'hsl(var(--muted-foreground))',
                      }}
                    />
                    <YAxis
                      domain={['auto', 'auto']}
                      tickFormatter={(v: number) => v.toFixed(3)}
                      tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
                      label={{
                        value: isPhaseFolded || !showRawFlux ? 'Normalized Relative Flux (F/F₀)' : 'Raw SAP Flux (e-/s)',
                        angle: -90,
                        position: 'insideLeft',
                        fontSize: 12,
                        fill: 'hsl(var(--muted-foreground))',
                      }}
                    />
                    <Tooltip
                      content={({ active, payload }) => {
                        if (!active || !payload?.length) return null;
                        const data = payload[0].payload as (typeof lightCurveData)[0];
                        return (
                          <div className="rounded-lg border border-border/80 bg-popover/95 p-3 text-xs shadow-xl backdrop-blur">
                            <p className="font-semibold text-foreground">
                              {isPhaseFolded ? `Phase: ${data.phase} φ` : `BJD: ${data.timeBjd}`}
                            </p>
                            <div className="mt-2 space-y-1 font-mono">
                              {showRawFlux && !isPhaseFolded && (
                                <p className="text-red-400">Raw SAP Flux: {data.rawFlux}</p>
                              )}
                              {showTrend && !isPhaseFolded && (
                                <p className="text-amber-400">Spline Trend: {data.trendFlux}</p>
                              )}
                              {showNormalized && (
                                <p className="text-emerald-400">
                                  {isPhaseFolded ? `Folded Flux: ${data.foldedFlux}` : `Normalized Flux: ${data.normalizedFlux}`}
                                </p>
                              )}
                              {data.isOutlier && <p className="text-purple-400 font-bold">&bull; 5σ Cosmic Ray Outlier</p>}
                            </div>
                          </div>
                        );
                      }}
                    />
                    <ReferenceLine y={1.0} stroke="hsl(var(--muted-foreground))" strokeDasharray="3 3" opacity={0.4} />

                    {/* 1. Raw SAP Flux Layer */}
                    {showRawFlux && !isPhaseFolded && (
                      <Line
                        type="monotone"
                        dataKey="rawFlux"
                        stroke="#ef4444"
                        strokeWidth={1}
                        dot={{ r: 1.5, fill: '#ef4444', opacity: 0.6 }}
                        isAnimationActive={false}
                        name="Raw SAP Flux"
                      />
                    )}

                    {/* 2. Spline Background Trend Layer */}
                    {showTrend && !isPhaseFolded && (
                      <Line
                        type="basis"
                        dataKey="trendFlux"
                        stroke="#f59e0b"
                        strokeWidth={2.5}
                        dot={false}
                        isAnimationActive={false}
                        name="Spline Trend"
                      />
                    )}

                    {/* 3. Cleaned Normalized or Phase Folded Layer */}
                    {showNormalized && (
                      <Line
                        type="monotone"
                        dataKey={isPhaseFolded ? 'foldedFlux' : 'normalizedFlux'}
                        stroke="#10b981"
                        strokeWidth={isPhaseFolded ? 2.5 : 1.5}
                        dot={
                          isPhaseFolded
                            ? { r: 2.5, fill: '#10b981', strokeWidth: 0 }
                            : { r: 1.5, fill: '#10b981', opacity: 0.7 }
                        }
                        isAnimationActive={false}
                        name={isPhaseFolded ? 'Folded Transit Curve' : 'Normalized Flux'}
                      />
                    )}

                    {/* 4. 5σ Outlier Highlight Layer */}
                    {showOutliers && !isPhaseFolded && (
                      <Scatter
                        dataKey="outlierPoint"
                        fill="#a855f7"
                        shape="cross"
                        isAnimationActive={false}
                        name="5σ Outliers"
                      />
                    )}
                  </ComposedChart>
                </ResponsiveContainer>
              </div>

              {/* Physical Parameters Summary Card */}
              <div className="mt-4 grid grid-cols-2 gap-3 border-t border-border/60 pt-4 sm:grid-cols-3 lg:grid-cols-6 text-xs">
                <div className="bg-muted/20 p-2.5 rounded">
                  <span className="text-muted-foreground block text-[11px]">Độ sâu Transit (ΔF/F)</span>
                  <span className="font-mono font-bold text-foreground text-sm">
                    {(currentTarget.depth * 100).toFixed(3)}% ({Math.round(currentTarget.depth * 1e6)} ppm)
                  </span>
                </div>
                <div className="bg-muted/20 p-2.5 rounded">
                  <span className="text-muted-foreground block text-[11px]">Chu kỳ quỹ đạo P</span>
                  <span className="font-mono font-bold text-foreground text-sm">{currentTarget.period} ngày</span>
                </div>
                <div className="bg-muted/20 p-2.5 rounded">
                  <span className="text-muted-foreground block text-[11px]">Thời lượng Transit</span>
                  <span className="font-mono font-bold text-foreground text-sm">{currentTarget.duration} giờ</span>
                </div>
                <div className="bg-muted/20 p-2.5 rounded">
                  <span className="text-muted-foreground block text-[11px]">Bán kính ước tính Rp</span>
                  <span className="font-mono font-bold text-foreground text-sm">{currentTarget.radius} R⊕</span>
                </div>
                <div className="bg-muted/20 p-2.5 rounded">
                  <span className="text-muted-foreground block text-[11px]">Tỷ số Tín hiệu/Nhiễu (SNR)</span>
                  <span className="font-mono font-bold text-emerald-500 text-sm">{currentTarget.snr} σ</span>
                </div>
                <div className="bg-muted/20 p-2.5 rounded">
                  <span className="text-muted-foreground block text-[11px]">Độ đồng pha Odd/Even</span>
                  <span className="font-mono font-bold text-foreground text-sm">0.99 (Đạt chuẩn)</span>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ========================================================================= */}
        {/* TAB 2: SƠ ĐỒ ĐƯỜNG ỐNG DAG (PIPELINE FLOW GRAPH) */}
        {/* ========================================================================= */}
        <TabsContent value="dag" className="space-y-6">
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
        </TabsContent>

        {/* ========================================================================= */}
        {/* TAB 3: PHẢ HỆ DỮ LIỆU & PROVENANCE MATRIX */}
        {/* ========================================================================= */}
        <TabsContent value="lineage" className="space-y-6">
          <div className="grid gap-6 lg:grid-cols-3">
            {/* Search & List of Lineage Records */}
            <Card className="lg:col-span-1 border-border/80">
              <CardHeader className="pb-3 border-b border-border/60">
                <CardTitle className="text-base font-semibold">Truy vết Phả hệ Dữ liệu (Lineage)</CardTitle>
                <CardDescription className="text-xs">
                  Tra cứu lịch sử biến đổi của từng bản ghi từ Bronze FITS sang Silver Parquet.
                </CardDescription>
                <div className="relative mt-2">
                  <Search className="absolute left-2.5 top-2.5 size-3.5 text-muted-foreground" />
                  <Input
                    placeholder="Tìm theo TIC ID, tên, mã SHA-256..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-8 text-xs h-8"
                  />
                </div>
              </CardHeader>
              <CardContent className="p-2 divide-y divide-border/40 max-h-[500px] overflow-y-auto">
                {filteredLineage.map((rec) => {
                  const isSelected = selectedLineageRecord?.tic_id === rec.tic_id;
                  return (
                    <button
                      key={rec.tic_id}
                      type="button"
                      onClick={() => setSelectedLineageRecord(rec)}
                      className={`w-full text-left p-3 rounded-md transition ${
                        isSelected ? 'bg-primary/10 border-l-2 border-primary' : 'hover:bg-muted/30'
                      }`}
                    >
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-mono font-bold text-foreground">TIC {rec.tic_id}</span>
                        <Badge variant="outline" className="text-[10px] text-emerald-500 border-emerald-500/30">
                          {rec.integrity}
                        </Badge>
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">{rec.target_name}</p>
                      <div className="mt-2 flex items-center justify-between text-[11px] text-muted-foreground font-mono">
                        <span>Sector {rec.sector}</span>
                        <span>{rec.silver_records} pts</span>
                      </div>
                    </button>
                  );
                })}
              </CardContent>
            </Card>

            {/* Lineage Tree & Cryptographic Audit Trail */}
            <Card className="lg:col-span-2 border-border/80">
              <CardHeader className="pb-3 border-b border-border/60">
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="text-base font-semibold flex items-center gap-2">
                      <ShieldCheck className="size-4 text-emerald-500" />
                      Cây Phả hệ Toàn diện (Provenance Tree) &bull; TIC {selectedLineageRecord?.tic_id}
                    </CardTitle>
                    <CardDescription className="text-xs">
                      Xác thực nguồn gốc 100% không thể giả mạo bằng mã băm SHA-256 đối xứng.
                    </CardDescription>
                  </div>
                  <Badge className="bg-emerald-500/10 text-emerald-500 border-emerald-500/30">
                    <CheckCircle2 className="size-3 mr-1 inline" /> Cryptographically Verified
                  </Badge>
                </div>
              </CardHeader>

              <CardContent className="p-5 space-y-6 text-xs">
                {selectedLineageRecord ? (
                  <>
                    {/* Visual 4-Stage Tree */}
                    <div className="space-y-4">
                      {/* Node 1: Bronze Source */}
                      <div className="border border-border/80 bg-muted/20 p-3.5 rounded-lg">
                        <div className="flex items-center justify-between text-xs font-semibold text-foreground">
                          <span className="flex items-center gap-2">
                            <span className="flex size-5 items-center justify-center rounded-full bg-amber-500/20 text-amber-500 font-mono text-[10px]">
                              1
                            </span>
                            Bronze Source Layer (NASA MAST FITS)
                          </span>
                          <span className="font-mono text-muted-foreground text-[11px]">S3 Object</span>
                        </div>
                        <p className="mt-2 font-mono text-[11px] text-muted-foreground break-all bg-background/80 p-2 rounded border border-border/50">
                          {selectedLineageRecord.source_fits_key}
                        </p>
                        <p className="mt-1 font-mono text-[10px] text-muted-foreground/80">
                          SHA-256: {selectedLineageRecord.source_sha256}
                        </p>
                      </div>

                      <div className="flex justify-center text-muted-foreground">
                        <ChevronRight className="rotate-90 size-4" />
                      </div>

                      {/* Node 2: Transformation Engine */}
                      <div className="border border-border/80 bg-primary/5 p-3.5 rounded-lg border-l-4 border-l-primary">
                        <div className="flex items-center justify-between text-xs font-semibold text-foreground">
                          <span className="flex items-center gap-2">
                            <span className="flex size-5 items-center justify-center rounded-full bg-primary/20 text-primary font-mono text-[10px]">
                              2
                            </span>
                            Transformation Engine (Rust Preprocessor)
                          </span>
                          <span className="font-mono text-primary text-[11px]">{selectedLineageRecord.run_id}</span>
                        </div>
                        <div className="mt-2 grid grid-cols-2 gap-2 text-[11px]">
                          <div>
                            <span className="text-muted-foreground">Version:</span>{' '}
                            <span className="font-mono font-medium text-foreground">
                              {selectedLineageRecord.preprocessor_version}
                            </span>
                          </div>
                          <div>
                            <span className="text-muted-foreground">Thời điểm xử lý:</span>{' '}
                            <span className="font-mono font-medium text-foreground">
                              {new Date(selectedLineageRecord.processed_at).toLocaleString()}
                            </span>
                          </div>
                        </div>
                      </div>

                      <div className="flex justify-center text-muted-foreground">
                        <ChevronRight className="rotate-90 size-4" />
                      </div>

                      {/* Node 3: Silver Artifact */}
                      <div className="border border-border/80 bg-muted/20 p-3.5 rounded-lg">
                        <div className="flex items-center justify-between text-xs font-semibold text-foreground">
                          <span className="flex items-center gap-2">
                            <span className="flex size-5 items-center justify-center rounded-full bg-emerald-500/20 text-emerald-500 font-mono text-[10px]">
                              3
                            </span>
                            Silver Lakehouse Layer (Cleaned Parquet)
                          </span>
                          <span className="font-mono text-emerald-500 text-[11px]">
                            {selectedLineageRecord.silver_records} Records
                          </span>
                        </div>
                        <p className="mt-2 font-mono text-[11px] text-muted-foreground break-all bg-background/80 p-2 rounded border border-border/50">
                          {selectedLineageRecord.silver_parquet_key}
                        </p>
                        <p className="mt-1 font-mono text-[10px] text-muted-foreground/80">
                          SHA-256: {selectedLineageRecord.silver_sha256}
                        </p>
                      </div>

                      <div className="flex justify-center text-muted-foreground">
                        <ChevronRight className="rotate-90 size-4" />
                      </div>

                      {/* Node 4: Downstream Gold & ML */}
                      <div className="border border-border/80 bg-purple-500/5 p-3.5 rounded-lg border-l-4 border-l-purple-500">
                        <div className="flex items-center justify-between text-xs font-semibold text-foreground">
                          <span className="flex items-center gap-2">
                            <span className="flex size-5 items-center justify-center rounded-full bg-purple-500/20 text-purple-500 font-mono text-[10px]">
                              4
                            </span>
                            Downstream Gold Features &amp; Champion Model
                          </span>
                          <span className="font-mono text-purple-400 text-[11px]">model-cand-v1</span>
                        </div>
                        <div className="mt-2 grid grid-cols-3 gap-2 font-mono text-[11px]">
                          <div className="bg-background/80 p-2 rounded border border-border/50">
                            <span className="text-muted-foreground block text-[10px]">Depth PPM:</span>
                            <span className="font-bold text-foreground">
                              {selectedLineageRecord.features.transit_depth_ppm}
                            </span>
                          </div>
                          <div className="bg-background/80 p-2 rounded border border-border/50">
                            <span className="text-muted-foreground block text-[10px]">Period:</span>
                            <span className="font-bold text-foreground">
                              {selectedLineageRecord.features.period_days}d
                            </span>
                          </div>
                          <div className="bg-background/80 p-2 rounded border border-border/50">
                            <span className="text-muted-foreground block text-[10px]">Transit SNR:</span>
                            <span className="font-bold text-emerald-500">
                              {selectedLineageRecord.features.snr}σ
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="py-12 text-center text-muted-foreground">
                    Chọn một đối tượng từ danh sách bên trái để xem cây phả hệ chi tiết.
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* ========================================================================= */}
        {/* TAB 4: THUẬT TOÁN & CÔNG THỨC TOÁN HỌC */}
        {/* ========================================================================= */}
        <TabsContent value="math" className="space-y-6">
          <div className="grid gap-6 md:grid-cols-2">
            <Card className="border-border/80">
              <CardHeader className="pb-3 border-b border-border/60">
                <CardTitle className="text-base font-semibold flex items-center gap-2">
                  <Wand2 className="size-4 text-primary" />
                  1. Non-linear Spline Detrending (Khử Xu Hướng Sao)
                </CardTitle>
                <CardDescription className="text-xs">
                  Loại bỏ biến quang chu kỳ dài của sao mẹ và độ trôi quang sai nhiệt của kính thiên văn TESS.
                </CardDescription>
              </CardHeader>
              <CardContent className="p-4 space-y-3 text-xs leading-relaxed">
                <div className="bg-muted/20 p-3 rounded font-mono text-xs border border-border/50">
                  F_norm(t) = F_raw(t) / S_spline(t, window=0.75d, step=0.1d)
                </div>
                <p className="text-muted-foreground">
                  Sử dụng thuật toán <strong>Savitzky-Golay / Cubic Spline with iterative outlier masking</strong>. 
                  Bộ lọc này chia nhỏ chuỗi thời gian thành các cửa sổ 0.75 ngày, khớp đa thức bậc 2 để tìm hàm nền S(t), 
                  sau đó chia thông lượng thực tế cho S(t) để đưa đường cong về giá trị trung bình 1.0.
                </p>
              </CardContent>
            </Card>

            <Card className="border-border/80">
              <CardHeader className="pb-3 border-b border-border/60">
                <CardTitle className="text-base font-semibold flex items-center gap-2">
                  <Sparkles className="size-4 text-purple-400" />
                  2. 5σ Outlier &amp; Flare Rejection (Lọc Nhiễu Điểm Dị Biệt)
                </CardTitle>
                <CardDescription className="text-xs">
                  Loại trừ các điểm đo bị nhiễu tia vũ trụ (Cosmic Ray Hits) hoặc hiện tượng sao lóe sáng (Stellar Flares).
                </CardDescription>
              </CardHeader>
              <CardContent className="p-4 space-y-3 text-xs leading-relaxed">
                <div className="bg-muted/20 p-3 rounded font-mono text-xs border border-border/50">
                  | F_norm(t) - Median(F_norm) | &lt; 5 * 1.4826 * MAD(F_norm)
                </div>
                <p className="text-muted-foreground">
                  Thay vì dùng phương sai chuẩn thông thường (dễ bị ảnh hưởng bởi điểm ngoại lai), hệ thống sử dụng 
                  <strong> Median Absolute Deviation (MAD)</strong> để tính độ lệch chuẩn bền vững (Robust Sigma). 
                  Mọi điểm lệch quá 5σ đều được đánh dấu cờ loại trừ.
                </p>
              </CardContent>
            </Card>

            <Card className="border-border/80">
              <CardHeader className="pb-3 border-b border-border/60">
                <CardTitle className="text-base font-semibold flex items-center gap-2">
                  <Orbit className="size-4 text-emerald-400" />
                  3. Box Least Squares (BLS) Transit Period Search
                </CardTitle>
                <CardDescription className="text-xs">
                  Tìm kiếm chu kỳ quỹ đạo P và thời điểm quá cảnh T₀ của hành tinh.
                </CardDescription>
              </CardHeader>
              <CardContent className="p-4 space-y-3 text-xs leading-relaxed">
                <div className="bg-muted/20 p-3 rounded font-mono text-xs border border-border/50">
                  BLS_Power(P, T₀, q) = [ s² / (r * (1 - r)) ]_max
                </div>
                <p className="text-muted-foreground">
                  Thuật toán quét qua dải chu kỳ từ 0.5 đến 30 ngày. Với mỗi chu kỳ, dữ liệu được gập pha thành dạng hình hộp (Box-like Dip). 
                  Đỉnh phổ BLS cao nhất tương ứng với chu kỳ quỹ đạo thực tế của ngoại hành tinh.
                </p>
              </CardContent>
            </Card>

            <Card className="border-border/80">
              <CardHeader className="pb-3 border-b border-border/60">
                <CardTitle className="text-base font-semibold flex items-center gap-2">
                  <Database className="size-4 text-sky-400" />
                  4. Columnar Silver Parquet Encoding
                </CardTitle>
                <CardDescription className="text-xs">
                  Lưu trữ dạng cột tối ưu hóa truy vấn phân tích khoa học và nạp mô hình ML siêu tốc.
                </CardDescription>
              </CardHeader>
              <CardContent className="p-4 space-y-3 text-xs leading-relaxed">
                <div className="bg-muted/20 p-3 rounded font-mono text-xs border border-border/50">
                  Parquet Schema: [time_bjd: float64, flux_norm: float32, flux_err: float32, phase: float32, quality: uint32]
                </div>
                <p className="text-muted-foreground">
                  Định dạng nén <strong>Snappy Compression + Dictionary Encoding</strong> giúp giảm dung lượng đến 85% so với FITS gốc, 
                  đồng thời cho phép nạp trực tiếp vào DuckDB/ClickHouse hoặc PyTorch DataLoader mà không cần giải mã trung gian.
                </p>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>

      {/* Drawer for Hop/DAG Detail */}
      <Drawer
        open={selection !== null}
        snapPoints={[0.5, 0.85]}
        activeSnapPoint={drawerSnap}
        setActiveSnapPoint={(p) => p !== null && setDrawerSnap(p)}
        onOpenChange={(open) => {
          if (open) setDrawerSnap(0.5);
          else setSelection(null);
        }}
      >
        <DrawerContent className="h-[85vh] max-h-[85vh] border-t-2 border-primary/40">
          <DrawerHeader className="border-b border-border pr-12 text-left">
            <div className="flex items-start justify-between gap-4">
              <div>
                <DrawerTitle className="text-lg font-bold flex items-center gap-2">
                  <Workflow className="size-5 text-primary" />
                  {selectedHop?.label ?? 'Chi tiết bước xử lý'}
                </DrawerTitle>
                <DrawerDescription className="text-xs">
                  {selectedHop?.description ?? 'Đặc tả hợp đồng và dữ liệu đầu vào/đầu ra.'}
                </DrawerDescription>
              </div>
              <DrawerClose asChild>
                <Button variant="ghost" size="icon-sm">
                  <X className="size-4" />
                  <span className="sr-only">Close</span>
                </Button>
              </DrawerClose>
            </div>
          </DrawerHeader>

          <div className="overflow-y-auto p-6 space-y-5 max-w-4xl mx-auto text-xs">
            {selectedHop ? (
              <>
                <div className="grid gap-4 md:grid-cols-3">
                  <div className="bg-muted/20 p-3 rounded border border-border/50">
                    <span className="text-muted-foreground block text-[11px]">Trạng thái</span>
                    <span className="font-semibold text-foreground uppercase">{selectedHop.status}</span>
                  </div>
                  <div className="bg-muted/20 p-3 rounded border border-border/50">
                    <span className="text-muted-foreground block text-[11px]">Đầu vào (Input)</span>
                    <span className="font-semibold text-foreground">{selectedHop.input}</span>
                  </div>
                  <div className="bg-muted/20 p-3 rounded border border-border/50">
                    <span className="text-muted-foreground block text-[11px]">Đầu ra (Output)</span>
                    <span className="font-semibold text-foreground">{selectedHop.output}</span>
                  </div>
                </div>

                <div className="bg-muted/15 p-4 rounded-lg border border-border/60 space-y-2">
                  <span className="text-muted-foreground uppercase tracking-wider text-[10px] font-bold">
                    Mục tiêu Khoa học Thiên văn
                  </span>
                  <p className="text-sm font-medium text-foreground">{selectedHop.astronomyGoal}</p>
                  {selectedHop.formula && (
                    <div className="mt-2 bg-background p-2.5 rounded font-mono text-xs text-primary border border-border/50">
                      {selectedHop.formula}
                    </div>
                  )}
                </div>

                <div className="bg-muted/15 p-4 rounded-lg border border-border/60">
                  <span className="text-muted-foreground uppercase tracking-wider text-[10px] font-bold">
                    Hợp đồng Dữ liệu (Data Contract URI)
                  </span>
                  <p className="mt-1 font-mono text-xs text-foreground bg-background p-2 rounded border border-border/50 break-all">
                    {selectedHop.contract}
                  </p>
                </div>
              </>
            ) : (
              <div className="py-8 text-center text-muted-foreground">Chọn một node để xem chi tiết.</div>
            )}
          </div>
        </DrawerContent>
      </Drawer>
    </div>
  );
}
