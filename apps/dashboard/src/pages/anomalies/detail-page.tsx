import { useEffect, useMemo, useState } from 'react';
import type { JSX } from 'react';
import { ArrowLeft, AlertTriangle, CheckCircle2, CircleAlert, Database, ExternalLink, LoaderCircle } from 'lucide-react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { apiFetch } from '@/lib/api';
import type { AnomalyDetailResponse, AnomalyExplanationFeature, LightcurveResponse } from '@/lib/analytics-types';

function number(value: number | null | undefined, digits = 6): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return value.toFixed(digits);
}

function pct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function formatDate(value: string): string {
  const parsed = new Date(value);
  return Number.isNaN(parsed.valueOf()) ? value || '—' : parsed.toLocaleString();
}

export default function AnomalyDetailPage(): JSX.Element {
  const { predictionId = '' } = useParams();
  const [searchParams] = useSearchParams();
  const snapshotID = searchParams.get('snapshot_id') || '';
  const [detail, setDetail] = useState<AnomalyDetailResponse>();
  const [lightcurve, setLightcurve] = useState<LightcurveResponse>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (!predictionId || !snapshotID) {
      setError('Thiếu prediction_id hoặc snapshot_id để kiểm tra lineage.');
      return;
    }
    let cancelled = false;
    setError(undefined);
    setDetail(undefined);
    setLightcurve(undefined);
    void apiFetch<AnomalyDetailResponse>(`/v1/anomalies/${encodeURIComponent(predictionId)}?snapshot_id=${encodeURIComponent(snapshotID)}`)
      .then((nextDetail) => {
        if (!cancelled) setDetail(nextDetail);
      }).catch((loadError) => {
      if (!cancelled) setError(loadError instanceof Error ? loadError.message : 'Không tải được anomaly detail');
      });
    return () => { cancelled = true; };
  }, [predictionId, snapshotID]);

  useEffect(() => {
    if (!detail?.anomaly) return;
    let cancelled = false;
    void apiFetch<LightcurveResponse>(`/v1/lightcurves?tic_id=${detail.anomaly.tic_id}&sector=${detail.anomaly.sector}&limit=4000`)
      .then((nextLightcurve) => { if (!cancelled) setLightcurve(nextLightcurve); })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [detail]);

  const features = detail?.explanation?.features ?? [];
  const topFeatures = useMemo(
    () => [...features].sort((left, right) => right.contribution - left.contribution).slice(0, 8),
    [features],
  );
  const curve = useMemo(() => {
    if (!lightcurve) return [];
    const step = Math.max(1, Math.ceil(lightcurve.time.length / 1800));
    return lightcurve.time.filter((_, index) => index % step === 0).map((time, index) => ({
      time,
      flux: lightcurve.flux[index * step],
    }));
  }, [lightcurve]);

  if (error) return <ErrorState message={error} />;
  if (!detail) return <div className="flex min-h-64 items-center justify-center gap-2 text-sm text-muted-foreground"><LoaderCircle className="animate-spin" />Loading anomaly evidence…</div>;

  const anomaly = detail.anomaly;
  const explanation = detail.explanation;
  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
        <div>
          <Button asChild variant="ghost" className="mb-2 -ml-3"><Link to="/anomalies"><ArrowLeft />Back to review queue</Link></Button>
          <div className="flex flex-wrap items-center gap-2"><Badge variant={anomaly.above_threshold ? 'destructive' : 'secondary'}>{anomaly.above_threshold ? 'FLAGGED' : 'BELOW THRESHOLD'}</Badge><span className="font-mono text-xs text-muted-foreground">{anomaly.prediction_id}</span></div>
          <h1 className="mt-2 font-heading text-2xl font-semibold tracking-tight md:text-3xl">Anomaly detail · TIC {anomaly.tic_id}</h1>
          <p className="mt-1 text-sm text-muted-foreground">Đối chiếu immutable Gold input với tensor model, reconstruction và light curve quan sát.</p>
        </div>
        <Button asChild variant="outline"><Link to={`/targets/${anomaly.tic_id}?sector=${anomaly.sector}`}><ExternalLink />Open target</Link></Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Metric label="Reconstruction MSE" value={number(anomaly.reconstruction_mse)} detail={`threshold ${number(anomaly.decision_threshold)}`} />
        <Metric label="Decision margin" value={number(anomaly.reconstruction_mse - anomaly.decision_threshold)} detail="MSE − threshold" />
        <Metric label="Features used" value={explanation ? `${features.length} / ${explanation.feature_order.length}` : '—'} detail="Only model input features" />
        <Metric label="Detected at" value={formatDate(anomaly.predicted_at)} detail={`sector ${anomaly.sector}`} />
      </div>

      {!detail.explanation_available || !explanation ? (
        <div className="flex items-start gap-3 rounded-lg border border-amber-400/30 bg-amber-400/10 p-4 text-sm">
          <CircleAlert className="mt-0.5 size-4 shrink-0 text-amber-300" />
          <div><p className="font-medium">Explanation artifact chưa có</p><p className="mt-1 text-muted-foreground">Prediction này được tạo trước khi audit sidecar được bật. Score vẫn hợp lệ; hãy chạy lại inference để có diff theo từng feature.</p></div>
        </div>
      ) : (
        <>
          <Card>
            <CardHeader><CardTitle>Top feature contributions</CardTitle><CardDescription>Contribution = residual² / tổng residual². Đây là phần đóng góp vào MSE, không phải xác suất nguyên nhân vật lý.</CardDescription></CardHeader>
            <CardContent>
              <div className="space-y-3">
                {topFeatures.map((feature) => <ContributionBar key={feature.name} feature={feature} />)}
              </div>
            </CardContent>
          </Card>

          <Card className="overflow-hidden">
            <CardHeader><CardTitle>Gold → model → reconstruction diff</CardTitle><CardDescription>Giá trị Gold là dữ liệu đầu vào; model value là giá trị sau fallback median nếu Gold bị null; z-input là tensor thật gửi vào ONNX.</CardDescription></CardHeader>
            <CardContent className="overflow-x-auto">
              <Table className="min-w-[1040px]"><TableHeader><TableRow><TableHead>Feature</TableHead><TableHead>Gold value</TableHead><TableHead>Model value</TableHead><TableHead>z-input</TableHead><TableHead>Reconstruction</TableHead><TableHead>Residual²</TableHead><TableHead>Contribution</TableHead><TableHead>Audit</TableHead></TableRow></TableHeader>
                <TableBody>{features.map((feature) => <FeatureRow key={feature.name} feature={feature} />)}</TableBody>
              </Table>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Provenance & reproducibility</CardTitle><CardDescription>Những định danh này giúp con người chạy lại đúng pipeline và kiểm tra tensor hash.</CardDescription></CardHeader>
            <CardContent><dl className="grid gap-4 text-xs sm:grid-cols-2 lg:grid-cols-3"><Info label="Gold snapshot" value={explanation.gold_snapshot_id} /><Info label="Gold artifact" value={explanation.gold_artifact_key} /><Info label="Runtime package" value={explanation.runtime_package_id} /><Info label="Runtime validation" value={explanation.runtime_validation_id} /><Info label="Preprocessing" value={`${explanation.preprocessing_version} · ${explanation.split_id}`} /><Info label="Model input SHA-256" value={explanation.model_input_sha256} /></dl></CardContent>
          </Card>
        </>
      )}

      <Card>
        <CardHeader><CardTitle>Observed light curve</CardTitle><CardDescription>Raw time-series được dùng để tạo Silver/Gold features. Chart này giúp reviewer kiểm tra context, gap và mức flux bất thường.</CardDescription></CardHeader>
        <CardContent>{curve.length === 0 ? <p className="py-10 text-center text-sm text-muted-foreground">Không có light curve cho TIC/sector này.</p> : <div className="h-[340px] w-full"><ResponsiveContainer width="100%" height="100%"><LineChart data={curve} margin={{ top: 12, right: 18, left: 4, bottom: 8 }}><CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" /><XAxis dataKey="time" tick={{ fontSize: 10 }} tickFormatter={(value: number) => value.toFixed(1)} /><YAxis tick={{ fontSize: 10 }} domain={['auto', 'auto']} /><Tooltip labelFormatter={(value) => `time ${Number(value).toFixed(6)}`} formatter={(value: number) => [number(value, 6), 'flux']} /><ReferenceLine y={0} stroke="hsl(var(--muted-foreground))" /><Line type="monotone" dataKey="flux" stroke="hsl(var(--primary))" dot={false} strokeWidth={1.5} /></LineChart></ResponsiveContainer></div>}</CardContent>
      </Card>

      <div className="flex items-center gap-2 text-xs text-muted-foreground"><CheckCircle2 className="size-4 text-emerald-400" />Decision is deterministic: reconstruction_mse ≥ threshold. FLAGGED không tự kết luận có ngoại hành tinh.</div>
    </div>
  );
}

function Metric({ label, value, detail }: { label: string; value: string; detail: string }): JSX.Element {
  return <Card><CardContent className="p-4"><p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p><p className="mt-1 truncate font-mono text-lg font-semibold">{value}</p><p className="mt-1 truncate text-xs text-muted-foreground">{detail}</p></CardContent></Card>;
}

function ContributionBar({ feature }: { feature: AnomalyExplanationFeature }): JSX.Element {
  return <div><div className="mb-1 flex justify-between gap-3 text-xs"><span className="font-mono">{feature.name}</span><span className="font-mono text-muted-foreground">{pct(feature.contribution)}</span></div><div className="h-2 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary" style={{ width: `${Math.min(100, feature.contribution * 100)}%` }} /></div></div>;
}

function FeatureRow({ feature }: { feature: AnomalyExplanationFeature }): JSX.Element {
  return <TableRow><TableCell className="font-mono font-medium">{feature.name}</TableCell><TableCell className="font-mono text-xs">{number(feature.gold_value)}</TableCell><TableCell className="font-mono text-xs">{number(feature.model_value)}</TableCell><TableCell className="font-mono text-xs">{number(feature.standardized_input)}</TableCell><TableCell className="font-mono text-xs">{number(feature.reconstruction)}</TableCell><TableCell className="font-mono text-xs text-primary">{number(feature.squared_residual)}</TableCell><TableCell className="font-mono text-xs">{pct(feature.contribution)}</TableCell><TableCell>{feature.imputed ? <Badge variant="secondary">median fallback</Badge> : <Badge variant="outline">Gold observed</Badge>}</TableCell></TableRow>;
}

function Info({ label, value }: { label: string; value: string }): JSX.Element {
  return <div className="min-w-0"><dt className="text-muted-foreground">{label}</dt><dd className="mt-1 break-all font-mono text-foreground">{value || '—'}</dd></div>;
}

function ErrorState({ message }: { message: string }): JSX.Element {
  return <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-5 text-sm text-destructive"><div className="flex items-center gap-2 font-medium"><AlertTriangle className="size-4" />Unable to load anomaly detail</div><p className="mt-2 opacity-90">{message}</p><Button asChild variant="outline" className="mt-4"><Link to="/anomalies"><Database />Back to anomalies</Link></Button></div>;
}
