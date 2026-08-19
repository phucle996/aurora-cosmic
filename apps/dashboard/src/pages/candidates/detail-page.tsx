import { useEffect, useMemo, useState } from 'react';
import type { JSX } from 'react';
import { ArrowLeft, CircleAlert, Database, ExternalLink, FlaskConical, LoaderCircle, Orbit, Rotate3D, Sparkles, Star, ThermometerSun } from 'lucide-react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { OrbitViewer3D } from '@/components/OrbitViewer3D';
import { apiFetch } from '@/lib/api';
import type { CandidateDetailResponse, LightcurveResponse } from '@/lib/analytics-types';

function number(value: number | null | undefined, digits = 2): string {
  return value == null || !Number.isFinite(value) ? '—' : value.toFixed(digits);
}

function tierLabel(tier: string): string {
  return ({ high_priority: 'High priority', promising: 'Promising', low_priority: 'Low priority', unlikely: 'Unlikely', not_assessed: 'Not assessed' } as Record<string, string>)[tier] ?? tier;
}

export default function CandidateDetailPage(): JSX.Element {
  const { predictionId = '' } = useParams();
  const [search] = useSearchParams();
  const snapshot = search.get('snapshot_id') ?? '';
  const [detail, setDetail] = useState<CandidateDetailResponse>();
  const [curve, setCurve] = useState<LightcurveResponse>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (!predictionId || !snapshot) return;
    let active = true;
    setError(undefined);
    void apiFetch<CandidateDetailResponse>(`/v1/candidates/${encodeURIComponent(predictionId)}?snapshot_id=${encodeURIComponent(snapshot)}`)
      .then(async (result) => {
        if (!active) return;
        setDetail(result);
        try {
          const lightcurve = await apiFetch<LightcurveResponse>(`/v1/lightcurves?tic_id=${result.candidate.tic_id}&sector=${result.candidate.sector}&limit=1000`);
          if (active) setCurve(lightcurve);
        } catch {
          if (active) setCurve(undefined);
        }
      })
      .catch((reason: unknown) => active && setError(reason instanceof Error ? reason.message : 'Unable to load candidate'));
    return () => { active = false; };
  }, [predictionId, snapshot]);

  const chartData = useMemo(() => curve?.time.map((time, index) => ({ time, flux: curve.flux[index] ?? 0 })) ?? [], [curve]);

  if (!snapshot) return <Message title="Thiếu snapshot" detail="Candidate detail cần snapshot_id để bảo đảm dữ liệu và model result cùng một phiên bản." />;
  if (error) return <Message title="Không tải được candidate" detail={error} destructive />;
  if (!detail) return <div className="flex items-center justify-center gap-2 py-24 text-sm text-muted-foreground"><LoaderCircle className="animate-spin" />Loading candidate physics…</div>;

  const { candidate, evidence, planet_physics: physics, habitability } = detail;
  const physicsScore = habitability.physics_score;
  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <Button asChild variant="ghost" size="sm" className="mb-3 -ml-3"><Link to="/candidates"><ArrowLeft />Candidate queue</Link></Button>
          <div className="flex flex-wrap items-center gap-2"><h2 className="font-heading text-2xl font-semibold md:text-3xl">TIC {candidate.tic_id}</h2><Badge variant={candidate.above_threshold ? 'default' : 'outline'}>{candidate.above_threshold ? 'priority review' : 'ranked'}</Badge><Badge variant="secondary">Sector {candidate.sector}</Badge></div>
          <p className="mt-2 font-mono text-xs text-muted-foreground">{physics.planet_candidate_id} · {physics.model_version}</p>
        </div>
        <Button asChild variant="outline"><Link to={`/targets/${candidate.tic_id}?sector=${candidate.sector}`}><Star />Open host target</Link></Button>
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(300px,0.72fr)_minmax(0,1.28fr)]">
        <Card className="overflow-hidden border-primary/25 bg-gradient-to-br from-primary/10 via-card to-card">
          <CardHeader><CardTitle>Habitability screening</CardTitle><CardDescription>Explainable physics score, not probability of life.</CardDescription></CardHeader>
          <CardContent className="space-y-5">
            <div className="flex items-end justify-between gap-4"><div><p className="text-5xl font-semibold tracking-tight">{physicsScore == null ? '—' : physicsScore.toFixed(0)}<span className="text-xl text-muted-foreground">/100</span></p><p className="mt-2 text-sm font-medium text-primary">{tierLabel(habitability.tier)}</p></div><Badge variant={habitability.status === 'evaluated' ? 'default' : 'outline'}>{habitability.status.replace('_', ' ')}</Badge></div>
            <div><div className="mb-2 flex justify-between text-xs text-muted-foreground"><span>Input confidence</span><span>{(habitability.confidence * 100).toFixed(0)}%</span></div><Progress value={habitability.confidence * 100} /></div>
            <div className="rounded-lg border border-border bg-background/50 p-3 text-sm"><div className="flex items-center gap-2 font-medium"><Sparkles className="size-4 text-primary" />ML habitability score</div><p className="mt-1 text-muted-foreground">{habitability.ml_score == null ? 'Chưa đánh giá — cần model được huấn luyện và kiểm định.' : `${habitability.ml_score.toFixed(1)}/100`}</p></div>
            <p className="text-xs leading-relaxed text-muted-foreground">{habitability.disclaimer}</p>
          </CardContent>
        </Card>

        <Card><CardHeader><CardTitle>Physical parameters</CardTitle><CardDescription>Observed inputs and deterministic derived estimates.</CardDescription></CardHeader><CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <PhysicsMetric icon={Orbit} label="Orbital period" value={`${number(physics.orbital_period_days, 3)} days`} source="observed · BLS" />
          <PhysicsMetric icon={FlaskConical} label="Planet radius" value={`${number(physics.planet_radius_earth)} R⊕`} source="derived" />
          <PhysicsMetric icon={Orbit} label="Semi-major axis" value={`${number(physics.semi_major_axis_au, 4)} AU`} source="derived · Kepler" />
          <PhysicsMetric icon={ThermometerSun} label="Equilibrium temp." value={`${number(physics.equilibrium_temperature_k, 0)} K`} source="derived · albedo 0.30" />
          <PhysicsMetric icon={Star} label="Incident flux" value={`${number(physics.insolation_earth)} S⊕`} source="derived" />
          <PhysicsMetric icon={Star} label="Stellar luminosity" value={`${number(physics.stellar_luminosity_solar)} L☉`} source="derived" />
        </CardContent></Card>
      </div>

      {/* 3D Planetary Orbit & System Simulation */}
      <Card className="overflow-hidden border-primary/25 bg-card shadow-lg">
        <CardHeader className="bg-muted/15 border-b border-border/60 pb-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2 text-base">
                <Rotate3D className="size-5 text-primary" />
                3D Planetary Orbit & System Simulation
              </CardTitle>
              <CardDescription className="mt-0.5">
                Mô hình quỹ đạo không gian 3D tương tác của ứng viên {physics.planet_candidate_id} quay quanh sao chủ TIC {candidate.tic_id}.
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="font-mono text-xs text-primary border-primary/40">
                Keplerian 3D Model
              </Badge>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <OrbitViewer3D
            star={{
              name: `TIC ${candidate.tic_id}`,
              teff: evidence.teff || 5778,
              radius: evidence.stellar_radius || 1.0,
              mass: evidence.stellar_mass || 1.0,
              mag: evidence.tmag || 10.0,
            }}
            planets={[
              {
                name: physics.planet_candidate_id || `Candidate b`,
                radiusEarth: physics.planet_radius_earth || 1.2,
                periodDays: physics.orbital_period_days || 10.0,
                semiMajorAxisAu: physics.semi_major_axis_au || 0.08,
                tempK: physics.equilibrium_temperature_k || 280,
                habitabilityTier: habitability.tier,
                habitabilityScore: habitability.physics_score ?? undefined,
              },
            ]}
            height="620px"
          />
        </CardContent>
      </Card>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card><CardHeader><CardTitle>Score breakdown</CardTitle><CardDescription>Mỗi thành phần cho biết điểm đến từ đâu và dữ liệu nào còn thiếu.</CardDescription></CardHeader><CardContent className="space-y-4">{habitability.components.map((component) => <div key={component.key}><div className="mb-1.5 flex items-center justify-between gap-3 text-sm"><span className={component.available ? 'font-medium' : 'text-muted-foreground'}>{component.label}</span><span className="font-mono">{component.available ? component.score.toFixed(1) : '—'} / {component.max_score}</span></div><Progress value={component.available ? component.score / component.max_score * 100 : 0} /><p className="mt-1.5 text-xs text-muted-foreground">{component.reason}</p></div>)}</CardContent></Card>
        <Card><CardHeader><CardTitle>Transit & host evidence</CardTitle><CardDescription>Catalog context used to derive the physical read model.</CardDescription></CardHeader><CardContent><dl className="grid grid-cols-2 gap-x-6 gap-y-4 text-sm"><Info label="Transit depth" value={evidence.bls_available ? number(evidence.bls_depth, 6) : '—'} /><Info label="BLS power" value={number(evidence.bls_power, 3)} /><Info label="Stellar Teff" value={`${number(evidence.teff, 0)} K`} /><Info label="Stellar radius" value={`${number(evidence.stellar_radius)} R☉`} /><Info label="Stellar mass" value={`${number(evidence.stellar_mass)} M☉`} /><Info label="TESS magnitude" value={number(evidence.tmag)} /><Info label="TOI match" value={evidence.matched_toi_id || evidence.toi_match_status || 'unmatched'} /><Info label="TCE match" value={evidence.matched_tce_id || evidence.tce_match_status || 'unmatched'} /></dl>{physics.warnings.length > 0 && <div className="mt-5 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-300">{physics.warnings.map((warning) => warning.replace(/_/g, ' ')).join(' · ')}</div>}</CardContent></Card>
      </div>

      <Card><CardHeader className="flex-row items-center justify-between"><div><CardTitle>Light curve</CardTitle><CardDescription>{chartData.length ? `${chartData.length.toLocaleString()} indexed samples` : 'No indexed samples available.'}</CardDescription></div>{evidence.matched_toi_id && <Button asChild variant="outline" size="sm"><Link to={`/exoplanets?system=${encodeURIComponent(evidence.matched_toi_id)}`}>NASA Eyes <ExternalLink /></Link></Button>}</CardHeader><CardContent>{chartData.length === 0 ? <div className="py-16 text-center text-sm text-muted-foreground">Light curve is not available in the query index.</div> : <div className="h-72"><ResponsiveContainer width="100%" height="100%"><LineChart data={chartData}><CartesianGrid vertical={false} strokeDasharray="3 3" /><XAxis dataKey="time" tickLine={false} axisLine={false} tickFormatter={(value: number) => value.toFixed(1)} /><YAxis width={58} tickLine={false} axisLine={false} tickFormatter={(value: number) => value.toFixed(3)} /><Tooltip formatter={(value) => [Number(value).toFixed(6), 'flux']} /><Line dataKey="flux" stroke="var(--primary)" dot={false} strokeWidth={1.5} isAnimationActive={false} /></LineChart></ResponsiveContainer></div>}</CardContent></Card>
    </div>
  );
}

function PhysicsMetric({ icon: Icon, label, value, source }: { icon: typeof Orbit; label: string; value: string; source: string }): JSX.Element { return <div className="rounded-lg border border-border bg-muted/20 p-4"><div className="flex items-center gap-2 text-xs text-muted-foreground"><Icon className="size-4 text-primary" />{label}</div><p className="mt-2 text-xl font-semibold">{value}</p><Badge variant="outline" className="mt-2">{source}</Badge></div>; }
function Info({ label, value }: { label: string; value: string }): JSX.Element { return <div><dt className="text-xs text-muted-foreground">{label}</dt><dd className="mt-1 font-medium">{value}</dd></div>; }
function Message({ title, detail, destructive = false }: { title: string; detail: string; destructive?: boolean }): JSX.Element { return <Card className={destructive ? 'border-destructive/40' : ''}><CardContent className="flex gap-3 p-6"><CircleAlert className={destructive ? 'text-destructive' : 'text-primary'} /><div><p className="font-medium">{title}</p><p className="mt-1 text-sm text-muted-foreground">{detail}</p><Button asChild variant="outline" size="sm" className="mt-4"><Link to="/candidates"><Database />Candidate queue</Link></Button></div></CardContent></Card>; }
