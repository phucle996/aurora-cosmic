import { useEffect, useRef, useState } from 'react';
import type { JSX } from 'react';
import { Eye, Flame, Maximize2, Minimize2, Orbit, Pause, Play, RefreshCw, Rotate3D, ShieldAlert, Sparkles, Star, Sun, ThermometerSun } from 'lucide-react';

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
}

export interface OrbitViewer3DProps {
  star: StarParams;
  planets: PlanetParams[];
  className?: string;
  height?: string;
}

function getStarColor(teff: number): { base: string; glow: string; type: string } {
  if (teff < 3700) {
    return { base: '#ff5e36', glow: 'rgba(255, 94, 54, 0.45)', type: 'M-Dwarf (Red)' };
  } else if (teff < 5200) {
    return { base: '#ffa834', glow: 'rgba(255, 168, 52, 0.45)', type: 'K-Type (Orange)' };
  } else if (teff < 6000) {
    return { base: '#ffe066', glow: 'rgba(255, 224, 102, 0.5)', type: 'G-Type (Yellow, Solar-like)' };
  } else if (teff < 7500) {
    return { base: '#f0f8ff', glow: 'rgba(240, 248, 255, 0.55)', type: 'F-Type (Yellow-White)' };
  } else {
    return { base: '#88c8ff', glow: 'rgba(136, 200, 255, 0.6)', type: 'A/B-Type (Blue-White)' };
  }
}

function getPlanetAppearance(radiusEarth: number, tempK: number = 300): { color: string; highlight: string; type: string } {
  if (radiusEarth >= 6.0) {
    return { color: '#c9966b', highlight: '#f3d3b0', type: 'Gas Giant' };
  } else if (radiusEarth >= 2.0) {
    return { color: '#4aa0db', highlight: '#a1d7fb', type: 'Sub-Neptune / Mini-Gas' };
  } else {
    // Terrestrial / Super-Earth
    if (tempK > 450) {
      return { color: '#cf4f2e', highlight: '#ff956b', type: 'Lava / Scorched World' };
    } else if (tempK < 200) {
      return { color: '#a0d2eb', highlight: '#e5f6ff', type: 'Ice Planet' };
    } else if (tempK >= 240 && tempK <= 330) {
      return { color: '#2b82c9', highlight: '#4cd98b', type: 'Temperate / Potentially Habitable' };
    } else {
      return { color: '#8e7970', highlight: '#c7b7ad', type: 'Rocky Terrestrial' };
    }
  }
}

export function OrbitViewer3D({ star, planets, className = '', height = '520px' }: OrbitViewer3DProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Simulation controls
  const [isPlaying, setIsPlaying] = useState(true);
  const [speedMultiplier, setSpeedMultiplier] = useState(5);
  const [showHabitableZone, setShowHabitableZone] = useState(true);
  const [showOrbits, setShowOrbits] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [selectedPlanetIndex, setSelectedPlanetIndex] = useState(0);

  // Camera state
  const cameraRef = useRef({
    pitch: 0.65, // Angle from vertical
    yaw: 0.3,   // Horizontal rotation
    distance: 1.0, // Zoom multiplier
    isDragging: false,
    startX: 0,
    startY: 0,
    autoRotate: true,
  });

  // Animation time tracker
  const timeRef = useRef(0);

  // Stellar luminosity for Habitable Zone calculation
  const teff = star.teff > 0 ? star.teff : 5778;
  const radius = star.radius > 0 ? star.radius : 1.0;
  const luminosity = Math.pow(radius, 2) * Math.pow(teff / 5778, 4);
  const hzInnerAu = Math.max(0.02, Math.sqrt(luminosity / 1.1));
  const hzOuterAu = Math.max(0.04, Math.sqrt(luminosity / 0.53));

  const starStyle = getStarColor(teff);

  // Interactive mouse handlers for 3D Camera Rotation
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const handleMouseDown = (e: MouseEvent) => {
      cameraRef.current.isDragging = true;
      cameraRef.current.startX = e.clientX;
      cameraRef.current.startY = e.clientY;
      cameraRef.current.autoRotate = false;
    };

    const handleMouseMove = (e: MouseEvent) => {
      if (!cameraRef.current.isDragging) return;
      const dx = e.clientX - cameraRef.current.startX;
      const dy = e.clientY - cameraRef.current.startY;
      cameraRef.current.startX = e.clientX;
      cameraRef.current.startY = e.clientY;

      cameraRef.current.yaw += dx * 0.008;
      cameraRef.current.pitch = Math.max(0.05, Math.min(Math.PI / 2 - 0.02, cameraRef.current.pitch + dy * 0.008));
    };

    const handleMouseUp = () => {
      cameraRef.current.isDragging = false;
    };

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      const zoomFactor = e.deltaY > 0 ? 1.08 : 0.92;
      cameraRef.current.distance = Math.max(0.3, Math.min(3.5, cameraRef.current.distance * zoomFactor));
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
  }, []);

  // Main Canvas Render Loop with 3D projection
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animationFrameId: number;

    // Generate random background stars
    const starfield: { x: number; y: number; size: number; alpha: number }[] = [];
    for (let i = 0; i < 180; i++) {
      starfield.push({
        x: Math.random(),
        y: Math.random(),
        size: Math.random() * 1.5 + 0.5,
        alpha: Math.random() * 0.7 + 0.3,
      });
    }

    const render = () => {
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }

      if (isPlaying) {
        timeRef.current += 0.016 * speedMultiplier;
        if (cameraRef.current.autoRotate && !cameraRef.current.isDragging) {
          cameraRef.current.yaw += 0.002;
        }
      }

      const cx = width / 2;
      const cy = height / 2;

      // Base scaling: max orbital radius mapped to canvas bounds
      const maxAu = Math.max(
        0.2,
        hzOuterAu * 1.25,
        ...planets.map((p) => p.semiMajorAxisAu * 1.35)
      );
      const baseScale = (Math.min(width, height) * 0.38) / (maxAu * cameraRef.current.distance);

      // Clear space background
      ctx.fillStyle = '#07090e';
      ctx.fillRect(0, 0, width, height);

      // 1. Draw Starfield
      starfield.forEach((s) => {
        ctx.fillStyle = `rgba(255, 255, 255, ${s.alpha * (0.8 + 0.2 * Math.sin(timeRef.current * 2 + s.x * 20))})`;
        ctx.beginPath();
        ctx.arc(s.x * width, s.y * height, s.size, 0, Math.PI * 2);
        ctx.fill();
      });

      // 3D Projection helper: maps orbital coordinate (x, z in AU) to canvas (X, Y)
      const project3D = (xAu: number, zAu: number, yOffset = 0) => {
        // Yaw rotation around Y axis
        const cosYaw = Math.cos(cameraRef.current.yaw);
        const sinYaw = Math.sin(cameraRef.current.yaw);
        const rx = xAu * cosYaw - zAu * sinYaw;
        const rz = xAu * sinYaw + zAu * cosYaw;

        // Pitch rotation (tilt)
        const cosPitch = Math.cos(cameraRef.current.pitch);
        const sinPitch = Math.sin(cameraRef.current.pitch);
        const screenX = cx + rx * baseScale;
        const screenY = cy + (rz * cosPitch - yOffset * sinPitch) * baseScale;
        const depth = rz * sinPitch + yOffset * cosPitch; // For z-sorting

        return { x: screenX, y: screenY, depth };
      };

      // 2. Draw Habitable Zone Belt (Toroid ring)
      if (showHabitableZone) {
        ctx.save();
        ctx.beginPath();
        const steps = 64;
        for (let i = 0; i <= steps; i++) {
          const angle = (i / steps) * Math.PI * 2;
          const p = project3D(Math.cos(angle) * hzOuterAu, Math.sin(angle) * hzOuterAu);
          if (i === 0) ctx.moveTo(p.x, p.y);
          else ctx.lineTo(p.x, p.y);
        }
        for (let i = steps; i >= 0; i--) {
          const angle = (i / steps) * Math.PI * 2;
          const p = project3D(Math.cos(angle) * hzInnerAu, Math.sin(angle) * hzInnerAu);
          ctx.lineTo(p.x, p.y);
        }
        ctx.closePath();
        const grad = ctx.createRadialGradient(cx, cy, hzInnerAu * baseScale * 0.6, cx, cy, hzOuterAu * baseScale * 1.1);
        grad.addColorStop(0, 'rgba(34, 197, 94, 0.0)');
        grad.addColorStop(0.5, 'rgba(34, 197, 94, 0.12)');
        grad.addColorStop(1, 'rgba(34, 197, 94, 0.0)');
        ctx.fillStyle = grad;
        ctx.fill();

        // Inner & Outer borders
        ctx.strokeStyle = 'rgba(34, 197, 94, 0.3)';
        ctx.setLineDash([4, 4]);
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.restore();
      }

      // 3. Draw Orbit Rings & Trails
      if (showOrbits) {
        planets.forEach((planet, idx) => {
          ctx.save();
          ctx.beginPath();
          const steps = 80;
          for (let i = 0; i <= steps; i++) {
            const angle = (i / steps) * Math.PI * 2;
            const pt = project3D(Math.cos(angle) * planet.semiMajorAxisAu, Math.sin(angle) * planet.semiMajorAxisAu);
            if (i === 0) ctx.moveTo(pt.x, pt.y);
            else ctx.lineTo(pt.x, pt.y);
          }
          const isSelected = idx === selectedPlanetIndex;
          ctx.strokeStyle = isSelected ? 'rgba(56, 189, 248, 0.7)' : 'rgba(255, 255, 255, 0.15)';
          ctx.lineWidth = isSelected ? 1.5 : 1;
          ctx.setLineDash(isSelected ? [] : [2, 3]);
          ctx.stroke();
          ctx.restore();
        });
      }

      // Calculate Planet Positions for Z-Sorting
      const renderList: {
        type: 'star' | 'planet';
        planet?: PlanetParams;
        index?: number;
        x: number;
        y: number;
        depth: number;
        screenRadius: number;
        angle?: number;
      }[] = [];

      // Add Host Star
      const starScreenR = Math.max(12, Math.min(36, 16 * Math.sqrt(radius)));
      renderList.push({
        type: 'star',
        x: cx,
        y: cy,
        depth: 0,
        screenRadius: starScreenR,
      });

      // Add Planets
      planets.forEach((p, idx) => {
        // Mean anomaly / orbital phase: theta = (time / period) * 2pi
        const period = Math.max(0.2, p.periodDays);
        const theta = (timeRef.current / period) * Math.PI * 2;
        const orbX = Math.cos(theta) * p.semiMajorAxisAu;
        const orbZ = Math.sin(theta) * p.semiMajorAxisAu;

        const proj = project3D(orbX, orbZ);
        const planetScreenR = Math.max(4, Math.min(14, 3.5 * Math.pow(p.radiusEarth, 0.5)));

        renderList.push({
          type: 'planet',
          planet: p,
          index: idx,
          x: proj.x,
          y: proj.y,
          depth: proj.depth,
          screenRadius: planetScreenR,
          angle: theta,
        });
      });

      // Sort by depth (back to front)
      renderList.sort((a, b) => a.depth - b.depth);

      // Render Objects in 3D Order
      renderList.forEach((obj) => {
        if (obj.type === 'star') {
          // Central Star with Corona Glow
          const pulse = 1 + 0.04 * Math.sin(timeRef.current * 3);
          const r = obj.screenRadius * pulse;

          // Outer flare/corona
          const corona = ctx.createRadialGradient(obj.x, obj.y, r * 0.2, obj.x, obj.y, r * 3.5);
          corona.addColorStop(0, starStyle.glow);
          corona.addColorStop(0.5, 'rgba(255, 180, 50, 0.1)');
          corona.addColorStop(1, 'rgba(0, 0, 0, 0)');
          ctx.fillStyle = corona;
          ctx.beginPath();
          ctx.arc(obj.x, obj.y, r * 3.5, 0, Math.PI * 2);
          ctx.fill();

          // Star Surface Sphere
          const starGrad = ctx.createRadialGradient(obj.x - r * 0.2, obj.y - r * 0.2, r * 0.1, obj.x, obj.y, r);
          starGrad.addColorStop(0, '#ffffff');
          starGrad.addColorStop(0.4, starStyle.base);
          starGrad.addColorStop(1, '#ff3b00');
          ctx.fillStyle = starGrad;
          ctx.beginPath();
          ctx.arc(obj.x, obj.y, r, 0, Math.PI * 2);
          ctx.fill();

          // Star Name Label
          ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
          ctx.font = '11px sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText(star.name, obj.x, obj.y + r + 14);
        } else if (obj.planet && obj.index != null) {
          const p = obj.planet;
          const isSelected = obj.index === selectedPlanetIndex;
          const pApp = getPlanetAppearance(p.radiusEarth, p.tempK);
          const pr = obj.screenRadius;

          // Planet Orbit Light Vector (Pointing from Star cx,cy to Planet obj.x,obj.y)
          const angleToStar = Math.atan2(cy - obj.y, cx - obj.x);
          const lightOffsetX = Math.cos(angleToStar) * pr * 0.35;
          const lightOffsetY = Math.sin(angleToStar) * pr * 0.35;

          // Selection Ring
          if (isSelected) {
            ctx.strokeStyle = '#38bdf8';
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.arc(obj.x, obj.y, pr + 5, 0, Math.PI * 2);
            ctx.stroke();
          }

          // Planet Shaded Sphere (Day/Night side terminator)
          const planetGrad = ctx.createRadialGradient(
            obj.x + lightOffsetX,
            obj.y + lightOffsetY,
            pr * 0.1,
            obj.x,
            obj.y,
            pr
          );
          planetGrad.addColorStop(0, pApp.highlight);
          planetGrad.addColorStop(0.6, pApp.color);
          planetGrad.addColorStop(1, '#05070a'); // Dark night side

          ctx.fillStyle = planetGrad;
          ctx.beginPath();
          ctx.arc(obj.x, obj.y, pr, 0, Math.PI * 2);
          ctx.fill();

          // Planet Atmosphere Rim / Specular
          ctx.strokeStyle = pApp.highlight;
          ctx.lineWidth = 0.6;
          ctx.stroke();

          // Planet Tag
          ctx.fillStyle = isSelected ? '#38bdf8' : 'rgba(255, 255, 255, 0.85)';
          ctx.font = '10px font-mono, monospace';
          ctx.textAlign = 'center';
          ctx.fillText(p.name, obj.x, obj.y - pr - 6);
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
    selectedPlanetIndex,
    hzInnerAu,
    hzOuterAu,
    radius,
    starStyle,
  ]);

  const selectedPlanet = planets[selectedPlanetIndex] ?? planets[0];

  const resetCamera = () => {
    cameraRef.current.pitch = 0.65;
    cameraRef.current.yaw = 0.3;
    cameraRef.current.distance = 1.0;
    cameraRef.current.autoRotate = true;
  };

  const setTopDownView = () => {
    cameraRef.current.pitch = 0.05;
    cameraRef.current.autoRotate = false;
  };

  const setTransitView = () => {
    cameraRef.current.pitch = Math.PI / 2 - 0.03;
    cameraRef.current.autoRotate = false;
  };

  return (
    <div
      ref={containerRef}
      className={`relative overflow-hidden rounded-xl border border-border/70 bg-[#07090e] shadow-2xl ${
        isFullscreen ? 'fixed inset-0 z-50 rounded-none' : className
      }`}
      style={{ height: isFullscreen ? '100vh' : height }}
    >
      {/* 3D Canvas */}
      <canvas ref={canvasRef} className="size-full cursor-grab active:cursor-grabbing" />

      {/* Top Left: System Overview HUD */}
      <div className="absolute top-3 left-3 z-10 flex flex-col gap-2 pointer-events-none">
        <div className="rounded-lg border border-border/40 bg-background/85 p-3 backdrop-blur-md pointer-events-auto max-w-xs shadow-lg">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 font-semibold text-sm">
              <Sun className="size-4 text-amber-400" />
              <span>{star.name}</span>
            </div>
            <Badge variant="outline" className="text-[10px] font-mono border-amber-500/40 text-amber-400">
              {starStyle.type}
            </Badge>
          </div>
          <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <div>Teff: <span className="font-mono text-foreground">{teff.toLocaleString()} K</span></div>
            <div>Radius: <span className="font-mono text-foreground">{radius.toFixed(2)} R☉</span></div>
            <div>Luminosity: <span className="font-mono text-foreground">{luminosity.toFixed(3)} L☉</span></div>
            <div>Planets: <span className="font-mono text-foreground">{planets.length}</span></div>
          </div>
        </div>

        {/* Selected Planet HUD Card */}
        {selectedPlanet && (
          <div className="rounded-lg border border-sky-500/30 bg-background/85 p-3 backdrop-blur-md pointer-events-auto max-w-xs shadow-lg">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 font-semibold text-xs text-sky-400">
                <Orbit className="size-3.5" />
                <span>{selectedPlanet.name}</span>
              </div>
              {selectedPlanet.habitabilityScore != null && (
                <Badge className="text-[10px] bg-emerald-500/20 text-emerald-300 border-emerald-500/30">
                  <Sparkles className="size-2.5 mr-1" />
                  Score {selectedPlanet.habitabilityScore.toFixed(0)}/100
                </Badge>
              )}
            </div>
            <div className="mt-2 grid grid-cols-2 gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
              <div>Radius: <span className="font-mono text-foreground">{selectedPlanet.radiusEarth.toFixed(2)} R⊕</span></div>
              <div>Period: <span className="font-mono text-foreground">{selectedPlanet.periodDays.toFixed(2)} d</span></div>
              <div>Distance: <span className="font-mono text-foreground">{selectedPlanet.semiMajorAxisAu.toFixed(4)} AU</span></div>
              <div>T_eq: <span className="font-mono text-foreground">{selectedPlanet.tempK ? `${selectedPlanet.tempK.toFixed(0)} K` : '—'}</span></div>
            </div>
          </div>
        )}
      </div>

      {/* Top Right: View Controls & Fullscreen */}
      <div className="absolute top-3 right-3 z-10 flex items-center gap-1.5 bg-background/80 p-1 rounded-lg border border-border/40 backdrop-blur-md shadow-lg">
        <Button
          variant="ghost"
          size="icon-sm"
          className="size-7"
          title="Reset Camera"
          onClick={resetCamera}
        >
          <RefreshCw className="size-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          className="size-7"
          title="Top-down Polar View"
          onClick={setTopDownView}
        >
          <Orbit className="size-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          className="size-7"
          title="Side-on Transit View"
          onClick={setTransitView}
        >
          <Eye className="size-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          className="size-7"
          title={isFullscreen ? 'Exit Fullscreen' : 'Fullscreen'}
          onClick={() => setIsFullscreen(!isFullscreen)}
        >
          {isFullscreen ? <Minimize2 className="size-3.5" /> : <Maximize2 className="size-3.5" />}
        </Button>
      </div>

      {/* Bottom Bar: Simulation Controls */}
      <div className="absolute bottom-3 inset-x-3 z-10 flex flex-wrap items-center justify-between gap-3 bg-background/85 p-2.5 px-4 rounded-xl border border-border/50 backdrop-blur-md shadow-xl text-xs">
        {/* Play/Pause & Speed Slider */}
        <div className="flex items-center gap-3">
          <Button
            variant={isPlaying ? 'secondary' : 'default'}
            size="sm"
            className="h-7 px-2.5"
            onClick={() => setIsPlaying(!isPlaying)}
          >
            {isPlaying ? <Pause className="size-3.5 mr-1" /> : <Play className="size-3.5 mr-1" />}
            {isPlaying ? 'Pause' : 'Play'}
          </Button>

          <div className="flex items-center gap-2 w-32">
            <span className="text-muted-foreground font-mono">{speedMultiplier}x</span>
            <Slider
              value={[speedMultiplier]}
              min={1}
              max={30}
              step={1}
              onValueChange={(val) => setSpeedMultiplier(val[0] ?? 5)}
              className="w-20"
            />
          </div>
        </div>

        {/* Planet Switcher Chips */}
        {planets.length > 1 && (
          <div className="flex items-center gap-1.5 overflow-x-auto">
            {planets.map((p, idx) => (
              <Button
                key={p.name}
                variant={idx === selectedPlanetIndex ? 'default' : 'outline'}
                size="sm"
                className="h-6 px-2 text-[11px] font-mono"
                onClick={() => setSelectedPlanetIndex(idx)}
              >
                {p.name}
              </Button>
            ))}
          </div>
        )}

        {/* Toggles: Habitable Zone & Orbit Lines */}
        <div className="flex items-center gap-2">
          <Button
            variant={showHabitableZone ? 'default' : 'outline'}
            size="sm"
            className={`h-6 px-2 text-[11px] ${
              showHabitableZone ? 'bg-emerald-600 hover:bg-emerald-700 text-white' : ''
            }`}
            onClick={() => setShowHabitableZone(!showHabitableZone)}
          >
            <Sparkles className="size-3 mr-1" />
            Habitable Zone ({hzInnerAu.toFixed(2)} - {hzOuterAu.toFixed(2)} AU)
          </Button>

          <Button
            variant={showOrbits ? 'secondary' : 'outline'}
            size="sm"
            className="h-6 px-2 text-[11px]"
            onClick={() => setShowOrbits(!showOrbits)}
          >
            Orbits
          </Button>
        </div>
      </div>
    </div>
  );
}
