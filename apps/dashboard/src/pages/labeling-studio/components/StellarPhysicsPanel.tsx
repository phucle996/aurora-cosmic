import type { JSX } from 'react';
import { AlertTriangle, CheckCircle2, Flame, Globe2, Sun } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import type { ScientificReviewEvidence } from '../types';

export type PlanetSizeCategory =
  | 'EARTH_SIZE'
  | 'SUPER_EARTH'
  | 'SUB_NEPTUNE'
  | 'JOVIAN'
  | 'SUPER_JUPITER'
  | 'STELLAR_COMPANION'
  | 'UNKNOWN';

export function computePlanetPhysics(evidence: ScientificReviewEvidence): {
  hasStellarParams: boolean;
  stellarRadius: number;
  teff: number;
  tmag: number;
  stellarMass: number;
  planetRadiusEarth: number;
  planetRadiusJupiter: number;
  category: PlanetSizeCategory;
  categoryLabel: string;
  isPhysicallyPlausible: boolean;
  plausibilityNote: string;
} {
  const stellarRadius = evidence.stellar_radius ?? 0;
  const teff = evidence.teff ?? 0;
  const tmag = evidence.tmag ?? 0;
  const stellarMass = evidence.stellar_mass ?? 0;
  const depthPpm = evidence.bls_depth_ppm ?? 0;

  if (stellarRadius <= 0 || depthPpm <= 0) {
    return {
      hasStellarParams: false,
      stellarRadius,
      teff,
      tmag,
      stellarMass,
      planetRadiusEarth: 0,
      planetRadiusJupiter: 0,
      category: 'UNKNOWN',
      categoryLabel: 'Unknown radius',
      isPhysicallyPlausible: true,
      plausibilityNote: 'Thiếu thông số bán kính sao chủ (R*) trong danh mục TIC; không thể suy diễn bán kính vật lý của hành tinh.',
    };
  }

  const depthFraction = depthPpm / 1_000_000;
  // Rp/R_earth = sqrt(depth) * (R_star/R_sun) * (R_sun/R_earth = 109.2)
  const planetRadiusEarth = Math.sqrt(depthFraction) * stellarRadius * 109.2;
  const planetRadiusJupiter = planetRadiusEarth / 11.209;

  let category: PlanetSizeCategory = 'UNKNOWN';
  let categoryLabel = 'Unknown';
  let isPhysicallyPlausible = true;
  let plausibilityNote = '';

  if (planetRadiusJupiter > 2.5) {
    category = 'STELLAR_COMPANION';
    categoryLabel = 'Vượt giới hạn hành tinh (>2.5 R_Jup)';
    isPhysicallyPlausible = false;
    plausibilityNote = `Bán kính suy diễn (${planetRadiusJupiter.toFixed(2)} R_Jup) vượt ngưỡng giới hạn vật lý hành tinh tối đa (2.5 R_Jup). Khả năng cao là sao đôi hoặc sao lùn nâu che nhau.`;
  } else if (planetRadiusJupiter >= 1.3) {
    category = 'SUPER_JUPITER';
    categoryLabel = 'Super-Jupiter / Inflated Gas Giant';
    isPhysicallyPlausible = true;
    plausibilityNote = `Hành tinh khí khổng lồ phồng to (${planetRadiusJupiter.toFixed(2)} R_Jup), trong ngưỡng vật lý cho phép của Hot Jupiter.`;
  } else if (planetRadiusEarth >= 4.0) {
    category = 'JOVIAN';
    categoryLabel = 'Jovian Gas Giant';
    isPhysicallyPlausible = true;
    plausibilityNote = `Hành tinh khí khổng lồ (${planetRadiusJupiter.toFixed(2)} R_Jup · ${planetRadiusEarth.toFixed(1)} R_⊕).`;
  } else if (planetRadiusEarth >= 2.0) {
    category = 'SUB_NEPTUNE';
    categoryLabel = 'Sub-Neptune';
    isPhysicallyPlausible = true;
    plausibilityNote = `Hành tinh đất đá khí quyển dày / Sub-Neptune (${planetRadiusEarth.toFixed(1)} R_⊕).`;
  } else if (planetRadiusEarth >= 1.25) {
    category = 'SUPER_EARTH';
    categoryLabel = 'Super-Earth';
    isPhysicallyPlausible = true;
    plausibilityNote = `Siêu Trái Đất đất đá (${planetRadiusEarth.toFixed(2)} R_⊕).`;
  } else {
    category = 'EARTH_SIZE';
    categoryLabel = 'Earth-sized';
    isPhysicallyPlausible = true;
    plausibilityNote = `Hành tinh kích thước tương đương Trái Đất (${planetRadiusEarth.toFixed(2)} R_⊕).`;
  }

  return {
    hasStellarParams: true,
    stellarRadius,
    teff,
    tmag,
    stellarMass,
    planetRadiusEarth,
    planetRadiusJupiter,
    category,
    categoryLabel,
    isPhysicallyPlausible,
    plausibilityNote,
  };
}

export function StellarPhysicsPanel({ evidence }: { evidence: ScientificReviewEvidence }): JSX.Element {
  const physics = computePlanetPhysics(evidence);

  return (
    <div className="border border-border/70 bg-background/50">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 bg-muted/20 px-3 py-2">
        <div className="flex items-center gap-2">
          <Sun className="size-4 text-amber-500" />
          <span className="text-xs font-semibold uppercase tracking-wide">
            Host Star Parameters & Physical Planet Radius
          </span>
        </div>
        {physics.hasStellarParams && (
          <Badge
            variant={physics.isPhysicallyPlausible ? 'default' : 'destructive'}
            className="rounded-none font-mono text-[10px]"
          >
            {physics.isPhysicallyPlausible ? (
              <span className="flex items-center gap-1">
                <CheckCircle2 className="size-3" /> Plausible Exoplanet Size
              </span>
            ) : (
              <span className="flex items-center gap-1">
                <AlertTriangle className="size-3" /> Limit Exceeded (&gt;2.5 R_Jup)
              </span>
            )}
          </Badge>
        )}
      </div>

      <div className="grid gap-px border-b border-border/60 bg-border/60 sm:grid-cols-2 lg:grid-cols-5 text-xs">
        <div className="bg-background p-2.5">
          <span className="block font-mono text-[10px] uppercase text-muted-foreground">Stellar Radius R*</span>
          <span className="mt-0.5 block font-mono text-sm font-semibold">
            {physics.stellarRadius > 0 ? `${physics.stellarRadius.toFixed(3)} R☉` : '—'}
          </span>
          <span className="text-[10px] text-muted-foreground">Solar radii</span>
        </div>
        <div className="bg-background p-2.5">
          <span className="block font-mono text-[10px] uppercase text-muted-foreground">Effective Temp Teff</span>
          <span className="mt-0.5 block font-mono text-sm font-semibold">
            {physics.teff > 0 ? `${Math.round(physics.teff).toLocaleString()} K` : '—'}
          </span>
          <span className="text-[10px] text-muted-foreground">Photosphere temp</span>
        </div>
        <div className="bg-background p-2.5">
          <span className="block font-mono text-[10px] uppercase text-muted-foreground">TESS Mag TMag</span>
          <span className="mt-0.5 block font-mono text-sm font-semibold">
            {physics.tmag > 0 ? physics.tmag.toFixed(2) : '—'}
          </span>
          <span className="text-[10px] text-muted-foreground">Apparent magnitude</span>
        </div>
        <div className="bg-background p-2.5">
          <span className="block font-mono text-[10px] uppercase text-muted-foreground">Inferred Radius (Earth)</span>
          <span className={`mt-0.5 block font-mono text-sm font-semibold ${physics.isPhysicallyPlausible ? 'text-primary' : 'text-rose-500'}`}>
            {physics.planetRadiusEarth > 0 ? `${physics.planetRadiusEarth.toFixed(2)} R⊕` : '—'}
          </span>
          <span className="text-[10px] text-muted-foreground">Earth radii</span>
        </div>
        <div className="bg-background p-2.5">
          <span className="block font-mono text-[10px] uppercase text-muted-foreground">Inferred Radius (Jupiter)</span>
          <span className={`mt-0.5 block font-mono text-sm font-semibold ${physics.isPhysicallyPlausible ? 'text-primary' : 'text-rose-500'}`}>
            {physics.planetRadiusJupiter > 0 ? `${physics.planetRadiusJupiter.toFixed(2)} RJ` : '—'}
          </span>
          <span className="text-[10px] text-muted-foreground">Jupiter radii (limit 2.5)</span>
        </div>
      </div>

      <div className="p-3 text-xs leading-relaxed">
        <div className="flex items-start gap-2">
          {physics.isPhysicallyPlausible ? (
            <Globe2 className="mt-0.5 size-4 shrink-0 text-emerald-500" />
          ) : (
            <Flame className="mt-0.5 size-4 shrink-0 text-rose-500" />
          )}
          <div>
            <span className="font-semibold">{physics.categoryLabel}: </span>
            <span className="text-muted-foreground">{physics.plausibilityNote}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
