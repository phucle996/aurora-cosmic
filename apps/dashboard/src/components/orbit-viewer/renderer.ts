import type {
  BackgroundStar,
  CameraState,
  HabitableZoneBoundaries,
  PlanetParams,
  StarParams,
  StarStyle,
  TrailPoint,
} from './types';
import { getPlanetBiome } from './physics';

export interface Projector {
  (xAu: number, zAu: number, yOffsetAu?: number): {
    x: number;
    y: number;
    depth: number;
    rx: number;
    rz: number;
  };
}

export function createProjector(
  cx: number,
  cy: number,
  baseScale: number,
  camera: CameraState
): Projector {
  return (xAu: number, zAu: number, yOffsetAu = 0) => {
    const cosYaw = Math.cos(camera.yaw);
    const sinYaw = Math.sin(camera.yaw);
    const rx = xAu * cosYaw - zAu * sinYaw;
    const rz = xAu * sinYaw + zAu * cosYaw;

    const cosPitch = Math.cos(camera.pitch);
    const sinPitch = Math.sin(camera.pitch);
    const screenX = cx + rx * baseScale;
    const screenY = cy + (rz * cosPitch - yOffsetAu * sinPitch) * baseScale;
    const depth = rz * sinPitch + yOffsetAu * cosPitch;

    return { x: screenX, y: screenY, depth, rx, rz };
  };
}

export function drawDeepSpace(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  cx: number,
  cy: number
): void {
  const bgGrad = ctx.createRadialGradient(cx, cy, 20, cx, cy, Math.max(width, height) * 0.85);
  bgGrad.addColorStop(0, '#0c101c');
  bgGrad.addColorStop(0.4, '#070913');
  bgGrad.addColorStop(1, '#030408');
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, width, height);

  // Cosmic Nebula Clouds
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
}

export function drawStarfield(
  ctx: CanvasRenderingContext2D,
  stars: BackgroundStar[],
  width: number,
  height: number,
  yaw: number,
  time: number
): void {
  stars.forEach((s) => {
    const twinkle = 0.65 + 0.35 * Math.sin(time * 2 + s.blinkPhase);
    const parallaxX = (yaw * 30 * s.depth) % width;
    const drawX = (s.x * width + parallaxX + width) % width;
    const drawY = s.y * height;

    ctx.fillStyle = s.color;
    ctx.globalAlpha = twinkle;
    ctx.beginPath();
    ctx.arc(drawX, drawY, s.size, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1.0;
  });
}

export function drawDistanceGrid(
  ctx: CanvasRenderingContext2D,
  project: Projector,
  maxAu: number
): void {
  ctx.save();
  const gridRings = [0.05, 0.1, 0.2, 0.5, 1.0, 1.5, 2.0].filter((r) => r <= maxAu * 1.4);
  gridRings.forEach((rAu) => {
    ctx.beginPath();
    const steps = 60;
    for (let i = 0; i <= steps; i++) {
      const angle = (i / steps) * Math.PI * 2;
      const pt = project(Math.cos(angle) * rAu, Math.sin(angle) * rAu);
      if (i === 0) ctx.moveTo(pt.x, pt.y);
      else ctx.lineTo(pt.x, pt.y);
    }
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.06)';
    ctx.lineWidth = 0.8;
    ctx.setLineDash([2, 5]);
    ctx.stroke();

    const labelPt = project(rAu, 0);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
    ctx.font = '9px font-mono, monospace';
    ctx.textAlign = 'center';
    ctx.fillText(`${rAu} AU`, labelPt.x, labelPt.y - 4);
  });

  const axisLength = maxAu * 1.2;
  const posX = project(axisLength, 0);
  const negX = project(-axisLength, 0);
  ctx.beginPath();
  ctx.moveTo(negX.x, negX.y);
  ctx.lineTo(posX.x, posX.y);
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
  ctx.lineWidth = 1;
  ctx.setLineDash([]);
  ctx.stroke();
  ctx.restore();
}

export function drawHabitableZone(
  ctx: CanvasRenderingContext2D,
  project: Projector,
  cx: number,
  cy: number,
  baseScale: number,
  hz: HabitableZoneBoundaries,
  time: number
): void {
  ctx.save();

  // Optimistic & Conservative Toroid Zone
  ctx.beginPath();
  const steps = 72;
  for (let i = 0; i <= steps; i++) {
    const angle = (i / steps) * Math.PI * 2;
    const p = project(Math.cos(angle) * hz.optOuterAu, Math.sin(angle) * hz.optOuterAu);
    if (i === 0) ctx.moveTo(p.x, p.y);
    else ctx.lineTo(p.x, p.y);
  }
  for (let i = steps; i >= 0; i--) {
    const angle = (i / steps) * Math.PI * 2;
    const p = project(Math.cos(angle) * hz.optInnerAu, Math.sin(angle) * hz.optInnerAu);
    ctx.lineTo(p.x, p.y);
  }
  ctx.closePath();

  const hzGrad = ctx.createRadialGradient(
    cx,
    cy,
    hz.consInnerAu * baseScale * 0.7,
    cx,
    cy,
    hz.optOuterAu * baseScale * 1.1
  );
  hzGrad.addColorStop(0, 'rgba(16, 185, 129, 0.0)');
  hzGrad.addColorStop(0.3, 'rgba(16, 185, 129, 0.12)');
  hzGrad.addColorStop(0.7, 'rgba(16, 185, 129, 0.16)');
  hzGrad.addColorStop(1, 'rgba(16, 185, 129, 0.0)');
  ctx.fillStyle = hzGrad;
  ctx.fill();

  // Animated Scanline Ripple
  const scanOffset = (time * 0.1) % 1;
  const scanR = hz.consInnerAu + (hz.consOuterAu - hz.consInnerAu) * scanOffset;
  ctx.beginPath();
  for (let i = 0; i <= steps; i++) {
    const angle = (i / steps) * Math.PI * 2;
    const p = project(Math.cos(angle) * scanR, Math.sin(angle) * scanR);
    if (i === 0) ctx.moveTo(p.x, p.y);
    else ctx.lineTo(p.x, p.y);
  }
  ctx.strokeStyle = 'rgba(52, 211, 153, 0.45)';
  ctx.lineWidth = 1.2;
  ctx.setLineDash([3, 4]);
  ctx.stroke();

  const hzLabelPt = project((hz.consInnerAu + hz.consOuterAu) * 0.5, 0);
  ctx.fillStyle = '#34d399';
  ctx.font = '10px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('HABITABLE ZONE', hzLabelPt.x, hzLabelPt.y + 14);

  ctx.restore();
}

export function drawTrails(
  ctx: CanvasRenderingContext2D,
  project: Projector,
  trails: Record<number, TrailPoint[]>,
  selectedIndex: number
): void {
  ctx.save();
  Object.entries(trails).forEach(([key, trail]) => {
    const idx = Number(key);
    if (trail.length < 2) return;
    const isSelected = idx === selectedIndex;

    for (let i = 1; i < trail.length; i++) {
      const p1 = project(trail[i - 1].xAu, trail[i - 1].zAu);
      const p2 = project(trail[i].xAu, trail[i].zAu);
      const alpha = (i / trail.length) * 0.7;

      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
      ctx.strokeStyle = isSelected
        ? `rgba(56, 189, 248, ${alpha})`
        : `rgba(255, 255, 255, ${alpha * 0.5})`;
      ctx.lineWidth = isSelected ? 2.5 : 1.5;
      ctx.stroke();
    }
  });
  ctx.restore();
}

export function drawOrbits(
  ctx: CanvasRenderingContext2D,
  project: Projector,
  planets: PlanetParams[],
  selectedIndex: number
): void {
  planets.forEach((planet, idx) => {
    ctx.save();
    ctx.beginPath();
    const steps = 96;
    for (let i = 0; i <= steps; i++) {
      const angle = (i / steps) * Math.PI * 2;
      const pt = project(Math.cos(angle) * planet.semiMajorAxisAu, Math.sin(angle) * planet.semiMajorAxisAu);
      if (i === 0) ctx.moveTo(pt.x, pt.y);
      else ctx.lineTo(pt.x, pt.y);
    }
    const isSelected = idx === selectedIndex;
    ctx.strokeStyle = isSelected ? 'rgba(56, 189, 248, 0.85)' : 'rgba(255, 255, 255, 0.18)';
    ctx.lineWidth = isSelected ? 2 : 1;
    ctx.setLineDash(isSelected ? [] : [3, 4]);
    ctx.stroke();
    ctx.restore();
  });
}

export function drawHostStar(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  star: StarParams,
  style: StarStyle,
  time: number
): void {
  // Volumetric Corona Glow
  const coronaGrad = ctx.createRadialGradient(x, y, r * 0.3, x, y, r * 4.5);
  coronaGrad.addColorStop(0, style.glow);
  coronaGrad.addColorStop(0.3, style.corona);
  coronaGrad.addColorStop(0.7, 'rgba(255, 160, 40, 0.05)');
  coronaGrad.addColorStop(1, 'transparent');

  ctx.fillStyle = coronaGrad;
  ctx.beginPath();
  ctx.arc(x, y, r * 4.5, 0, Math.PI * 2);
  ctx.fill();

  // Dynamic Solar Flares
  ctx.save();
  const flareCount = 10;
  for (let f = 0; f < flareCount; f++) {
    const fAngle = (f / flareCount) * Math.PI * 2 + time * 0.4;
    const fLen = r * (1.2 + 0.28 * Math.sin(time * 3 + f * 1.8));
    const fx = x + Math.cos(fAngle) * fLen;
    const fy = y + Math.sin(fAngle) * fLen;

    ctx.beginPath();
    ctx.moveTo(x + Math.cos(fAngle - 0.15) * r * 0.9, y + Math.sin(fAngle - 0.15) * r * 0.9);
    ctx.quadraticCurveTo(fx, fy, x + Math.cos(fAngle + 0.15) * r * 0.9, y + Math.sin(fAngle + 0.15) * r * 0.9);
    ctx.fillStyle = style.flare;
    ctx.globalAlpha = 0.45;
    ctx.fill();
  }
  ctx.restore();

  // 3D Spherical Surface with Limb Darkening
  const sphereGrad = ctx.createRadialGradient(x - r * 0.3, y - r * 0.3, r * 0.1, x, y, r);
  sphereGrad.addColorStop(0, '#ffffff');
  sphereGrad.addColorStop(0.3, style.base);
  sphereGrad.addColorStop(0.85, style.base);
  sphereGrad.addColorStop(1, '#ff2200');

  ctx.fillStyle = sphereGrad;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();

  // Anamorphic Lens Flare
  ctx.save();
  const streakGrad = ctx.createLinearGradient(x - r * 6, y, x + r * 6, y);
  streakGrad.addColorStop(0, 'transparent');
  streakGrad.addColorStop(0.5, style.glow);
  streakGrad.addColorStop(1, 'transparent');
  ctx.fillStyle = streakGrad;
  ctx.fillRect(x - r * 6, y - 1.5, r * 12, 3);
  ctx.restore();

  // Labels
  ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
  ctx.font = 'bold 12px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(star.name, x, y + r + 18);

  ctx.fillStyle = style.base;
  ctx.font = '10px font-mono, monospace';
  ctx.fillText(`${star.teff || 5778} K · ${(star.radius || 1.0).toFixed(2)} R☉`, x, y + r + 30);
}

export function drawPlanet(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  pr: number,
  planet: PlanetParams,
  cx: number,
  cy: number,
  isSelected: boolean,
  yaw: number
): void {
  const biome = getPlanetBiome(planet.radiusEarth, planet.tempK);
  const angleToStar = Math.atan2(cy - y, cx - x);
  const lightDirX = Math.cos(angleToStar);
  const lightDirY = Math.sin(angleToStar);

  // Selection Hologram Ring
  if (isSelected) {
    ctx.save();
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 1.8;
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    ctx.arc(x, y, pr + 7, 0, Math.PI * 2);
    ctx.stroke();

    ctx.setLineDash([]);
    ctx.lineWidth = 1;
    const ch = pr + 11;
    ctx.beginPath();
    ctx.moveTo(x - ch, y);
    ctx.lineTo(x - ch + 4, y);
    ctx.moveTo(x + ch, y);
    ctx.lineTo(x + ch - 4, y);
    ctx.moveTo(x, y - ch);
    ctx.lineTo(x, y - ch + 4);
    ctx.moveTo(x, y + ch);
    ctx.lineTo(x, y + ch - 4);
    ctx.stroke();
    ctx.restore();
  }

  // Atmospheric Scattering Halo
  const atmoGrad = ctx.createRadialGradient(x, y, pr * 0.8, x, y, pr * 1.45);
  atmoGrad.addColorStop(0, biome.atmosphereGlow);
  atmoGrad.addColorStop(1, 'transparent');
  ctx.fillStyle = atmoGrad;
  ctx.beginPath();
  ctx.arc(x, y, pr * 1.45, 0, Math.PI * 2);
  ctx.fill();

  // Day/Night Shaded Sphere
  const planetGrad = ctx.createRadialGradient(
    x + lightDirX * pr * 0.45,
    y + lightDirY * pr * 0.45,
    pr * 0.05,
    x,
    y,
    pr
  );
  planetGrad.addColorStop(0, biome.accentColor);
  planetGrad.addColorStop(0.55, biome.baseColor);
  planetGrad.addColorStop(0.95, '#07090e');
  planetGrad.addColorStop(1, '#020305');

  ctx.fillStyle = planetGrad;
  ctx.beginPath();
  ctx.arc(x, y, pr, 0, Math.PI * 2);
  ctx.fill();

  // Cloud Swirls
  if (biome.hasClouds) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y, pr, 0, Math.PI * 2);
    ctx.clip();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
    ctx.lineWidth = pr * 0.35;
    ctx.beginPath();
    ctx.arc(x + lightDirX * pr * 0.2, y + lightDirY * pr * 0.2, pr * 0.6, 0, Math.PI);
    ctx.stroke();
    ctx.restore();
  }

  // Rings for Gas Giants
  if (biome.hasRings) {
    ctx.save();
    ctx.beginPath();
    ctx.ellipse(x, y, pr * 2.2, pr * 0.65, yaw * 0.5, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(220, 190, 160, 0.5)';
    ctx.lineWidth = pr * 0.4;
    ctx.stroke();
    ctx.restore();
  }

  // Specular Crescent Rim
  ctx.save();
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.7)';
  ctx.lineWidth = 1.0;
  ctx.beginPath();
  ctx.arc(x, y, pr, angleToStar - Math.PI / 3, angleToStar + Math.PI / 3);
  ctx.stroke();
  ctx.restore();

  // Planet Name Tag
  ctx.fillStyle = isSelected ? '#38bdf8' : 'rgba(255, 255, 255, 0.9)';
  ctx.font = 'bold 11px font-mono, monospace';
  ctx.textAlign = 'center';
  ctx.fillText(planet.name, x, y - pr - 10);

  if (isSelected) {
    ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
    ctx.font = '9px sans-serif';
    ctx.fillText(`${planet.radiusEarth.toFixed(2)} R⊕ · ${planet.periodDays.toFixed(1)} d`, x, y - pr - 1);
  }
}

export function drawTransitEclipse(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  starR: number,
  planetX: number,
  planetY: number,
  planetName: string
): void {
  ctx.save();
  ctx.strokeStyle = 'rgba(239, 68, 68, 0.75)';
  ctx.lineWidth = 1.5;
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(planetX, planetY);
  ctx.stroke();

  ctx.fillStyle = '#ef4444';
  ctx.font = 'bold 10px font-mono, monospace';
  ctx.textAlign = 'center';
  ctx.fillText(`● TRANSIT ECLIPSE: ${planetName}`, cx, cy - starR - 20);
  ctx.restore();
}
