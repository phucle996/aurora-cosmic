import { useEffect, useMemo, useState } from 'react';
import type { JSX } from 'react';
import {
  Activity,
  Calendar,
  CheckCircle2,
  Database,
  Orbit,
  TrendingDown,
} from 'lucide-react';
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

import type { TransitSyncEvent } from './orbit-viewer/types';

export interface SynchronizedLightCurveProps {
  time: number[];
  flux: number[];
  blsPeriod?: number; // In days, e.g. 12.5
  blsDepth?: number; // e.g. 0.0015
  blsDurationDays?: number;
  blsTransitTime?: number; // BTJD from measured BLS ephemeris
  transitInfo?: TransitSyncEvent;
  planetName?: string;
  className?: string;
}

export function SynchronizedLightCurve({
  time,
  flux,
  blsPeriod,
  blsDepth,
  blsDurationDays,
  blsTransitTime,
  transitInfo,
  planetName = 'Candidate Planet',
  className = '',
}: SynchronizedLightCurveProps): JSX.Element {
  const hasMeasuredEphemeris = Number.isFinite(blsPeriod) && (blsPeriod ?? 0) > 0
    && Number.isFinite(blsTransitTime);
  const [viewMode, setViewMode] = useState<'folded' | 'timeseries'>(() => hasMeasuredEphemeris ? 'folded' : 'timeseries');

  useEffect(() => {
    if (!hasMeasuredEphemeris) setViewMode('timeseries');
  }, [hasMeasuredEphemeris]);

  // 1. Full Time Series Data preparation
  const timeSeriesData = useMemo(() => {
    const pointCount = Math.min(time?.length ?? 0, flux?.length ?? 0);
    return Array.from({ length: pointCount }, (_, index) => ({
      time: time[index],
      flux: flux[index],
    })).filter((point) => Number.isFinite(point.time) && Number.isFinite(point.flux));
  }, [time, flux]);

  const minTime = timeSeriesData[0]?.time ?? 0;
  const maxTime = timeSeriesData[timeSeriesData.length - 1]?.time ?? 1;
  const timeSpan = maxTime - minTime;
  const measuredMedianFlux = useMemo(() => {
    const values = timeSeriesData.map((point) => point.flux).filter(Number.isFinite).sort((a, b) => a - b);
    if (values.length === 0) return undefined;
    const middle = Math.floor(values.length / 2);
    return values.length % 2 === 0 ? (values[middle - 1] + values[middle]) / 2 : values[middle];
  }, [timeSeriesData]);

  // 2. Project measured BLS ephemerides across the observed time series.
  const transitEpochs = useMemo(() => {
    if (!blsPeriod || blsPeriod <= 0 || !blsTransitTime || !blsDurationDays || blsDurationDays <= 0 || timeSeriesData.length === 0) return [];
    const durationDays = blsDurationDays;
    const epochs: { id: number; center: number; start: number; end: number; depth: number }[] = [];

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

  // 3. Compute Phase-Folded Light Curve (Phase phi in [-0.5, +0.5])
  const phaseFoldedData = useMemo(() => {
    if (timeSeriesData.length === 0) return [];
    if (!blsPeriod || blsPeriod <= 0 || !blsTransitTime) return [];
    const period = blsPeriod;
    const t0 = blsTransitTime;

    const rawFolded = timeSeriesData.map((d) => {
      let phase = ((d.time - t0) % period) / period;
      if (phase > 0.5) phase -= 1.0;
      if (phase < -0.5) phase += 1.0;
      return { phase, flux: d.flux };
    });

    // Sort by phase
    rawFolded.sort((a, b) => a.phase - b.phase);

    // Binning / subsampling for clean rendering
    const binCount = 200;
    const bins: { phase: number; fluxSum: number; count: number }[] = [];
    for (let b = 0; b < binCount; b++) {
      bins.push({ phase: -0.5 + (b / binCount), fluxSum: 0, count: 0 });
    }

    rawFolded.forEach((pt) => {
      const bIdx = Math.max(0, Math.min(binCount - 1, Math.floor((pt.phase + 0.5) * binCount)));
      bins[bIdx].fluxSum += pt.flux;
      bins[bIdx].count += 1;
    });

    return bins
      .filter((b) => b.count > 0)
      .map((b) => ({
        phase: b.phase,
        flux: b.fluxSum / b.count,
      }));
  }, [timeSeriesData, blsPeriod, blsTransitTime]);

  // 4. Current Synchronized Playhead Position
  const currentPhase = transitInfo?.phase ?? 0.0;
  const isCurrentlyInTransit = transitInfo?.isTransit ?? false;

  // Map 3D simulation time to Time Series cursor
  const currentTimeSeriesCursor = useMemo(() => {
    if (timeSpan <= 0) return minTime;
    const normalizedSimTime = ((transitInfo?.time ?? 0) * 0.4) % timeSpan;
    return minTime + normalizedSimTime;
  }, [transitInfo?.time, minTime, timeSpan]);

  // Calculate live flux reduction during transit
  const liveFluxDipPercent = transitInfo?.isTransit
    ? ((blsDepth ?? 0) * 100 * (transitInfo.transitDepthRatio ?? 1.0)).toFixed(3)
    : '0.000';

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
    <Card className={`overflow-hidden border-border/70 shadow-lg ${className}`}>
      <CardHeader className="bg-muted/15 border-b border-border/60 pb-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <CardTitle className="text-base flex items-center gap-2">
                <Activity className="size-4 text-primary" />
                Synchronized Observation Light Curve · {planetName}
              </CardTitle>
              {isCurrentlyInTransit ? (
                <Badge className="bg-rose-500/20 text-rose-300 border-rose-500/40 animate-pulse font-mono text-[11px]">
                  <TrendingDown className="size-3 mr-1" />
                  Visual orbit phase (-{liveFluxDipPercent}%)
                </Badge>
              ) : (
                <Badge variant="outline" className="text-emerald-400 border-emerald-500/30 text-[11px] font-mono">
                  <CheckCircle2 className="size-3 mr-1" />
                  Median Flux ({measuredMedianFlux?.toFixed(4) ?? '—'})
                </Badge>
              )}
            </div>
            <CardDescription className="mt-1">
              Transit markers use the measured BLS ephemeris when period, epoch and duration are available. The 3D cursor is illustrative only.
            </CardDescription>
          </div>

          {/* View Mode Switcher */}
          <div className="flex items-center gap-2">
            <Button
              variant={viewMode === 'folded' ? 'default' : 'outline'}
              size="sm"
              className="h-8 text-xs font-mono"
              onClick={() => setViewMode('folded')}
              disabled={!hasMeasuredEphemeris}
              title={hasMeasuredEphemeris ? 'Fold by the measured BLS period and epoch' : 'Measured BLS period and epoch are required'}
            >
              <Orbit className="size-3.5 mr-1.5" />
              Phase-Folded Curve
            </Button>
            <Button
              variant={viewMode === 'timeseries' ? 'default' : 'outline'}
              size="sm"
              className="h-8 text-xs font-mono"
              onClick={() => setViewMode('timeseries')}
            >
              <Calendar className="size-3.5 mr-1.5" />
              Full Sector Timeline
            </Button>
          </div>
          {!hasMeasuredEphemeris && (
            <p className="basis-full text-[11px] text-muted-foreground">
              Phase-fold is unavailable because this target has no measured BLS period and epoch. Showing the measured sector timeline.
            </p>
          )}
        </div>
      </CardHeader>

      <CardContent className="p-4 pt-5 space-y-4">
        {/* CHART CONTAINER */}
        <div className="h-72 w-full relative">
          <ResponsiveContainer width="100%" height="100%">
            {viewMode === 'folded' ? (
              // ================= PHASE-FOLDED LIGHT CURVE =================
              <LineChart data={phaseFoldedData} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
                <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" />
                <XAxis
                  dataKey="phase"
                  tickLine={false}
                  axisLine={{ stroke: 'rgba(255,255,255,0.15)' }}
                  tickFormatter={(val: number) => `${(val).toFixed(2)}φ`}
                  domain={[-0.5, 0.5]}
                  type="number"
                  tick={{ fontSize: 11 }}
                />
                <YAxis
                  width={60}
                  tickLine={false}
                  axisLine={{ stroke: 'rgba(255,255,255,0.15)' }}
                  tickFormatter={(val: number) => val.toFixed(4)}
                  domain={['dataMin - 0.001', 'dataMax + 0.001']}
                  tick={{ fontSize: 11 }}
                />
                <Tooltip
                  formatter={(value: any) => [Number(value).toFixed(6), 'Normalized Flux']}
                  labelFormatter={(label: any) => `Phase: ${Number(label).toFixed(3)}φ`}
                  contentStyle={{
                    backgroundColor: 'rgba(15, 23, 42, 0.92)',
                    borderColor: 'rgba(56, 189, 248, 0.4)',
                    borderRadius: '8px',
                    fontSize: '12px',
                  }}
                />

                {blsDurationDays && blsPeriod ? <ReferenceArea x1={-blsDurationDays / blsPeriod / 2} x2={blsDurationDays / blsPeriod / 2} fill="rgba(239, 68, 68, 0.12)" stroke="rgba(239, 68, 68, 0.3)" strokeDasharray="3 3" /> : null}

                {/* Center of Transit Line */}
                <ReferenceLine
                  x={0.0}
                  stroke="rgba(239, 68, 68, 0.6)"
                  strokeDasharray="4 4"
                  label={{
                    value: 'Measured BLS epoch (φ=0.0)',
                    fill: '#f87171',
                    fontSize: 10,
                    position: 'top',
                  }}
                />

                {/* Synchronized Live Laser Playhead */}
                <ReferenceLine
                  x={currentPhase}
                  stroke={isCurrentlyInTransit ? '#f43f5e' : '#38bdf8'}
                  strokeWidth={2.5}
                  label={{
                    value: '● visual orbit phase',
                    fill: isCurrentlyInTransit ? '#f43f5e' : '#38bdf8',
                    fontSize: 10,
                    fontWeight: 'bold',
                    position: 'bottom',
                  }}
                />

                <Line
                  dataKey="flux"
                  stroke="#38bdf8"
                  dot={false}
                  strokeWidth={1.8}
                  isAnimationActive={false}
                />
              </LineChart>
            ) : (
              // ================= FULL SECTOR TIME SERIES =================
              <LineChart data={timeSeriesData} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
                <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" />
                <XAxis
                  dataKey="time"
                  tickLine={false}
                  axisLine={{ stroke: 'rgba(255,255,255,0.15)' }}
                  tickFormatter={(val: number) => val.toFixed(1)}
                  domain={['dataMin', 'dataMax']}
                  tick={{ fontSize: 11 }}
                />
                <YAxis
                  width={60}
                  tickLine={false}
                  axisLine={{ stroke: 'rgba(255,255,255,0.15)' }}
                  tickFormatter={(val: number) => val.toFixed(4)}
                  domain={['dataMin - 0.001', 'dataMax + 0.001']}
                  tick={{ fontSize: 11 }}
                />
                <Tooltip
                  formatter={(value: any) => [Number(value).toFixed(6), 'Flux']}
                  labelFormatter={(label: any) => `Time (BTJD): ${Number(label).toFixed(2)} d`}
                  contentStyle={{
                    backgroundColor: 'rgba(15, 23, 42, 0.92)',
                    borderColor: 'rgba(56, 189, 248, 0.4)',
                    borderRadius: '8px',
                    fontSize: '12px',
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

                {/* Measured BLS transit epochs */}
                {transitEpochs.map((epoch) => (
                  <ReferenceLine
                    key={`line-${epoch.id}`}
                    x={epoch.center}
                    stroke="rgba(244, 63, 94, 0.75)"
                    strokeWidth={1.5}
                    strokeDasharray="3 3"
                    label={{
                      value: `BLS transit #${epoch.id}`,
                      fill: '#fb7185',
                      fontSize: 10,
                      position: 'top',
                    }}
                  />
                ))}

                {/* Synchronized Scanner Cursor */}
                <ReferenceLine
                  x={currentTimeSeriesCursor}
                  stroke="#38bdf8"
                  strokeWidth={2}
                  label={{
                  value: '● visual orbit phase',
                    fill: '#38bdf8',
                    fontSize: 10,
                    position: 'bottom',
                  }}
                />

                <Line
                  dataKey="flux"
                  stroke="#0284c7"
                  dot={false}
                  strokeWidth={1.2}
                  isAnimationActive={false}
                />
              </LineChart>
            )}
          </ResponsiveContainer>
        </div>

        {/* AI TRANSIT DIAGNOSTIC & TELEMETRY FOOTER */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2 border-t border-border/50 text-xs">
          <div className="p-2.5 rounded-lg border border-border/40 bg-muted/20">
            <p className="text-muted-foreground text-[11px]">Measured BLS period (P)</p>
            <p className="font-mono font-semibold text-sm mt-0.5">
              {blsPeriod ? `${blsPeriod.toFixed(3)} days` : '—'}
            </p>
          </div>

          <div className="p-2.5 rounded-lg border border-border/40 bg-muted/20">
            <p className="text-muted-foreground text-[11px]">Transit Depth (ΔF/F)</p>
            <p className="font-mono font-semibold text-sm text-rose-400 mt-0.5">
              {blsDepth == null ? '—' : `${(blsDepth * 100).toFixed(3)}% (${(blsDepth * 1e6).toFixed(0)} ppm)`}
            </p>
          </div>

          <div className="p-2.5 rounded-lg border border-border/40 bg-muted/20">
            <p className="text-muted-foreground text-[11px]">Transit Epochs in Sector</p>
            <p className="font-mono font-semibold text-sm text-sky-400 mt-0.5">
              {hasMeasuredEphemeris ? `${transitEpochs.length} measured BLS events` : 'Not available'}
            </p>
          </div>

          <div className="p-2.5 rounded-lg border border-border/40 bg-muted/20">
            <p className="text-muted-foreground text-[11px]">Estimated Duration (Δt)</p>
            <p className="font-mono font-semibold text-sm mt-0.5">
              {blsDurationDays == null ? '—' : `${(blsDurationDays * 24).toFixed(1)} hours`}
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
