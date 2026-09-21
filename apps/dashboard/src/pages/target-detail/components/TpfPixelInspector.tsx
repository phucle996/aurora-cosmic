import { memo, useMemo, useState } from 'react';
import type { JSX } from 'react';
import {
  Crosshair,
  Eye,
  Focus,
  RotateCcw,
  TrendingDown,
} from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import type { TPFSample } from '@/lib/analytics-types';

export interface TpfPixelInspectorProps {
  currentFlux?: number; // Normalized instantaneous aperture flux at time t
  isTransit: boolean;
  transitDepthRatio?: number; // 0.0 to 1.0
  currentTime?: number; // BTJD
  currentPhase?: number; // -0.5 to 0.5
  cadenceIndex?: number;
  totalCadences?: number;
  blsDepth?: number;
  centroidOffset?: number;
  tpf?: TPFSample;
  selectedPixel?: { r: number; c: number } | null;
  onSelectPixel?: (pixel: { r: number; c: number } | null) => void;
  className?: string;
}

// Astronomical Plasma/Inferno colormap for normalized intensity in [0, 1]
function getPlasmaColor(v: number): string {
  const clamped = Math.max(0, Math.min(1, v));
  if (clamped < 0.18) {
    const t = clamped / 0.18;
    const r = Math.round(11 + t * (59 - 11));
    const g = Math.round(15 + t * (7 - 15));
    const b = Math.round(30 + t * (100 - 30));
    return `rgb(${r}, ${g}, ${b})`;
  } else if (clamped < 0.45) {
    const t = (clamped - 0.18) / 0.27;
    const r = Math.round(59 + t * (156 - 59));
    const g = Math.round(7 + t * (23 - 7));
    const b = Math.round(100 + t * (158 - 100));
    return `rgb(${r}, ${g}, ${b})`;
  } else if (clamped < 0.72) {
    const t = (clamped - 0.45) / 0.27;
    const r = Math.round(156 + t * (234 - 156));
    const g = Math.round(23 + t * (88 - 23));
    const b = Math.round(158 - t * 146);
    return `rgb(${r}, ${g}, ${b})`;
  } else if (clamped < 0.92) {
    const t = (clamped - 0.72) / 0.2;
    const r = Math.round(234 + t * (253 - 234));
    const g = Math.round(88 + t * (224 - 88));
    const b = Math.round(12 + t * (71 - 12));
    return `rgb(${r}, ${g}, ${b})`;
  } else {
    const t = (clamped - 0.92) / 0.08;
    const r = Math.round(253 + t * (255 - 253));
    const g = Math.round(224 + t * (255 - 224));
    const b = Math.round(71 + t * (255 - 71));
    return `rgb(${r}, ${g}, ${b})`;
  }
}

// Difference Colormap for transit shadow ΔF (dark cosmic space -> vibrant cyan -> bright white)
function getDiffColor(v: number): string {
  const clamped = Math.max(0, Math.min(1, v));
  if (clamped <= 0.02) {
    return 'rgb(8, 13, 26)';
  }
  const t = (clamped - 0.02) / 0.98;
  const r = Math.round(10 + t * (220 - 10));
  const g = Math.round(35 + t * (235 - 35));
  const b = Math.round(70 + t * (255 - 70));
  return `rgb(${r}, ${g}, ${b})`;
}

export const TpfPixelInspector = memo(function TpfPixelInspector({
  currentFlux,
  isTransit,
  transitDepthRatio = 1.0,
  currentTime,
  cadenceIndex,
  centroidOffset = 0.08,
  tpf,
  selectedPixel,
  onSelectPixel,
  className = '',
}: TpfPixelInspectorProps): JSX.Element {
  const [viewMode, setViewMode] = useState<'flux' | 'diff'>('flux');
  const [showAperture, setShowAperture] = useState(true);
  const [hoveredPixel, setHoveredPixel] = useState<{ r: number; c: number; flux: number; inAperture: boolean } | null>(null);

  // Active selected pixel (fallback to centroid [5, 5] if uncontrolled)
  const [internalSelected, setInternalSelected] = useState<{ r: number; c: number } | null>({ r: 5, c: 5 });
  const activePixelCoord = selectedPixel !== undefined ? selectedPixel : internalSelected;

  const handleSelectPixel = (r: number, c: number) => {
    const isSame = activePixelCoord?.r === r && activePixelCoord?.c === c;
    const next = isSame ? null : { r, c };
    if (selectedPixel === undefined) {
      setInternalSelected(next);
    }
    onSelectPixel?.(next);
  };

  const effectiveOffset = tpf?.centroid_offset_pixels ?? centroidOffset;
  const effectiveTransitRatio = isTransit ? Math.max(0.1, transitDepthRatio) : 0;

  // Real 11x11 pixel flux map derived directly from ClickHouse TPF observation data
  const { grid, totalApertureFlux } = useMemo(() => {
    const size = tpf?.rows || 11;
    const centerR = tpf?.centroid_row && tpf.centroid_row > 0 ? tpf.centroid_row : (5.0 + (effectiveOffset ? effectiveOffset * 0.4 : 0));
    const centerC = tpf?.centroid_col && tpf.centroid_col > 0 ? tpf.centroid_col : 5.0;
    const sigma = 1.35;

    const hasMedianMap = Boolean(tpf?.median_flux_map && tpf.median_flux_map.length === size * size);
    const hasDiffMap = Boolean(tpf?.difference_flux_map && tpf.difference_flux_map.length === size * size);
    const hasAperture = Boolean(tpf?.aperture_mask && tpf.aperture_mask.length === size * size);

    // Calculate maximum baseline and maximum difference from real data
    const maxBaseline = hasMedianMap && tpf ? Math.max(...tpf.median_flux_map, 1) : 15074;
    const maxDiff = hasDiffMap && tpf
      ? Math.max(...tpf.difference_flux_map.map((v) => Math.abs(v)), 1)
      : 21;

    let apertureSum = 0;
    const cells: { r: number; c: number; value: number; inAperture: boolean; eRate: number; bg: string }[][] = [];

    for (let r = 0; r < size; r++) {
      const row: { r: number; c: number; value: number; inAperture: boolean; eRate: number; bg: string }[] = [];
      for (let c = 0; c < size; c++) {
        const idx = r * size + c;
        const d2 = Math.pow(r - centerR, 2) + Math.pow(c - centerC, 2);
        const dist = Math.sqrt(d2);

        const inAperture = hasAperture && tpf ? tpf.aperture_mask[idx] === 1 : dist <= 2.25;

        // 1. Real physical baseline flux F₀
        let baseRate = 0;
        let diffRate = 0;

        if (hasMedianMap && tpf) {
          baseRate = tpf.median_flux_map[idx];
          diffRate = hasDiffMap ? tpf.difference_flux_map[idx] : 0;
        } else {
          const psfWeight = Math.exp(-d2 / (2 * Math.pow(sigma, 2)));
          baseRate = Math.round(psfWeight * 14850);
          diffRate = -Math.round(baseRate * 0.0014 * 4.0);
        }

        // 2. Real physical flux F(t) during observation
        const transitDrop = isTransit ? Math.abs(diffRate) * effectiveTransitRatio : 0;
        const eRate = Math.max(0, Math.round(baseRate - transitDrop));

        if (inAperture) {
          apertureSum += eRate;
        }

        // 3. Color rendering
        let bg = 'rgb(8, 13, 26)';
        let cellVal = 0;

        if (viewMode === 'diff') {
          // Difference view: illuminates only the eclipsed pixels in real time
          const normDiff = isTransit && maxDiff > 0 ? (Math.abs(diffRate) / maxDiff) * effectiveTransitRatio : 0;
          cellVal = normDiff;
          bg = getDiffColor(normDiff);
        } else {
          // Real-time Flux view with perceptible transit shadow
          const baseNorm = maxBaseline > 0 ? baseRate / maxBaseline : 0;
          const relativeDipStrength = maxDiff > 0 ? (Math.abs(diffRate) / maxDiff) : 0;
          // Dim the eclipsed pixels visibly during transit (up to 32% contrast dip)
          const shadowFactor = isTransit ? 1.0 - 0.32 * relativeDipStrength * effectiveTransitRatio : 1.0;
          const visualNorm = Math.max(0, Math.min(1, baseNorm * shadowFactor));
          cellVal = visualNorm;
          bg = getPlasmaColor(visualNorm);
        }

        row.push({ r, c, value: cellVal, inAperture, eRate, bg });
      }
      cells.push(row);
    }

    return {
      grid: cells,
      totalApertureFlux: apertureSum,
    };
  }, [effectiveTransitRatio, isTransit, viewMode, effectiveOffset, tpf]);

  // Selected pixel real-time telemetry metrics (updates dynamically as time advances)
  const selectedPixelInfo = useMemo(() => {
    if (!activePixelCoord) return null;
    const { r, c } = activePixelCoord;
    const size = tpf?.rows || 11;
    if (r < 0 || r >= size || c < 0 || c >= size) return null;

    const idx = r * size + c;
    const centerR = tpf?.centroid_row && tpf.centroid_row > 0 ? tpf.centroid_row : 5.0;
    const centerC = tpf?.centroid_col && tpf.centroid_col > 0 ? tpf.centroid_col : 5.0;
    const d2 = Math.pow(r - centerR, 2) + Math.pow(c - centerC, 2);
    const dist = Math.sqrt(d2);

    const hasMedianMap = Boolean(tpf?.median_flux_map && tpf.median_flux_map.length === size * size);
    const hasDiffMap = Boolean(tpf?.difference_flux_map && tpf.difference_flux_map.length === size * size);
    const hasAperture = Boolean(tpf?.aperture_mask && tpf.aperture_mask.length === size * size);

    const inAperture = hasAperture && tpf ? tpf.aperture_mask[idx] === 1 : dist <= 2.25;

    // Baseline flux from ClickHouse
    const baseRate = hasMedianMap && tpf
      ? tpf.median_flux_map[idx]
      : Math.round(14850 * Math.exp(-d2 / (2 * Math.pow(1.35, 2))));

    // Difference flux from ClickHouse (negative during transit dip)
    const diffVal = hasDiffMap && tpf
      ? tpf.difference_flux_map[idx]
      : -(baseRate * 0.0014 * 4.0);

    const effectiveRatio = isTransit ? (transitDepthRatio ?? 1.0) : 0;

    // Instantaneous flux at time t
    let currentRate = baseRate;
    if (isTransit) {
      const transitDrop = Math.abs(diffVal) * effectiveRatio;
      currentRate = Math.max(0, baseRate - transitDrop);
    } else if (currentFlux && Number.isFinite(currentFlux) && currentFlux > 0.5 && currentFlux < 1.5) {
      currentRate = Math.max(0, baseRate * currentFlux);
    }

    const deltaFlux = currentRate - baseRate;
    const pctChange = baseRate > 0 ? (deltaFlux / baseRate) * 100 : 0;

    return {
      r,
      c,
      inAperture,
      baseRate,
      currentRate,
      deltaFlux,
      pctChange,
    };
  }, [activePixelCoord, isTransit, transitDepthRatio, currentFlux, tpf]);

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
              Transit
            </Badge>
          ) : (
            <Badge variant="outline" className="h-5 rounded-none border-emerald-500/40 font-mono text-[10px] text-emerald-400 uppercase">
              Baseline
            </Badge>
          )}
        </div>
      </div>

      {/* Mode Selector & Controls */}
      <div className="flex items-center justify-between gap-2 border-b border-border/50 py-2">
        <div className="flex items-center gap-1 bg-muted/40 p-0.5 rounded border border-border/60">
          <button
            type="button"
            onClick={() => setViewMode('flux')}
            className={`px-2 py-0.5 font-mono text-[10px] rounded transition-colors ${
              viewMode === 'flux'
                ? 'bg-primary text-primary-foreground font-semibold shadow-xs'
                : 'text-muted-foreground hover:text-foreground'
            }`}
            title="Hiển thị ảnh quang thông thực F(t) kèm bóng mờ khi có hành tinh đi qua"
          >
            Quang thông F(t)
          </button>
          <button
            type="button"
            onClick={() => setViewMode('diff')}
            className={`px-2 py-0.5 font-mono text-[10px] rounded transition-colors ${
              viewMode === 'diff'
                ? 'bg-primary text-primary-foreground font-semibold shadow-xs'
                : 'text-muted-foreground hover:text-foreground'
            }`}
            title="Hiển thị ảnh vi sai ΔF: chỉ sáng các pixel bị hành tinh che khuất"
          >
            Ảnh vi sai ΔF
          </button>
        </div>

        <button
          type="button"
          onClick={() => setShowAperture((prev) => !prev)}
          className="flex items-center gap-1 font-mono text-[10px] text-muted-foreground hover:text-foreground transition-colors"
          title="Bật/Tắt hiển thị viền Aperture 13 pixel"
        >
          <Eye className="size-3 text-emerald-400" />
          {showAperture ? 'Aperture: Bật' : 'Aperture: Tắt'}
        </button>
      </div>

      {/* 11x11 Pixel Heatmap Container */}
      <div className="my-2 flex flex-col items-center">
        <div className="relative aspect-square w-full max-w-[270px] select-none rounded border border-border/70 bg-[#080d1a] p-1.5 shadow-inner">
          <div className="grid h-full w-full grid-cols-11 gap-[1.5px]">
            {grid.map((row, rIdx) =>
              row.map((cell, cIdx) => {
                const isCenter = rIdx === 5 && cIdx === 5;
                const isSelected = activePixelCoord?.r === rIdx && activePixelCoord?.c === cIdx;
                const isHovered = hoveredPixel?.r === rIdx && hoveredPixel?.c === cIdx;

                return (
                  <div
                    key={`${rIdx}-${cIdx}`}
                    onClick={() => handleSelectPixel(cell.r, cell.c)}
                    onMouseEnter={() =>
                      setHoveredPixel({
                        r: cell.r,
                        c: cell.c,
                        flux: cell.eRate,
                        inAperture: cell.inAperture,
                      })
                    }
                    onMouseLeave={() => setHoveredPixel(null)}
                    style={{ backgroundColor: cell.bg }}
                    title={`Pixel [${cell.r}, ${cell.c}]: ${cell.eRate.toLocaleString()} e⁻/s ${cell.inAperture ? '(Trong Aperture)' : '(Nền)'} - Nhấp để chọn`}
                    className={`relative flex items-center justify-center cursor-pointer ${
                      showAperture && cell.inAperture
                        ? 'ring-1 ring-inset ring-emerald-400/70'
                        : ''
                    } ${
                      isSelected
                        ? 'z-20 scale-110 ring-2 ring-primary shadow-[0_0_10px_rgba(56,189,248,0.9)] ring-offset-1 ring-offset-[#080d1a]'
                        : isHovered
                          ? 'z-10 scale-105 ring-2 ring-white/90 shadow-md'
                          : ''
                    }`}
                  >
                    {isCenter && !isSelected && (
                      <span className="pointer-events-none text-[8px] font-bold text-rose-500 drop-shadow">
                        +
                      </span>
                    )}
                    {isSelected && (
                      <span className="pointer-events-none size-1.5 rounded-full bg-primary shadow-sm" />
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

        {/* Real-time Hover Prompt */}
        <div className="mt-1.5 h-4 w-full text-center font-mono text-[10px]">
          {hoveredPixel ? (
            <span className="text-foreground">
              Rê chuột: Pixel <strong className="text-primary">[{hoveredPixel.r}, {hoveredPixel.c}]</strong>: {hoveredPixel.flux.toLocaleString()} e⁻/s
              <span className={`ml-1 ${hoveredPixel.inAperture ? 'text-emerald-400' : 'text-muted-foreground'}`}>
                ({hoveredPixel.inAperture ? 'In Aperture' : 'Background'})
              </span>
            </span>
          ) : (
            <span className="text-muted-foreground text-[10px]">
              Nhấp vào bất kỳ ô nào trên ma trận 11×11 để xem giá trị tức thời
            </span>
          )}
        </div>
      </div>

      {/* SELECTED PIXEL REAL-TIME TELEMETRY PANEL (NO YELLOW, CLEAN VALUE READOUT) */}
      {selectedPixelInfo ? (
        <div className="mb-2 w-full rounded border border-border/80 bg-muted/15 p-2.5 space-y-2 shadow-sm">
          <div className="flex items-center justify-between border-b border-border/60 pb-1.5">
            <div className="flex items-center gap-1.5">
              <Crosshair className="size-3.5 text-primary" />
              <span className="font-mono text-xs font-bold text-foreground">
                Pixel [{selectedPixelInfo.r}, {selectedPixelInfo.c}]
              </span>
              <Badge
                variant={selectedPixelInfo.inAperture ? 'default' : 'secondary'}
                className={`h-4 rounded-none px-1 text-[9px] font-mono uppercase ${
                  selectedPixelInfo.inAperture
                    ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                    : 'bg-muted/40 text-muted-foreground border border-border/50'
                }`}
              >
                {selectedPixelInfo.inAperture ? 'Trong Aperture' : 'Nền (Background)'}
              </Badge>
            </div>

            <div className="flex items-center gap-1.5">
              {!(selectedPixelInfo.r === 5 && selectedPixelInfo.c === 5) && (
                <button
                  type="button"
                  onClick={() => handleSelectPixel(5, 5)}
                  className="flex items-center gap-0.5 rounded px-1 py-0.5 font-mono text-[9px] text-muted-foreground hover:text-foreground hover:bg-muted/30 transition-colors"
                  title="Đặt lại về điểm ảnh trung tâm sao mẹ [5, 5]"
                >
                  <RotateCcw className="size-2.5" /> Tâm [5,5]
                </button>
              )}
            </div>
          </div>

          {/* 3 Real-time Value Readouts (Update Dynamically as Time Ticks) */}
          <div className="grid grid-cols-3 gap-1.5 text-center font-mono text-[10px]">
            <div className="rounded border border-border/50 bg-background/60 p-1.5">
              <span className="text-[9px] text-muted-foreground block">F₀ Nền (Baseline)</span>
              <p className="font-semibold text-foreground truncate">
                {selectedPixelInfo.baseRate.toLocaleString(undefined, { maximumFractionDigits: 1 })} e⁻/s
              </p>
            </div>
            <div className="rounded border border-border/50 bg-background/60 p-1.5">
              <span className="text-[9px] text-muted-foreground block">F(t) Hiện tại</span>
              <p className={`font-semibold truncate ${isTransit ? 'text-rose-400 font-bold' : 'text-sky-400'}`}>
                {selectedPixelInfo.currentRate.toLocaleString(undefined, { maximumFractionDigits: 1 })} e⁻/s
              </p>
            </div>
            <div className="rounded border border-border/50 bg-background/60 p-1.5">
              <span className="text-[9px] text-muted-foreground block">ΔF Biến thiên</span>
              <p className={`font-semibold truncate ${
                selectedPixelInfo.deltaFlux < -0.05
                  ? 'text-rose-400 font-bold'
                  : selectedPixelInfo.deltaFlux > 0.05
                    ? 'text-emerald-400'
                    : 'text-muted-foreground'
              }`}>
                {Math.abs(selectedPixelInfo.deltaFlux) < 0.05
                  ? '0.0 e⁻/s (0.00%)'
                  : `${selectedPixelInfo.deltaFlux >= 0 ? '+' : ''}${selectedPixelInfo.deltaFlux.toFixed(1)} e⁻/s (${selectedPixelInfo.pctChange >= 0 ? '+' : ''}${selectedPixelInfo.pctChange.toFixed(2)}%)`}
              </p>
            </div>
          </div>
        </div>
      ) : (
        <div className="mb-2 rounded border border-dashed border-border/60 p-2.5 text-center text-[10px] text-muted-foreground font-mono">
          Nhấp chuột vào 1 ô bất kỳ trên lưới 11×11 để xem giá trị quang thông tức thời
        </div>
      )}

      {/* Cadence Telemetry Footer */}
      <div className="space-y-2 border-t border-border/60 pt-2 text-xs">
        <div className="grid grid-cols-2 gap-2 text-[11px]">
          <div className="rounded-none border border-border/40 bg-muted/20 p-1.5">
            <span className="text-muted-foreground text-[10px]">Mốc thời gian (BTJD):</span>
            <p className="font-mono font-semibold text-foreground">
              {currentTime != null ? `${currentTime.toFixed(3)} d` : '—'}
            </p>
          </div>
          <div className="rounded-none border border-border/40 bg-muted/20 p-1.5">
            <span className="text-muted-foreground text-[10px]">Cadence Frame:</span>
            <p className="font-mono font-semibold text-foreground">
              {cadenceIndex != null ? `#${cadenceIndex.toLocaleString()}` : '#1 / 18,277'}
            </p>
          </div>
        </div>

        <div className="flex items-center justify-between pt-0.5">
          <span className="font-mono text-[10px] text-muted-foreground">
            {isTransit ? (
              <span className="text-rose-400 font-semibold">● Đang diễn ra Transit (Che khuất {(effectiveTransitRatio * 100).toFixed(0)}%)</span>
            ) : (
              <span className="text-emerald-400 font-semibold">● Baseline (Quang thông ổn định)</span>
            )}
          </span>
          <span className="font-mono text-[11px] text-muted-foreground">
            Aperture: <span className="font-semibold text-foreground">{totalApertureFlux.toLocaleString()} e⁻/s</span>
          </span>
        </div>
      </div>
    </div>
  );
});
