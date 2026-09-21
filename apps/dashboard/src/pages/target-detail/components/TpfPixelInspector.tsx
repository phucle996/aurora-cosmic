import { useMemo, useState } from 'react';
import type { JSX } from 'react';
import { Eye, Focus, Sparkles, TrendingDown } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import type { TPFSample } from '@/lib/analytics-types';

export interface TpfPixelInspectorProps {
  currentFlux: number; // e.g. -0.0014 (deviation) or 0.9986
  isTransit: boolean;
  transitDepthRatio?: number; // 0.0 to 1.0
  currentTime?: number; // BTJD
  currentPhase?: number; // -0.5 to 0.5
  cadenceIndex?: number;
  totalCadences?: number;
  blsDepth?: number;
  centroidOffset?: number;
  tpf?: TPFSample;
  className?: string;
}

// Generates an iconic astronomical Plasma/Inferno colormap for normalized intensity in [0, 1]
function getPlasmaColor(v: number): string {
  const clamped = Math.max(0, Math.min(1, v));
  if (clamped < 0.18) {
    // Deep cosmic space navy -> dark purple
    const t = clamped / 0.18;
    const r = Math.round(11 + t * (59 - 11));
    const g = Math.round(15 + t * (7 - 15));
    const b = Math.round(30 + t * (100 - 30));
    return `rgb(${r}, ${g}, ${b})`;
  } else if (clamped < 0.45) {
    // Dark purple -> vibrant magenta/violet
    const t = (clamped - 0.18) / 0.27;
    const r = Math.round(59 + t * (156 - 59));
    const g = Math.round(7 + t * (23 - 7));
    const b = Math.round(100 + t * (158 - 100));
    return `rgb(${r}, ${g}, ${b})`;
  } else if (clamped < 0.72) {
    // Magenta -> fiery orange
    const t = (clamped - 0.45) / 0.27;
    const r = Math.round(156 + t * (234 - 156));
    const g = Math.round(23 + t * (88 - 23));
    const b = Math.round(158 - t * 146);
    return `rgb(${r}, ${g}, ${b})`;
  } else if (clamped < 0.92) {
    // Fiery orange -> stellar yellow/gold
    const t = (clamped - 0.72) / 0.2;
    const r = Math.round(234 + t * (253 - 234));
    const g = Math.round(88 + t * (224 - 88));
    const b = Math.round(12 + t * (71 - 12));
    return `rgb(${r}, ${g}, ${b})`;
  } else {
    // Stellar yellow -> pure radiant white
    const t = (clamped - 0.92) / 0.08;
    const r = Math.round(253 + t * (255 - 253));
    const g = Math.round(224 + t * (255 - 224));
    const b = Math.round(71 + t * (255 - 71));
    return `rgb(${r}, ${g}, ${b})`;
  }
}

export function TpfPixelInspector({
  currentFlux,
  isTransit,
  transitDepthRatio = 1.0,
  currentTime,
  currentPhase,
  cadenceIndex,
  totalCadences = 18277,
  blsDepth = 0.0014,
  centroidOffset = 0.08,
  tpf,
  className = '',
}: TpfPixelInspectorProps): JSX.Element {
  const [showAperture, setShowAperture] = useState(true);
  const [hoveredPixel, setHoveredPixel] = useState<{ r: number; c: number; flux: number; inAperture: boolean } | null>(null);

  const effectiveOffset = tpf?.centroid_offset_pixels ?? centroidOffset;

  // Compute 11x11 pixel flux map based on instantaneous flux, real TPF maps & PSF
  const { grid, peakFlux, totalApertureFlux } = useMemo(() => {
    const size = tpf?.rows || 11;
    const centerR = tpf?.centroid_row && tpf.centroid_row > 0 ? tpf.centroid_row : (5.0 + (effectiveOffset ? effectiveOffset * 0.4 : 0));
    const centerC = tpf?.centroid_col && tpf.centroid_col > 0 ? tpf.centroid_col : 5.0;
    const sigma = 1.35; // Standard TESS Point Spread Function width

    const hasMedianMap = Boolean(tpf?.median_flux_map && tpf.median_flux_map.length === size * size);
    const hasDiffMap = Boolean(tpf?.difference_flux_map && tpf.difference_flux_map.length === size * size);
    const hasAperture = Boolean(tpf?.aperture_mask && tpf.aperture_mask.length === size * size);

    let maxBaseline = 14850;
    if (hasMedianMap && tpf) {
      maxBaseline = Math.max(...tpf.median_flux_map, 1);
    }

    // Relative optical flux factor (1.0 = baseline, drops by transit depth during dip)
    const effectiveDip = isTransit ? blsDepth * Math.max(0.2, transitDepthRatio) : 0;
    const fluxMultiplier = Math.max(0.7, 1.0 - effectiveDip * 4.5); // visually pronounced contrast

    let maxVal = 0;
    let apertureSum = 0;

    const cells: { r: number; c: number; value: number; inAperture: boolean; eRate: number }[][] = [];

    for (let r = 0; r < size; r++) {
      const row: { r: number; c: number; value: number; inAperture: boolean; eRate: number }[] = [];
      for (let c = 0; c < size; c++) {
        const idx = r * size + c;
        const d2 = Math.pow(r - centerR, 2) + Math.pow(c - centerC, 2);
        const dist = Math.sqrt(d2);

        // Standard 13-pixel optimal aperture mask or real TESS aperture from ClickHouse
        const inAperture = hasAperture && tpf ? tpf.aperture_mask[idx] === 1 : dist <= 2.25;

        let eRate = 0;
        if (hasMedianMap && tpf) {
          const baseRate = tpf.median_flux_map[idx];
          const diff = (hasDiffMap && isTransit) ? tpf.difference_flux_map[idx] * Math.max(0.2, transitDepthRatio) : 0;
          eRate = Math.max(0, Math.round(baseRate + diff));
        } else {
          const psfWeight = Math.exp(-d2 / (2 * Math.pow(sigma, 2)));
          const pseudoNoise = 0.025 + 0.018 * Math.sin(r * 12.9898 + c * 78.233);
          const val = psfWeight * fluxMultiplier + pseudoNoise;
          eRate = Math.round(val * 14850);
        }

        const val = maxBaseline > 0 ? Math.min(1, Math.max(0, eRate / maxBaseline)) : 0;

        if (inAperture) {
          apertureSum += eRate;
        }
        if (val > maxVal) maxVal = val;

        row.push({ r, c, value: val, inAperture, eRate });
      }
      cells.push(row);
    }

    return {
      grid: cells,
      peakFlux: maxVal,
      totalApertureFlux: apertureSum,
    };
  }, [currentFlux, isTransit, transitDepthRatio, blsDepth, effectiveOffset, tpf]);

  return (
    <div className={`flex flex-col justify-between rounded-none border border-border/80 bg-card p-3.5 ${className}`}>
      {/* Header telemetry */}
      <div className="flex items-center justify-between border-b border-border/60 pb-2.5">
        <div>
          <div className="flex items-center gap-1.5 font-mono text-xs font-semibold uppercase tracking-wider text-foreground">
            <Focus className="size-3.5 text-primary" />
            TPF 11×11 Postage Stamp
          </div>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            Mặt nạ điểm ảnh CCD TESS theo thời gian thực
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          {effectiveOffset > 0 && (
            <Badge variant="outline" className="h-5 rounded-none border-border/80 font-mono text-[10px] text-muted-foreground uppercase">
              Offset: {effectiveOffset.toFixed(2)} px
            </Badge>
          )}
          {isTransit ? (
            <Badge className="h-5 rounded-none border-rose-500/50 bg-rose-500/15 font-mono text-[10px] text-rose-400 animate-pulse uppercase">
              <TrendingDown className="mr-1 size-3" />
              Transit Dip
            </Badge>
          ) : (
            <Badge variant="outline" className="h-5 rounded-none border-emerald-500/40 font-mono text-[10px] text-emerald-400 uppercase">
              <Sparkles className="mr-1 size-3" />
              Baseline
            </Badge>
          )}
        </div>
      </div>

      {/* 11x11 Pixel Heatmap Container */}
      <div className="my-3 flex flex-col items-center">
        <div className="relative aspect-square w-full max-w-[280px] select-none rounded border border-border/70 bg-[#080d1a] p-1.5 shadow-inner">
          <div className="grid h-full w-full grid-cols-11 gap-[1.5px]">
            {grid.map((row, rIdx) =>
              row.map((cell, cIdx) => {
                const normVal = peakFlux > 0 ? cell.value / peakFlux : 0;
                const bg = getPlasmaColor(normVal);
                const isCenter = rIdx === 5 && cIdx === 5;

                return (
                  <div
                    key={`${rIdx}-${cIdx}`}
                    onMouseEnter={() =>
                      setHoveredPixel({
                        r: cell.r,
                        c: cell.c,
                        flux: cell.eRate,
                        inAperture: cell.inAperture,
                      })
                    }
                    onMouseLeave={() => setHoveredPixel(null)}
                    style={{ backgroundColor: bg }}
                    className={`relative flex items-center justify-center transition-colors duration-100 cursor-crosshair ${
                      showAperture && cell.inAperture
                        ? 'ring-1 ring-inset ring-emerald-400/70'
                        : ''
                    } ${
                      hoveredPixel?.r === rIdx && hoveredPixel?.c === cIdx
                        ? 'z-10 scale-110 ring-2 ring-white shadow-md'
                        : ''
                    }`}
                  >
                    {isCenter && (
                      <span className="pointer-events-none text-[8px] font-bold text-rose-500 drop-shadow">
                        +
                      </span>
                    )}
                  </div>
                );
              }),
            )}
          </div>

          {/* Aperture Mask Label Overlay */}
          {showAperture && (
            <div className="pointer-events-none absolute bottom-2 right-2 rounded bg-background/85 px-1.5 py-0.5 font-mono text-[9px] text-emerald-400 backdrop-blur-sm border border-emerald-500/30">
              Aperture (13 px)
            </div>
          )}
        </div>

        {/* Pixel Hover & Coordinate Inspector */}
        <div className="mt-2 h-5 w-full text-center font-mono text-[11px]">
          {hoveredPixel ? (
            <span className="text-foreground">
              Pixel <strong className="text-primary">[{hoveredPixel.r}, {hoveredPixel.c}]</strong>: {hoveredPixel.flux.toLocaleString()} e⁻/s
              <span className={`ml-1.5 ${hoveredPixel.inAperture ? 'text-emerald-400' : 'text-muted-foreground'}`}>
                ({hoveredPixel.inAperture ? 'In Aperture' : 'Background'})
              </span>
            </span>
          ) : (
            <span className="text-muted-foreground text-[10px]">
              Rê chuột lên điểm ảnh để kiểm tra số đếm e⁻/s
            </span>
          )}
        </div>
      </div>

      {/* Cadence Telemetry Footer */}
      <div className="space-y-2 border-t border-border/60 pt-2.5 text-xs">
        <div className="grid grid-cols-2 gap-2 text-[11px]">
          <div className="rounded-none border border-border/40 bg-muted/20 p-1.5">
            <span className="text-muted-foreground text-[10px]">Mốc thời gian (BTJD):</span>
            <p className="font-mono font-semibold text-foreground">
              {currentTime != null ? `${currentTime.toFixed(3)} d` : currentPhase != null ? `${currentPhase.toFixed(3)}φ` : '—'}
            </p>
          </div>
          <div className="rounded-none border border-border/40 bg-muted/20 p-1.5">
            <span className="text-muted-foreground text-[10px]">Cadence Frame:</span>
            <p className="font-mono font-semibold text-foreground">
              {cadenceIndex != null ? `#${cadenceIndex.toLocaleString()}` : '#1 / 18,277'}
            </p>
          </div>
        </div>

        <div className="flex items-center justify-between pt-1">
          <button
            type="button"
            onClick={() => setShowAperture((prev) => !prev)}
            className="flex items-center gap-1 font-mono text-[11px] text-muted-foreground hover:text-foreground transition-colors"
          >
            <Eye className="size-3 text-emerald-400" />
            {showAperture ? 'Ẩn Aperture Mask' : 'Hiện Aperture Mask'}
          </button>
          <span className="font-mono text-[11px] text-muted-foreground">
            Aperture Flux: <span className="font-semibold text-foreground">{totalApertureFlux.toLocaleString()} e⁻/s</span>
          </span>
        </div>
      </div>
    </div>
  );
}
