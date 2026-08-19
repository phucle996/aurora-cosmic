import { useMemo, useState } from 'react';
import type { JSX } from 'react';
import { Filter, Orbit, Wand2 } from 'lucide-react';
import {
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { defaultHops, sampleTargets } from '../types';

function generateLightCurvePoints(targetKey: string, isPhaseFolded: boolean) {
  const target = sampleTargets[targetKey] || sampleTargets['TIC 246980040'];
  const points = [];
  const count = isPhaseFolded ? 120 : 180;
  const timeSpanDays = 14.0;

  for (let i = 0; i < count; i++) {
    let t = (i / (count - 1)) * timeSpanDays;
    let phase = 0;

    if (isPhaseFolded) {
      phase = i / (count - 1) - 0.5;
      t = phase * target.period;
    } else {
      phase = ((t % target.period) / target.period) - 0.5;
    }

    const drift =
      1.0 +
      target.stellarDriftAmp * Math.sin((2 * Math.PI * t) / 7.2) +
      0.008 * Math.cos((2 * Math.PI * t) / 3.1);

    const transitWidthPhase = target.duration / 24.0 / target.period;
    let transitDip = 0;
    if (Math.abs(phase) < transitWidthPhase / 2) {
      const edge = Math.abs(phase) / (transitWidthPhase / 2);
      const ingressFactor = edge > 0.7 ? 1.0 - (edge - 0.7) / 0.3 : 1.0;
      transitDip = target.depth * ingressFactor;
    }

    let outlierSpike = 0;
    const isOutlier = !isPhaseFolded && (i === 28 || i === 85 || i === 142);
    if (isOutlier) {
      outlierSpike = (i % 2 === 0 ? 1 : -1) * (0.028 + Math.random() * 0.015);
    }

    const pseudoRandom = Math.sin(i * 999.13 + t * 45.2) * 0.5 + Math.cos(i * 333.7) * 0.5;
    const noise = pseudoRandom * target.rawNoise;

    const rawFlux = drift - transitDip * drift + noise + outlierSpike;
    const trendFlux = drift;
    const normalizedFlux = (rawFlux - outlierSpike) / drift;
    const foldedFlux = 1.0 - transitDip + noise * 0.8;

    points.push({
      index: i,
      timeBjd: Number((2459000 + t).toFixed(3)),
      phase: Number(phase.toFixed(4)),
      rawFlux: Number(rawFlux.toFixed(5)),
      trendFlux: Number(trendFlux.toFixed(5)),
      normalizedFlux: Number(normalizedFlux.toFixed(5)),
      foldedFlux: Number(foldedFlux.toFixed(5)),
      outlierPoint: isOutlier ? Number(rawFlux.toFixed(5)) : null,
      isOutlier,
    });
  }

  return points;
}

export function LightCurveVisualizer(): JSX.Element {
  const [selectedTargetKey, setSelectedTargetKey] = useState<string>('TIC 246980040');
  const [isPhaseFolded, setIsPhaseFolded] = useState<boolean>(false);
  const [activeStep, setActiveStep] = useState<number>(3);

  // Layer Toggles
  const [showRawFlux, setShowRawFlux] = useState<boolean>(true);
  const [showTrend, setShowTrend] = useState<boolean>(true);
  const [showNormalized, setShowNormalized] = useState<boolean>(true);
  const [showOutliers, setShowOutliers] = useState<boolean>(true);

  const lightCurveData = useMemo(() => {
    return generateLightCurvePoints(selectedTargetKey, isPhaseFolded);
  }, [selectedTargetKey, isPhaseFolded]);

  const currentTarget = sampleTargets[selectedTargetKey] || sampleTargets['TIC 246980040'];

  return (
    <div className="space-y-6">
      {/* Step-by-Step Interactive Pipeline Strip */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        {defaultHops.map((hop) => {
          const isSelected = activeStep === hop.stepNumber;
          return (
            <button
              key={hop.id}
              type="button"
              onClick={() => setActiveStep(hop.stepNumber)}
              className={`flex flex-col text-left p-3 rounded-lg border transition-all ${
                isSelected
                  ? 'border-primary bg-primary/10 shadow-sm shadow-primary/20 ring-1 ring-primary'
                  : 'border-border/60 bg-card/60 hover:border-primary/40 hover:bg-muted/20'
              }`}
            >
              <div className="flex items-center justify-between text-xs">
                <span className="font-mono font-bold text-primary">Bước {hop.stepNumber}</span>
                {isSelected && <span className="size-2 rounded-full bg-primary animate-pulse" />}
              </div>
              <p className="mt-1 text-xs font-semibold text-foreground line-clamp-1">{hop.label}</p>
              <p className="mt-1 text-[11px] text-muted-foreground line-clamp-2 leading-tight">
                {hop.shortTitle}
              </p>
            </button>
          );
        })}
      </div>

      {/* Target Selector & Visual Controls */}
      <Card className="border-border/80 shadow-sm">
        <CardHeader className="pb-3 border-b border-border/50">
          <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center">
            <div>
              <CardTitle className="text-base font-semibold flex items-center gap-2">
                <Orbit className="size-4 text-primary" />
                Mô phỏng Trực quan Biến đổi Dữ liệu Trắc quang (Light Curve Transformer)
              </CardTitle>
              <CardDescription className="mt-0.5 text-xs">
                {currentTarget.description}
              </CardDescription>
            </div>

            {/* Target Dropdown */}
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-muted-foreground font-medium">Thiên thể mục tiêu:</span>
              <select
                value={selectedTargetKey}
                onChange={(e) => setSelectedTargetKey(e.target.value)}
                className="h-8 rounded-md border border-border bg-background px-2.5 text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-primary"
              >
                {Object.keys(sampleTargets).map((key) => (
                  <option key={key} value={key}>
                    {key} ({sampleTargets[key].type})
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Layer Toggles */}
          <div className="mt-3 flex flex-wrap items-center gap-2 pt-2 text-xs">
            <span className="text-muted-foreground font-medium mr-1 flex items-center gap-1">
              <Filter className="size-3.5 text-primary" /> Lớp hiển thị:
            </span>

            <button
              type="button"
              onClick={() => setShowRawFlux(!showRawFlux)}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded border text-xs font-medium transition ${
                showRawFlux
                  ? 'border-red-500/40 bg-red-500/10 text-red-600 dark:text-red-400'
                  : 'border-border text-muted-foreground opacity-50'
              }`}
            >
              <span className="size-2 rounded-full bg-red-500" />
              1. Raw SAP Flux (Bronze)
            </button>

            <button
              type="button"
              onClick={() => setShowTrend(!showTrend)}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded border text-xs font-medium transition ${
                showTrend
                  ? 'border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400'
                  : 'border-border text-muted-foreground opacity-50'
              }`}
            >
              <span className="size-2 rounded-full bg-amber-500" />
              2. Spline Background Trend
            </button>

            <button
              type="button"
              onClick={() => setShowNormalized(!showNormalized)}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded border text-xs font-medium transition ${
                showNormalized
                  ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                  : 'border-border text-muted-foreground opacity-50'
              }`}
            >
              <span className="size-2 rounded-full bg-emerald-500" />
              3. Cleaned Normalized (Silver)
            </button>

            <button
              type="button"
              onClick={() => setShowOutliers(!showOutliers)}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded border text-xs font-medium transition ${
                showOutliers
                  ? 'border-purple-500/40 bg-purple-500/10 text-purple-600 dark:text-purple-400'
                  : 'border-border text-muted-foreground opacity-50'
              }`}
            >
              <span className="size-2 rounded-full bg-purple-500" />
              4. 5σ Outlier Spikes
            </button>

            <div className="ml-auto flex items-center gap-1.5 pl-2">
              <Button
                variant={isPhaseFolded ? 'default' : 'outline'}
                size="sm"
                onClick={() => setIsPhaseFolded(!isPhaseFolded)}
                className="h-7 text-xs gap-1 font-semibold"
              >
                <Wand2 className="size-3" />
                {isPhaseFolded ? 'Chế độ: Gập Pha Chu Kỳ (Folded)' : 'Chuyển sang Gập Pha (Phase Fold)'}
              </Button>
            </div>
          </div>
        </CardHeader>

        <CardContent className="p-4">
          <div className="h-[380px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={lightCurveData} margin={{ top: 10, right: 20, bottom: 20, left: 10 }}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.15} />
                <XAxis
                  dataKey={isPhaseFolded ? 'phase' : 'timeBjd'}
                  domain={isPhaseFolded ? [-0.5, 0.5] : ['auto', 'auto']}
                  tickFormatter={(v: number) => (isPhaseFolded ? `${v.toFixed(2)} φ` : `${v}`)}
                  tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
                  label={{
                    value: isPhaseFolded
                      ? 'Orbital Phase φ (0.0 = Transit Center)'
                      : 'Barycentric Julian Date (BJD - 2459000)',
                    position: 'insideBottom',
                    offset: -12,
                    fontSize: 12,
                    fill: 'hsl(var(--muted-foreground))',
                  }}
                />
                <YAxis
                  domain={['auto', 'auto']}
                  tickFormatter={(v: number) => v.toFixed(3)}
                  tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
                  label={{
                    value: isPhaseFolded || !showRawFlux ? 'Normalized Relative Flux (F/F₀)' : 'Raw SAP Flux (e-/s)',
                    angle: -90,
                    position: 'insideLeft',
                    fontSize: 12,
                    fill: 'hsl(var(--muted-foreground))',
                  }}
                />
                <Tooltip
                  content={({ active, payload }) => {
                    if (!active || !payload?.length) return null;
                    const data = payload[0].payload as (typeof lightCurveData)[0];
                    return (
                      <div className="rounded-lg border border-border/80 bg-popover/95 p-3 text-xs shadow-xl backdrop-blur">
                        <p className="font-semibold text-foreground">
                          {isPhaseFolded ? `Phase: ${data.phase} φ` : `BJD: ${data.timeBjd}`}
                        </p>
                        <div className="mt-2 space-y-1 font-mono">
                          {showRawFlux && !isPhaseFolded && (
                            <p className="text-red-400">Raw SAP Flux: {data.rawFlux}</p>
                          )}
                          {showTrend && !isPhaseFolded && (
                            <p className="text-amber-400">Spline Trend: {data.trendFlux}</p>
                          )}
                          {showNormalized && (
                            <p className="text-emerald-400">
                              {isPhaseFolded
                                ? `Folded Flux: ${data.foldedFlux}`
                                : `Normalized Flux: ${data.normalizedFlux}`}
                            </p>
                          )}
                          {data.isOutlier && (
                            <p className="text-purple-400 font-bold">&bull; 5σ Cosmic Ray Outlier</p>
                          )}
                        </div>
                      </div>
                    );
                  }}
                />
                <ReferenceLine y={1.0} stroke="hsl(var(--muted-foreground))" strokeDasharray="3 3" opacity={0.4} />

                {/* 1. Raw SAP Flux Layer */}
                {showRawFlux && !isPhaseFolded && (
                  <Line
                    type="monotone"
                    dataKey="rawFlux"
                    stroke="#ef4444"
                    strokeWidth={1}
                    dot={{ r: 1.5, fill: '#ef4444', opacity: 0.6 }}
                    isAnimationActive={false}
                    name="Raw SAP Flux"
                  />
                )}

                {/* 2. Spline Background Trend Layer */}
                {showTrend && !isPhaseFolded && (
                  <Line
                    type="basis"
                    dataKey="trendFlux"
                    stroke="#f59e0b"
                    strokeWidth={2.5}
                    dot={false}
                    isAnimationActive={false}
                    name="Spline Trend"
                  />
                )}

                {/* 3. Cleaned Normalized or Phase Folded Layer */}
                {showNormalized && (
                  <Line
                    type="monotone"
                    dataKey={isPhaseFolded ? 'foldedFlux' : 'normalizedFlux'}
                    stroke="#10b981"
                    strokeWidth={isPhaseFolded ? 2.5 : 1.5}
                    dot={
                      isPhaseFolded
                        ? { r: 2.5, fill: '#10b981', strokeWidth: 0 }
                        : { r: 1.5, fill: '#10b981', opacity: 0.7 }
                    }
                    isAnimationActive={false}
                    name={isPhaseFolded ? 'Folded Transit Curve' : 'Normalized Flux'}
                  />
                )}

                {/* 4. 5σ Outlier Highlight Layer */}
                {showOutliers && !isPhaseFolded && (
                  <Scatter
                    dataKey="outlierPoint"
                    fill="#a855f7"
                    shape="cross"
                    isAnimationActive={false}
                    name="5σ Outliers"
                  />
                )}
              </ComposedChart>
            </ResponsiveContainer>
          </div>

          {/* Physical Parameters Summary Card */}
          <div className="mt-4 grid grid-cols-2 gap-3 border-t border-border/60 pt-4 sm:grid-cols-3 lg:grid-cols-6 text-xs">
            <div className="bg-muted/20 p-2.5 rounded">
              <span className="text-muted-foreground block text-[11px]">Độ sâu Transit (ΔF/F)</span>
              <span className="font-mono font-bold text-foreground text-sm">
                {(currentTarget.depth * 100).toFixed(3)}% ({Math.round(currentTarget.depth * 1e6)} ppm)
              </span>
            </div>
            <div className="bg-muted/20 p-2.5 rounded">
              <span className="text-muted-foreground block text-[11px]">Chu kỳ quỹ đạo P</span>
              <span className="font-mono font-bold text-foreground text-sm">{currentTarget.period} ngày</span>
            </div>
            <div className="bg-muted/20 p-2.5 rounded">
              <span className="text-muted-foreground block text-[11px]">Thời lượng Transit</span>
              <span className="font-mono font-bold text-foreground text-sm">{currentTarget.duration} giờ</span>
            </div>
            <div className="bg-muted/20 p-2.5 rounded">
              <span className="text-muted-foreground block text-[11px]">Bán kính ước tính Rp</span>
              <span className="font-mono font-bold text-foreground text-sm">{currentTarget.radius} R⊕</span>
            </div>
            <div className="bg-muted/20 p-2.5 rounded">
              <span className="text-muted-foreground block text-[11px]">Tỷ số Tín hiệu/Nhiễu (SNR)</span>
              <span className="font-mono font-bold text-emerald-500 text-sm">{currentTarget.snr} σ</span>
            </div>
            <div className="bg-muted/20 p-2.5 rounded">
              <span className="text-muted-foreground block text-[11px]">Độ đồng pha Odd/Even</span>
              <span className="font-mono font-bold text-foreground text-sm">0.99 (Đạt chuẩn)</span>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
