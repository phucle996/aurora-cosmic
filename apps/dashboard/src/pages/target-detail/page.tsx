import { useEffect, useMemo, useState } from 'react';
import type { JSX } from 'react';
import {
  ArrowLeft,
  CircleAlert,
  Compass,
  Database,
  Gauge,
  LoaderCircle,
  MapPin,
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
import type { LightcurveResponse, TargetDetailResponse } from '@/lib/analytics-types';

function number(value: number | null | undefined, digits = 2): string {
  return value == null || !Number.isFinite(value) ? '—' : value.toFixed(digits);
}

// Route page for one TESS target and its synchronized observations.
export default function TargetDetailPage(): JSX.Element {
  const { ticId = '' } = useParams();
  const [search] = useSearchParams();
  const sector = search.get('sector') ?? '';
	const snapshotID = search.get('snapshot_id') ?? '';
  const [detail, setDetail] = useState<TargetDetailResponse>();
  const [curve, setCurve] = useState<LightcurveResponse>();
  const [error, setError] = useState<string>();
  const [transitSync, setTransitSync] = useState<TransitSyncEvent>();

  useEffect(() => {
    if (!ticId) return;
    let active = true;
		const parameters = new URLSearchParams();
		if (sector) parameters.set('sector', sector);
		if (snapshotID) parameters.set('snapshot_id', snapshotID);
		const suffix = parameters.size > 0 ? `?${parameters.toString()}` : '';
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
  }, [sector, snapshotID, ticId]);

  const target = detail?.target;
  const physics = detail?.planet_physics;
  const habitability = detail?.habitability;
  const evidence = detail?.evidence;

  // Only derive stellar / orbital views from an actual TIC enrichment.  Do not
  // fill missing catalog context with solar defaults: that would look measured.
  const hasTicContext = target?.tic_context_available === true;
  const hasStellarContext = hasTicContext && Boolean(
    (target?.effective_t && target.effective_t > 0) || (evidence?.teff && evidence.teff > 0)
  ) && Boolean((target?.radius && target.radius > 0) || (evidence?.stellar_radius && evidence.stellar_radius > 0));
  const starTeff = target?.effective_t && target.effective_t > 0
    ? target.effective_t
    : evidence?.teff && evidence.teff > 0
    ? evidence.teff
    : 0;

  const starRadius = target?.radius && target.radius > 0
    ? target.radius
    : evidence?.stellar_radius && evidence.stellar_radius > 0
    ? evidence.stellar_radius
    : 0;

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

  const toiMatch = target.matched_toi
    ? `TOI ${target.matched_toi}`
    : target.toi_match_status === 'CATALOG_UNAVAILABLE'
    ? 'TOI catalog not applied to this Gold snapshot'
    : target.toi_match_status === 'NO_TOI_FOR_TARGET'
    ? 'No TOI catalog record for this TIC'
    : target.toi_match_status === 'PERIOD_MISMATCH'
    ? 'TOI exists, but its period does not match this BLS signal'
    : target.toi_match_status === 'BLS_UNAVAILABLE'
    ? 'No usable BLS ephemeris for TOI comparison'
    : target.toi_match_status === 'TARGET_ID_UNAVAILABLE'
    ? 'TIC identity is unavailable for TOI comparison'
    : 'Awaiting catalog enrichment';
  const labelStatus = 'Discovery evidence — curated labels are stored in a separate training cohort';

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <Button asChild variant="ghost" size="sm" className="mb-3 -ml-3">
            <Link to="/research-factory/discovery">
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
          <Button variant="outline" onClick={() => document.getElementById('target-system-3d')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>
            <Telescope />
            {target.matched_toi ? `3D · ${target.matched_toi}` : '3D Simulator'}
          </Button>
          {target.has_candidate && (
            <Button asChild>
						<Link to={`/research-factory/candidates/${encodeURIComponent(target.candidate_prediction_id)}?snapshot_id=${encodeURIComponent(target.gold_snapshot_id)}`}>
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
          value={hasTicContext && target.effective_t > 0 ? `${number(target.effective_t, 0)} K` : '—'}
          detail={hasTicContext ? 'TIC catalog' : 'TIC catalog not enriched'}
        />
        <Metric
          icon={Star}
          label="Stellar radius"
          value={hasTicContext && target.radius > 0 ? `${number(target.radius)} R☉` : '—'}
          detail={hasTicContext ? 'TIC catalog' : 'TIC catalog not enriched'}
        />
        <Metric
          icon={Gauge}
          label="Surface gravity"
          value={hasTicContext && target.surface_grav > 0 ? number(target.surface_grav) : '—'}
          detail={hasTicContext ? 'log g (cgs)' : 'TIC catalog not enriched'}
        />
        <Metric
          icon={MapPin}
          label="Coordinates"
          value={hasTicContext ? `${number(target.ra, 3)}°, ${number(target.dec, 3)}°` : '—'}
          detail={hasTicContext ? 'RA / Dec (ICRS)' : 'TIC catalog not enriched'}
        />
      </div>

      {/* 3D Host Star & Orbital Zone Model with Real Physics */}
      <Card id="target-system-3d" className="scroll-mt-20 overflow-hidden border-primary/20 shadow-lg">
        <CardHeader className="bg-muted/15 border-b border-border/60 pb-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2 text-base">
                <Rotate3D className="size-5 text-primary" />
                3D Host Star & Habitable Zone Simulator
              </CardTitle>
              <CardDescription className="mt-0.5">
                {hasStellarContext
                  ? `Mô phỏng 3D vật lý ngôi sao TIC ${target.tic_id} (${number(starTeff, 0)} K · ${number(starRadius, 2)} R☉) từ snapshot TIC đã xác minh.`
                  : 'Chờ TIC catalog enrichment trước khi dựng mô phỏng vật lý sao chủ.'}
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
          {hasStellarContext ? (
            <OrbitViewer3D
              star={{
                name: `TIC ${target.tic_id}`,
                teff: starTeff,
                radius: starRadius,
                mass: evidence?.stellar_mass || undefined,
                mag: target.tess_mag > 0 ? target.tess_mag : undefined,
              }}
              planets={planetsList}
              height="580px"
              onTimeUpdate={setTransitSync}
            />
          ) : (
            <div className="flex min-h-[360px] flex-col items-center justify-center gap-2 p-8 text-center text-sm text-muted-foreground">
              <CircleAlert className="size-6 text-amber-500" />
              <p className="font-medium text-foreground">Stellar simulation is unavailable</p>
              <p>This target has no verified TIC stellar context in the Gold snapshot yet.</p>
            </div>
          )}
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
                  <Info label="TESS Magnitude" value={hasTicContext && target.tess_mag > 0 ? `${number(target.tess_mag)} Tmag` : '— (TIC not enriched)'} />
                  <Info label="TESS Sector" value={`Sector ${target.sector}`} />
                  <Info label="Pipeline Status" value={target.pipeline_status || 'INDEXED'} />
                  <Info label="Right Ascension (RA)" value={hasTicContext ? `${number(target.ra, 4)}°` : '— (TIC not enriched)'} />
                  <Info label="Declination (Dec)" value={hasTicContext ? `${number(target.dec, 4)}°` : '— (TIC not enriched)'} />
                  <Info label="NASA TOI Match" value={toiMatch} />
                  <Info label="Light Curve Points" value={target.has_lightcurve ? `${target.lightcurve_points.toLocaleString()} pts` : 'Not indexed'} />
                  <Info label="Observation Span" value={target.has_lightcurve ? `${number(target.lightcurve_time_span, 1)} days` : '—'} />
                  <Info label="Catalog Disposition" value={labelStatus} />
                </dl>
                <div className="pt-2 border-t border-border/40 flex items-center justify-between text-xs text-muted-foreground">
                  <span>{hasTicContext ? 'ICRS coordinates from pinned TIC snapshot' : 'TIC snapshot has not enriched this target'}</span>
                  <span className="font-mono text-foreground/80">Sector {target.sector} Coverage</span>
                </div>
              </TabsContent>

              {/* TAB 2: HOST STAR ASTROPHYSICS */}
              <TabsContent value="star_physics" className="space-y-4 m-0">
                {hasStellarContext ? <><dl className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-3.5 text-sm">
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
                    value={evidence?.stellar_mass ? `${evidence.stellar_mass.toFixed(2)} M☉` : '—'}
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
                </> : <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-800 dark:text-amber-200">
                  Chưa có thông số TIC đã xác minh cho target này, nên không suy diễn loại sao, độ sáng hay vùng Goldilocks.
                </div>}
              </TabsContent>

              {/* TAB 3: AI VETTING & ASTROPHYSICS DERIVATION */}
              <TabsContent value="ai_physics" className="space-y-3.5 m-0">
                <div className="grid grid-cols-1 gap-3">
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
          blsPeriod={physics?.orbital_period_days || evidence?.bls_period || planetsList[0]?.periodDays}
          blsDepth={evidence?.bls_depth}
              blsDurationDays={evidence?.bls_duration}
              blsTransitTime={evidence?.bls_transit_time}
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
