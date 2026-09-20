import type { JSX } from 'react';
import { Crosshair, ShieldAlert, ShieldCheck } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import type { ScientificReviewEvidence } from '../types';

export function TPFCentroidCutoutMap({ evidence }: { evidence: ScientificReviewEvidence }): JSX.Element {
  const offsetPx = evidence.centroid_offset_pixels ?? 0;
  const hasEvidence = evidence.transit_evidence_available && offsetPx >= 0;

  // Target star center is pixel (5, 5) in standard 11x11 TESS stamp (0 to 10 indices)
  const targetRow = 5;
  const targetCol = 5;

  // If centroid_row/col are provided in range [0, 10], use them; otherwise use offset along 45-deg angle for representation
  let deficitRow = evidence.centroid_row ?? 0;
  let deficitCol = evidence.centroid_col ?? 0;

  if (deficitRow <= 0 && deficitCol <= 0 && offsetPx > 0) {
    const angle = Math.PI / 4; // 45 degrees
    deficitCol = Math.min(10, Math.max(0, targetCol + offsetPx * Math.cos(angle)));
    deficitRow = Math.min(10, Math.max(0, targetRow + offsetPx * Math.sin(angle)));
  }

  // SVG dimensions
  const size = 260;
  const pad = 20;
  const gridSize = size - 2 * pad;
  const cellSize = gridSize / 11;

  // Transform cutout coordinate (col, row) to SVG (x, y)
  const toX = (col: number) => pad + col * cellSize + cellSize / 2;
  const toY = (row: number) => pad + row * cellSize + cellSize / 2;

  const targetX = toX(targetCol);
  const targetY = toY(targetRow);
  const deficitX = toX(deficitCol);
  const deficitY = toY(deficitRow);

  const statusTone = offsetPx >= 2.5 ? 'destructive' : offsetPx >= 1.5 ? 'warning' : 'default';

  return (
    <div className="border border-border/70 bg-background/50">
      <div className="flex items-center justify-between border-b border-border/60 bg-muted/20 px-3 py-2">
        <div className="flex items-center gap-2">
          <Crosshair className="size-4 text-primary" />
          <span className="text-xs font-semibold uppercase tracking-wide">
            TPF 11×11 Spatial Centroid & Difference Map
          </span>
        </div>
        <Badge
          variant={statusTone === 'destructive' ? 'destructive' : statusTone === 'warning' ? 'outline' : 'default'}
          className={`rounded-none font-mono text-[10px] ${statusTone === 'warning' ? 'border-amber-500 text-amber-500' : ''
            }`}
        >
          {offsetPx >= 2.5 ? (
            <span className="flex items-center gap-1">
              <ShieldAlert className="size-3" /> Contamination Risk (≥2.5 px)
            </span>
          ) : offsetPx >= 1.5 ? (
            <span className="flex items-center gap-1">
              <ShieldAlert className="size-3" /> Borderline (1.5–2.5 px)
            </span>
          ) : (
            <span className="flex items-center gap-1">
              <ShieldCheck className="size-3" /> On-Target (&lt;1.5 px)
            </span>
          )}
        </Badge>
      </div>

      <div className="grid gap-3 p-3 lg:grid-cols-[auto_minmax(0,1fr)] items-center">
        {/* SVG 11x11 Pixel Cutout */}
        <div className="flex justify-center">
          <svg
            width={size}
            height={size}
            className="border border-border/70 bg-muted/10"
            viewBox={`0 0 ${size} ${size}`}
          >
            {/* 11x11 grid cells */}
            {Array.from({ length: 11 }).map((_, r) =>
              Array.from({ length: 11 }).map((_, c) => {
                const distFromCenter = Math.hypot(c - targetCol, r - targetRow);
                const isCenter = c === targetCol && r === targetRow;
                const cellBg = isCenter
                  ? 'rgba(56, 189, 248, 0.15)'
                  : distFromCenter <= 1.8
                    ? 'rgba(148, 163, 184, 0.06)'
                    : 'transparent';

                return (
                  <rect
                    key={`${r}-${c}`}
                    x={pad + c * cellSize}
                    y={pad + r * cellSize}
                    width={cellSize}
                    height={cellSize}
                    fill={cellBg}
                    stroke="currentColor"
                    strokeOpacity={0.12}
                  />
                );
              })
            )}

            {/* Safe zone circle (1.5 px) */}
            <circle
              cx={targetX}
              cy={targetY}
              r={1.5 * cellSize}
              fill="none"
              stroke="#10b981"
              strokeWidth={1}
              strokeDasharray="3 3"
              opacity={0.6}
            />

            {/* Borderline zone circle (2.5 px) */}
            <circle
              cx={targetX}
              cy={targetY}
              r={2.5 * cellSize}
              fill="none"
              stroke="#f59e0b"
              strokeWidth={1}
              strokeDasharray="3 3"
              opacity={0.6}
            />

            {/* Offset Vector Line */}
            {hasEvidence && offsetPx > 0.1 && (
              <line
                x1={targetX}
                y1={targetY}
                x2={deficitX}
                y2={deficitY}
                stroke={offsetPx >= 2.5 ? '#ef4444' : offsetPx >= 1.5 ? '#f59e0b' : '#38bdf8'}
                strokeWidth={2}
              />
            )}

            {/* Target Star Marker (Center) */}
            <circle cx={targetX} cy={targetY} r={4} fill="#38bdf8" />
            <circle cx={targetX} cy={targetY} r={7} fill="none" stroke="#38bdf8" strokeWidth={1} />
            <text x={targetX + 8} y={targetY - 6} fill="#38bdf8" fontSize={9} fontFamily="monospace" fontWeight="bold">
              TIC Star
            </text>

            {/* Deficit Centroid Marker */}
            {hasEvidence && (
              <>
                <circle
                  cx={deficitX}
                  cy={deficitY}
                  r={4}
                  fill={offsetPx >= 2.5 ? '#ef4444' : offsetPx >= 1.5 ? '#f59e0b' : '#10b981'}
                />
                <circle
                  cx={deficitX}
                  cy={deficitY}
                  r={8}
                  fill="none"
                  stroke={offsetPx >= 2.5 ? '#ef4444' : offsetPx >= 1.5 ? '#f59e0b' : '#10b981'}
                  strokeWidth={1.5}
                  strokeDasharray="2 2"
                />
                <text
                  x={deficitX + 8}
                  y={deficitY + 12}
                  fill={offsetPx >= 2.5 ? '#ef4444' : offsetPx >= 1.5 ? '#f59e0b' : '#10b981'}
                  fontSize={9}
                  fontFamily="monospace"
                  fontWeight="bold"
                >
                  Deficit (Δ)
                </text>
              </>
            )}

            {/* Axis labels */}
            <text x={pad + 2} y={size - 6} fill="currentColor" opacity={0.4} fontSize={8} fontFamily="monospace">
              Row: 0..10 · Col: 0..10
            </text>
          </svg>
        </div>

        {/* Legend & Interpretation */}
        <div className="space-y-2.5 text-xs">
          <div className="grid grid-cols-2 gap-2 rounded border border-border/60 bg-muted/20 p-2 font-mono text-[11px]">
            <div>
              <span className="text-muted-foreground block text-[10px] uppercase">Centroid Offset</span>
              <span className={`font-bold text-sm ${offsetPx >= 2.5 ? 'text-rose-500' : offsetPx >= 1.5 ? 'text-amber-500' : 'text-emerald-500'}`}>
                {offsetPx.toFixed(3)} px
              </span>
            </div>
            <div>
              <span className="text-muted-foreground block text-[10px] uppercase">TESS Pixel Scale</span>
              <span className="font-medium text-foreground">
                {(offsetPx * 21).toFixed(1)} arcsec
              </span>
            </div>
          </div>

          <p className="text-muted-foreground leading-relaxed">
            {offsetPx >= 2.5
              ? `Tâm sụt giảm quang thông lệch ${offsetPx.toFixed(2)} px (${(offsetPx * 21).toFixed(1)}″) khỏi tâm sao chủ, vượt ngưỡng an toàn 2.5 px. Tín hiệu dip bắt nguồn từ sao nền (Background Eclipsing Binary - BEB).`
              : offsetPx >= 1.5
                ? `Độ lệch tâm ${offsetPx.toFixed(2)} px nằm ở vùng ranh giới (1.5–2.5 px). Cần kiểm tra kỹ các sao lân cận trong bán kính lóa sáng.`
                : `Tâm sụt giảm quang thông trùng khớp với vị trí sao TIC (${offsetPx.toFixed(2)} px < 1.5 px). Không phát hiện dấu hiệu nhiễm quang sao nền.`}
          </p>

          <div className="flex flex-wrap items-center gap-3 pt-1 text-[11px] text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <span className="size-2 rounded-full bg-emerald-500" />
              <span>&lt;1.5 px (On-target)</span>
            </span>
            <span className="flex items-center gap-1.5">
              <span className="size-2 rounded-full bg-amber-500" />
              <span>1.5–2.5 px (Borderline)</span>
            </span>
            <span className="flex items-center gap-1.5">
              <span className="size-2 rounded-full bg-rose-500" />
              <span>≥2.5 px (Contamination)</span>
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
