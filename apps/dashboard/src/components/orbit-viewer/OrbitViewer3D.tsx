import { useEffect, useRef, useState } from 'react';
import type { JSX } from 'react';

import type { CameraMode, CameraState, OrbitViewer3DProps, TrailPoint } from './types';
import { calculateHabitableZone, generateStarfield, getStarColor } from './physics';
import {
  createProjector,
  drawDeepSpace,
  drawDistanceGrid,
  drawHabitableZone,
  drawHostStar,
  drawOrbits,
  drawPlanet,
  drawStarfield,
  drawTrails,
  drawTransitEclipse,
} from './renderer';
import { SystemHud } from './SystemHud';
import { CameraControls } from './CameraControls';
import { SimulationControls } from './SimulationControls';

export function OrbitViewer3D({
  star,
  planets,
  className = '',
  height = '640px',
  onTimeUpdate,
}: OrbitViewer3DProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Simulation state
  const [isPlaying, setIsPlaying] = useState(true);
  const [speedMultiplier, setSpeedMultiplier] = useState(8);
  const [showHabitableZone, setShowHabitableZone] = useState(true);
  const [showOrbits, setShowOrbits] = useState(true);
  const [showGrid, setShowGrid] = useState(true);
  const [showTrails, setShowTrails] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [selectedPlanetIndex, setSelectedPlanetIndex] = useState(0);
  const [cameraMode, setCameraMode] = useState<CameraMode>('free');

  // Smooth camera state with ultra deep zoom range (0.015 to 4.5)
  const cameraRef = useRef<CameraState>({
    pitch: 0.7,
    yaw: 0.4,
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

  const timeRef = useRef(0);
  const trailsRef = useRef<Record<number, TrailPoint[]>>({});

  // Physics & Styling
  const teff = star.teff > 0 ? star.teff : 5778;
  const radius = star.radius > 0 ? star.radius : 1.0;
  const hz = calculateHabitableZone(radius, teff);
  const starStyle = getStarColor(teff);

  // Mouse Interaction handlers (Left Drag: Rotate, Shift/Right Drag: Pan, Wheel: Ultra Zoom)
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let isRightDrag = false;

    const handleContextMenu = (e: MouseEvent) => {
      e.preventDefault();
    };

    const handleMouseDown = (e: MouseEvent) => {
      cameraRef.current.isDragging = true;
      cameraRef.current.startX = e.clientX;
      cameraRef.current.startY = e.clientY;
      cameraRef.current.autoRotate = false;
      isRightDrag = e.button === 2 || e.shiftKey;
      if (cameraMode === 'polar' || cameraMode === 'transit') setCameraMode('free');
    };

    const handleMouseMove = (e: MouseEvent) => {
      if (!cameraRef.current.isDragging) return;
      const dx = e.clientX - cameraRef.current.startX;
      const dy = e.clientY - cameraRef.current.startY;
      cameraRef.current.startX = e.clientX;
      cameraRef.current.startY = e.clientY;

      if (isRightDrag || e.shiftKey) {
        // Pan camera
        cameraRef.current.panX += dx;
        cameraRef.current.panY += dy;
      } else {
        // Rotate camera
        cameraRef.current.targetYaw += dx * 0.007;
        cameraRef.current.targetPitch = Math.max(
          0.02,
          Math.min(Math.PI / 2 - 0.01, cameraRef.current.targetPitch + dy * 0.007)
        );
      }
    };

    const handleMouseUp = () => {
      cameraRef.current.isDragging = false;
      isRightDrag = false;
    };

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      // Smooth exponential zoom scaling with ultra-deep zoom support (down to 0.015)
      const zoomFactor = e.deltaY > 0 ? 1.15 : 0.86;
      cameraRef.current.targetDistance = Math.max(
        0.015,
        Math.min(4.5, cameraRef.current.targetDistance * zoomFactor)
      );
      if (cameraMode === 'focus_planet' && e.deltaY > 0) {
        setCameraMode('free');
      }
    };

    canvas.addEventListener('contextmenu', handleContextMenu);
    canvas.addEventListener('mousedown', handleMouseDown);
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    canvas.addEventListener('wheel', handleWheel, { passive: false });

    return () => {
      canvas.removeEventListener('contextmenu', handleContextMenu);
      canvas.removeEventListener('mousedown', handleMouseDown);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      canvas.removeEventListener('wheel', handleWheel);
    };
  }, [cameraMode]);

  // Main Canvas Render Loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animationFrameId: number;
    const starfield = generateStarfield(280);

    const render = () => {
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }

      if (isPlaying) {
        timeRef.current += 0.016 * speedMultiplier;
        if (cameraRef.current.autoRotate && !cameraRef.current.isDragging && cameraMode === 'free') {
          cameraRef.current.targetYaw += 0.0015;
        }
      }

      // Camera Damping
      cameraRef.current.yaw += (cameraRef.current.targetYaw - cameraRef.current.yaw) * 0.1;
      cameraRef.current.pitch += (cameraRef.current.targetPitch - cameraRef.current.pitch) * 0.1;
      cameraRef.current.distance += (cameraRef.current.targetDistance - cameraRef.current.distance) * 0.14;

      // Calculate Extent & Scale
      const maxAu = Math.max(0.18, hz.optOuterAu * 1.3, ...planets.map((p) => p.semiMajorAxisAu * 1.3));
      const baseScale = (Math.min(width, height) * 0.42) / (maxAu * cameraRef.current.distance);

      // Handle Focus Planet Tracking Cam
      let targetPanX = 0;
      let targetPanY = 0;
      const selectedPlanet = planets[selectedPlanetIndex] ?? planets[0];

      if (cameraMode === 'focus_planet' && selectedPlanet) {
        const period = Math.max(0.1, selectedPlanet.periodDays);
        const theta = (timeRef.current / period) * Math.PI * 2;
        const orbX = Math.cos(theta) * selectedPlanet.semiMajorAxisAu;
        const orbZ = Math.sin(theta) * selectedPlanet.semiMajorAxisAu;

        const cosYaw = Math.cos(cameraRef.current.yaw);
        const sinYaw = Math.sin(cameraRef.current.yaw);
        const rx = orbX * cosYaw - orbZ * sinYaw;
        const rz = orbX * sinYaw + orbZ * cosYaw;
        const cosPitch = Math.cos(cameraRef.current.pitch);

        targetPanX = -rx * baseScale;
        targetPanY = -rz * cosPitch * baseScale;
      }

      if (cameraMode === 'focus_planet') {
        cameraRef.current.panX += (targetPanX - cameraRef.current.panX) * 0.15;
        cameraRef.current.panY += (targetPanY - cameraRef.current.panY) * 0.15;
      }

      const cx = width / 2 + cameraRef.current.panX;
      const cy = height / 2 + cameraRef.current.panY;

      const project = createProjector(cx, cy, baseScale, cameraRef.current);

      // 1. Clear background and nebulae
      drawDeepSpace(ctx, width, height, cx, cy);

      // 2. Background Starfield
      drawStarfield(ctx, starfield, width, height, cameraRef.current.yaw, timeRef.current);

      // 3. Distance Grid
      if (showGrid) drawDistanceGrid(ctx, project, maxAu);

      // 4. Habitable Zone
      if (showHabitableZone) drawHabitableZone(ctx, project, cx, cy, baseScale, hz, timeRef.current);

      // 5. Update and Draw Trails
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
        });
        drawTrails(ctx, project, trailsRef.current, selectedPlanetIndex);
      }

      // 6. Orbit Rings
      if (showOrbits) drawOrbits(ctx, project, planets, selectedPlanetIndex);

      // 7. Dynamic Adaptive Sizing for Star & Planets
      // Ensures close-in orbits are never swallowed by the star
      const minOrbitAu = planets.length > 0
        ? Math.min(...planets.map((p) => p.semiMajorAxisAu))
        : hz.consInnerAu;
      const minOrbitScreenR = minOrbitAu * baseScale;
      const maxStarR = Math.max(8, minOrbitScreenR * 0.42);
      const desiredStarR = Math.max(8, (16 * Math.sqrt(radius)) / Math.pow(cameraRef.current.distance, 0.22));
      const starScreenR = Math.min(maxStarR, desiredStarR);

      // Current Zoom Multiplier for Close-Up Detail Expansion
      const zoomMultiplier = 1 / Math.max(0.015, cameraRef.current.distance);

      // 8. Depth-Sorted Objects
      const renderObjects: {
        type: 'star' | 'planet';
        planet?: (typeof planets)[0];
        index?: number;
        x: number;
        y: number;
        depth: number;
        screenRadius: number;
      }[] = [];

      renderObjects.push({ type: 'star', x: cx, y: cy, depth: 0, screenRadius: starScreenR });

      planets.forEach((p, idx) => {
        const period = Math.max(0.1, p.periodDays);
        const theta = (timeRef.current / period) * Math.PI * 2;
        const orbX = Math.cos(theta) * p.semiMajorAxisAu;
        const orbZ = Math.sin(theta) * p.semiMajorAxisAu;
        const proj = project(orbX, orbZ);

        // Planet radius expands smoothly when zoomed in close!
        const basePlanetR = 4.2 * Math.pow(p.radiusEarth, 0.55);
        const planetScreenR = Math.max(
          5,
          Math.min(150, basePlanetR * Math.pow(zoomMultiplier, 0.42))
        );

        renderObjects.push({
          type: 'planet',
          planet: p,
          index: idx,
          x: proj.x,
          y: proj.y,
          depth: proj.depth,
          screenRadius: planetScreenR,
        });
      });

      renderObjects.sort((a, b) => a.depth - b.depth);

      renderObjects.forEach((obj) => {
        if (obj.type === 'star') {
          drawHostStar(ctx, obj.x, obj.y, obj.screenRadius, star, starStyle, timeRef.current);
        } else if (obj.planet && obj.index != null) {
          drawPlanet(
            ctx,
            obj.x,
            obj.y,
            obj.screenRadius,
            obj.planet,
            cx,
            cy,
            obj.index === selectedPlanetIndex,
            cameraRef.current.yaw
          );
        }
      });

      // 9. Transit Eclipse Ray
      const transitThreshold = 0.05;
      planets.forEach((p) => {
        const period = Math.max(0.1, p.periodDays);
        const theta = ((timeRef.current / period) * Math.PI * 2) % (Math.PI * 2);
        const isTransit =
          Math.abs(theta - Math.PI / 2) < transitThreshold ||
          Math.abs(theta - (3 * Math.PI) / 2) < transitThreshold;

        if (isTransit) {
          const pProj = project(Math.cos(theta) * p.semiMajorAxisAu, Math.sin(theta) * p.semiMajorAxisAu);
          drawTransitEclipse(ctx, cx, cy, starScreenR, pProj.x, pProj.y, p.name);
        }
      });

      // Notify Transit Sync Event for Synchronized Light Curve
      const activePlanet = planets[selectedPlanetIndex] ?? planets[0];
      if (activePlanet && onTimeUpdate) {
        const period = Math.max(0.1, activePlanet.periodDays);
        const theta = ((timeRef.current / period) * Math.PI * 2) % (Math.PI * 2);
        let phase = (theta - Math.PI / 2) / (Math.PI * 2);
        while (phase < -0.5) phase += 1.0;
        while (phase > 0.5) phase -= 1.0;

        const transitThreshold = 0.05;
        const isTransit = Math.abs(phase) < transitThreshold;
        const transitDepthRatio = isTransit
          ? 1.0 - Math.pow(Math.abs(phase) / transitThreshold, 2)
          : 0;

        onTimeUpdate({
          time: timeRef.current,
          phase,
          isTransit,
          transitDepthRatio,
          planetName: activePlanet.name,
        });
      }

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
    hz,
    radius,
    starStyle,
    onTimeUpdate,
  ]);

  const selectedPlanet = planets[selectedPlanetIndex] ?? planets[0];

  // Camera Actions
  const resetCamera = () => {
    cameraRef.current.targetPitch = 0.7;
    cameraRef.current.targetYaw = 0.4;
    cameraRef.current.targetDistance = 1.0;
    cameraRef.current.panX = 0;
    cameraRef.current.panY = 0;
    cameraRef.current.autoRotate = true;
    setCameraMode('free');
  };

  const focusPlanet = () => {
    cameraRef.current.targetDistance = 0.06; // 16x zoom-in directly on planet
    cameraRef.current.targetPitch = 0.35;
    cameraRef.current.autoRotate = false;
    setCameraMode('focus_planet');
  };

  const setTopDownView = () => {
    cameraRef.current.targetPitch = 0.02;
    cameraRef.current.autoRotate = false;
    cameraRef.current.panX = 0;
    cameraRef.current.panY = 0;
    setCameraMode('polar');
  };

  const setTransitView = () => {
    cameraRef.current.targetPitch = Math.PI / 2 - 0.02;
    cameraRef.current.autoRotate = false;
    cameraRef.current.panX = 0;
    cameraRef.current.panY = 0;
    setCameraMode('transit');
  };

  const zoomIn = () => {
    cameraRef.current.targetDistance = Math.max(0.015, cameraRef.current.targetDistance * 0.65);
  };

  const zoomOut = () => {
    cameraRef.current.targetDistance = Math.min(4.5, cameraRef.current.targetDistance * 1.5);
    if (cameraMode === 'focus_planet') setCameraMode('free');
  };

  const currentZoomLevel = 1 / cameraRef.current.distance;

  return (
    <div
      ref={containerRef}
      className={`relative overflow-hidden rounded-2xl border border-border/80 bg-[#030408] shadow-2xl transition-all duration-300 ${
        isFullscreen ? 'fixed inset-0 z-50 rounded-none' : className
      }`}
      style={{ height: isFullscreen ? '100vh' : height }}
    >
      <canvas ref={canvasRef} className="size-full cursor-grab active:cursor-grabbing" />

      {/* Top Left System HUD */}
      <SystemHud star={star} starStyle={starStyle} hz={hz} selectedPlanet={selectedPlanet} />

      {/* Top Right Camera Controls with Deep Zoom & Focus Planet */}
      <CameraControls
        cameraMode={cameraMode}
        isFullscreen={isFullscreen}
        zoomLevel={currentZoomLevel}
        hasPlanets={planets.length > 0}
        onResetCamera={resetCamera}
        onFocusPlanet={focusPlanet}
        onSetTopDownView={setTopDownView}
        onSetTransitView={setTransitView}
        onZoomIn={zoomIn}
        onZoomOut={zoomOut}
        onToggleFullscreen={() => setIsFullscreen(!isFullscreen)}
      />

      {/* Bottom Simulation Controls */}
      <SimulationControls
        isPlaying={isPlaying}
        speedMultiplier={speedMultiplier}
        showHabitableZone={showHabitableZone}
        showTrails={showTrails}
        showGrid={showGrid}
        planets={planets}
        selectedPlanetIndex={selectedPlanetIndex}
        onTogglePlay={() => setIsPlaying(!isPlaying)}
        onChangeSpeed={setSpeedMultiplier}
        onSelectPlanet={(idx) => {
          setSelectedPlanetIndex(idx);
          if (cameraMode === 'focus_planet') focusPlanet();
        }}
        onToggleHabitableZone={() => setShowHabitableZone(!showHabitableZone)}
        onToggleTrails={() => setShowTrails(!showTrails)}
        onToggleGrid={() => setShowGrid(!showGrid)}
      />
    </div>
  );
}
