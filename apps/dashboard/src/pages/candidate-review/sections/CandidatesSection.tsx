import { useCallback, useEffect, useMemo, useState } from 'react';
import type { JSX } from 'react';
import {
  Activity,
  ArrowUpRight,
  BarChart3,
  CheckCircle2,
  CircleAlert,
  CircleHelp,
  Clock3,
  Database,
  Gauge,
  LoaderCircle,
  RefreshCw,
  Sparkles,
  Telescope,
  XCircle,
} from 'lucide-react';
import { Link } from 'react-router-dom';
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

type CandidateReview = {
  decision: 'CONFIRMED' | 'REJECTED' | 'FOLLOW_UP' | 'PENDING';
  review_status: string;
  reviewer: string;
  note: string;
  updated_at: string;
};
type CandidateDetail = { candidate: CandidateRecord; evidence: CandidateEvidence; review: CandidateReview };
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

// Shared candidate-review surface used by canonical and research routes.
export default function CandidatesSection({
  detailPath = '/research-factory/candidates',
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
  const [reviewing, setReviewing] = useState(false);
  const [reviewMessage, setReviewMessage] = useState<string>();
  const [reviewNote, setReviewNote] = useState('');

  const loadCandidate = useCallback(async (candidate: CandidateRecord, snapshot: string): Promise<void> => {
    setSelectedID(candidate.prediction_id);
    setDetailLoading(true);
    setError(undefined);
    setReviewMessage(undefined);
    setReviewNote('');
    try {
      const [candidateDetail, curve] = await Promise.all([
        apiFetch<CandidateDetail>(`/v1/candidates/${encodeURIComponent(candidate.prediction_id)}?snapshot_id=${encodeURIComponent(snapshot)}`),
        apiFetch<Lightcurve>(`/v1/lightcurves?tic_id=${candidate.tic_id}&sector=${candidate.sector}&limit=1000`),
      ]);
      setDetail(candidateDetail);
      setReviewNote(candidateDetail.review?.note ?? '');
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

  const submitReview = useCallback(async (decision: Exclude<CandidateReview['decision'], 'PENDING'>): Promise<void> => {
    if (!selected || !snapshotID) return;
    setReviewing(true);
    setReviewMessage(undefined);
    try {
      await apiFetch<{ status: string }>(`/v1/candidates/${encodeURIComponent(selected.prediction_id)}/review`, {
        method: 'PUT',
        body: JSON.stringify({
          snapshot_id: snapshotID,
          decision,
          note: reviewNote,
        }),
      });
      await loadCandidate(selected, snapshotID);
      setReviewMessage(decision === 'CONFIRMED' ? 'Đã xác nhận candidate trong scientific review ledger.' : decision === 'REJECTED' ? 'Đã loại tín hiệu khỏi hàng đợi khoa học.' : 'Đã chuyển candidate sang trạng thái cần theo dõi thêm.');
    } catch (reviewError) {
      setReviewMessage(reviewError instanceof Error ? reviewError.message : 'Không lưu được quyết định review.');
    } finally {
      setReviewing(false);
    }
  }, [loadCandidate, reviewNote, selected, snapshotID]);

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
    <div className="min-w-0 space-y-4">
      <header className="flex flex-col gap-4 border border-border/80 bg-card p-4 sm:p-5 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.16em] text-primary">
            <Sparkles className="size-4" />
            {eyebrow}
          </div>
          <h1 className="mt-2 font-heading text-2xl font-semibold tracking-tight md:text-3xl">{title}</h1>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-muted-foreground">{description}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className="hidden items-center gap-2 border border-border/70 bg-muted/20 px-3 py-2 font-mono text-[10px] uppercase text-muted-foreground sm:flex">
            <span className={`size-1.5 rounded-full ${loading || refreshing ? 'animate-pulse bg-amber-500' : 'bg-emerald-500'}`} />
            {loading || refreshing ? 'reading evidence' : snapshotID ? 'review console ready' : 'awaiting predictions'}
          </span>
          <Button className="rounded-none font-mono text-[10px] uppercase" variant="outline" onClick={() => void loadData(true)} disabled={loading || refreshing}>
            <RefreshCw className={refreshing ? 'animate-spin' : ''} />
            Refresh
          </Button>
        </div>
      </header>

      {error && <div className="flex items-start gap-3 border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"><CircleAlert className="mt-0.5 size-4 shrink-0" /><div><p className="font-medium">Không tải được candidate evidence</p><p className="mt-0.5 break-words opacity-90">{error}</p></div></div>}

      <section className="grid gap-px border border-border/80 bg-border/80 sm:grid-cols-2 xl:grid-cols-4">
        <ConsoleMetric icon={Sparkles} label="Ranked signals" value={candidates.length} detail="Latest completed snapshot" />
        <ConsoleMetric icon={Gauge} label="Priority review" value={aboveThreshold} detail="Signals above model threshold" />
        <ConsoleMetric icon={BarChart3} label="Peak vetting score" value={formatScore(peakScore)} detail="Ranking evidence, not confirmation" />
        <ConsoleMetric icon={Clock3} label="Completed runs" value={jobs.filter((job) => job.status === 'completed').length} detail="Candidate-vetting observations" />
      </section>

      <section className="min-w-0 overflow-hidden border border-border/80 bg-card">
        <div className="flex flex-col gap-2 border-b border-border/70 bg-muted/15 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-primary">Candidate adjudication / evidence desk</p>
            <h2 className="mt-1 text-base font-semibold">Scientific review console</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">Chọn tín hiệu bên trái, kiểm tra evidence bên phải rồi mới ghi quyết định.</p>
          </div>
          <span className="max-w-full truncate border border-border/70 bg-background px-2.5 py-1.5 font-mono text-[10px] uppercase text-muted-foreground" title={snapshotID}>
            Gold snapshot · {snapshotID || 'not available'}
          </span>
        </div>

        <div className="grid min-w-0 xl:grid-cols-[minmax(380px,0.82fr)_minmax(0,1.18fr)]">
          <section className="min-w-0 border-b border-border/70 xl:border-b-0 xl:border-r">
            <div className="flex items-center justify-between border-b border-border/60 px-4 py-3">
              <div>
                <p className="font-mono text-[9px] uppercase tracking-[0.14em] text-muted-foreground">01 / ranked queue</p>
                <p className="mt-1 text-sm font-medium">Candidate signals</p>
              </div>
              <span className="font-mono text-[10px] tabular-nums text-muted-foreground">{candidates.length} records</span>
            </div>
            {loading ? <LoadingState /> : !latestCompletedJob ? <EmptyState label="Chưa có candidate inference job hoàn tất." /> : candidates.length === 0 ? <EmptyState label="Snapshot mới nhất chưa có candidate prediction." /> : (
              <div className="max-h-[650px] overflow-auto">
                <table className="w-full min-w-[560px] border-collapse text-left">
                  <thead className="sticky top-0 z-10 bg-muted/95 font-mono text-[9px] uppercase tracking-[0.11em] text-muted-foreground backdrop-blur">
                    <tr><th className="px-3 py-2.5 font-medium">Rank / target</th><th className="px-3 py-2.5 font-medium">Model evidence</th><th className="px-3 py-2.5 font-medium">State</th></tr>
                  </thead>
                  <tbody>{candidates.map((candidate, index) => <CandidateQueueRow key={candidate.prediction_id} candidate={candidate} rank={index + 1} selected={candidate.prediction_id === selectedID} onSelect={() => void loadCandidate(candidate, snapshotID)} />)}</tbody>
                </table>
              </div>
            )}
          </section>

          <section className="min-w-0">
            <div className="flex items-center justify-between border-b border-border/60 px-4 py-3">
              <div>
                <p className="font-mono text-[9px] uppercase tracking-[0.14em] text-muted-foreground">02 / evidence + decision</p>
                <p className="mt-1 text-sm font-medium">Selected signal</p>
              </div>
              {selected && <span className="font-mono text-[10px] uppercase text-primary">TIC {selected.tic_id} · S{selected.sector}</span>}
            </div>
            <div className="p-4">
              {detailLoading ? <LoadingState /> : !selected || !detail ? <EmptyState label="Chọn một candidate để xem chi tiết." /> : <CandidateDetail detail={detail} detailPath={detailPath} reviewing={reviewing} reviewMessage={reviewMessage} reviewNote={reviewNote} onReviewNoteChange={setReviewNote} onReview={submitReview} />}
            </div>
          </section>
        </div>
      </section>

      <section className="min-w-0 overflow-hidden border border-border/80 bg-card">
        <div className="flex flex-col gap-3 border-b border-border/70 bg-muted/15 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div><p className="font-mono text-[10px] uppercase tracking-[0.14em] text-primary">03 / temporal evidence</p><h2 className="mt-1 flex items-center gap-2 text-sm font-semibold"><Activity className="size-4 text-primary" />Light curve evidence</h2><p className="mt-0.5 text-xs text-muted-foreground">{selected ? `TIC ${selected.tic_id} · Sector ${selected.sector} · observed cadence series` : 'Chọn candidate để tải light curve.'}</p></div>
          <Button className="rounded-none font-mono text-[10px] uppercase" variant="outline" size="sm" onClick={() => setFolded((value) => !value)} disabled={!detail?.evidence.bls_available || !lightcurve}>{folded ? 'Observed time' : 'Phase fold'}</Button>
        </div>
        <div className="p-3 sm:p-4">
          {!selected || !lightcurve || chartData.length === 0 ? <EmptyState label="Chưa có light curve để hiển thị." /> : <div className="h-[380px] w-full"><ResponsiveContainer width="100%" height="100%"><LineChart data={chartData} margin={{ top: 12, right: 18, left: 4, bottom: 12 }}><CartesianGrid vertical={false} strokeDasharray="3 3" stroke="var(--border)" /><XAxis dataKey="x" tickLine={false} axisLine={{ stroke: 'var(--border)' }} tick={{ fontSize: 10 }} tickFormatter={(value: number) => folded ? value.toFixed(2) : value.toFixed(1)} label={{ value: folded ? 'Orbital phase' : 'Time · BTJD', position: 'insideBottom', offset: -7, fontSize: 10 }} /><YAxis tickLine={false} axisLine={{ stroke: 'var(--border)' }} width={64} tick={{ fontSize: 10 }} tickFormatter={(value: number) => value.toFixed(3)} /><Tooltip contentStyle={{ borderRadius: 0, borderColor: 'var(--border)', background: 'var(--card)', fontSize: 12 }} labelFormatter={(value) => folded ? `Phase ${Number(value).toFixed(4)}` : `Time ${Number(value).toFixed(4)} BTJD`} formatter={(value) => [typeof value === 'number' ? value.toFixed(6) : '—', 'Normalized flux']} /><Line type="monotone" dataKey="flux" stroke="var(--primary)" strokeWidth={1.35} dot={false} isAnimationActive={false} /></LineChart></ResponsiveContainer></div>}
        </div>
      </section>
    </div>
  );
}

function CandidateDetail({
  detail,
  detailPath,
  reviewing,
  reviewMessage,
  reviewNote,
  onReviewNoteChange,
  onReview,
}: {
  detail: CandidateDetail;
  detailPath: string;
  reviewing: boolean;
  reviewMessage?: string;
  reviewNote: string;
  onReviewNoteChange: (value: string) => void;
  onReview: (decision: Exclude<CandidateReview['decision'], 'PENDING'>) => Promise<void>;
}): JSX.Element {
  const { candidate, evidence, review } = detail;
  const decision = review?.decision || 'PENDING';
  const scorePosition = `${Math.min(100, Math.max(0, candidate.candidate_score * 100))}%`;
  const thresholdPosition = `${Math.min(100, Math.max(0, candidate.decision_threshold * 100))}%`;
  return (
    <div className="space-y-3">
      <section className="border border-border/80 bg-muted/10">
        <div className="flex flex-col gap-3 border-b border-border/60 p-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0"><p className="font-mono text-base font-semibold text-primary">TIC {candidate.tic_id}</p><p className="mt-1 truncate font-mono text-[10px] text-muted-foreground" title={candidate.source_product_id}>{candidate.source_product_id}</p></div>
          <Badge className="w-fit rounded-none font-mono text-[9px] uppercase" variant={candidate.above_threshold ? 'default' : 'outline'}>{candidate.above_threshold ? 'priority review' : 'below threshold'}</Badge>
        </div>
        <div className="border-b border-border/60 p-3">
          <div className="flex items-end justify-between gap-4"><div><p className="font-mono text-[9px] uppercase tracking-[0.12em] text-muted-foreground">Model score position</p><p className="mt-1 font-mono text-lg font-semibold tabular-nums">{formatScore(candidate.candidate_score)}</p></div><p className="font-mono text-[10px] text-muted-foreground">threshold {formatScore(candidate.decision_threshold)}</p></div>
          <div className="relative mt-2 h-2 bg-muted">
            <div className="absolute inset-y-0 left-0 bg-primary" style={{ width: scorePosition }} />
            <span className="absolute -top-1 h-4 w-px bg-foreground" style={{ left: thresholdPosition }} aria-label={`Decision threshold ${formatScore(candidate.decision_threshold)}`} />
          </div>
        </div>
        <dl className="grid gap-px bg-border/70 text-xs sm:grid-cols-2 lg:grid-cols-3">
          <InfoItem label="Sector" value={`${candidate.sector}`} />
          <InfoItem label="Detected" value={formatDate(candidate.predicted_at)} />
          <InfoItem label="Runtime" value={candidate.runtime_package_id} />
          <InfoItem label="Validation" value={candidate.runtime_validation_id || '—'} />
          <InfoItem label="Model" value={candidate.model_version} />
          <InfoItem label="Prediction" value={candidate.prediction_id} />
        </dl>
      </section>
      <section className="grid gap-px border border-border/80 bg-border/70 grid-cols-2">
        <EvidenceChip icon={BarChart3} label="BLS" value={evidence.bls_available ? `${formatNumber(evidence.bls_period, 2)} d` : 'not available'} />
        <EvidenceChip icon={Telescope} label="TOI catalog" value={evidence.matched_toi_id || evidence.toi_match_status || 'unmatched'} />
        <EvidenceChip icon={Database} label="Samples" value={evidence.n_points.toLocaleString()} />
        <EvidenceChip icon={Gauge} label="Transit evidence" value={evidence.transit_evidence_available ? 'available' : 'not available'} />
      </section>
      <section className="border border-primary/30 bg-primary/[0.035]">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-primary/20 px-3 py-2.5">
          <div>
            <p className="font-mono text-[9px] uppercase tracking-[0.13em] text-primary">03 / scientific adjudication</p>
            <p className="mt-1 text-sm font-medium">Human review decision</p>
          </div>
          <DecisionBadge decision={decision} />
        </div>
        <div className="p-3">
          <p className="mb-3 text-xs leading-5 text-muted-foreground">Quyết định khoa học được lưu riêng; Gold evidence và training labels giữ nguyên.</p>
          <label className="block">
          <span className="mb-1.5 block font-mono text-[9px] uppercase tracking-[0.11em] text-muted-foreground">Evidence-based note</span>
          <textarea
            value={reviewNote}
            maxLength={2000}
            rows={3}
            disabled={reviewing}
            onChange={(event) => onReviewNoteChange(event.target.value)}
            placeholder="Evidence supporting this scientific decision…"
            className="w-full resize-y rounded-none border border-input bg-background px-3 py-2 text-sm leading-5 outline-none focus:border-primary focus:ring-1 focus:ring-primary/30"
          />
          </label>
          <div className="mt-3 grid gap-2 sm:grid-cols-3">
            <Button className="rounded-none" size="sm" disabled={reviewing} onClick={() => void onReview('CONFIRMED')}><CheckCircle2 />Confirm</Button>
            <Button className="rounded-none" size="sm" variant="destructive" disabled={reviewing} onClick={() => void onReview('REJECTED')}><XCircle />Reject</Button>
            <Button className="rounded-none border-amber-500/40 text-amber-700 hover:bg-amber-500/10 dark:text-amber-300" size="sm" variant="outline" disabled={reviewing} onClick={() => void onReview('FOLLOW_UP')}><CircleHelp />Follow-up</Button>
          </div>
          {reviewMessage && <p className="mt-3 border-l-2 border-primary pl-2 text-xs text-muted-foreground">{reviewMessage}</p>}
          {review?.updated_at && <div className="mt-3 border-t border-border/60 pt-2 font-mono text-[10px] leading-5 text-muted-foreground"><span className="uppercase">{review.reviewer || 'HUMAN_OPERATOR'}</span> · {formatDate(review.updated_at)}{review.note ? <p className="mt-1 font-sans text-xs">{review.note}</p> : null}</div>}
        </div>
      </section>
      <Button asChild className="w-full rounded-none font-mono text-[10px] uppercase">
        <Link to={`/research-factory/workbench/${candidate.tic_id}?sector=${candidate.sector}&snapshot_id=${encodeURIComponent(candidate.gold_snapshot_id)}&prediction_id=${encodeURIComponent(candidate.prediction_id)}`}>
          Open 3D Keplerian &amp; Target Workbench <ArrowUpRight />
        </Link>
      </Button>
      <div className="flex items-center gap-2 border-l-2 border-primary/50 pl-2 font-mono text-[10px] text-muted-foreground"><Database className="size-3.5" />Feature {evidence.feature_version || '—'} · lineage {evidence.lineage_id || 'not recorded'}</div>
    </div>
  );
}

function EvidenceChip({ icon: Icon, label, value }: { icon: typeof Database; label: string; value: string }): JSX.Element {
  return <div className="min-w-0 bg-card p-3"><div className="flex items-center gap-2 font-mono text-[9px] uppercase tracking-[0.1em] text-muted-foreground"><Icon className="size-3.5 text-primary" />{label}</div><p className="mt-1.5 truncate font-mono text-sm font-semibold" title={value}>{value}</p></div>;
}

function CandidateQueueRow({ candidate, rank, selected, onSelect }: { candidate: CandidateRecord; rank: number; selected: boolean; onSelect: () => void }): JSX.Element {
  const scoreWidth = `${Math.min(100, Math.max(0, candidate.candidate_score * 100))}%`;
  const thresholdPosition = `${Math.min(100, Math.max(0, candidate.decision_threshold * 100))}%`;
  return (
    <tr
      tabIndex={0}
      aria-selected={selected}
      className={`cursor-pointer border-t border-border/60 transition-colors hover:bg-primary/[0.045] focus:bg-primary/[0.06] focus:outline-none ${selected ? 'bg-primary/[0.07]' : ''}`}
      onClick={onSelect}
      onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelect(); } }}
    >
      <td className={`px-3 py-3 ${selected ? 'border-l-2 border-l-primary' : 'border-l-2 border-l-transparent'}`}><div className="flex items-start gap-3"><span className="font-mono text-[10px] text-muted-foreground">{String(rank).padStart(2, '0')}</span><div className="min-w-0"><p className="font-mono text-sm font-semibold text-primary">TIC {candidate.tic_id}</p><p className="mt-1 truncate font-mono text-[9px] text-muted-foreground" title={candidate.source_product_id}>{candidate.source_product_id}</p><p className="mt-1 font-mono text-[9px] uppercase text-muted-foreground">Sector {candidate.sector}</p></div></div></td>
      <td className="w-40 px-3 py-3"><div className="flex items-center justify-between font-mono text-[10px]"><span className="font-semibold tabular-nums">{formatScore(candidate.candidate_score)}</span><span className="text-muted-foreground">τ {formatScore(candidate.decision_threshold)}</span></div><div className="relative mt-2 h-1.5 bg-muted"><div className="absolute inset-y-0 left-0 bg-primary" style={{ width: scoreWidth }} /><span className="absolute -top-0.5 h-2.5 w-px bg-foreground" style={{ left: thresholdPosition }} /></div></td>
      <td className="px-3 py-3"><Badge variant={candidate.above_threshold ? 'default' : 'outline'} className="rounded-none font-mono text-[9px] uppercase">{candidate.above_threshold ? 'priority' : 'ranked'}</Badge></td>
    </tr>
  );
}

function ConsoleMetric({ icon: Icon, label, value, detail }: { icon: typeof Sparkles; label: string; value: number | string; detail: string }): JSX.Element {
  return <div className="min-w-0 bg-card p-3.5"><div className="flex items-center gap-2 font-mono text-[9px] uppercase tracking-[0.11em] text-muted-foreground"><Icon className="size-4 text-primary" />{label}</div><p className="mt-2 truncate font-mono text-xl font-semibold tabular-nums">{typeof value === 'number' ? value.toLocaleString() : value}</p><p className="mt-1 truncate text-xs text-muted-foreground">{detail}</p></div>;
}

function DecisionBadge({ decision }: { decision: CandidateReview['decision'] }): JSX.Element {
  const tone = decision === 'CONFIRMED'
    ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
    : decision === 'REJECTED'
      ? 'border-destructive/40 bg-destructive/10 text-destructive'
      : decision === 'FOLLOW_UP'
        ? 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300'
        : 'border-border bg-muted/30 text-muted-foreground';
  return <Badge variant="outline" className={`rounded-none font-mono text-[9px] uppercase ${tone}`}>{decision}</Badge>;
}

function InfoItem({ label, value }: { label: string; value: string }): JSX.Element {
  return <div className="min-w-0 bg-card p-3"><dt className="font-mono text-[9px] uppercase tracking-[0.1em] text-muted-foreground">{label}</dt><dd className="mt-1 truncate font-mono text-xs font-semibold text-foreground" title={value}>{value}</dd></div>;
}

function LoadingState(): JSX.Element {
  return <div className="flex items-center justify-center gap-2 py-16 font-mono text-[10px] uppercase text-muted-foreground"><LoaderCircle className="size-4 animate-spin" />Reading candidate evidence…</div>;
}

function EmptyState({ label }: { label: string }): JSX.Element {
  return <div className="flex flex-col items-center justify-center gap-2 border border-dashed border-border/70 py-16 text-center text-sm text-muted-foreground"><Database className="size-6 opacity-60" /><p>{label}</p></div>;
}
