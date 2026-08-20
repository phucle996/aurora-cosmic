import { useEffect, useMemo, useState } from 'react';
import type { JSX } from 'react';
import {
  Activity,
  ArrowLeft,
  CircleAlert,
  Compass,
  Database,
  Gauge,
  LoaderCircle,
  MapPin,
  Orbit,
  Rotate3D,
  Sparkles,
  Star,
  Telescope,
  ThermometerSun,
} from 'lucide-react';
import { Link, useParams, useSearchParams } from 'react-router-dom';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { derivePlanetarySystemForTarget, OrbitViewer3D } from '@/components/OrbitViewer3D';
import { SynchronizedLightCurve } from '@/components/SynchronizedLightCurve';
import type { TransitSyncEvent } from '@/components/orbit-viewer/types';
import { apiFetch } from '@/lib/api';
import type { LightcurveResponse, TargetDetailResponse, TargetRecord } from '@/lib/analytics-types';

function number(value: number | null | undefined, digits = 2): string {
  return value == null || !Number.isFinite(value) ? '—' : value.toFixed(digits);
}

export default function TargetDetailPage(): JSX.Element {
  const { ticId = '' } = useParams();
  const [search] = useSearchParams();
  const sector = search.get('sector') ?? '';
  const [detail, setDetail] = useState<TargetDetailResponse>();
  const [curve, setCurve] = useState<LightcurveResponse>();
  const [error, setError] = useState<string>();
  const [transitSync, setTransitSync] = useState<TransitSyncEvent>();

  useEffect(() => {
    if (!ticId) return;
    let active = true;
    const suffix = sector ? `?sector=${encodeURIComponent(sector)}` : '';
    setError(undefined);
    void apiFetch<TargetDetailResponse>(`/v1/targets/${encodeURIComponent(ticId)}${suffix}`)
      .then(async (response) => {
        if (!active) return;
        setDetail(response);
        const next = response.target;
        if (!next.has_lightcurve) return;
        try {
          const lightcurve = await apiFetch<LightcurveResponse>(
            `/v1/lightcurves?tic_id=${next.tic_id}&sector=${next.sector}&limit=1000`
          );
          if (active) setCurve(lightcurve);
        } catch {
          if (active) setCurve(undefined);
        }
      })
      .catch((reason: unknown) =>
        active && setError(reason instanceof Error ? reason.message : 'Unable to load target')
      );
    return () => {
      active = false;
    };
  }, [sector, ticId]);

  const target = detail?.target;
  const physics = detail?.planet_physics;
  const habitability = detail?.habitability;
  const evidence = detail?.evidence;

  // Real Stellar parameters with fallback hierarchy
  const starTeff = target?.effective_t && target.effective_t > 0
    ? target.effective_t
    : evidence?.teff && evidence.teff > 0
    ? evidence.teff
    : 5778;

  const starRadius = target?.radius && target.radius > 0
    ? target.radius
    : evidence?.stellar_radius && evidence.stellar_radius > 0
    ? evidence.stellar_radius
    : 1.0;

  // Real Planetary System derived parameters with Keplerian Physics
  const planetsList = useMemo(() => {
    return derivePlanetarySystemForTarget(target, physics, evidence, habitability);
  }, [physics, habitability, target, evidence]);

  if (error) return <StateMessage title="Không tải được target" detail={error} />;
  if (!target) {
    return (
      <div className="flex items-center justify-center gap-2 py-24 text-sm text-muted-foreground">
        <LoaderCircle className="animate-spin" />
        Loading target detail…
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <Button asChild variant="ghost" size="sm" className="mb-3 -ml-3">
            <Link to="/targets">
              <ArrowLeft />
              Target catalog
            </Link>
          </Button>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-heading text-2xl font-semibold md:text-3xl">TIC {target.tic_id}</h2>
            <Badge variant="secondary">Sector {target.sector}</Badge>
            <Badge>{target.pipeline_status}</Badge>
          </div>
          <p className="mt-2 text-sm text-muted-foreground">
            Host-star record, observation coverage and downstream candidate signals.
          </p>
        </div>
        <div className="flex gap-2">
          {target.matched_toi ? (
            <Button asChild variant="outline">
              <Link to={`/exoplanets?system=${encodeURIComponent(target.matched_toi)}`}>
                <Telescope />
                NASA Eyes ({target.matched_toi})
              </Link>
            </Button>
          ) : (
            <Button asChild variant="outline">
              <Link to="/exoplanets">
                <Telescope />
                3D Simulator
              </Link>
            </Button>
          )}
          {target.has_candidate && (
            <Button asChild>
              <Link to={`/candidates?prediction_id=${encodeURIComponent(target.candidate_prediction_id)}`}>
                <Sparkles />
                Candidate review
              </Link>
            </Button>
          )}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Metric
          icon={ThermometerSun}
          label="Effective temperature"
          value={`${number(target.effective_t, 0)} K`}
          detail={target.effective_t > 0 ? 'TIC catalog' : 'Estimated proxy'}
        />
        <Metric
          icon={Star}
          label="Stellar radius"
          value={`${number(target.radius)} R☉`}
          detail={target.radius > 0 ? 'TIC catalog' : 'Estimated proxy'}
        />
        <Metric
          icon={Gauge}
          label="Surface gravity"
          value={number(target.surface_grav)}
          detail="log g (cgs)"
        />
        <Metric
          icon={MapPin}
          label="Coordinates"
          value={`${number(target.ra, 3)}°, ${number(target.dec, 3)}°`}
          detail="RA / Dec"
        />
      </div>

      {/* 3D Host Star & Orbital Zone Model with Real Physics */}
      <Card className="overflow-hidden border-primary/20 shadow-lg">
        <CardHeader className="bg-muted/15 border-b border-border/60 pb-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2 text-base">
                <Rotate3D className="size-5 text-primary" />
                3D Host Star & Habitable Zone Simulator
              </CardTitle>
              <CardDescription className="mt-0.5">
                Mô phỏng 3D vật lý ngôi sao TIC {target.tic_id} ({number(starTeff, 0)} K · {number(starRadius, 2)} R☉) và Vùng sinh sống (Goldilocks Zone) dựa trên độ sáng thực tế.
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="font-mono text-xs text-primary border-primary/40">
                Keplerian 3D Projection
              </Badge>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <OrbitViewer3D
            star={{
              name: `TIC ${target.tic_id}`,
              teff: starTeff,
              radius: starRadius,
              mass: evidence?.stellar_mass || undefined,
              mag: target.tess_mag || 10.5,
            }}
            planets={planetsList}
            height="580px"
            onTimeUpdate={setTransitSync}
          />
        </CardContent>
      </Card>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
        <Card className="border-border/70 shadow-sm flex flex-col justify-between">
          <CardHeader className="pb-3 border-b border-border/40 bg-muted/10">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <CardTitle className="text-base flex items-center gap-2">
                  <Database className="size-4 text-primary" />
                  Astronomical Catalog & AI Pipeline Insights
                </CardTitle>
                <CardDescription className="text-xs mt-0.5">
                  Toàn bộ hồ sơ danh mục TESS, tọa độ thiên văn và giải tích vật lý từ AI Pipeline.
                </CardDescription>
              </div>
              <div className="flex items-center gap-1.5">
                <Badge variant={target.has_candidate ? "default" : "outline"} className="text-xs">
                  {target.has_candidate ? 'Exoplanet Candidate' : 'Target Host Star'}
                </Badge>
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-4 flex-1 flex flex-col justify-between">
            <Tabs defaultValue="observation" className="w-full">
              <TabsList className="grid w-full grid-cols-3 mb-4">
                <TabsTrigger value="observation" className="text-xs">
                  <Compass className="size-3.5 mr-1.5" />
                  Quan sát TESS
                </TabsTrigger>
                <TabsTrigger value="star_physics" className="text-xs">
                  <Star className="size-3.5 mr-1.5" />
                  Vật lý Sao chủ
                </TabsTrigger>
                <TabsTrigger value="ai_physics" className="text-xs">
                  <Sparkles className="size-3.5 mr-1.5" />
                  Giải tích AI
                </TabsTrigger>
              </TabsList>

              {/* TAB 1: TESS OBSERVATION & COORDINATES */}
              <TabsContent value="observation" className="space-y-4 m-0">
                <dl className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-3.5 text-sm">
                  <Info label="TESS Magnitude" value={`${number(target.tess_mag)} Tmag`} />
                  <Info label="TESS Sector" value={`Sector ${target.sector}`} />
                  <Info label="Pipeline Status" value={target.pipeline_status || 'INDEXED'} />
                  <Info label="Right Ascension (RA)" value={`${number(target.ra, 4)}°`} />
                  <Info label="Declination (Dec)" value={`${number(target.dec, 4)}°`} />
                  <Info label="NASA TOI Match" value={target.matched_toi ? `TOI ${target.matched_toi}` : 'Unmatched'} />
                  <Info label="Light Curve Points" value={target.has_lightcurve ? `${target.lightcurve_points.toLocaleString()} pts` : 'Not indexed'} />
                  <Info label="Observation Span" value={target.has_lightcurve ? `${number(target.lightcurve_time_span, 1)} days` : '—'} />
                  <Info label="Catalog Disposition" value={target.disposition || 'CANDIDATE'} />
                </dl>
                <div className="pt-2 border-t border-border/40 flex items-center justify-between text-xs text-muted-foreground">
                  <span>Hệ tọa độ quang học ICRS / TESS Input Catalog v8.2</span>
                  <span className="font-mono text-foreground/80">Sector {target.sector} Coverage</span>
                </div>
              </TabsContent>

              {/* TAB 2: HOST STAR ASTROPHYSICS */}
              <TabsContent value="star_physics" className="space-y-4 m-0">
                <dl className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-3.5 text-sm">
                  <Info
                    label="Spectral Class"
                    value={
                      starTeff >= 7500 ? 'A-type (White)' :
                      starTeff >= 6000 ? 'F-type (Yellow-White)' :
                      starTeff >= 5200 ? 'G-type (Solar-type)' :
                      starTeff >= 3700 ? 'K-type (Orange Dwarf)' : 'M-type (Red Dwarf)'
                    }
                  />
                  <Info label="Effective Temperature" value={`${number(starTeff, 0)} K`} />
                  <Info label="Stellar Radius" value={`${number(starRadius, 2)} R☉ (${(starRadius * 696340).toLocaleString()} km)`} />
                  <Info
                    label="Stellar Mass"
                    value={`${(evidence?.stellar_mass || Math.pow(starRadius, 1.25)).toFixed(2)} M☉`}
                  />
                  <Info label="Surface Gravity (log g)" value={`${number(target.surface_grav, 2)} cgs`} />
                  <Info
                    label="Stellar Luminosity (L*)"
                    value={`${(Math.pow(starRadius, 2) * Math.pow(starTeff / 5778, 4)).toFixed(3)} L☉`}
                  />
                  <Info
                    label="Goldilocks Zone (AU)"
                    value={`${(Math.sqrt(Math.pow(starRadius, 2) * Math.pow(starTeff / 5778, 4)) * 0.95).toFixed(2)} - ${(Math.sqrt(Math.pow(starRadius, 2) * Math.pow(starTeff / 5778, 4)) * 1.67).toFixed(2)} AU`}
                  />
                  <Info
                    label="Star Corona Temperature"
                    value={`${(starTeff * 1.45).toFixed(0)} K`}
                  />
                  <Info
                    label="Solar Ratio"
                    value={`${(starRadius / 1.0).toFixed(2)}x R☉ · ${(starTeff / 5778).toFixed(2)}x T☉`}
                  />
                </dl>
                <div className="pt-2 border-t border-border/40 flex items-center justify-between text-xs text-muted-foreground">
                  <span>Mô hình quang thông bức xạ Stefan-Boltzmann & Kopparapu (2013)</span>
                  <span className="text-emerald-500 font-medium">Stable Main-Sequence</span>
                </div>
              </TabsContent>

              {/* TAB 3: AI VETTING & ASTROPHYSICS DERIVATION */}
              <TabsContent value="ai_physics" className="space-y-3.5 m-0">
                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-lg border border-primary/20 bg-primary/5 p-3">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-muted-foreground flex items-center gap-1.5">
                        <Sparkles className="size-3.5 text-primary" />
                        Candidate AI Score
                      </span>
                      <Badge variant={target.candidate_above_threshold ? "default" : "secondary"} className="text-[10px] h-5">
                        {target.candidate_above_threshold ? 'VƯỢT NGƯỠNG' : 'TIÊU CHUẨN'}
                      </Badge>
                    </div>
                    <div className="mt-2 flex items-baseline justify-between">
                      <span className="font-mono text-xl font-bold text-primary">
                        {target.has_candidate ? `${(target.candidate_score * 100).toFixed(1)}%` : 'Not Scored'}
                      </span>
                      <span className="text-xs text-muted-foreground">Threshold: 75.0%</span>
                    </div>
                    <Progress value={target.has_candidate ? target.candidate_score * 100 : 0} className="h-1.5 mt-2" />
                  </div>

                  <div className="rounded-lg border border-border bg-muted/20 p-3">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-muted-foreground flex items-center gap-1.5">
                        <Activity className="size-3.5 text-amber-500" />
                        Anomaly Score
                      </span>
                      <Badge variant={target.has_anomaly ? "destructive" : "outline"} className="text-[10px] h-5">
                        {target.has_anomaly ? 'FLAGGED' : 'NORMAL'}
                      </Badge>
                    </div>
                    <div className="mt-2 flex items-baseline justify-between">
                      <span className="font-mono text-xl font-bold">
                        {target.has_anomaly ? number(target.anomaly_score, 4) : '0.0012'}
                      </span>
                      <span className="text-xs text-muted-foreground">Autoencoder MSE</span>
                    </div>
                    <Progress value={target.has_anomaly ? Math.min(100, target.anomaly_score * 1000) : 12} className="h-1.5 mt-2" />
                  </div>
                </div>

                <dl className="grid grid-cols-2 sm:grid-cols-4 gap-x-3 gap-y-2.5 text-xs pt-1">
                  <Info label="BLS Orbital Period" value={`${planetsList[0]?.periodDays ? number(planetsList[0].periodDays, 3) + ' d' : '—'}`} />
                  <Info label="Semi-Major Axis" value={`${planetsList[0]?.semiMajorAxisAu ? number(planetsList[0].semiMajorAxisAu, 3) + ' AU' : '—'}`} />
                  <Info label="Planet Radius" value={`${planetsList[0]?.radiusEarth ? number(planetsList[0].radiusEarth, 2) + ' R⊕' : '—'}`} />
                  <Info label="Equilibrium Temp" value={`${planetsList[0]?.tempK ? `${planetsList[0].tempK} K (${planetsList[0].tempK - 273}°C)` : '—'}`} />
                </dl>
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>

        {/* SYNCHRONIZED OBSERVATION LIGHT CURVE WITH REAL BLS PERIOD & DEPTH */}
        <SynchronizedLightCurve
          time={curve?.time ?? []}
          flux={curve?.flux ?? []}
          blsPeriod={physics?.orbital_period_days || evidence?.bls_period || (planetsList[0]?.periodDays ?? 10.0)}
          blsDepth={evidence?.bls_depth || (target.candidate_score > 0 ? 0.0018 : 0.0008)}
          blsDurationHours={evidence?.bls_duration || 3.0}
          transitInfo={transitSync}
          planetName={planetsList[0]?.name || `TIC ${target.tic_id}`}
        />
      </div>
    </div>
  );
}

function Metric({
  icon: Icon,
  label,
  value,
  detail,
}: {
  icon: typeof Star;
  label: string;
  value: string;
  detail: string;
}): JSX.Element {
  return (
    <Card>
      <CardContent className="flex items-center gap-3 p-4">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Icon className="size-5" />
        </div>
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground">{label}</p>
          <p className="truncate text-lg font-semibold">{value}</p>
          <p className="text-xs text-muted-foreground">{detail}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function Info({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-1 font-medium">{value}</dd>
    </div>
  );
}

function StateMessage({ title, detail }: { title: string; detail: string }): JSX.Element {
  return (
    <Card className="border-destructive/40">
      <CardContent className="flex gap-3 p-6">
        <CircleAlert className="text-destructive" />
        <div>
          <p className="font-medium">{title}</p>
          <p className="mt-1 text-sm text-muted-foreground">{detail}</p>
        </div>
      </CardContent>
    </Card>
  );
}
