import type {
  BackgroundStar,
  CameraState,
  HabitableZoneBoundaries,
  PlanetParams,
  StarParams,
  StarStyle,
  TrailPoint,
} from './types';
import { getPlanetBiome, solveKeplerOrbit } from './physics';

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
  const bgGrad = ctx.createRadialGradient(cx, cy, 30, cx, cy, Math.max(width, height) * 0.9);
  bgGrad.addColorStop(0, '#090d18');
  bgGrad.addColorStop(0.5, '#05070d');
  bgGrad.addColorStop(1, '#020306');
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, width, height);
}

export function drawStarfield(
  ctx: CanvasRenderingContext2D,
  stars: BackgroundStar[],
  width: number,
  height: number,
  _yaw: number,
  _time: number
): void {
  // Completely stationary, subtle background stars
  stars.forEach((s) => {
    const sx = s.x * width;
    const sy = s.y * height;

    ctx.fillStyle = s.color;
    ctx.globalAlpha = 0.35;
    ctx.beginPath();
    ctx.arc(sx, sy, s.size, 0, Math.PI * 2);
    ctx.fill();
  });
  ctx.globalAlpha = 1.0;
}

export function drawDistanceGrid(
  ctx: CanvasRenderingContext2D,
  project: Projector,
  maxAu: number
): void {
  ctx.save();
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.04)';
  ctx.lineWidth = 1;

  // Spacious, clean reference rings (only 2-4 rings total)
  const ringStep = maxAu > 3.0 ? 1.0 : maxAu > 1.5 ? 0.5 : maxAu > 0.6 ? 0.25 : maxAu > 0.2 ? 0.1 : 0.05;
  for (let r = ringStep; r <= maxAu * 1.2; r += ringStep) {
    ctx.beginPath();
    const steps = 72;
    for (let i = 0; i <= steps; i++) {
      const angle = (i / steps) * Math.PI * 2;
      const pt = project(Math.cos(angle) * r, Math.sin(angle) * r);
      if (i === 0) ctx.moveTo(pt.x, pt.y);
      else ctx.lineTo(pt.x, pt.y);
    }
    ctx.stroke();

    const labelPt = project(r, 0);
    const kmStr = (r * 149.59787).toFixed(1);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.35)';
    ctx.font = '9px font-mono, monospace';
    ctx.fillText(`${r.toFixed(2)} AU (${kmStr}M km)`, labelPt.x + 4, labelPt.y - 2);
  }

  // Cross axes
  const xNeg = project(-maxAu * 1.35, 0);
  const xPos = project(maxAu * 1.35, 0);
  const zNeg = project(0, -maxAu * 1.35);
  const zPos = project(0, maxAu * 1.35);

  ctx.beginPath();
  ctx.moveTo(xNeg.x, xNeg.y);
  ctx.lineTo(xPos.x, xPos.y);
  ctx.moveTo(zNeg.x, zNeg.y);
  ctx.lineTo(zPos.x, zPos.y);
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
  _time: number
): void {
  ctx.save();

  // Optimistic & Conservative Toroid Zone
  ctx.beginPath();
  const steps = 80;
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
    hz.consInnerAu * baseScale * 0.75,
    cx,
    cy,
    hz.optOuterAu * baseScale * 1.15
  );
  hzGrad.addColorStop(0, 'rgba(16, 185, 129, 0.0)');
  hzGrad.addColorStop(0.3, 'rgba(16, 185, 129, 0.10)');
  hzGrad.addColorStop(0.65, 'rgba(16, 185, 129, 0.15)');
  hzGrad.addColorStop(1, 'rgba(16, 185, 129, 0.0)');
  ctx.fillStyle = hzGrad;
  ctx.fill();

  // Stationary Conservative Zone Inner Boundary
  ctx.beginPath();
  for (let i = 0; i <= steps; i++) {
    const angle = (i / steps) * Math.PI * 2;
    const p = project(Math.cos(angle) * hz.consInnerAu, Math.sin(angle) * hz.consInnerAu);
    if (i === 0) ctx.moveTo(p.x, p.y);
    else ctx.lineTo(p.x, p.y);
  }
  ctx.strokeStyle = 'rgba(52, 211, 153, 0.35)';
  ctx.lineWidth = 1;
  ctx.stroke();

  // Stationary Conservative Zone Outer Boundary
  ctx.beginPath();
  for (let i = 0; i <= steps; i++) {
    const angle = (i / steps) * Math.PI * 2;
    const p = project(Math.cos(angle) * hz.consOuterAu, Math.sin(angle) * hz.consOuterAu);
    if (i === 0) ctx.moveTo(p.x, p.y);
    else ctx.lineTo(p.x, p.y);
  }
  ctx.strokeStyle = 'rgba(52, 211, 153, 0.35)';
  ctx.lineWidth = 1;
  ctx.stroke();

  const hzLabelPt = project((hz.consInnerAu + hz.consOuterAu) * 0.5, 0);
  ctx.fillStyle = '#34d399';
  ctx.font = 'bold 10px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('HABITABLE ZONE (GOLDILOCKS)', hzLabelPt.x, hzLabelPt.y + 14);

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
      const alpha = (i / trail.length) * 0.75;

      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
      ctx.strokeStyle = isSelected
        ? `rgba(56, 189, 248, ${alpha})`
        : `rgba(255, 255, 255, ${alpha * 0.45})`;
      ctx.lineWidth = isSelected ? 2.5 : 1.4;
      ctx.stroke();
    }
  });
  ctx.restore();
}

// Elliptical Keplerian Orbit Rings
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
    const ecc = planet.eccentricity ?? 0.04;
    const periRad = ((planet.periapsisDeg ?? 0) * Math.PI) / 180;

    for (let i = 0; i <= steps; i++) {
      const meanAnom = (i / steps) * Math.PI * 2;
      const { xAu, zAu } = solveKeplerOrbit(meanAnom, ecc, planet.semiMajorAxisAu, periRad);
      const pt = project(xAu, zAu);
      if (i === 0) ctx.moveTo(pt.x, pt.y);
      else ctx.lineTo(pt.x, pt.y);
    }
    const isSelected = idx === selectedIndex;
    ctx.strokeStyle = isSelected ? 'rgba(56, 189, 248, 0.85)' : 'rgba(255, 255, 255, 0.2)';
    ctx.lineWidth = isSelected ? 2 : 1;
    ctx.setLineDash(isSelected ? [] : [3, 4]);
    ctx.stroke();
    ctx.restore();
  });
}

// Interactive Distance Vector / Ruler Callout
export function drawDistanceRuler(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  px: number,
  py: number,
  currentRadiusAu: number,
  starRadiusSolar: number
): void {
  ctx.save();

  // Dashed measurement ray
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(px, py);
  ctx.strokeStyle = 'rgba(56, 189, 248, 0.65)';
  ctx.lineWidth = 1.2;
  ctx.setLineDash([4, 4]);
  ctx.stroke();

  // Floating measurement badge at midpoint
  const midX = (cx + px) / 2;
  const midY = (cy + py) / 2;

  const kmMillion = (currentRadiusAu * 149.59787).toFixed(1);
  const stellarRadii = (currentRadiusAu / (starRadiusSolar * 0.00465)).toFixed(1);
  const lightTimeSec = (currentRadiusAu * 499.0).toFixed(0);

  const badgeText = `${currentRadiusAu.toFixed(3)} AU · ${kmMillion}M km (${stellarRadii} R☉)`;

  ctx.font = 'bold 10px font-mono, monospace';
  const textWidth = ctx.measureText(badgeText).width;
  const padding = 6;

  ctx.fillStyle = 'rgba(12, 16, 28, 0.88)';
  ctx.strokeStyle = 'rgba(56, 189, 248, 0.6)';
  ctx.lineWidth = 1;
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.roundRect(midX - textWidth / 2 - padding, midY - 11, textWidth + padding * 2, 22, 6);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = '#38bdf8';
  ctx.textAlign = 'center';
  ctx.fillText(badgeText, midX, midY + 4);

  ctx.restore();
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
  // Volumetric Corona Glow (proportioned gracefully so it doesn't swallow inner planets)
  const coronaGrad = ctx.createRadialGradient(x, y, r * 0.3, x, y, r * 1.85);
  coronaGrad.addColorStop(0, style.glow);
  coronaGrad.addColorStop(0.4, style.corona);
  coronaGrad.addColorStop(0.8, 'rgba(255, 160, 40, 0.05)');
  coronaGrad.addColorStop(1, 'transparent');

  ctx.fillStyle = coronaGrad;
  ctx.beginPath();
  ctx.arc(x, y, r * 1.85, 0, Math.PI * 2);
  ctx.fill();

  // Stationary Solar Radiance Halo
  ctx.save();
  const outerGlow = ctx.createRadialGradient(x, y, r * 0.8, x, y, r * 1.6);
  outerGlow.addColorStop(0, style.flare);
  outerGlow.addColorStop(1, 'transparent');
  ctx.fillStyle = outerGlow;
  ctx.globalAlpha = 0.25;
  ctx.beginPath();
  ctx.arc(x, y, r * 1.6, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // 3D Spherical Surface with Limb Darkening
  const sphereGrad = ctx.createRadialGradient(x - r * 0.32, y - r * 0.32, r * 0.08, x, y, r);
  sphereGrad.addColorStop(0, '#ffffff');
  sphereGrad.addColorStop(0.28, style.base);
  sphereGrad.addColorStop(0.85, style.base);
  sphereGrad.addColorStop(1, style.spectralClass === 'M' ? '#7a0e00' : '#d43f00');

  ctx.fillStyle = sphereGrad;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();

  // Subtle Anamorphic Lens Flare
  ctx.save();
  const streakGrad = ctx.createLinearGradient(x - r * 3.5, y, x + r * 3.5, y);
  streakGrad.addColorStop(0, 'transparent');
  streakGrad.addColorStop(0.5, style.glow);
  streakGrad.addColorStop(1, 'transparent');
  ctx.fillStyle = streakGrad;
  ctx.fillRect(x - r * 3.5, y - 1, r * 7, 2);
  ctx.restore();

  // Labels
  ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
  ctx.font = 'bold 11px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(star.name, x, y + r + 16);

  ctx.fillStyle = style.base;
  ctx.font = '9px font-mono, monospace';
  ctx.fillText(`${star.teff || 5778} K · ${(star.radius || 1.0).toFixed(2)} R☉`, x, y + r + 27);
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
  yaw: number,
  time: number
): void {
  const biome = getPlanetBiome(planet.radiusEarth, planet.tempK, planet.insolationEarth);
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
    ctx.arc(x, y, pr + 8, 0, Math.PI * 2);
    ctx.stroke();

    ctx.setLineDash([]);
    ctx.lineWidth = 1.2;
    const ch = pr + 12;
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
  const atmoGrad = ctx.createRadialGradient(x, y, pr * 0.8, x, y, pr * 1.5);
  atmoGrad.addColorStop(0, biome.atmosphereGlow);
  atmoGrad.addColorStop(1, 'transparent');
  ctx.fillStyle = atmoGrad;
  ctx.beginPath();
  ctx.arc(x, y, pr * 1.5, 0, Math.PI * 2);
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
  planetGrad.addColorStop(0.92, '#080a10');
  planetGrad.addColorStop(1, '#020305');

  ctx.fillStyle = planetGrad;
  ctx.beginPath();
  ctx.arc(x, y, pr, 0, Math.PI * 2);
  ctx.fill();

  // Dynamic Rotating Surface Features
  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, pr, 0, Math.PI * 2);
  ctx.clip();

  const rotSpeed = 24 / Math.max(8, planet.rotationPeriodHours ?? 24);
  const rotPhase = (time * rotSpeed * 0.2) % (Math.PI * 2);

  if (biome.surfacePattern === 'continents') {
    for (let c = 0; c < 3; c++) {
      const landAngle = rotPhase + c * 2.1;
      const lx = x + Math.cos(landAngle) * pr * 0.55 + lightDirX * pr * 0.15;
      const ly = y + Math.sin(landAngle * 0.7) * pr * 0.45;
      ctx.fillStyle = 'rgba(43, 158, 86, 0.75)';
      ctx.beginPath();
      ctx.ellipse(lx, ly, pr * 0.45, pr * 0.3, landAngle * 0.4, 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (biome.surfacePattern === 'bands') {
    for (let b = -2; b <= 2; b++) {
      ctx.fillStyle = b % 2 === 0 ? 'rgba(255, 255, 255, 0.18)' : 'rgba(0, 0, 0, 0.18)';
      ctx.fillRect(x - pr, y + (b * pr) / 3, pr * 2, pr / 4.5);
    }
  } else if (biome.surfacePattern === 'lava_cracks') {
    ctx.strokeStyle = 'rgba(255, 90, 0, 0.8)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(x - pr * 0.5, y - pr * 0.3);
    ctx.lineTo(x + pr * 0.2, y + pr * 0.1);
    ctx.lineTo(x - pr * 0.1, y + pr * 0.6);
    ctx.stroke();
  }

  if (biome.hasClouds) {
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.45)';
    ctx.lineWidth = pr * 0.3;
    ctx.beginPath();
    ctx.arc(x + lightDirX * pr * 0.18, y + lightDirY * pr * 0.18, pr * 0.65, 0, Math.PI);
    ctx.stroke();
  }
  ctx.restore();

  // Rings for Gas Giants / Ice Giants with 3D perspective
  if (biome.hasRings) {
    ctx.save();
    ctx.beginPath();
    ctx.ellipse(x, y, pr * 2.3, pr * 0.7, (yaw + (planet.axialTiltDeg ?? 15) * 0.017) * 0.5, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(220, 190, 160, 0.55)';
    ctx.lineWidth = pr * 0.45;
    ctx.stroke();
    ctx.restore();
  }

  // Specular Crescent Rim
  ctx.save();
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.75)';
  ctx.lineWidth = 1.1;
  ctx.beginPath();
  ctx.arc(x, y, pr, angleToStar - Math.PI / 3, angleToStar + Math.PI / 3);
  ctx.stroke();
  ctx.restore();

  // Planet Name Tag & Physics Spec
  ctx.fillStyle = isSelected ? '#38bdf8' : 'rgba(255, 255, 255, 0.92)';
  ctx.font = 'bold 11px font-mono, monospace';
  ctx.textAlign = 'center';
  ctx.fillText(planet.name, x, y - pr - 10);

  if (isSelected) {
    ctx.fillStyle = 'rgba(255, 255, 255, 0.75)';
    ctx.font = '9px sans-serif';
    ctx.fillText(`${planet.radiusEarth.toFixed(2)} R⊕ · ${planet.periodDays.toFixed(1)} d · ${planet.semiMajorAxisAu.toFixed(3)} AU`, x, y - pr - 1);
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
