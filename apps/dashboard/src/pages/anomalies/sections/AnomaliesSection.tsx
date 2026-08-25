import { useCallback, useEffect, useMemo, useState } from 'react';
import type { JSX } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertTriangle,
  CircleAlert,
  Clock3,
  Database,
  Gauge,
  Layers3,
  LoaderCircle,
  RefreshCw,
} from 'lucide-react';

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
  runtime_package_id: string;
  gold_snapshot_id: string;
  sector: number;
  expected_prediction_count: number;
  created_at: string;
  status: string;
};

type AnomalyRecord = {
  prediction_id: string;
  source_product_id: string;
  tic_id: number;
  sector: number;
  reconstruction_mse: number;
  decision_threshold: number;
  above_threshold: boolean;
  model_version: string;
  registered_model_id: string;
  gold_snapshot_id: string;
  runtime_validation_id: string;
  runtime_package_id: string;
  predicted_at: string;
};

type JobResponse = { jobs: InferenceJob[] };
type AnomalyResponse = {
  anomalies: AnomalyRecord[];
  count: number;
  snapshot_id: string;
  only_flagged: boolean;
};

function formatDate(value: string): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? value : date.toLocaleString();
}

function formatScore(value: number): string {
  if (!Number.isFinite(value)) return '—';
  return value.toFixed(5);
}

function statusVariant(status: string): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (status === 'completed') return 'default';
  if (status === 'failed') return 'destructive';
  if (status === 'planned' || status === 'queued') return 'secondary';
  return 'outline';
}

export default function AnomaliesSection(): JSX.Element {
  const [jobs, setJobs] = useState<InferenceJob[]>([]);
  const [anomalies, setAnomalies] = useState<AnomalyRecord[]>([]);
  const [snapshotID, setSnapshotID] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string>();

  const loadData = useCallback(async (isRefresh = false) => {
    setError(undefined);
    if (isRefresh) setRefreshing(true);
    else setLoading(true);

    try {
      const jobResponse = await apiFetch<JobResponse>('/v1/inference/jobs?task=astronomical_anomaly_detection');
      const nextJobs = jobResponse.jobs ?? [];
      setJobs(nextJobs);

      const latestCompletedJob = nextJobs.find((job) => job.status === 'completed' && job.gold_snapshot_id);
      if (!latestCompletedJob) {
        setAnomalies([]);
        setSnapshotID('');
        return;
      }

      const anomalyResponse = await apiFetch<AnomalyResponse>(
        `/v1/anomalies?snapshot_id=${encodeURIComponent(latestCompletedJob.gold_snapshot_id)}&only_flagged=true&limit=100`,
      );
      setAnomalies(anomalyResponse.anomalies ?? []);
      setSnapshotID(anomalyResponse.snapshot_id || latestCompletedJob.gold_snapshot_id);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Unable to load anomaly results');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const latestCompletedJob = jobs.find((job) => job.status === 'completed' && job.gold_snapshot_id);
  const sectors = useMemo(() => new Set(anomalies.map((item) => item.sector)).size, [anomalies]);
  const peakScore = useMemo(
    () => anomalies.reduce((peak, item) => Math.max(peak, item.reconstruction_mse), 0),
    [anomalies],
  );
  const threshold = anomalies[0]?.decision_threshold ?? 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
        <div>
          <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
            <AlertTriangle className="size-4 text-primary" />
            Review queue
          </div>
          <h2 className="font-heading text-2xl font-semibold tracking-tight md:text-3xl">Anomaly Engine</h2>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            Các light curve vượt reconstruction threshold được đưa vào hàng đợi để theo dõi và xem xét.
          </p>
        </div>
        <Button variant="outline" onClick={() => void loadData(true)} disabled={loading || refreshing}>
          <RefreshCw className={refreshing ? 'animate-spin' : ''} />
          Refresh results
        </Button>
      </div>

      {error && (
        <div className="flex items-start gap-3 rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
          <CircleAlert className="mt-0.5 size-4 shrink-0" />
          <div><p className="font-medium">Không tải được anomaly results</p><p className="mt-1 opacity-90">{error}</p></div>
        </div>
      )}

      <div className="grid min-w-0 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard icon={AlertTriangle} label="Flagged anomalies" value={anomalies.length} detail="Above model threshold" />
        <MetricCard icon={Layers3} label="Sectors to review" value={sectors} detail="Distinct affected sectors" />
        <MetricCard icon={Gauge} label="Peak reconstruction MSE" value={formatScore(peakScore)} detail={`Threshold ${formatScore(threshold)}`} />
        <MetricCard icon={Clock3} label="Completed runs" value={jobs.filter((job) => job.status === 'completed').length} detail="GPU inference jobs" />
      </div>

      <div className="grid min-w-0 gap-6 2xl:grid-cols-[minmax(0,1.25fr)_minmax(0,0.75fr)]">
        <Card className="min-w-0 overflow-hidden">
          <CardHeader className="gap-3 md:flex-row md:items-center md:justify-between">
            <div className="min-w-0">
              <CardTitle>Review queue</CardTitle>
              <CardDescription>Chỉ các prediction có MSE lớn hơn hoặc bằng threshold được hiển thị.</CardDescription>
            </div>
            <Badge variant="secondary">only_flagged=true</Badge>
          </CardHeader>
          <CardContent>
            {loading ? <LoadingState /> : !latestCompletedJob ? <EmptyState label="Chưa có anomaly inference job hoàn tất." /> : anomalies.length === 0 ? <EmptyState label="Không có anomaly vượt threshold trong snapshot mới nhất." /> : (
              <Table className="min-w-[920px]">
                <TableHeader><TableRow><TableHead>Target</TableHead><TableHead>Score / threshold</TableHead><TableHead>Sector</TableHead><TableHead>Detected</TableHead><TableHead>Model</TableHead><TableHead>Review</TableHead></TableRow></TableHeader>
                <TableBody>
                  {anomalies.map((item) => (
                    <TableRow key={item.prediction_id}>
                      <TableCell>
                        <p className="font-mono font-medium text-primary">TIC {item.tic_id}</p>
                        <p className="mt-1 max-w-56 truncate font-mono text-xs text-muted-foreground">{item.source_product_id}</p>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2"><Badge variant="destructive">flagged</Badge><span className="font-mono text-xs">{formatScore(item.reconstruction_mse)}</span></div>
                        <p className="mt-1 text-xs text-muted-foreground">threshold {formatScore(item.decision_threshold)}</p>
                      </TableCell>
                      <TableCell>{item.sector}</TableCell>
                      <TableCell className="whitespace-nowrap text-xs text-muted-foreground">{formatDate(item.predicted_at)}</TableCell>
                      <TableCell className="max-w-44 truncate font-mono text-xs text-muted-foreground">{item.model_version || '—'}</TableCell>
                      <TableCell><Button asChild size="sm" variant="outline"><Link to={`/anomalies/${encodeURIComponent(item.prediction_id)}?snapshot_id=${encodeURIComponent(item.gold_snapshot_id)}`}>Open detail</Link></Button></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card className="min-w-0 overflow-hidden">
          <CardHeader><CardTitle>Current inference</CardTitle><CardDescription>Lineage của snapshot đang được đưa vào review queue.</CardDescription></CardHeader>
          <CardContent>
            {!latestCompletedJob ? <EmptyState label="Chưa có completed anomaly job để chọn snapshot." /> : (
              <div className="space-y-4">
                <div className="rounded-lg border border-border bg-muted/30 p-4">
                  <div className="flex items-start justify-between gap-3"><div><p className="font-medium">Anomaly detection</p><p className="mt-1 text-xs text-muted-foreground">{latestCompletedJob.model_version || latestCompletedJob.model_id}</p></div><Badge variant={statusVariant(latestCompletedJob.status)}>{latestCompletedJob.status}</Badge></div>
                  <Separator className="my-3" />
                  <dl className="grid grid-cols-2 gap-3 text-xs"><InfoItem label="Gold snapshot" value={snapshotID || latestCompletedJob.gold_snapshot_id} /><InfoItem label="Rows" value={latestCompletedJob.expected_prediction_count.toLocaleString()} /><InfoItem label="Job" value={latestCompletedJob.job_id} /><InfoItem label="Sector" value={`${latestCompletedJob.sector}`} /><InfoItem label="Created" value={formatDate(latestCompletedJob.created_at)} /><InfoItem label="Flagged" value={`${anomalies.length}`} /></dl>
                </div>
                <div className="flex items-center gap-2 text-xs text-muted-foreground"><Database className="size-4" />Gold-only input · Rust GPU inference · thresholded review queue</div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function MetricCard({ icon: Icon, label, value, detail }: { icon: typeof AlertTriangle; label: string; value: number | string; detail: string }): JSX.Element {
  return <Card><CardContent className="flex items-center gap-3 p-4"><div className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary"><Icon className="size-5" /></div><div className="min-w-0"><p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p><p className="mt-0.5 truncate text-xl font-semibold">{value}</p><p className="truncate text-xs text-muted-foreground">{detail}</p></div></CardContent></Card>;
}

function InfoItem({ label, value }: { label: string; value: string }): JSX.Element {
  return <div><dt className="text-muted-foreground">{label}</dt><dd className="mt-0.5 truncate font-medium text-foreground">{value}</dd></div>;
}

function LoadingState(): JSX.Element {
  return <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground"><LoaderCircle className="animate-spin" />Loading anomaly results…</div>;
}

function EmptyState({ label }: { label: string }): JSX.Element {
  return <div className="flex flex-col items-center justify-center gap-2 py-12 text-center text-sm text-muted-foreground"><Database className="size-6 opacity-60" /><p>{label}</p></div>;
}
