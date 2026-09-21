import { memo, useEffect, useMemo, useRef, useState } from 'react';
import type { JSX } from 'react';
import {
  Activity,
  CheckCircle2,
  Database,
  Orbit,
  Sparkles,
  TrendingDown,
} from 'lucide-react';
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceArea,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { TpfPixelInspector } from './TpfPixelInspector';
import type { TransitSyncEvent } from './orbit-viewer/types';
import type { TPFSample } from '@/lib/analytics-types';
import type { TransitSyncBridge } from '../transit-sync';

interface RawLightCurvePoint {
  index: number;
  time: number;
  flux: number;
}

interface ChartDataPoint extends RawLightCurvePoint {
  pixelFlux?: number;
  pixelElectrons?: number;
}

interface TransitEpochMarker {
  id: number;
  center: number;
  start: number;
  end: number;
  depth: number;
}

/**
 * Downsamples time-series data using Min-Max extrema bucketing to ~targetPoints.
 * Guarantees astronomical transit dips and stellar flares are preserved with 100% exact depth
 * while reducing SVG DOM node count from 18,000+ down to ~1,200.
 */
function downsampleMinMax(data: RawLightCurvePoint[], targetPoints = 1200): RawLightCurvePoint[] {
  const n = data.length;
  if (n <= targetPoints) return data;

  const bucketCount = Math.floor(targetPoints / 2);
  const bucketSize = n / bucketCount;
  const result: RawLightCurvePoint[] = [];

  for (let b = 0; b < bucketCount; b++) {
    const start = Math.floor(b * bucketSize);
    const end = Math.min(n, Math.floor((b + 1) * bucketSize));
    if (start >= end) continue;

    let minPt = data[start];
    let maxPt = data[start];

    for (let i = start + 1; i < end; i++) {
      const pt = data[i];
      if (pt.flux < minPt.flux) minPt = pt;
      if (pt.flux > maxPt.flux) maxPt = pt;
    }

    if (minPt.time < maxPt.time) {
      result.push(minPt);
      if (minPt !== maxPt) result.push(maxPt);
    } else {
      result.push(maxPt);
      if (minPt !== maxPt) result.push(minPt);
    }
  }

  return result;
}

/**
 * Memoized SVG LineChart that NEVER re-renders on simulation ticks.
 * Only re-renders when light curve points or selected pixel change.
 */
interface StaticLightCurveChartProps {
  chartData: ChartDataPoint[];
  transitEpochs: TransitEpochMarker[];
}

const StaticLightCurveChart = memo(function StaticLightCurveChart({
  chartData,
  transitEpochs,
}: StaticLightCurveChartProps) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart
        data={chartData}
        margin={{ top: 10, right: 15, left: -10, bottom: 0 }}
      >
        <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" />
        <XAxis
          dataKey="time"
          tickLine={false}
          axisLine={{ stroke: 'rgba(255,255,255,0.15)' }}
          tickFormatter={(val: number) => val.toFixed(1)}
          domain={['dataMin', 'dataMax']}
          tick={{ fontSize: 10 }}
        />
        <YAxis
          width={55}
          tickLine={false}
          axisLine={{ stroke: 'rgba(255,255,255,0.15)' }}
          tickFormatter={(val: number) => val.toFixed(4)}
          domain={['dataMin - 0.001', 'dataMax + 0.001']}
          tick={{ fontSize: 10 }}
        />
        <Tooltip
          formatter={(value: any) => [Number(value).toFixed(6), 'Aperture Flux']}
          labelFormatter={(label: any) => `Time: ${Number(label).toFixed(2)} BTJD`}
          contentStyle={{
            backgroundColor: 'rgba(15, 23, 42, 0.95)',
            borderColor: 'rgba(56, 189, 248, 0.4)',
            fontSize: '11px',
            fontFamily: 'monospace',
          }}
        />

        {/* Measured BLS transit windows */}
        {transitEpochs.map((epoch) => (
          <ReferenceArea
            key={epoch.id}
            x1={epoch.start}
            x2={epoch.end}
            fill="rgba(244, 63, 94, 0.15)"
            stroke="rgba(244, 63, 94, 0.4)"
            strokeDasharray="2 2"
          />
        ))}

        <Line
          dataKey="flux"
          name="Aperture Flux"
          stroke="#0284c7"
          dot={false}
          strokeWidth={1.3}
          isAnimationActive={false}
        />
      </LineChart>
    </ResponsiveContainer>
  );
});

export interface SynchronizedLightCurveProps {
  time: number[];
  flux: number[];
  blsPeriod?: number; // In days, e.g. 12.5
  blsDepth?: number; // e.g. 0.0015
  blsDurationDays?: number;
  blsTransitTime?: number; // BTJD from measured BLS ephemeris
  transitInfo?: TransitSyncEvent;
  syncBridge?: TransitSyncBridge;
  planetName?: string;
  centroidOffset?: number;
  tpf?: TPFSample;
  className?: string;
}

export const SynchronizedLightCurve = memo(function SynchronizedLightCurve({
  time,
  flux,
  blsPeriod,
  blsDepth,
  blsDurationDays,
  blsTransitTime,
  transitInfo,
  syncBridge,
  centroidOffset = 0.08,
  tpf,
  className = '',
}: SynchronizedLightCurveProps): JSX.Element {
  // Sync Bridge listener (keeps simulation ticks localized without re-rendering parent page)
  const [internalTransitEvent, setInternalTransitEvent] = useState<TransitSyncEvent | undefined>(
    syncBridge?.getLatest() ?? transitInfo,
  );

  useEffect(() => {
    if (!syncBridge) return;
    return syncBridge.subscribe((event) => {
      setInternalTransitEvent(event);
    });
  }, [syncBridge]);

  const activeTransitEvent = syncBridge ? internalTransitEvent : transitInfo;

  // 1. Full Time Series Data preparation
  const [selectedPixel, setSelectedPixel] = useState<{ r: number; c: number } | null>({ r: 5, c: 5 });

  const timeSeriesData = useMemo(() => {
    const pointCount = Math.min(time?.length ?? 0, flux?.length ?? 0);
    return Array.from({ length: pointCount }, (_, index) => ({
      index,
      time: time[index],
      flux: flux[index],
    })).filter((point) => Number.isFinite(point.time) && Number.isFinite(point.flux));
  }, [time, flux]);

  // Downsample aperture flux to ~1,200 points to guarantee 60 FPS
  const chartData = useMemo(() => {
    return downsampleMinMax(timeSeriesData, 1200);
  }, [timeSeriesData]);

  const minTime = timeSeriesData[0]?.time ?? 0;
  const maxTime = timeSeriesData[timeSeriesData.length - 1]?.time ?? 1;
  const timeSpan = Math.max(0.0001, maxTime - minTime);

  const measuredMedianFlux = useMemo(() => {
    const values = timeSeriesData
      .map((point) => point.flux)
      .filter(Number.isFinite)
      .sort((a, b) => a - b);
    if (values.length === 0) return undefined;
    const middle = Math.floor(values.length / 2);
    return values.length % 2 === 0 ? (values[middle - 1] + values[middle]) / 2 : values[middle];
  }, [timeSeriesData]);

  // 2. Project measured BLS ephemerides across the observed time series
  const transitEpochs = useMemo(() => {
    if (
      !blsPeriod ||
      blsPeriod <= 0 ||
      !blsTransitTime ||
      !blsDurationDays ||
      blsDurationDays <= 0 ||
      timeSeriesData.length === 0
    )
      return [];
    const durationDays = blsDurationDays;
    const epochs: TransitEpochMarker[] = [];

    // Find first epoch before minTime
    let epochTime = blsTransitTime;
    while (epochTime - blsPeriod >= minTime) {
      epochTime -= blsPeriod;
    }
    while (epochTime < minTime) {
      epochTime += blsPeriod;
    }

    let epochIndex = 1;
    while (epochTime <= maxTime) {
      epochs.push({
        id: epochIndex,
        center: epochTime,
        start: Math.max(minTime, epochTime - durationDays * 0.5),
        end: Math.min(maxTime, epochTime + durationDays * 0.5),
        depth: blsDepth ?? 0,
      });
      epochTime += blsPeriod;
      epochIndex++;
    }

    return epochs;
  }, [blsPeriod, blsDepth, blsDurationDays, blsTransitTime, minTime, maxTime, timeSeriesData]);

  // 3. Playhead Position on Full Sector Timeline derived from 3D Simulator (1:1 physical time: 86400s = 1 day)
  const simTime = useMemo(() => {
    if (!timeSeriesData.length) return 0;
    if (activeTransitEvent?.time == null) {
      return transitEpochs[0]?.center ?? minTime;
    }

    const elapsedDays = activeTransitEvent.time / 86400;
    const startCenter = blsPeriod && blsPeriod > 0
      ? (transitEpochs[0]?.center ?? minTime)
      : minTime;
    const offset = startCenter - minTime;
    return minTime + (((offset + elapsedDays) % timeSpan) + timeSpan) % timeSpan;
  }, [timeSeriesData.length, activeTransitEvent?.time, blsPeriod, transitEpochs, minTime, timeSpan]);

  // Click-to-inspect timeline position when simulator is paused
  const [clickedTime, setClickedTime] = useState<number | null>(null);
  const lastSimTimeRef = useRef<number>(activeTransitEvent?.time ?? 0);

  useEffect(() => {
    if (activeTransitEvent?.time !== undefined && activeTransitEvent.time !== lastSimTimeRef.current) {
      lastSimTimeRef.current = activeTransitEvent.time;
      if (clickedTime !== null) {
        setClickedTime(null);
      }
    }
  }, [activeTransitEvent?.time, clickedTime]);

  const currentTime = clickedTime ?? simTime;

  // Fraction across the full timeline [0, 1]
  const scannerFraction = useMemo(() => {
    if (timeSpan <= 0) return 0;
    return Math.max(0, Math.min(1, (currentTime - minTime) / timeSpan));
  }, [currentTime, minTime, timeSpan]);

  // 4. Evaluate whether scanner cursor is inside a transit event
  const { isInTransit, currentTransitDepthRatio, activeFlux, cadenceIdx } = useMemo(() => {
    // Check if currentTime falls within any transit epoch window
    const epoch = transitEpochs.find(
      (ep) => currentTime >= ep.start && currentTime <= ep.end,
    );

    let inTransit = Boolean(epoch);
    let ratio = 0;
    if (inTransit && epoch) {
      const halfDur = (epoch.end - epoch.start) / 2;
      ratio = halfDur > 0 ? Math.max(0.15, 1 - Math.abs(currentTime - epoch.center) / halfDur) : 1;
    } else if (activeTransitEvent?.isTransit && clickedTime === null) {
      inTransit = true;
      ratio = activeTransitEvent.transitDepthRatio ?? 0.8;
    }

    // Nearest sample in timeSeriesData
    let sampleIdx = 0;
    if (timeSeriesData.length > 0) {
      const fraction = Math.max(0, Math.min(1, (currentTime - minTime) / timeSpan));
      let guess = Math.floor(fraction * (timeSeriesData.length - 1));
      let bestDist = Math.abs(timeSeriesData[guess].time - currentTime);
      for (
        let i = Math.max(0, guess - 8);
        i <= Math.min(timeSeriesData.length - 1, guess + 8);
        i++
      ) {
        const d = Math.abs(timeSeriesData[i].time - currentTime);
        if (d < bestDist) {
          bestDist = d;
          guess = i;
        }
      }
      sampleIdx = guess;
    }

    const nearestFlux = timeSeriesData[sampleIdx]?.flux ?? 0;

    return {
      isInTransit: inTransit,
      currentTransitDepthRatio: ratio,
      activeFlux: nearestFlux,
      cadenceIdx: sampleIdx,
    };
  }, [currentTime, minTime, timeSpan, timeSeriesData, transitEpochs, activeTransitEvent, clickedTime]);

  // Handler for clicking directly on the chart area to move the scanner line
  const handleChartClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const plotLeft = 45; // YAxis width 55 - margin left 10
    const plotRight = rect.width - 15; // margin right 15
    const plotWidth = plotRight - plotLeft;
    if (plotWidth > 0 && clickX >= plotLeft && clickX <= plotRight) {
      const frac = (clickX - plotLeft) / plotWidth;
      const clickedT = minTime + frac * timeSpan;
      setClickedTime(clickedT);
    }
  };

  if (timeSeriesData.length === 0) {
    return (
      <Card className={className}>
        <CardHeader>
          <CardTitle>Observation light curve</CardTitle>
          <CardDescription>No indexed samples available.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col items-center justify-center py-20 text-sm text-muted-foreground">
          <Database className="mb-2 size-6 text-muted-foreground" />
          No indexed light curve samples for this target.
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={`overflow-hidden rounded-none border border-border/80 shadow-none ring-0 ${className}`}>
      {/* HEADER WITH SYNC TELEMETRY */}
      <CardHeader className="rounded-none border-b border-border/60 bg-muted/10 py-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <CardTitle className="text-base flex items-center gap-2 tracking-tight [font-family:'Outfit',sans-serif]">
                <Activity className="size-4 text-primary" />
                Synchronized TPF Inspector & Observation Light Curve
              </CardTitle>
              {isInTransit ? (
                <Badge className="h-5 rounded-none border-rose-500/50 bg-rose-500/20 font-mono text-[10px] text-rose-300 animate-pulse uppercase">
                  <TrendingDown className="mr-1 size-3" />
                  In Transit (-{(blsDepth ? blsDepth * 100 * currentTransitDepthRatio : 0.014).toFixed(3)}%)
                </Badge>
              ) : (
                <Badge variant="outline" className="h-5 rounded-none border-emerald-500/40 font-mono text-[10px] text-emerald-400 uppercase">
                  <CheckCircle2 className="mr-1 size-3" />
                  Baseline ({measuredMedianFlux?.toFixed(4) ?? '0.0000'})
                </Badge>
              )}
            </div>
            <CardDescription className="mt-1 text-xs">
              Đồng bộ hóa thời gian thực giữa ma trận ảnh điểm CCD TPF 11×11 (trái) và chuỗi thời gian trắc quang Sector (phải) theo trình mô phỏng 3D.
            </CardDescription>
          </div>

          <div className="flex items-center gap-2">
            <Badge variant="outline" className="h-6 rounded-none border-primary/40 bg-primary/5 font-mono text-[10px] text-primary uppercase">
              <Orbit className="mr-1.5 size-3" />
              Synced to 3D Simulator
            </Badge>
          </div>
        </div>
      </CardHeader>

      <CardContent className="p-4 space-y-4">
        {/* DUAL MAIN STAGE: TPF (LEFT) + LIGHT CURVE (RIGHT) */}
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-[320px_minmax(0,1fr)] xl:grid-cols-[350px_minmax(0,1fr)] items-stretch">
          {/* LEFT: TPF 11x11 PIXEL INSPECTOR */}
          <TpfPixelInspector
            currentFlux={activeFlux}
            isTransit={isInTransit}
            transitDepthRatio={currentTransitDepthRatio}
            currentTime={currentTime}
            cadenceIndex={cadenceIdx}
            totalCadences={timeSeriesData.length}
            blsDepth={blsDepth}
            centroidOffset={tpf?.centroid_offset_pixels ?? centroidOffset}
            tpf={tpf}
            selectedPixel={selectedPixel}
            onSelectPixel={setSelectedPixel}
            className="h-full"
          />

          {/* RIGHT: FULL SECTOR TIMELINE WITH SCANNER */}
          <div className="flex flex-col justify-between rounded-none border border-border/80 bg-card p-3.5">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 pb-2 text-xs">
              <div className="flex items-center gap-2">
                <Sparkles className="size-3.5 text-primary" />
                <span className="font-mono text-xs font-semibold uppercase tracking-wider text-foreground">
                  Chuỗi thời gian Sector (Full Sector Timeline)
                </span>
              </div>
              <div className="flex items-center gap-2.5">
                <span className="font-mono text-[11px] text-muted-foreground">
                  Thời gian: <strong className="text-foreground">{currentTime.toFixed(2)} BTJD</strong>
                </span>
              </div>
            </div>

            {/* CHART VIEW CONTAINER WITH VISIBLE SCANNER LINE OVERLAY */}
            <div
              className="my-2 h-[290px] w-full relative select-none cursor-crosshair"
              onClick={handleChartClick}
              title="Nhấp chuột bất kỳ đâu trên biểu đồ để chuyển vạch quét đến mốc thời gian đó"
            >
              {/* 1. MEASURED TRANSIT EPOCH REFERENCE MARKERS */}
              {transitEpochs.map((epoch) => {
                const epochFrac = Math.max(0, Math.min(1, (epoch.center - minTime) / timeSpan));
                return (
                  <div
                    key={`marker-${epoch.id}`}
                    className="pointer-events-none absolute top-[12px] bottom-[26px] z-10 flex flex-col items-center"
                    style={{
                      left: `calc(45px + ${epochFrac} * (100% - 60px))`,
                      transform: 'translateX(-50%)',
                    }}
                  >
                    <span className="font-mono text-[9px] font-semibold text-rose-400 bg-rose-950/80 px-1 py-0.5 border border-rose-500/40 shadow-sm">
                      Transit #{epoch.id}
                    </span>
                    <div className="w-[1px] flex-1 border-l-2 border-dashed border-rose-500/50 shadow-[0_0_6px_rgba(244,63,94,0.4)]" />
                  </div>
                );
              })}

              {/* 2. GUARANTEED UNMISTAKABLE SCANNER LASER LINE | */}
              <div
                className="pointer-events-none absolute top-[8px] bottom-[26px] z-30 flex flex-col items-center will-change-transform"
                style={{
                  left: `calc(45px + ${scannerFraction} * (100% - 60px))`,
                  transform: 'translateX(-50%)',
                }}
              >
                {/* Playhead Badge Indicator */}
                <div
                  className={`whitespace-nowrap px-2 py-0.5 font-mono text-[10px] font-bold shadow-lg uppercase tracking-wider border ${isInTransit
                      ? 'bg-rose-600 text-white border-rose-400 ring-2 ring-rose-500/60 animate-pulse'
                      : 'bg-sky-500 text-slate-950 border-sky-300 ring-2 ring-sky-400/50'
                    }`}
                >
                  {isInTransit ? '▼ IN TRANSIT' : '● SCANNER'}
                </div>

                {/* Solid Glowing Vertical Laser Line | */}
                <div
                  className={`w-[3px] flex-1 ${isInTransit
                      ? 'bg-rose-500 shadow-[0_0_12px_#f43f5e,0_0_20px_#f43f5e]'
                      : 'bg-sky-400 shadow-[0_0_10px_#38bdf8,0_0_16px_#38bdf8]'
                    }`}
                />

                {/* Bottom Tracker Dot */}
                <div
                  className={`size-3 rounded-full border-2 ${isInTransit
                      ? 'bg-rose-500 border-white shadow-[0_0_10px_#f43f5e]'
                      : 'bg-sky-400 border-slate-900 shadow-[0_0_10px_#38bdf8]'
                    }`}
                />
              </div>

              {/* MEMOIZED RECHARTS SVG CANVAS - NEVER RE-RENDERS ON SIMULATION TICKS */}
              <StaticLightCurveChart
                chartData={chartData}
                transitEpochs={transitEpochs}
              />
            </div>

            {/* Footer note: interactive hint & stats */}
            <div className="flex items-center justify-between border-t border-border/50 pt-2 text-[11px] text-muted-foreground">
              <span>Nhấp chuột vào bất kỳ điểm nào trên đồ thị để di chuyển vạch quét `|` và xem ảnh TPF tương ứng</span>
              <span className="font-mono text-[10px]">
                {timeSeriesData.length.toLocaleString()} cadences · {timeSpan.toFixed(1)} ngày quan sát
              </span>
            </div>
          </div>
        </div>

        {/* AI TRANSIT DIAGNOSTIC & TELEMETRY FOOTER */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2 border-t border-border/50 text-xs">
          <div className="p-2.5 rounded-none border border-border/60 bg-muted/10">
            <p className="text-muted-foreground text-[11px]">Measured BLS period (P)</p>
            <p className="font-mono font-semibold text-sm mt-0.5">
              {blsPeriod ? `${blsPeriod.toFixed(3)} days` : '—'}
            </p>
          </div>

          <div className="p-2.5 rounded-none border border-border/60 bg-muted/10">
            <p className="text-muted-foreground text-[11px]">Transit Depth (ΔF/F)</p>
            <p className="font-mono font-semibold text-sm text-rose-400 mt-0.5">
              {blsDepth == null
                ? '—'
                : `${(blsDepth * 100).toFixed(3)}% (${(blsDepth * 1e6).toFixed(0)} ppm)`}
            </p>
          </div>

          <div className="p-2.5 rounded-none border border-border/60 bg-muted/10">
            <p className="text-muted-foreground text-[11px]">Transit Epochs in Sector</p>
            <p className="font-mono font-semibold text-sm text-sky-400 mt-0.5">
              {transitEpochs.length > 0 ? `${transitEpochs.length} measured BLS events` : 'Not available'}
            </p>
          </div>

          <div className="p-2.5 rounded-none border border-border/60 bg-muted/10">
            <p className="text-muted-foreground text-[11px]">Estimated Duration (Δt)</p>
            <p className="font-mono font-semibold text-sm mt-0.5">
              {blsDurationDays == null ? '—' : `${(blsDurationDays * 24).toFixed(1)} hours`}
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
});
