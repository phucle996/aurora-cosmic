import type { BackgroundStar, HabitableZoneBoundaries, PlanetBiome, StarStyle } from './types';

export function getStarColor(teff: number): StarStyle {
  if (teff < 3700) {
    return {
      base: '#ff4d2e',
      glow: 'rgba(255, 77, 46, 0.65)',
      corona: 'rgba(255, 120, 40, 0.25)',
      flare: '#ff8a50',
      type: 'M-Dwarf (Red Dwarf)',
      spectralClass: 'M',
    };
  } else if (teff < 5200) {
    return {
      base: '#ffa529',
      glow: 'rgba(255, 165, 41, 0.65)',
      corona: 'rgba(255, 200, 70, 0.28)',
      flare: '#ffc870',
      type: 'K-Type (Orange Star)',
      spectralClass: 'K',
    };
  } else if (teff < 6000) {
    return {
      base: '#ffea6c',
      glow: 'rgba(255, 234, 108, 0.7)',
      corona: 'rgba(255, 245, 160, 0.3)',
      flare: '#fff5b0',
      type: 'G-Type (Yellow Dwarf, Solar-like)',
      spectralClass: 'G',
    };
  } else if (teff < 7500) {
    return {
      base: '#f4f8ff',
      glow: 'rgba(244, 248, 255, 0.75)',
      corona: 'rgba(210, 235, 255, 0.35)',
      flare: '#ffffff',
      type: 'F-Type (Yellow-White Star)',
      spectralClass: 'F',
    };
  } else {
    return {
      base: '#90cbff',
      glow: 'rgba(144, 203, 255, 0.8)',
      corona: 'rgba(100, 180, 255, 0.4)',
      flare: '#cbe7ff',
      type: 'A/B-Type (Blue-White Giant)',
      spectralClass: 'A',
    };
  }
}

export function getPlanetBiome(radiusEarth: number, tempK: number = 300): PlanetBiome {
  if (radiusEarth >= 6.0) {
    return {
      type: 'Gas Giant (Jovian)',
      baseColor: '#cfa276',
      accentColor: '#8a5c34',
      atmosphereGlow: 'rgba(235, 185, 140, 0.45)',
      nightGlow: 'rgba(0,0,0,0)',
      hasClouds: true,
      hasRings: true,
      isHabitable: false,
    };
  } else if (radiusEarth >= 2.0) {
    return {
      type: 'Sub-Neptune (Ice/Gas)',
      baseColor: '#38a8e0',
      accentColor: '#176b9e',
      atmosphereGlow: 'rgba(100, 210, 255, 0.55)',
      nightGlow: 'rgba(0,0,0,0)',
      hasClouds: true,
      hasRings: false,
      isHabitable: false,
    };
  } else {
    if (tempK > 480) {
      return {
        type: 'Lava World (Ultra-Hot)',
        baseColor: '#302624',
        accentColor: '#ff4800',
        atmosphereGlow: 'rgba(255, 80, 0, 0.5)',
        nightGlow: 'rgba(255, 90, 0, 0.65)',
        hasClouds: false,
        hasRings: false,
        isHabitable: false,
      };
    } else if (tempK < 200) {
      return {
        type: 'Ice World (Cryogenic)',
        baseColor: '#aee3f8',
        accentColor: '#58a7c9',
        atmosphereGlow: 'rgba(180, 235, 255, 0.45)',
        nightGlow: 'rgba(120, 200, 255, 0.2)',
        hasClouds: true,
        hasRings: false,
        isHabitable: false,
      };
    } else if (tempK >= 240 && tempK <= 330) {
      return {
        type: 'Ocean & Terrestrial (Habitable Zone)',
        baseColor: '#1e68b3',
        accentColor: '#289e52',
        atmosphereGlow: 'rgba(80, 195, 255, 0.65)',
        nightGlow: 'rgba(255, 215, 120, 0.4)',
        hasClouds: true,
        hasRings: false,
        isHabitable: true,
      };
    } else {
      return {
        type: 'Barren Rocky Terrestrial',
        baseColor: '#967d6d',
        accentColor: '#574235',
        atmosphereGlow: 'rgba(190, 160, 140, 0.3)',
        nightGlow: 'rgba(0,0,0,0)',
        hasClouds: false,
        hasRings: false,
        isHabitable: false,
      };
    }
  }
}

export function calculateHabitableZone(radius: number, teff: number): HabitableZoneBoundaries {
  const safeTeff = teff > 0 ? teff : 5778;
  const safeRadius = radius > 0 ? radius : 1.0;
  const luminosity = Math.pow(safeRadius, 2) * Math.pow(safeTeff / 5778, 4);

  return {
    luminosity,
    optInnerAu: Math.max(0.015, Math.sqrt(luminosity / 1.3)),
    consInnerAu: Math.max(0.02, Math.sqrt(luminosity / 1.1)),
    consOuterAu: Math.max(0.04, Math.sqrt(luminosity / 0.53)),
    optOuterAu: Math.max(0.05, Math.sqrt(luminosity / 0.35)),
  };
}

export function generateStarfield(count = 280): BackgroundStar[] {
  const colors = ['#ffffff', '#a8d5ff', '#ffe0b2', '#ffcdd2', '#c5cae9'];
  const stars: BackgroundStar[] = [];
  for (let i = 0; i < count; i++) {
    stars.push({
      x: Math.random(),
      y: Math.random(),
      size: Math.random() * 1.8 + 0.4,
      depth: Math.random() * 0.8 + 0.2,
      color: colors[Math.floor(Math.random() * colors.length)] ?? '#ffffff',
      blinkPhase: Math.random() * Math.PI * 2,
    });
  }
  return stars;
}
