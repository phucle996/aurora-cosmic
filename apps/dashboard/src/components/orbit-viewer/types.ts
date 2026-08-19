export interface StarParams {
  name: string;
  teff: number; // Kelvin, e.g. 5778
  radius: number; // Solar radii (R☉), e.g. 1.0
  mass?: number; // Solar masses (M☉), e.g. 1.0
  mag?: number;
}

export interface PlanetParams {
  name: string;
  radiusEarth: number; // in R⊕, e.g. 1.2
  periodDays: number; // in days, e.g. 10.5
  semiMajorAxisAu: number; // in AU, e.g. 0.08
  tempK?: number; // in Kelvin, e.g. 280
  habitabilityTier?: string; // e.g. 'promising', 'high_priority', 'unlikely'
  habitabilityScore?: number; // 0 - 100
  eccentricity?: number; // 0 - 0.5
}

export interface OrbitViewer3DProps {
  star: StarParams;
  planets: PlanetParams[];
  className?: string;
  height?: string;
}

export interface StarStyle {
  base: string;
  glow: string;
  corona: string;
  flare: string;
  type: string;
  spectralClass: string;
}

export interface PlanetBiome {
  type: string;
  baseColor: string;
  accentColor: string;
  atmosphereGlow: string;
  nightGlow: string;
  hasClouds: boolean;
  hasRings: boolean;
  isHabitable: boolean;
}

export interface HabitableZoneBoundaries {
  optInnerAu: number;
  consInnerAu: number;
  consOuterAu: number;
  optOuterAu: number;
  luminosity: number;
}

export interface CameraState {
  pitch: number;
  yaw: number;
  targetPitch: number;
  targetYaw: number;
  distance: number;
  targetDistance: number;
  panX: number;
  panY: number;
  isDragging: boolean;
  startX: number;
  startY: number;
  autoRotate: boolean;
}

export type CameraMode = 'free' | 'track' | 'polar' | 'transit';

export interface BackgroundStar {
  x: number;
  y: number;
  size: number;
  depth: number;
  color: string;
  blinkPhase: number;
}

export interface TrailPoint {
  xAu: number;
  zAu: number;
  time: number;
}
