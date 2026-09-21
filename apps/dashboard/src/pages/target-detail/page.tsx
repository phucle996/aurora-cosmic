import { useEffect, useMemo, useState } from 'react';
import type { JSX } from 'react';
import { CircleAlert, LoaderCircle } from 'lucide-react';
import { useParams, useSearchParams } from 'react-router-dom';

import { Card, CardContent } from '@/components/ui/card';
import { derivePlanetarySystemFromInsights } from './components/OrbitViewer3D';
import { SynchronizedLightCurve } from './components/SynchronizedLightCurve';
import type { TransitSyncEvent } from './components/orbit-viewer/types';
import { apiFetch } from '@/lib/api';
import type { TargetInsightResponse, TargetObservationResponse } from '@/lib/analytics-types';

import { CatalogInsightsCard } from './components/CatalogInsightsCard';
import { Target3DSimulator } from './components/Target3DSimulator';
import { TargetHeader } from './components/TargetHeader';

// Route page for one TESS target and its synchronized observations.
export default function TargetDetailPage(): JSX.Element {
  const { ticId = '' } = useParams();
  const [search] = useSearchParams();
  const sector = search.get('sector') ?? '';
  const snapshotID = search.get('snapshot_id') ?? '';
  const [data, setData] = useState<TargetInsightResponse>();
  const [observation, setObservation] = useState<TargetObservationResponse>();
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
    void apiFetch<TargetInsightResponse>(`/v1/targets/${encodeURIComponent(ticId)}/insights${suffix}`)
      .then(async (response) => {
        if (!active) return;
        setData(response);
        const next = response.target;
        if (!next.has_lightcurve) return;
        try {
          const obs = await apiFetch<TargetObservationResponse>(
            `/v1/targets/${next.tic_id}/observation?sector=${next.sector}&limit=5000`,
          );
          if (active) setObservation(obs);
        } catch {
          if (active) setObservation(undefined);
        }
      })
      .catch((reason: unknown) =>
        active && setError(reason instanceof Error ? reason.message : 'Unable to load target insight'),
      );
    return () => {
      active = false;
    };
  }, [sector, snapshotID, ticId]);

  const target = data?.target;
  const insights = data?.insights;
  const stellar = insights?.stellar_physics;
  const ai = insights?.ai_insights;

  const hasTicContext = target?.tic_context_available === true;
  const hasStellarContext = hasTicContext && Boolean(stellar && stellar.teff > 0 && stellar.radius > 0);
  const starTeff = stellar?.teff ?? 0;
  const starRadius = stellar?.radius ?? 0;
  const stellarMass = stellar?.mass ?? 0;

  const planetsList = useMemo(() => {
    return derivePlanetarySystemFromInsights(target, insights);
  }, [target, insights]);

  if (error) return <StateMessage title="Không tải được target insight" detail={error} />;
  if (!target || !insights) {
    return (
      <div className="flex items-center justify-center gap-2 py-24 text-sm text-muted-foreground">
        <LoaderCircle className="animate-spin" />
        Loading target insights…
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <TargetHeader target={target} />

      <Target3DSimulator
        target={target}
        hasStellarContext={hasStellarContext}
        starTeff={starTeff}
        starRadius={starRadius}
        stellarMass={stellarMass}
        planetsList={planetsList}
        onTransitSync={setTransitSync}
      />

      {/* 1. Full-Width Astronomical Catalog & AI Insights */}
      <CatalogInsightsCard
        target={target}
        insights={insights}
      />

      {/* 2. Full-Width Synchronized TPF Inspector & Light Curve Suite */}
      <SynchronizedLightCurve
        time={observation?.lightcurve?.time ?? []}
        flux={observation?.lightcurve?.flux ?? []}
        blsPeriod={ai?.bls_period_days || planetsList[0]?.periodDays}
        blsDepth={ai?.bls_depth_fraction ?? undefined}
        blsDurationDays={ai?.bls_duration_days ?? undefined}
        blsTransitTime={ai?.bls_transit_time ?? undefined}
        transitInfo={transitSync}
        planetName={planetsList[0]?.name || `TIC ${target.tic_id}`}
        centroidOffset={observation?.tpf?.centroid_offset_pixels ?? 0.08}
        tpf={observation?.tpf}
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
