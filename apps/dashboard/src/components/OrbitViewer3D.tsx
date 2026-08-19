import { useEffect, useRef, useState } from 'react';
import type { JSX } from 'react';
import {
  Compass,
  Crosshair,
  Eye,
  Flame,
  Layers,
  Maximize2,
  Minimize2,
  Orbit,
  Pause,
  Play,
  Radio,
  RefreshCw,
  Rotate3D,
  Sparkles,
  Star,
  Sun,
  Telescope,
  ThermometerSun,
  Video,
  Zap,
} from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';

export interface StarParams {
  name: string;
  teff: number; // in Kelvin, e.g. 5778
  radius: number; // in Solar radii (R☉), e.g. 1.0
  mass?: number; // in Solar masses (M☉), e.g. 1.0
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

function getStarColor(teff: number): {
  base: string;
  glow: string;
  corona: string;
  flare: string;
  type: string;
  spectralClass: string;
} {
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

interface PlanetBiome {
  type: string;
  baseColor: string;
  accentColor: string;
  atmosphereGlow: string;
  nightGlow: string;
  hasClouds: boolean;
  hasRings: boolean;
  isHabitable: boolean;
}

function getPlanetBiome(radiusEarth: number, tempK: number = 300): PlanetBiome {
  if (radiusEarth >= 6.0) {
    // Jovian Gas Giant
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
    // Mini-Neptune / Sub-Neptune
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
    // Terrestrial / Super-Earth
    if (tempK > 480) {
      // Lava World
      return {
        type: 'Lava World (Ultra-Hot)',
        baseColor: '#302624',
        accentColor: '#ff4800',
        atmosphereGlow: 'rgba(255, 80, 0, 0.5)',
        nightGlow: 'rgba(255, 90, 0, 0.65)', // Magma veins on night side
        hasClouds: false,
        hasRings: false,
        isHabitable: false,
      };
    } else if (tempK < 200) {
      // Ice World
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
      // Potentially Habitable / Ocean World
      return {
        type: 'Ocean & Terrestrial (Habitable Zone)',
        baseColor: '#1e68b3',
        accentColor: '#289e52',
        atmosphereGlow: 'rgba(80, 195, 255, 0.65)',
        nightGlow: 'rgba(255, 215, 120, 0.4)', // City/Bioluminescent lights
        hasClouds: true,
        hasRings: false,
        isHabitable: true,
      };
    } else {
      // Barren Rocky (Mars/Mercury analogue)
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

export function OrbitViewer3D({
  star,
  planets,
  className = '',
  height = '640px',
}: OrbitViewer3DProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Simulation controls
  const [isPlaying, setIsPlaying] = useState(true);
  const [speedMultiplier, setSpeedMultiplier] = useState(8);
  const [showHabitableZone, setShowHabitableZone] = useState(true);
  const [showOrbits, setShowOrbits] = useState(true);
  const [showGrid, setShowGrid] = useState(true);
  const [showTrails, setShowTrails] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [selectedPlanetIndex, setSelectedPlanetIndex] = useState(0);
  const [cameraMode, setCameraMode] = useState<'free' | 'track' | 'polar' | 'transit'>('free');

  // Camera state with smooth damping
  const cameraRef = useRef({
    pitch: 0.7, // Radians from vertical
    yaw: 0.4,   // Radians horizontal rotation
    targetPitch: 0.7,
    targetYaw: 0.4,
    distance: 1.0,
    targetDistance: 1.0,
    panX: 0,
    panY: 0,
    isDragging: false,
    startX: 0,
    startY: 0,
    autoRotate: true,
  });

  // Animation time tracker
  const timeRef = useRef(0);
  const trailsRef = useRef<Record<number, { xAu: number; zAu: number; time: number }[]>>({});

  // Stellar & Habitable Zone Physics Calculation
  const teff = star.teff > 0 ? star.teff : 5778;
  const radius = star.radius > 0 ? star.radius : 1.0;
  const luminosity = Math.pow(radius, 2) * Math.pow(teff / 5778, 4);

  // Habitable Zone (Kopparapu et al. 2014)
  const hzOptInnerAu = Math.max(0.015, Math.sqrt(luminosity / 1.3));
  const hzConsInnerAu = Math.max(0.02, Math.sqrt(luminosity / 1.1));
  const hzConsOuterAu = Math.max(0.04, Math.sqrt(luminosity / 0.53));
  const hzOptOuterAu = Math.max(0.05, Math.sqrt(luminosity / 0.35));

  const starStyle = getStarColor(teff);

  // Mouse Interaction handlers for smooth 3D orbit
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const handleMouseDown = (e: MouseEvent) => {
      cameraRef.current.isDragging = true;
      cameraRef.current.startX = e.clientX;
      cameraRef.current.startY = e.clientY;
      cameraRef.current.autoRotate = false;
      if (cameraMode !== 'free') setCameraMode('free');
    };

    const handleMouseMove = (e: MouseEvent) => {
      if (!cameraRef.current.isDragging) return;
      const dx = e.clientX - cameraRef.current.startX;
      const dy = e.clientY - cameraRef.current.startY;
      cameraRef.current.startX = e.clientX;
      cameraRef.current.startY = e.clientY;

      cameraRef.current.targetYaw += dx * 0.007;
      cameraRef.current.targetPitch = Math.max(
        0.02,
        Math.min(Math.PI / 2 - 0.01, cameraRef.current.targetPitch + dy * 0.007)
      );
    };

    const handleMouseUp = () => {
      cameraRef.current.isDragging = false;
    };

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      const zoomFactor = e.deltaY > 0 ? 1.12 : 0.88;
      cameraRef.current.targetDistance = Math.max(
        0.2,
        Math.min(4.5, cameraRef.current.targetDistance * zoomFactor)
      );
    };

    canvas.addEventListener('mousedown', handleMouseDown);
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    canvas.addEventListener('wheel', handleWheel, { passive: false });

    return () => {
      canvas.removeEventListener('mousedown', handleMouseDown);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      canvas.removeEventListener('wheel', handleWheel);
    };
  }, [cameraMode]);

  // Main High-Fidelity 3D WebGL / Canvas Render Loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animationFrameId: number;

    // Generate multi-depth Procedural Starfield & Nebulae
    const numStars = 280;
    const starfield: {
      x: number;
      y: number;
      size: number;
      depth: number;
      color: string;
      blinkPhase: number;
    }[] = [];
    const colors = ['#ffffff', '#a8d5ff', '#ffe0b2', '#ffcdd2', '#c5cae9'];

    for (let i = 0; i < numStars; i++) {
      starfield.push({
        x: Math.random(),
        y: Math.random(),
        size: Math.random() * 1.8 + 0.4,
        depth: Math.random() * 0.8 + 0.2,
        color: colors[Math.floor(Math.random() * colors.length)] ?? '#ffffff',
        blinkPhase: Math.random() * Math.PI * 2,
      });
    }

    const render = () => {
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }

      // Time progression
      if (isPlaying) {
        timeRef.current += 0.016 * speedMultiplier;
        if (cameraRef.current.autoRotate && !cameraRef.current.isDragging && cameraMode === 'free') {
          cameraRef.current.targetYaw += 0.0015;
        }
      }

      // Smooth camera interpolation (Damping)
      cameraRef.current.yaw += (cameraRef.current.targetYaw - cameraRef.current.yaw) * 0.1;
      cameraRef.current.pitch += (cameraRef.current.targetPitch - cameraRef.current.pitch) * 0.1;
      cameraRef.current.distance +=
        (cameraRef.current.targetDistance - cameraRef.current.distance) * 0.12;

      const cx = width / 2 + cameraRef.current.panX;
      const cy = height / 2 + cameraRef.current.panY;

      // Base scaling based on max orbital extent
      const maxAu = Math.max(
        0.18,
        hzOptOuterAu * 1.3,
        ...planets.map((p) => p.semiMajorAxisAu * 1.3)
      );
      const baseScale = (Math.min(width, height) * 0.42) / (maxAu * cameraRef.current.distance);

      // 1. CLEAR WITH CINEMATIC DEEP-SPACE GRADIENT & NEBULA
      const bgGrad = ctx.createRadialGradient(cx, cy, 20, cx, cy, Math.max(width, height) * 0.8);
      bgGrad.addColorStop(0, '#0c101c');
      bgGrad.addColorStop(0.4, '#070913');
      bgGrad.addColorStop(1, '#030408');
      ctx.fillStyle = bgGrad;
      ctx.fillRect(0, 0, width, height);

      // Subtle Cosmic Nebula Dust Clouds
      ctx.save();
      const nebula1 = ctx.createRadialGradient(
        width * 0.25,
        height * 0.3,
        20,
        width * 0.25,
        height * 0.3,
        width * 0.6
      );
      nebula1.addColorStop(0, 'rgba(56, 189, 248, 0.045)');
      nebula1.addColorStop(0.5, 'rgba(99, 102, 241, 0.025)');
      nebula1.addColorStop(1, 'transparent');
      ctx.fillStyle = nebula1;
      ctx.fillRect(0, 0, width, height);

      const nebula2 = ctx.createRadialGradient(
        width * 0.75,
        height * 0.7,
        30,
        width * 0.75,
        height * 0.7,
        width * 0.5
      );
      nebula2.addColorStop(0, 'rgba(236, 72, 153, 0.035)');
      nebula2.addColorStop(0.6, 'rgba(168, 85, 247, 0.02)');
      nebula2.addColorStop(1, 'transparent');
      ctx.fillStyle = nebula2;
      ctx.fillRect(0, 0, width, height);
      ctx.restore();

      // 2. DRAW STARFIELD WITH PARALLAX & TWINKLE
      starfield.forEach((s) => {
        const twinkle =
          0.65 + 0.35 * Math.sin(timeRef.current * 2 + s.blinkPhase);
        const parallaxX = (cameraRef.current.yaw * 30 * s.depth) % width;
        const drawX = (s.x * width + parallaxX + width) % width;
        const drawY = s.y * height;

        ctx.fillStyle = s.color;
        ctx.globalAlpha = twinkle;
        ctx.beginPath();
        ctx.arc(drawX, drawY, s.size, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1.0;
      });

      // 3D Projection Matrix (Transforms 3D Astronomical coords -> 2D Screen coords)
      const project3D = (xAu: number, zAu: number, yOffsetAu = 0) => {
        const cosYaw = Math.cos(cameraRef.current.yaw);
        const sinYaw = Math.sin(cameraRef.current.yaw);
        const rx = xAu * cosYaw - zAu * sinYaw;
        const rz = xAu * sinYaw + zAu * cosYaw;

        const cosPitch = Math.cos(cameraRef.current.pitch);
        const sinPitch = Math.sin(cameraRef.current.pitch);
        const screenX = cx + rx * baseScale;
        const screenY = cy + (rz * cosPitch - yOffsetAu * sinPitch) * baseScale;
        const depth = rz * sinPitch + yOffsetAu * cosPitch;

        return { x: screenX, y: screenY, depth, rx, rz };
      };

      // 3. DRAW CELESTIAL DISTANCE GRID
      if (showGrid) {
        ctx.save();
        const gridRings = [0.05, 0.1, 0.2, 0.5, 1.0, 1.5, 2.0].filter(
          (r) => r <= maxAu * 1.4
        );
        gridRings.forEach((rAu) => {
          ctx.beginPath();
          const steps = 60;
          for (let i = 0; i <= steps; i++) {
            const angle = (i / steps) * Math.PI * 2;
            const pt = project3D(Math.cos(angle) * rAu, Math.sin(angle) * rAu);
            if (i === 0) ctx.moveTo(pt.x, pt.y);
            else ctx.lineTo(pt.x, pt.y);
          }
          ctx.strokeStyle = 'rgba(255, 255, 255, 0.06)';
          ctx.lineWidth = 0.8;
          ctx.setLineDash([2, 5]);
          ctx.stroke();

          // Distance Tag
          const labelPt = project3D(rAu, 0);
          ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
          ctx.font = '9px font-mono, monospace';
          ctx.textAlign = 'center';
          ctx.fillText(`${rAu} AU`, labelPt.x, labelPt.y - 4);
        });

        // Cardinal axes (X and Z)
        const axisLength = maxAu * 1.2;
        const posX = project3D(axisLength, 0);
        const negX = project3D(-axisLength, 0);
        ctx.beginPath();
        ctx.moveTo(negX.x, negX.y);
        ctx.lineTo(posX.x, posX.y);
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
        ctx.lineWidth = 1;
        ctx.setLineDash([]);
        ctx.stroke();

        ctx.restore();
      }

      // 4. DRAW HOLOGRAPHIC HABITABLE ZONE (GOLDILOCKS ZONE)
      if (showHabitableZone) {
        ctx.save();

        // Outer Optimistic Zone
        ctx.beginPath();
        const steps = 72;
        for (let i = 0; i <= steps; i++) {
          const angle = (i / steps) * Math.PI * 2;
          const p = project3D(
            Math.cos(angle) * hzOptOuterAu,
            Math.sin(angle) * hzOptOuterAu
          );
          if (i === 0) ctx.moveTo(p.x, p.y);
          else ctx.lineTo(p.x, p.y);
        }
        for (let i = steps; i >= 0; i--) {
          const angle = (i / steps) * Math.PI * 2;
          const p = project3D(
            Math.cos(angle) * hzOptInnerAu,
            Math.sin(angle) * hzOptInnerAu
          );
          ctx.lineTo(p.x, p.y);
        }
        ctx.closePath();

        const hzGrad = ctx.createRadialGradient(
          cx,
          cy,
          hzConsInnerAu * baseScale * 0.7,
          cx,
          cy,
          hzOptOuterAu * baseScale * 1.1
        );
        hzGrad.addColorStop(0, 'rgba(16, 185, 129, 0.0)');
        hzGrad.addColorStop(0.3, 'rgba(16, 185, 129, 0.12)');
        hzGrad.addColorStop(0.7, 'rgba(16, 185, 129, 0.16)');
        hzGrad.addColorStop(1, 'rgba(16, 185, 129, 0.0)');
        ctx.fillStyle = hzGrad;
        ctx.fill();

        // Pulsing Scanline Effect inside Habitable Zone
        const scanOffset = (timeRef.current * 0.1) % 1;
        const scanR =
          hzConsInnerAu + (hzConsOuterAu - hzConsInnerAu) * scanOffset;
        ctx.beginPath();
        for (let i = 0; i <= steps; i++) {
          const angle = (i / steps) * Math.PI * 2;
          const p = project3D(Math.cos(angle) * scanR, Math.sin(angle) * scanR);
          if (i === 0) ctx.moveTo(p.x, p.y);
          else ctx.lineTo(p.x, p.y);
        }
        ctx.strokeStyle = 'rgba(52, 211, 153, 0.45)';
        ctx.lineWidth = 1.2;
        ctx.setLineDash([3, 4]);
        ctx.stroke();

        // Habitable Zone Label
        const hzLabelPt = project3D(
          (hzConsInnerAu + hzConsOuterAu) * 0.5,
          0
        );
        ctx.fillStyle = '#34d399';
        ctx.font = '10px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('HABITABLE ZONE', hzLabelPt.x, hzLabelPt.y + 14);

        ctx.restore();
      }

      // 5. UPDATE AND DRAW PLANET TRAILS
      if (showTrails) {
        planets.forEach((p, idx) => {
          const period = Math.max(0.1, p.periodDays);
          const theta = (timeRef.current / period) * Math.PI * 2;
          const currentXAu = Math.cos(theta) * p.semiMajorAxisAu;
          const currentZAu = Math.sin(theta) * p.semiMajorAxisAu;

          if (!trailsRef.current[idx]) trailsRef.current[idx] = [];
          const trail = trailsRef.current[idx];

          trail.push({ xAu: currentXAu, zAu: currentZAu, time: timeRef.current });
          if (trail.length > 45) trail.shift();

          // Render Glowing Particle Trail
          if (trail.length > 2) {
            ctx.save();
            for (let i = 1; i < trail.length; i++) {
              const p1 = project3D(trail[i - 1].xAu, trail[i - 1].zAu);
              const p2 = project3D(trail[i].xAu, trail[i].zAu);
              const alpha = (i / trail.length) * 0.7;

              ctx.beginPath();
              ctx.moveTo(p1.x, p1.y);
              ctx.lineTo(p2.x, p2.y);
              ctx.strokeStyle =
                idx === selectedPlanetIndex
                  ? `rgba(56, 189, 248, ${alpha})`
                  : `rgba(255, 255, 255, ${alpha * 0.5})`;
              ctx.lineWidth = idx === selectedPlanetIndex ? 2.5 : 1.5;
              ctx.stroke();
            }
            ctx.restore();
          }
        });
      }

      // 6. DRAW ORBIT ELLIPSES
      if (showOrbits) {
        planets.forEach((planet, idx) => {
          ctx.save();
          ctx.beginPath();
          const steps = 96;
          for (let i = 0; i <= steps; i++) {
            const angle = (i / steps) * Math.PI * 2;
            const pt = project3D(
              Math.cos(angle) * planet.semiMajorAxisAu,
              Math.sin(angle) * planet.semiMajorAxisAu
            );
            if (i === 0) ctx.moveTo(pt.x, pt.y);
            else ctx.lineTo(pt.x, pt.y);
          }
          const isSelected = idx === selectedPlanetIndex;
          ctx.strokeStyle = isSelected
            ? 'rgba(56, 189, 248, 0.85)'
            : 'rgba(255, 255, 255, 0.18)';
          ctx.lineWidth = isSelected ? 2 : 1;
          ctx.setLineDash(isSelected ? [] : [3, 4]);
          ctx.stroke();
          ctx.restore();
        });
      }

      // 7. GATHER ALL 3D OBJECTS FOR DEPTH SORTING
      const renderObjects: {
        type: 'star' | 'planet';
        planet?: PlanetParams;
        index?: number;
        x: number;
        y: number;
        depth: number;
        screenRadius: number;
        theta?: number;
      }[] = [];

      // Add Central Host Star
      const starScreenRadius = Math.max(
        16,
        Math.min(48, 22 * Math.sqrt(radius))
      );
      renderObjects.push({
        type: 'star',
        x: cx,
        y: cy,
        depth: 0,
        screenRadius: starScreenRadius,
      });

      // Add Planets
      planets.forEach((p, idx) => {
        const period = Math.max(0.1, p.periodDays);
        const theta = (timeRef.current / period) * Math.PI * 2;
        const orbX = Math.cos(theta) * p.semiMajorAxisAu;
        const orbZ = Math.sin(theta) * p.semiMajorAxisAu;

        const proj = project3D(orbX, orbZ);
        // Visual radius with logarithmic scaling so small planets remain crisp and visible
        const planetScreenRadius = Math.max(
          5,
          Math.min(18, 4.2 * Math.pow(p.radiusEarth, 0.55))
        );

        renderObjects.push({
          type: 'planet',
          planet: p,
          index: idx,
          x: proj.x,
          y: proj.y,
          depth: proj.depth,
          screenRadius: planetScreenRadius,
          theta,
        });
      });

      // Sort back-to-front (Z-sorting)
      renderObjects.sort((a, b) => a.depth - b.depth);

      // 8. RENDER SORTED 3D OBJECTS WITH VOLUMETRIC SHADING
      renderObjects.forEach((obj) => {
        if (obj.type === 'star') {
          // ================= HOST STAR RENDERING =================
          const pulse = 1 + 0.05 * Math.sin(timeRef.current * 4);
          const r = obj.screenRadius * pulse;

          // Multi-layer Volumetric Corona Glow
          const coronaGrad = ctx.createRadialGradient(
            obj.x,
            obj.y,
            r * 0.3,
            obj.x,
            obj.y,
            r * 4.5
          );
          coronaGrad.addColorStop(0, starStyle.glow);
          coronaGrad.addColorStop(0.3, starStyle.corona);
          coronaGrad.addColorStop(0.7, 'rgba(255, 160, 40, 0.05)');
          coronaGrad.addColorStop(1, 'transparent');

          ctx.fillStyle = coronaGrad;
          ctx.beginPath();
          ctx.arc(obj.x, obj.y, r * 4.5, 0, Math.PI * 2);
          ctx.fill();

          // Animated Dynamic Solar Flares / Prominences
          ctx.save();
          const flareCount = 10;
          for (let f = 0; f < flareCount; f++) {
            const fAngle =
              (f / flareCount) * Math.PI * 2 + timeRef.current * 0.4;
            const fLen =
              r * (1.2 + 0.28 * Math.sin(timeRef.current * 3 + f * 1.8));
            const fx = obj.x + Math.cos(fAngle) * fLen;
            const fy = obj.y + Math.sin(fAngle) * fLen;

            ctx.beginPath();
            ctx.moveTo(
              obj.x + Math.cos(fAngle - 0.15) * r * 0.9,
              obj.y + Math.sin(fAngle - 0.15) * r * 0.9
            );
            ctx.quadraticCurveTo(fx, fy, obj.x + Math.cos(fAngle + 0.15) * r * 0.9, obj.y + Math.sin(fAngle + 0.15) * r * 0.9);
            ctx.fillStyle = starStyle.flare;
            ctx.globalAlpha = 0.45;
            ctx.fill();
          }
          ctx.restore();

          // Star Photosphere (3D Spherical Radial Gradient)
          const sphereGrad = ctx.createRadialGradient(
            obj.x - r * 0.3,
            obj.y - r * 0.3,
            r * 0.1,
            obj.x,
            obj.y,
            r
          );
          sphereGrad.addColorStop(0, '#ffffff'); // White-hot core
          sphereGrad.addColorStop(0.3, starStyle.base);
          sphereGrad.addColorStop(0.85, starStyle.base);
          sphereGrad.addColorStop(1, '#ff2200'); // Limb darkening

          ctx.fillStyle = sphereGrad;
          ctx.beginPath();
          ctx.arc(obj.x, obj.y, r, 0, Math.PI * 2);
          ctx.fill();

          // Horizontal Anamorphic Lens Flare Streak
          ctx.save();
          const streakGrad = ctx.createLinearGradient(
            obj.x - r * 6,
            obj.y,
            obj.x + r * 6,
            obj.y
          );
          streakGrad.addColorStop(0, 'transparent');
          streakGrad.addColorStop(0.5, starStyle.glow);
          streakGrad.addColorStop(1, 'transparent');
          ctx.fillStyle = streakGrad;
          ctx.fillRect(obj.x - r * 6, obj.y - 1.5, r * 12, 3);
          ctx.restore();

          // Star Tag
          ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
          ctx.font = 'bold 12px sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText(star.name, obj.x, obj.y + r + 18);

          ctx.fillStyle = starStyle.base;
          ctx.font = '10px font-mono, monospace';
          ctx.fillText(`${teff} K · ${radius.toFixed(2)} R☉`, obj.x, obj.y + r + 30);
        } else if (obj.planet && obj.index != null) {
          // ================= PLANET 3D RENDERING =================
          const p = obj.planet;
          const isSelected = obj.index === selectedPlanetIndex;
          const biome = getPlanetBiome(p.radiusEarth, p.tempK);
          const pr = obj.screenRadius;

          // Light Vector from Star (cx, cy) to Planet (obj.x, obj.y)
          const angleToStar = Math.atan2(cy - obj.y, cx - obj.x);
          const lightDirX = Math.cos(angleToStar);
          const lightDirY = Math.sin(angleToStar);

          // 1. Selection Hologram Ring
          if (isSelected) {
            ctx.save();
            ctx.strokeStyle = '#38bdf8';
            ctx.lineWidth = 1.8;
            ctx.setLineDash([4, 3]);
            ctx.beginPath();
            ctx.arc(obj.x, obj.y, pr + 7, 0, Math.PI * 2);
            ctx.stroke();

            // Hologram target crosshairs
            ctx.setLineDash([]);
            ctx.lineWidth = 1;
            const ch = pr + 11;
            ctx.beginPath();
            ctx.moveTo(obj.x - ch, obj.y);
            ctx.lineTo(obj.x - ch + 4, obj.y);
            ctx.moveTo(obj.x + ch, obj.y);
            ctx.lineTo(obj.x + ch - 4, obj.y);
            ctx.moveTo(obj.x, obj.y - ch);
            ctx.lineTo(obj.x, obj.y - ch + 4);
            ctx.moveTo(obj.x, obj.y + ch);
            ctx.lineTo(obj.x, obj.y + ch - 4);
            ctx.stroke();
            ctx.restore();
          }

          // 2. Planet Atmosphere Outer Scattering Halo
          const atmoGrad = ctx.createRadialGradient(
            obj.x,
            obj.y,
            pr * 0.8,
            obj.x,
            obj.y,
            pr * 1.45
          );
          atmoGrad.addColorStop(0, biome.atmosphereGlow);
          atmoGrad.addColorStop(1, 'transparent');
          ctx.fillStyle = atmoGrad;
          ctx.beginPath();
          ctx.arc(obj.x, obj.y, pr * 1.45, 0, Math.PI * 2);
          ctx.fill();

          // 3. Planet Day/Night Shaded Sphere
          const planetGrad = ctx.createRadialGradient(
            obj.x + lightDirX * pr * 0.45,
            obj.y + lightDirY * pr * 0.45,
            pr * 0.05,
            obj.x,
            obj.y,
            pr
          );
          planetGrad.addColorStop(0, biome.accentColor); // Sunlit highlight
          planetGrad.addColorStop(0.55, biome.baseColor);
          planetGrad.addColorStop(0.95, '#07090e'); // Deep night terminator
          planetGrad.addColorStop(1, '#020305');

          ctx.fillStyle = planetGrad;
          ctx.beginPath();
          ctx.arc(obj.x, obj.y, pr, 0, Math.PI * 2);
          ctx.fill();

          // 4. Procedural Clouds & Surface Veins
          if (biome.hasClouds) {
            ctx.save();
            ctx.beginPath();
            ctx.arc(obj.x, obj.y, pr, 0, Math.PI * 2);
            ctx.clip();

            // Cloud swirl bands
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
            ctx.lineWidth = pr * 0.35;
            ctx.beginPath();
            ctx.arc(
              obj.x + lightDirX * pr * 0.2,
              obj.y + lightDirY * pr * 0.2,
              pr * 0.6,
              0,
              Math.PI
            );
            ctx.stroke();
            ctx.restore();
          }

          // 5. Planet Rings (for Gas Giants)
          if (biome.hasRings) {
            ctx.save();
            ctx.beginPath();
            ctx.ellipse(
              obj.x,
              obj.y,
              pr * 2.2,
              pr * 0.65,
              cameraRef.current.yaw * 0.5,
              0,
              Math.PI * 2
            );
            ctx.strokeStyle = 'rgba(220, 190, 160, 0.5)';
            ctx.lineWidth = pr * 0.4;
            ctx.stroke();
            ctx.restore();
          }

          // 6. Planet Specular Rim / Sunlit Crescent Highlight
          ctx.save();
          ctx.strokeStyle = 'rgba(255, 255, 255, 0.7)';
          ctx.lineWidth = 1.0;
          ctx.beginPath();
          ctx.arc(
            obj.x,
            obj.y,
            pr,
            angleToStar - Math.PI / 3,
            angleToStar + Math.PI / 3
          );
          ctx.stroke();
          ctx.restore();

          // 7. Planet Tag & Details
          ctx.fillStyle = isSelected ? '#38bdf8' : 'rgba(255, 255, 255, 0.9)';
          ctx.font = 'bold 11px font-mono, monospace';
          ctx.textAlign = 'center';
          ctx.fillText(p.name, obj.x, obj.y - pr - 10);

          if (isSelected) {
            ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
            ctx.font = '9px sans-serif';
            ctx.fillText(
              `${p.radiusEarth.toFixed(2)} R⊕ · ${p.periodDays.toFixed(1)} d`,
              obj.x,
              obj.y - pr - 1
            );
          }
        }
      });

      // 9. TRANSIT EVENT ALIGNMENT RAY & INDICATOR
      // Check if any planet is in transit (between observer and star)
      const transitThreshold = 0.05; // radians
      planets.forEach((p, idx) => {
        const period = Math.max(0.1, p.periodDays);
        const theta = ((timeRef.current / period) * Math.PI * 2) % (Math.PI * 2);
        // Transit happens when planet passes in front (depth > 0 and close to star X)
        const isTransit =
          Math.abs(theta - Math.PI / 2) < transitThreshold ||
          Math.abs(theta - (3 * Math.PI) / 2) < transitThreshold;

        if (isTransit) {
          ctx.save();
          ctx.strokeStyle = 'rgba(239, 68, 68, 0.75)';
          ctx.lineWidth = 1.5;
          ctx.setLineDash([4, 4]);
          ctx.beginPath();
          ctx.moveTo(cx, cy);
          const pProj = project3D(
            Math.cos(theta) * p.semiMajorAxisAu,
            Math.sin(theta) * p.semiMajorAxisAu
          );
          ctx.lineTo(pProj.x, pProj.y);
          ctx.stroke();

          // Transit HUD Badge
          ctx.fillStyle = '#ef4444';
          ctx.font = 'bold 10px font-mono, monospace';
          ctx.fillText(`● TRANSIT ECLIPSE: ${p.name}`, cx, cy - starScreenRadius - 20);
          ctx.restore();
        }
      });

      animationFrameId = requestAnimationFrame(render);
    };

    animationFrameId = requestAnimationFrame(render);
    return () => cancelAnimationFrame(animationFrameId);
  }, [
    star,
    planets,
    isPlaying,
    speedMultiplier,
    showHabitableZone,
    showOrbits,
    showGrid,
    showTrails,
    selectedPlanetIndex,
    cameraMode,
    hzOptInnerAu,
    hzConsInnerAu,
    hzConsOuterAu,
    hzOptOuterAu,
    radius,
    starStyle,
  ]);

  const selectedPlanet = planets[selectedPlanetIndex] ?? planets[0];
  const selectedBiome = selectedPlanet
    ? getPlanetBiome(selectedPlanet.radiusEarth, selectedPlanet.tempK)
    : null;

  const resetCamera = () => {
    cameraRef.current.targetPitch = 0.7;
    cameraRef.current.targetYaw = 0.4;
    cameraRef.current.targetDistance = 1.0;
    cameraRef.current.panX = 0;
    cameraRef.current.panY = 0;
    cameraRef.current.autoRotate = true;
    setCameraMode('free');
  };

  const setTopDownView = () => {
    cameraRef.current.targetPitch = 0.02;
    cameraRef.current.autoRotate = false;
    setCameraMode('polar');
  };

  const setTransitView = () => {
    cameraRef.current.targetPitch = Math.PI / 2 - 0.02;
    cameraRef.current.autoRotate = false;
    setCameraMode('transit');
  };

  return (
    <div
      ref={containerRef}
      className={`relative overflow-hidden rounded-2xl border border-border/80 bg-[#030408] shadow-2xl transition-all duration-300 ${
        isFullscreen ? 'fixed inset-0 z-50 rounded-none' : className
      }`}
      style={{ height: isFullscreen ? '100vh' : height }}
    >
      {/* High-Performance Canvas */}
      <canvas ref={canvasRef} className="size-full cursor-grab active:cursor-grabbing" />

      {/* TOP LEFT: STELLAR SYSTEM & HABITABILITY HUD */}
      <div className="absolute top-4 left-4 z-10 flex flex-col gap-3 pointer-events-none max-w-sm">
        {/* Star HUD Card */}
        <div className="rounded-xl border border-border/50 bg-background/90 p-3.5 backdrop-blur-xl pointer-events-auto shadow-2xl">
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
              Luminosity: <span className="font-mono text-foreground font-medium">{luminosity.toFixed(3)} L☉</span>
            </div>
            <div>
              HZ Zone: <span className="font-mono text-emerald-400 font-medium">{hzConsInnerAu.toFixed(2)} - {hzConsOuterAu.toFixed(2)} AU</span>
            </div>
          </div>
        </div>

        {/* Selected Planet HUD Card */}
        {selectedPlanet && selectedBiome && (
          <div className="rounded-xl border border-sky-500/40 bg-background/90 p-3.5 backdrop-blur-xl pointer-events-auto shadow-2xl">
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
                      : 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                  }`}
                >
                  <Sparkles className="size-2.5 mr-1" />
                  Life Score {selectedPlanet.habitabilityScore.toFixed(0)}/100
                </Badge>
              )}
            </div>

            <p className="mt-1 text-[11px] font-medium text-muted-foreground">{selectedBiome.type}</p>

            <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-muted-foreground">
              <div>
                Radius: <span className="font-mono text-foreground font-medium">{selectedPlanet.radiusEarth.toFixed(2)} R⊕</span>
              </div>
              <div>
                Period: <span className="font-mono text-foreground font-medium">{selectedPlanet.periodDays.toFixed(2)} d</span>
              </div>
              <div>
                Semi-Major: <span className="font-mono text-foreground font-medium">{selectedPlanet.semiMajorAxisAu.toFixed(4)} AU</span>
              </div>
              <div>
                T_eq: <span className="font-mono text-foreground font-medium">{selectedPlanet.tempK ? `${selectedPlanet.tempK.toFixed(0)} K` : '—'}</span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* TOP RIGHT: CINEMATIC CAMERA MODES & FULLSCREEN */}
      <div className="absolute top-4 right-4 z-10 flex items-center gap-2 bg-background/85 p-1.5 rounded-xl border border-border/50 backdrop-blur-xl shadow-2xl">
        <Button
          variant={cameraMode === 'free' ? 'secondary' : 'ghost'}
          size="sm"
          className="h-8 text-xs gap-1.5"
          title="Free 3D Orbit Camera"
          onClick={resetCamera}
        >
          <Rotate3D className="size-3.5 text-primary" />
          3D Orbit
        </Button>
        <Button
          variant={cameraMode === 'polar' ? 'secondary' : 'ghost'}
          size="sm"
          className="h-8 text-xs gap-1.5"
          title="Top-down Polar View"
          onClick={setTopDownView}
        >
          <Compass className="size-3.5 text-sky-400" />
          Polar
        </Button>
        <Button
          variant={cameraMode === 'transit' ? 'secondary' : 'ghost'}
          size="sm"
          className="h-8 text-xs gap-1.5"
          title="Side-on Transit Eclipse View"
          onClick={setTransitView}
        >
          <Crosshair className="size-3.5 text-rose-400" />
          Transit Eclipse
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          className="size-8"
          title={isFullscreen ? 'Exit Fullscreen' : 'Fullscreen / Theater Mode'}
          onClick={() => setIsFullscreen(!isFullscreen)}
        >
          {isFullscreen ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
        </Button>
      </div>

      {/* BOTTOM BAR: ORBITAL SIMULATION CONTROLS */}
      <div className="absolute bottom-4 inset-x-4 z-10 flex flex-wrap items-center justify-between gap-3 bg-background/90 p-3 px-5 rounded-2xl border border-border/60 backdrop-blur-xl shadow-2xl text-xs">
        {/* Play/Pause & Speed Multiplier */}
        <div className="flex items-center gap-4">
          <Button
            variant={isPlaying ? 'secondary' : 'default'}
            size="sm"
            className="h-8 px-3 text-xs"
            onClick={() => setIsPlaying(!isPlaying)}
          >
            {isPlaying ? <Pause className="size-3.5 mr-1.5" /> : <Play className="size-3.5 mr-1.5" />}
            {isPlaying ? 'Pause' : 'Resume'}
          </Button>

          <div className="flex items-center gap-2.5">
            <span className="text-muted-foreground font-mono text-xs w-12 text-right">
              {speedMultiplier}x speed
            </span>
            <Slider
              value={[speedMultiplier]}
              min={1}
              max={60}
              step={1}
              onValueChange={(val) => setSpeedMultiplier(val[0] ?? 8)}
              className="w-24"
            />
          </div>
        </div>

        {/* Planet Switcher Chips */}
        <div className="flex items-center gap-1.5 overflow-x-auto">
          {planets.map((p, idx) => (
            <Button
              key={p.name}
              variant={idx === selectedPlanetIndex ? 'default' : 'outline'}
              size="sm"
              className="h-7 px-2.5 text-xs font-mono"
              onClick={() => setSelectedPlanetIndex(idx)}
            >
              🪐 {p.name}
            </Button>
          ))}
        </div>

        {/* Layer Toggles: Habitable Zone, Orbits, Grid, Trails */}
        <div className="flex items-center gap-2">
          <Button
            variant={showHabitableZone ? 'default' : 'outline'}
            size="sm"
            className={`h-7 px-2.5 text-xs ${
              showHabitableZone ? 'bg-emerald-600 hover:bg-emerald-700 text-white' : ''
            }`}
            onClick={() => setShowHabitableZone(!showHabitableZone)}
          >
            <Sparkles className="size-3.5 mr-1" />
            Goldilocks Zone
          </Button>

          <Button
            variant={showTrails ? 'secondary' : 'outline'}
            size="sm"
            className="h-7 px-2.5 text-xs"
            onClick={() => setShowTrails(!showTrails)}
          >
            <Zap className="size-3.5 mr-1" />
            Trails
          </Button>

          <Button
            variant={showGrid ? 'secondary' : 'outline'}
            size="sm"
            className="h-7 px-2.5 text-xs"
            onClick={() => setShowGrid(!showGrid)}
          >
            <Layers className="size-3.5 mr-1" />
            AU Grid
          </Button>
        </div>
      </div>
    </div>
  );
}
