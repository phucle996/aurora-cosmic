import { useCallback, useEffect, useMemo, useState } from 'react';
import type { JSX } from 'react';
import {
  BarChart3,
  CircleAlert,
  Clock3,
  Database,
  Gauge,
  LoaderCircle,
  RefreshCw,
  Sparkles,
  Telescope,
} from 'lucide-react';
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { apiFetch } from '@/lib/api';

type InferenceJob = {
  job_id: string;
  task: string;
  model_id: string;
  model_version: string;
  gold_snapshot_id: string;
  sector: number;
  expected_prediction_count: number;
  created_at: string;
  status: string;
};

type CandidateRecord = {
  prediction_id: string;
  source_product_id: string;
  tic_id: number;
  sector: number;
  candidate_score: number;
  decision_threshold: number;
  above_threshold: boolean;
  model_version: string;
  gold_snapshot_id: string;
  runtime_validation_id: string;
  runtime_package_id: string;
  predicted_at: string;
};

type CandidateEvidence = {
  lineage_id: string;
  feature_version: string;
  n_points: number;
  time_span: number;
  median_cadence: number;
  max_gap: number;
  flux_mean: number;
  flux_std: number;
  flux_amplitude: number;
  flux_rms: number;
  median_flux_err: number;
  bls_available: boolean;
  bls_period: number;
  bls_duration: number;
  bls_transit_time: number;
  bls_depth: number;
  bls_power: number;
  pixel_mad_median: number;
  variability_peak_fraction: number;
  transit_evidence_available: boolean;
  transit_deficit_sum: number;
  transit_deficit_center_offset: number;
  tic_available: boolean;
  tmag: number;
  teff: number;
  stellar_radius: number;
  stellar_mass: number;
  logg: number;
  matched_toi_id: string;
  toi_match_status: string;
};

type CandidateDetail = { candidate: CandidateRecord; evidence: CandidateEvidence };
type Lightcurve = { tic_id: number; sector: number; time: number[]; flux: number[] };
type JobResponse = { jobs: InferenceJob[] };
type CandidateResponse = { candidates: CandidateRecord[]; snapshot_id: string };

function formatDate(value: string): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? value : date.toLocaleString();
}

function formatNumber(value: number, digits = 3): string {
  if (!Number.isFinite(value)) return '—';
  return value.toFixed(digits);
}

function formatScore(value: number): string {
  if (!Number.isFinite(value)) return '—';
  return `${(value * 100).toFixed(1)}%`;
}

export default function CandidatesSection({
  detailPath = '/candidates',
  eyebrow = 'Human review queue',
  title = 'ML Transit Candidates',
  description = 'Xếp hạng ứng viên bằng ML score và mở toàn bộ evidence để chuyên gia xác minh thủ công.',
}: {
  detailPath?: string;
  eyebrow?: string;
  title?: string;
  description?: string;
}): JSX.Element {
  const [jobs, setJobs] = useState<InferenceJob[]>([]);
  const [candidates, setCandidates] = useState<CandidateRecord[]>([]);
  const [selectedID, setSelectedID] = useState('');
  const [detail, setDetail] = useState<CandidateDetail>();
  const [lightcurve, setLightcurve] = useState<Lightcurve>();
  const [snapshotID, setSnapshotID] = useState('');
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [folded, setFolded] = useState(false);
  const [error, setError] = useState<string>();

  const loadCandidate = useCallback(async (candidate: CandidateRecord, snapshot: string): Promise<void> => {
    setSelectedID(candidate.prediction_id);
    setDetailLoading(true);
    setError(undefined);
    try {
      const [candidateDetail, curve] = await Promise.all([
        apiFetch<CandidateDetail>(`/v1/candidates/${encodeURIComponent(candidate.prediction_id)}?snapshot_id=${encodeURIComponent(snapshot)}`),
        apiFetch<Lightcurve>(`/v1/lightcurves?tic_id=${candidate.tic_id}&sector=${candidate.sector}&limit=1000`),
      ]);
      setDetail(candidateDetail);
      setLightcurve(curve);
    } catch (loadError) {
      setDetail(undefined);
      setLightcurve(undefined);
      setError(loadError instanceof Error ? loadError.message : 'Unable to load candidate evidence');
    } finally {
      setDetailLoading(false);
    }
  }, []);

  const loadData = useCallback(async (isRefresh = false) => {
    setError(undefined);
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    try {
      const jobResponse = await apiFetch<JobResponse>('/v1/inference/jobs?task=candidate_vetting');
      const nextJobs = jobResponse.jobs ?? [];
      setJobs(nextJobs);
      const latestCompletedJob = nextJobs.find((job) => job.status === 'completed' && job.gold_snapshot_id);
      if (!latestCompletedJob) {
        setCandidates([]);
        setSelectedID('');
        setSnapshotID('');
        setDetail(undefined);
        setLightcurve(undefined);
        return;
      }
      const candidateResponse = await apiFetch<CandidateResponse>(
        `/v1/candidates?snapshot_id=${encodeURIComponent(latestCompletedJob.gold_snapshot_id)}&limit=100`,
      );
      const nextCandidates = candidateResponse.candidates ?? [];
      const nextSnapshot = candidateResponse.snapshot_id || latestCompletedJob.gold_snapshot_id;
      setCandidates(nextCandidates);
      setSnapshotID(nextSnapshot);
      if (nextCandidates.length > 0) {
        const requestedID = new URLSearchParams(window.location.search).get('prediction_id');
        const initialCandidate = (requestedID && nextCandidates.find((candidate) => candidate.prediction_id === requestedID)) || nextCandidates[0];
        await loadCandidate(initialCandidate, nextSnapshot);
      } else {
        setSelectedID('');
        setDetail(undefined);
        setLightcurve(undefined);
      }
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Unable to load candidate queue');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [loadCandidate]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const selected = candidates.find((candidate) => candidate.prediction_id === selectedID);
  const latestCompletedJob = jobs.find((job) => job.status === 'completed' && job.gold_snapshot_id);
  const aboveThreshold = candidates.filter((candidate) => candidate.above_threshold).length;
  const peakScore = candidates.reduce((peak, candidate) => Math.max(peak, candidate.candidate_score), 0);

  const chartData = useMemo(() => {
    if (!lightcurve) return [];
    const period = detail?.evidence.bls_period ?? 0;
    const transitTime = detail?.evidence.bls_transit_time ?? 0;
    return lightcurve.time.map((time, index) => {
      const phase = period > 0
        ? ((((time - transitTime + period / 2) % period) + period) % period) / period - 0.5
        : 0;
      return { time, x: folded && period > 0 ? phase : time, flux: lightcurve.flux[index] ?? 0 };
    }).sort((a, b) => a.x - b.x);
  }, [detail, folded, lightcurve]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
        <div>
          <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
            <Sparkles className="size-4 text-primary" />
            {eyebrow}
          </div>
          <h2 className="font-heading text-2xl font-semibold tracking-tight md:text-3xl">{title}</h2>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">{description}</p>
        </div>
        <Button variant="outline" onClick={() => void loadData(true)} disabled={loading || refreshing}>
          <RefreshCw className={refreshing ? 'animate-spin' : ''} />
          Refresh queue
        </Button>
      </div>

      {error && <div className="flex items-start gap-3 rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive"><CircleAlert className="mt-0.5 size-4 shrink-0" /><div><p className="font-medium">Không tải được candidate evidence</p><p className="mt-1 opacity-90">{error}</p></div></div>}

      <div className="grid min-w-0 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard icon={Sparkles} label="Candidates" value={candidates.length} detail="Latest completed snapshot" />
        <MetricCard icon={Gauge} label="Above threshold" value={aboveThreshold} detail="Priority review queue" />
        <MetricCard icon={BarChart3} label="Peak vetting score" value={formatScore(peakScore)} detail="Score, not confirmation" />
        <MetricCard icon={Clock3} label="Completed runs" value={jobs.filter((job) => job.status === 'completed').length} detail="GPU inference jobs" />
      </div>

      <div className="grid min-w-0 gap-6 2xl:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)]">
        <Card className="min-w-0 overflow-hidden">
          <CardHeader className="gap-3 md:flex-row md:items-center md:justify-between"><div><CardTitle>Candidate queue</CardTitle><CardDescription>Score giảm dần; chọn một dòng để mở evidence và light curve.</CardDescription></div><Badge variant="secondary">snapshot {snapshotID || '—'}</Badge></CardHeader>
          <CardContent>
            {loading ? <LoadingState /> : !latestCompletedJob ? <EmptyState label="Chưa có candidate inference job hoàn tất." /> : candidates.length === 0 ? <EmptyState label="Snapshot mới nhất chưa có candidate prediction." /> : (
              <Table className="min-w-[720px]"><TableHeader><TableRow><TableHead>#</TableHead><TableHead>Target</TableHead><TableHead>Vetting score</TableHead><TableHead>Sector</TableHead><TableHead>Status</TableHead></TableRow></TableHeader><TableBody>
                {candidates.map((candidate, index) => <TableRow key={candidate.prediction_id} data-state={candidate.prediction_id === selectedID ? 'selected' : undefined} className="cursor-pointer" onClick={() => void loadCandidate(candidate, snapshotID)}><TableCell className="font-mono text-muted-foreground">{index + 1}</TableCell><TableCell><p className="font-mono font-medium text-primary">TIC {candidate.tic_id}</p><p className="mt-1 max-w-48 truncate font-mono text-xs text-muted-foreground">{candidate.source_product_id}</p></TableCell><TableCell><p className="font-mono font-medium">{formatScore(candidate.candidate_score)}</p><p className="mt-1 text-xs text-muted-foreground">threshold {formatScore(candidate.decision_threshold)}</p></TableCell><TableCell>{candidate.sector}</TableCell><TableCell><Badge variant={candidate.above_threshold ? 'default' : 'outline'}>{candidate.above_threshold ? 'priority' : 'ranked'}</Badge></TableCell></TableRow>)}
              </TableBody></Table>
            )}
          </CardContent>
        </Card>

        <Card className="min-w-0 overflow-hidden">
          <CardHeader><CardTitle>Selected candidate</CardTitle><CardDescription>Model score, lineage và scientific context trước khi review.</CardDescription></CardHeader>
          <CardContent>
            {detailLoading ? <LoadingState /> : !selected || !detail ? <EmptyState label="Chọn một candidate để xem chi tiết." /> : <CandidateDetail detail={detail} detailPath={detailPath} />}
          </CardContent>
        </Card>
      </div>

      <Card className="min-w-0 overflow-hidden">
        <CardHeader className="gap-3 md:flex-row md:items-center md:justify-between"><div><CardTitle>Light curve evidence</CardTitle><CardDescription>{selected ? `TIC ${selected.tic_id} · Sector ${selected.sector} · raw flux from ClickHouse` : 'Chọn candidate để tải light curve.'}</CardDescription></div><Button variant="outline" size="sm" onClick={() => setFolded((value) => !value)} disabled={!detail?.evidence.bls_available || !lightcurve}>{folded ? 'Show raw time' : 'Phase fold'} </Button></CardHeader>
        <CardContent>
          {!selected || !lightcurve || chartData.length === 0 ? <EmptyState label="Chưa có light curve để hiển thị." /> : <div className="h-[360px] w-full"><ResponsiveContainer width="100%" height="100%"><LineChart data={chartData} margin={{ top: 12, right: 16, left: 0, bottom: 8 }}><CartesianGrid vertical={false} strokeDasharray="3 3" /><XAxis dataKey="x" tickLine={false} axisLine={false} tickFormatter={(value: number) => folded ? value.toFixed(2) : value.toFixed(1)} label={{ value: folded ? 'phase' : 'time', position: 'insideBottom', offset: -2 }} /><YAxis tickLine={false} axisLine={false} width={58} tickFormatter={(value: number) => value.toFixed(3)} /><Tooltip labelFormatter={(value) => folded ? `phase ${Number(value).toFixed(4)}` : `time ${Number(value).toFixed(4)}`} formatter={(value) => [typeof value === 'number' ? value.toFixed(6) : '—', 'flux']} /><Line type="monotone" dataKey="flux" stroke="var(--primary)" strokeWidth={1.5} dot={false} isAnimationActive={false} /></LineChart></ResponsiveContainer></div>}
        </CardContent>
      </Card>
    </div>
  );
}

function CandidateDetail({ detail, detailPath }: { detail: CandidateDetail; detailPath: string }): JSX.Element {
  const { candidate, evidence } = detail;
  return <div className="space-y-4"><div className="rounded-lg border border-border bg-muted/30 p-4"><div className="flex items-start justify-between gap-3"><div><p className="font-mono font-semibold text-primary">TIC {candidate.tic_id}</p><p className="mt-1 text-xs text-muted-foreground">{candidate.model_version}</p></div><Badge variant={candidate.above_threshold ? 'default' : 'outline'}>{candidate.above_threshold ? 'priority review' : 'below threshold'}</Badge></div><Separator className="my-3" /><dl className="grid grid-cols-2 gap-3 text-xs"><InfoItem label="Vetting score" value={formatScore(candidate.candidate_score)} /><InfoItem label="Threshold" value={formatScore(candidate.decision_threshold)} /><InfoItem label="Sector" value={`${candidate.sector}`} /><InfoItem label="Detected" value={formatDate(candidate.predicted_at)} /><InfoItem label="Runtime" value={candidate.runtime_package_id} /><InfoItem label="Validation" value={candidate.runtime_validation_id || '—'} /></dl></div><div className="grid grid-cols-2 gap-2"><EvidenceChip icon={BarChart3} label="BLS" value={evidence.bls_available ? `${formatNumber(evidence.bls_period, 2)} d` : 'not available'} /><EvidenceChip icon={Telescope} label="TOI catalog" value={evidence.matched_toi_id || evidence.toi_match_status || 'unmatched'} /><EvidenceChip icon={Database} label="Samples" value={evidence.n_points.toLocaleString()} /><EvidenceChip icon={Gauge} label="Transit evidence" value={evidence.transit_evidence_available ? 'available' : 'not available'} /></div><Button asChild className="w-full"><a href={`${detailPath}/${encodeURIComponent(candidate.prediction_id)}?snapshot_id=${encodeURIComponent(candidate.gold_snapshot_id)}`}>Open physics & habitability detail</a></Button><div className="flex items-center gap-2 text-xs text-muted-foreground"><Database className="size-4" />Feature version {evidence.feature_version || '—'} · lineage verified by snapshot</div></div>;
}

function EvidenceChip({ icon: Icon, label, value }: { icon: typeof Database; label: string; value: string }): JSX.Element {
  return <div className="rounded-md border border-border bg-muted/20 p-3"><div className="flex items-center gap-2 text-xs text-muted-foreground"><Icon className="size-3.5 text-primary" />{label}</div><p className="mt-1 truncate text-sm font-medium">{value}</p></div>;
}

function MetricCard({ icon: Icon, label, value, detail }: { icon: typeof Sparkles; label: string; value: number | string; detail: string }): JSX.Element {
  return <Card><CardContent className="flex items-center gap-3 p-4"><div className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary"><Icon className="size-5" /></div><div className="min-w-0"><p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p><p className="mt-0.5 truncate text-xl font-semibold">{value}</p><p className="truncate text-xs text-muted-foreground">{detail}</p></div></CardContent></Card>;
}

function InfoItem({ label, value }: { label: string; value: string }): JSX.Element {
  return <div><dt className="text-muted-foreground">{label}</dt><dd className="mt-0.5 truncate font-medium text-foreground">{value}</dd></div>;
}

function LoadingState(): JSX.Element {
  return <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground"><LoaderCircle className="animate-spin" />Loading candidate data…</div>;
}

function EmptyState({ label }: { label: string }): JSX.Element {
  return <div className="flex flex-col items-center justify-center gap-2 py-12 text-center text-sm text-muted-foreground"><Database className="size-6 opacity-60" /><p>{label}</p></div>;
}
