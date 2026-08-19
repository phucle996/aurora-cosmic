import { useEffect, useMemo, useState } from 'react';
import type { JSX } from 'react';
import {
  Activity,
  ArrowLeft,
  CircleAlert,
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
import { OrbitViewer3D } from '@/components/OrbitViewer3D';
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

  // Real Planetary System derived parameters
  const planetsList = useMemo(() => {
    if (!target) return [];
    if (physics && (physics.orbital_period_days || physics.planet_radius_earth || physics.semi_major_axis_au)) {
      return [
        {
          name: physics.planet_candidate_id || `Candidate b`,
          radiusEarth: physics.planet_radius_earth ?? 1.2,
          periodDays: physics.orbital_period_days ?? 10.0,
          semiMajorAxisAu: physics.semi_major_axis_au ?? 0.08,
          tempK: physics.equilibrium_temperature_k ?? 280,
          habitabilityTier: habitability?.tier,
          habitabilityScore: habitability?.physics_score ?? undefined,
        },
      ];
    }
    if (target.has_candidate) {
      const estPeriod = evidence?.bls_period && evidence.bls_period > 0 ? evidence.bls_period : 8.5;
      const estDepth = evidence?.bls_depth && evidence.bls_depth > 0 ? evidence.bls_depth : 0.0012;
      const estRadiusEarth = Math.sqrt(estDepth) * starRadius * 109.2;
      const estAu = Math.pow(Math.pow(estPeriod / 365.25, 2) * (evidence?.stellar_mass || 1.0), 1 / 3);
      return [
        {
          name: `Candidate (Score ${(target.candidate_score * 100).toFixed(0)}%)`,
          radiusEarth: Math.max(0.5, Math.min(25.0, estRadiusEarth)),
          periodDays: estPeriod,
          semiMajorAxisAu: Math.max(0.02, estAu),
          tempK: Math.round(starTeff * Math.pow(starRadius / (2 * Math.max(0.02, estAu) * 215), 0.5)),
          habitabilityScore: target.candidate_score > 0.7 ? 80 : 45,
        },
      ];
    }
    return [];
  }, [physics, habitability, target, evidence, starTeff, starRadius]);

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
              mag: target.tess_mag || 10.5,
            }}
            planets={planetsList}
            height="580px"
            onTimeUpdate={setTransitSync}
          />
        </CardContent>
      </Card>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,0.72fr)_minmax(0,1.28fr)]">
        <Card>
          <CardHeader>
            <CardTitle>Catalog & pipeline</CardTitle>
            <CardDescription>Identity and current processing coverage.</CardDescription>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-5 text-sm">
              <Info label="TESS magnitude" value={number(target.tess_mag)} />
              <Info label="TOI" value={target.matched_toi || 'unmatched'} />
              <Info label="Disposition" value={target.disposition || '—'} />
              <Info label="Sector" value={`${target.sector}`} />
              <Info
                label="Light curve"
                value={
                  target.has_lightcurve
                    ? `${target.lightcurve_points.toLocaleString()} points`
                    : 'not indexed'
                }
              />
              <Info
                label="Time span"
                value={target.has_lightcurve ? `${number(target.lightcurve_time_span, 1)} days` : '—'}
              />
            </dl>
            <div className="mt-6 grid grid-cols-2 gap-3">
              <Signal
                label="Transit candidate"
                value={target.has_candidate ? `${(target.candidate_score * 100).toFixed(1)}%` : 'not scored'}
                active={target.candidate_above_threshold}
              />
              <Signal
                label="Anomaly"
                value={target.has_anomaly ? number(target.anomaly_score, 4) : 'not scored'}
                active={target.has_anomaly}
              />
            </div>
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

function Signal({ label, value, active }: { label: string; value: string; active: boolean }): JSX.Element {
  return (
    <div className="rounded-lg border border-border bg-muted/20 p-3">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Activity className={active ? 'size-3.5 text-primary' : 'size-3.5'} />
        {label}
      </div>
      <p className="mt-1 font-mono font-medium">{value}</p>
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
