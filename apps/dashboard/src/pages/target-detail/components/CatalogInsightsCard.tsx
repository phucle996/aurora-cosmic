import type { JSX } from 'react';
import { Compass, Database, Sparkles, Star } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { HabitableZoneBoundaries } from './orbit-viewer/types';
import type { CandidateEvidence, Target } from '@/lib/analytics-types';
import { AiPhysicsTab } from './AiPhysicsTab';
import { ObservationTab } from './ObservationTab';
import { StarPhysicsTab } from './StarPhysicsTab';

interface CatalogInsightsCardProps {
  target: Target;
  hasTicContext: boolean;
  hasStellarContext: boolean;
  toiMatch: string;
  starTeff: number;
  starRadius: number;
  stellarMass: number;
  surfaceGravity: number;
  spectralClassLabel: string;
  evolutionStatus: string;
  evolutionColor: string;
  hzBoundaries: HabitableZoneBoundaries | null;
  stellarDensity: number;
  escapeVelocity: number;
  bolometricMag: number | null;
  fluxStdPpm: number | null;
  fluxAmplitudePct: string | null;
  warnings?: string[];
  blsPeriod?: number | null;
  semiMajorAxis?: number | null;
  planetRadius?: number | null;
  eqTemp?: number | null;
  evidence?: CandidateEvidence;
}

export function CatalogInsightsCard({
  target,
  hasTicContext,
  hasStellarContext,
  toiMatch,
  starTeff,
  starRadius,
  stellarMass,
  surfaceGravity,
  spectralClassLabel,
  evolutionStatus,
  evolutionColor,
  hzBoundaries,
  stellarDensity,
  escapeVelocity,
  bolometricMag,
  fluxStdPpm,
  fluxAmplitudePct,
  warnings,
  blsPeriod,
  semiMajorAxis,
  planetRadius,
  eqTemp,
  evidence,
}: CatalogInsightsCardProps): JSX.Element {
  return (
    <Card className="flex flex-col justify-between rounded-none border border-border/80 py-0 shadow-none ring-0">
      <CardHeader className="rounded-none border-b border-border/60 bg-muted/10 py-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <CardTitle className="flex items-center gap-2 text-base tracking-tight [font-family:'Outfit',sans-serif]">
              <Database className="size-4 text-primary" />
              Astronomical Catalog & AI Pipeline Insights
            </CardTitle>
            <CardDescription className="mt-0.5 text-xs">
              Toàn bộ hồ sơ danh mục TESS, tọa độ thiên văn và giải tích vật lý từ AI Pipeline.
            </CardDescription>
          </div>
          <div className="flex items-center gap-1.5">
            <Badge
              variant={target.has_candidate ? 'default' : 'outline'}
              className="rounded-none font-mono text-[10px] uppercase"
            >
              {target.has_candidate ? 'Exoplanet Candidate' : 'Target Host Star'}
            </Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col justify-between p-4">
        <Tabs defaultValue="observation" className="w-full">
          <TabsList className="mb-4 grid w-full grid-cols-3 rounded-none border border-border/70 bg-muted/20 p-0">
            <TabsTrigger
              value="observation"
              className="rounded-none border-r border-border/70 font-mono text-xs uppercase tracking-[0.06em] data-active:bg-primary data-active:text-primary-foreground"
            >
              <Compass className="mr-1.5 size-3.5" />Quan sát TESS
            </TabsTrigger>
            <TabsTrigger
              value="star_physics"
              className="rounded-none border-r border-border/70 font-mono text-xs uppercase tracking-[0.06em] data-active:bg-primary data-active:text-primary-foreground"
            >
              <Star className="mr-1.5 size-3.5" />Vật lý Sao chủ
            </TabsTrigger>
            <TabsTrigger
              value="ai_physics"
              className="rounded-none font-mono text-xs uppercase tracking-[0.06em] data-active:bg-primary data-active:text-primary-foreground"
            >
              <Sparkles className="mr-1.5 size-3.5" />Giải tích AI
            </TabsTrigger>
          </TabsList>

          <ObservationTab
            target={target}
            hasTicContext={hasTicContext}
            toiMatch={toiMatch}
            evidence={evidence}
          />

          <StarPhysicsTab
            target={target}
            hasTicContext={hasTicContext}
            hasStellarContext={hasStellarContext}
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
            warnings={warnings}
          />

          <AiPhysicsTab
            target={target}
            blsPeriod={blsPeriod}
            semiMajorAxis={semiMajorAxis}
            planetRadius={planetRadius}
            eqTemp={eqTemp}
          />
        </Tabs>
      </CardContent>
    </Card>
  );
}
