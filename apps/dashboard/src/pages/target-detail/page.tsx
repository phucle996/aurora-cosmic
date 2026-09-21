import { useEffect, useMemo, useState } from 'react';
import type { JSX } from 'react';
import { CircleAlert, LoaderCircle } from 'lucide-react';
import { useParams, useSearchParams } from 'react-router-dom';

import { Card, CardContent } from '@/components/ui/card';
import { calculateHabitableZone, derivePlanetarySystemForTarget } from './components/OrbitViewer3D';
import { SynchronizedLightCurve } from './components/SynchronizedLightCurve';
import type { TransitSyncEvent } from './components/orbit-viewer/types';
import { apiFetch } from '@/lib/api';
import type { LightcurveResponse, TargetDetailResponse } from '@/lib/analytics-types';

import { CatalogInsightsCard } from './components/CatalogInsightsCard';
import { Target3DSimulator } from './components/Target3DSimulator';
import { TargetHeader } from './components/TargetHeader';
import { TargetMetricsGrid } from './components/TargetMetricsGrid';

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
            `/v1/lightcurves?tic_id=${next.tic_id}&sector=${next.sector}&limit=1000`,
          );
          if (active) setCurve(lightcurve);
        } catch {
          if (active) setCurve(undefined);
        }
      })
      .catch((reason: unknown) =>
        active && setError(reason instanceof Error ? reason.message : 'Unable to load target'),
      );
    return () => {
      active = false;
    };
  }, [sector, snapshotID, ticId]);

  const target = detail?.target;
  const physics = detail?.planet_physics;
  const habitability = detail?.habitability;
  const evidence = detail?.evidence;

  const hasTicContext = target?.tic_context_available === true;
  const hasStellarContext = hasTicContext && Boolean(
    (target?.effective_t && target.effective_t > 0) || (evidence?.teff && evidence.teff > 0),
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

  const surfaceGravity = target?.surface_grav && target.surface_grav > 0
    ? target.surface_grav
    : evidence?.logg && evidence.logg > 0
      ? evidence.logg
      : 0;

  const spectralType = starTeff >= 7500 ? 'A' : starTeff >= 6000 ? 'F' : starTeff >= 5200 ? 'G' : starTeff >= 3700 ? 'K' : 'M';
  const isGiant = starRadius >= 8.0;
  const isSubgiant = starRadius >= 2.0 && starRadius < 8.0;
  const luminosityClass = isGiant ? 'Giant' : isSubgiant ? 'Subgiant' : spectralType === 'M' ? 'Red Dwarf' : spectralType === 'K' ? 'Orange Dwarf' : spectralType === 'G' ? 'Solar-type' : spectralType === 'F' ? 'Yellow-White' : 'White';
  const spectralClassLabel = `${spectralType}-type (${luminosityClass})`;
  const evolutionStatus = (isGiant || isSubgiant) ? 'Evolved / Post-Main Sequence' : 'Stable Main-Sequence';
  const evolutionColor = (isGiant || isSubgiant) ? 'text-amber-500 font-medium' : 'text-emerald-500 font-medium';

  const hzBoundaries = useMemo(() => {
    if (starRadius <= 0 || starTeff <= 0) return null;
    return calculateHabitableZone(starRadius, starTeff);
  }, [starRadius, starTeff]);

  const stellarMass = evidence?.stellar_mass && evidence.stellar_mass > 0 ? evidence.stellar_mass : 0;

  // Mật độ sao trung bình: rho = (M / R^3) * 1.408 g/cm^3
  const stellarDensity = (stellarMass > 0 && starRadius > 0)
    ? (stellarMass / Math.pow(starRadius, 3)) * 1.408
    : 0;

  // Vận tốc thoát ly: v_esc = 617.5 * sqrt(M / R) km/s
  const escapeVelocity = (stellarMass > 0 && starRadius > 0)
    ? 617.5 * Math.sqrt(stellarMass / starRadius)
    : 0;

  // Cấp sao tuyệt đối Bolometric: M_bol = 4.74 - 2.5 * log10(L)
  const bolometricMag = (hzBoundaries && hzBoundaries.luminosity > 0)
    ? 4.74 - 2.5 * Math.log10(hzBoundaries.luminosity)
    : null;

  // Biến quang quang thông sao chủ
  const fluxStdPpm = evidence?.flux_std && evidence.flux_std > 0 ? Math.round(evidence.flux_std * 1e6) : null;
  const fluxAmplitudePct = evidence?.flux_amplitude && evidence.flux_amplitude > 0 ? (evidence.flux_amplitude * 100).toFixed(3) : null;

  const planetsList = useMemo(() => {
    return derivePlanetarySystemForTarget(target, physics, evidence, habitability);
  }, [physics, habitability, target, evidence]);

  const blsPeriod = evidence?.bls_period ?? physics?.orbital_period_days ?? planetsList[0]?.periodDays;
  const semiMajorAxis = physics?.semi_major_axis_au ?? planetsList[0]?.semiMajorAxisAu;
  const planetRadius = physics?.planet_radius_earth ?? planetsList[0]?.radiusEarth;
  const eqTemp = physics?.equilibrium_temperature_k ?? planetsList[0]?.tempK;

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
    ? (target.matched_toi.toUpperCase().startsWith('TOI') ? `Yes (${target.matched_toi})` : `Yes (TOI ${target.matched_toi})`)
    : 'No';

  return (
    <div className="space-y-6">
      <TargetHeader target={target} />

      <TargetMetricsGrid
        target={target}
        hasTicContext={hasTicContext}
        surfaceGravity={surfaceGravity}
      />

      <Target3DSimulator
        target={target}
        hasStellarContext={hasStellarContext}
        starTeff={starTeff}
        starRadius={starRadius}
        evidence={evidence}
        planetsList={planetsList}
        onTransitSync={setTransitSync}
      />

      {/* 1. Full-Width Astronomical Catalog & AI Insights */}
      <CatalogInsightsCard
        target={target}
        hasTicContext={hasTicContext}
        hasStellarContext={hasStellarContext}
        toiMatch={toiMatch}
        starTeff={starTeff}
        starRadius={starRadius}
        stellarMass={stellarMass}
        surfaceGravity={surfaceGravity}
        spectralClassLabel={spectralClassLabel}
        evolutionStatus={evolutionStatus}
        evolutionColor={evolutionColor}
        hzBoundaries={hzBoundaries}
        stellarDensity={stellarDensity}
        escapeVelocity={escapeVelocity}
        bolometricMag={bolometricMag}
        fluxStdPpm={fluxStdPpm}
        fluxAmplitudePct={fluxAmplitudePct}
        warnings={physics?.warnings}
        blsPeriod={blsPeriod}
        semiMajorAxis={semiMajorAxis}
        planetRadius={planetRadius}
        eqTemp={eqTemp}
        evidence={evidence}
      />

      {/* 2. Full-Width Synchronized TPF Inspector & Light Curve Suite */}
      <SynchronizedLightCurve
        time={curve?.time ?? []}
        flux={curve?.flux ?? []}
        blsPeriod={physics?.orbital_period_days || evidence?.bls_period || planetsList[0]?.periodDays}
        blsDepth={evidence?.bls_depth}
        blsDurationDays={evidence?.bls_duration}
        blsTransitTime={evidence?.bls_transit_time}
        transitInfo={transitSync}
        planetName={planetsList[0]?.name || `TIC ${target.tic_id}`}
        centroidOffset={evidence?.transit_deficit_center_offset}
        className="rounded-none border border-border/80 shadow-none ring-0 [&_[data-slot=badge]]:rounded-none [&_[data-slot=button]]:rounded-none [&_[data-slot=card-header]]:rounded-none"
      />
    </div>
  );
}

function StateMessage({ title, detail }: { title: string; detail: string }): JSX.Element {
  return (
    <Card className="rounded-none border border-destructive/40 py-0 shadow-none ring-0">
      <CardContent className="flex gap-3 p-6">
        <CircleAlert className="text-destructive" />
        <div>
          <p className="font-medium [font-family:'Outfit',sans-serif]">{title}</p>
          <p className="mt-1 text-sm text-muted-foreground">{detail}</p>
        </div>
      </CardContent>
    </Card>
  );
}
