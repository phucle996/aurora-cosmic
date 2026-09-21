import type { JSX } from 'react';
import { CircleAlert, Rotate3D } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { OrbitViewer3D } from './OrbitViewer3D';
import type { PlanetParams, TransitSyncEvent } from './orbit-viewer/types';
import type { CandidateEvidence, Target } from '@/lib/analytics-types';
import { number } from './InfoItem';

interface Target3DSimulatorProps {
  target: Target;
  hasStellarContext: boolean;
  starTeff: number;
  starRadius: number;
  evidence?: CandidateEvidence;
  planetsList: PlanetParams[];
  onTransitSync: (event: TransitSyncEvent) => void;
}

export function Target3DSimulator({
  target,
  hasStellarContext,
  starTeff,
  starRadius,
  evidence,
  planetsList,
  onTransitSync,
}: Target3DSimulatorProps): JSX.Element {
  return (
    <Card id="target-system-3d" className="scroll-mt-20 rounded-none border border-border/80 py-0 shadow-none ring-0">
      <CardHeader className="rounded-none border-b border-border/60 bg-muted/10 py-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-base tracking-tight [font-family:'Outfit',sans-serif]">
              <Rotate3D className="size-5 text-primary" />
              3D Host Star & Habitable Zone Simulator
            </CardTitle>
            <CardDescription className="mt-0.5">
              {hasStellarContext
                ? `Mô phỏng 3D vật lý ngôi sao TIC ${target.tic_id} (${number(starTeff, 0)} K · ${number(starRadius, 2)} R☉) từ snapshot TIC đã xác minh.`
                : 'Chờ TIC catalog enrichment trước khi dựng mô phỏng vật lý sao chủ.'}
            </CardDescription>
          </div>
          <Badge variant="outline" className="rounded-none border-primary/40 font-mono text-[10px] uppercase text-primary">
            Keplerian 3D Projection
          </Badge>
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
            className="rounded-none border-0 shadow-none"
            onTimeUpdate={onTransitSync}
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
  );
}
