import type { JSX } from 'react';
import { Orbit, Sparkles, Sun } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import type { HabitableZoneBoundaries, PlanetParams, StarParams, StarStyle } from './types';
import { getPlanetBiome } from './physics';

export interface SystemHudProps {
  star: StarParams;
  starStyle: StarStyle;
  hz: HabitableZoneBoundaries;
  selectedPlanet?: PlanetParams;
}

export function SystemHud({ star, starStyle, hz, selectedPlanet }: SystemHudProps): JSX.Element {
  const teff = star.teff > 0 ? star.teff : 5778;
  const radius = star.radius > 0 ? star.radius : 1.0;
  const selectedBiome = selectedPlanet ? getPlanetBiome(selectedPlanet.radiusEarth, selectedPlanet.tempK, selectedPlanet.insolationEarth) : null;

  const distAu = selectedPlanet?.semiMajorAxisAu ?? 0;
  const distKmMillion = (distAu * 149.59787).toFixed(1);
  const distStarRadii = (distAu / (radius * 0.00465)).toFixed(1);

  return (
    <div className="absolute top-4 left-4 z-10 flex flex-col gap-3 pointer-events-none max-w-sm">
      {/* Host Star Card */}
      <div className="rounded-xl border border-border/60 bg-background/92 p-3.5 backdrop-blur-xl pointer-events-auto shadow-2xl">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 font-semibold text-sm">
            <Sun className="size-4 text-amber-400 animate-pulse" />
            <span>{star.name}</span>
          </div>
          <Badge
            variant="outline"
            className="text-[11px] font-mono border-amber-500/50 text-amber-300 bg-amber-500/10"
          >
            {starStyle.spectralClass}-Class · {starStyle.type.split(' ')[0]}
          </Badge>
        </div>
        <div className="mt-2.5 grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
          <div>
            Teff: <span className="font-mono text-foreground font-medium">{teff.toLocaleString()} K</span>
          </div>
          <div>
            Radius: <span className="font-mono text-foreground font-medium">{radius.toFixed(2)} R☉</span>
          </div>
          <div>
            Luminosity: <span className="font-mono text-foreground font-medium">{hz.luminosity.toFixed(3)} L☉</span>
          </div>
          <div>
            Goldilocks Zone:{' '}
            <span className="font-mono text-emerald-400 font-medium">
              {hz.consInnerAu.toFixed(3)} - {hz.consOuterAu.toFixed(3)} AU
            </span>
          </div>
        </div>
      </div>

      {/* Selected Exoplanet Card */}
      {selectedPlanet && selectedBiome && (
        <div className="rounded-xl border border-sky-500/40 bg-background/92 p-3.5 backdrop-blur-xl pointer-events-auto shadow-2xl">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 font-semibold text-xs text-sky-400">
              <Orbit className="size-4" />
              <span className="truncate">{selectedPlanet.name}</span>
            </div>
            {selectedPlanet.habitabilityScore != null && (
              <Badge
                className={`text-[10px] ${
                  selectedPlanet.habitabilityScore > 75
                    ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                    : selectedPlanet.habitabilityScore > 40
                    ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                    : 'bg-muted/40 text-muted-foreground border-border'
                }`}
              >
                <Sparkles className="size-2.5 mr-1" />
                Habitability {selectedPlanet.habitabilityScore.toFixed(0)}%
              </Badge>
            )}
          </div>

          <div className="mt-1 flex items-center justify-between gap-2">
            <p className="text-[11px] font-medium text-foreground">{selectedBiome.type}</p>
            {selectedBiome.isHabitable && (
              <span className="text-[10px] font-semibold text-emerald-400">● Liquid Water Stable</span>
            )}
          </div>

          <div className="mt-2.5 grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs text-muted-foreground border-t border-border/40 pt-2">
            <div>
              Distance:{' '}
              <span className="font-mono text-sky-400 font-medium">
                {distAu.toFixed(3)} AU ({distKmMillion}M km)
              </span>
            </div>
            <div>
              Separation:{' '}
              <span className="font-mono text-sky-400 font-medium">
                {distStarRadii} R☉
              </span>
            </div>
            <div>
              Radius: <span className="font-mono text-foreground font-medium">{selectedPlanet.radiusEarth.toFixed(2)} R⊕</span>
            </div>
            <div>
              Period: <span className="font-mono text-foreground font-medium">{selectedPlanet.periodDays.toFixed(2)} d</span>
            </div>
            <div>
              Velocity:{' '}
              <span className="font-mono text-foreground font-medium">
                {selectedPlanet.orbitalVelocityKms ? `${selectedPlanet.orbitalVelocityKms.toFixed(1)} km/s` : `${(29.78 / Math.sqrt(selectedPlanet.semiMajorAxisAu)).toFixed(1)} km/s`}
              </span>
            </div>
            <div>
              T_eq:{' '}
              <span className="font-mono text-foreground font-medium">
                {selectedPlanet.tempK ? `${selectedPlanet.tempK.toFixed(0)} K (${(selectedPlanet.tempK - 273.15).toFixed(0)}°C)` : '—'}
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
