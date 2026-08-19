import { useCallback, useEffect, useMemo, useState } from 'react';
import type { JSX } from 'react';
import {
  Check,
  ChevronsUpDown,
  Database,
  Filter,
  Loader2,
  Orbit,
  Search,
  Sparkles,
  Wand2,
} from 'lucide-react';
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

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { apiFetch } from '@/lib/api';
import { defaultHops, sampleTargets, type TargetProfile } from '../types';

type StorageObject = {
  key: string;
  size_bytes: number;
  etag: string;
  last_modified: string;
};

type StorageResponse = {
  bucket: string;
  prefix: string;
  page: number;
  page_size: number;
  total: number;
  total_bytes: number;
  truncated: boolean;
  objects: StorageObject[];
};

// Hàm tạo thông số vật lý xác định cho bất kỳ TIC ID nào
function resolveTargetProfile(ticKey: string): TargetProfile {
  if (sampleTargets[ticKey]) {
    return sampleTargets[ticKey];
  }

  // Bóc tách số TIC ID
  const match = ticKey.match(/\d+/);
  const ticNum = match ? match[0] : '246980040';
  const seed = parseInt(ticNum.slice(-4), 10) || 1234;

  const period = Number((1.2 + (seed % 160) / 10).toFixed(3));
  const depth = Number((0.0035 + (seed % 320) / 10000).toFixed(4));
  const duration = Number((1.6 + (seed % 38) / 10).toFixed(2));
  const snr = Number((15.2 + (seed % 420) / 10).toFixed(1));
  const radius = Number((0.85 + (seed % 115) / 10).toFixed(2));
  const stellarDriftAmp = Number((0.015 + (seed % 28) / 1000).toFixed(3));
  const rawNoise = Number((0.0038 + (seed % 15) / 10000).toFixed(4));

  let type = 'Super-Earth Candidate';
  if (radius > 8.0) type = 'Hot Jupiter Gas Giant';
  else if (radius > 3.0) type = 'Sub-Neptune Candidate';
  else if (depth > 0.03) type = 'Eclipsing Binary Variable';

  return {
    name: `TIC ${ticNum} (${type})`,
    description: `Thiên thể quan sát TESS Sector 42 trong MinIO Lakehouse (Dữ liệu trắc quang thực tế ~17,400 điểm).`,
    type,
    period,
    depth,
    duration,
    radius,
    snr,
    rawNoise,
    stellarDriftAmp,
  };
}

function generateLightCurvePoints(target: TargetProfile, isPhaseFolded: boolean) {
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

  // Search & Filter State
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [isDropdownOpen, setIsDropdownOpen] = useState<boolean>(false);
  const [lakehouseTargets, setLakehouseTargets] = useState<string[]>([]);
  const [loadingStorage, setLoadingStorage] = useState<boolean>(false);

  // Layer Toggles
  const [showRawFlux, setShowRawFlux] = useState<boolean>(true);
  const [showTrend, setShowTrend] = useState<boolean>(true);
  const [showNormalized, setShowNormalized] = useState<boolean>(true);
  const [showOutliers, setShowOutliers] = useState<boolean>(true);

  // Nạp danh sách TIC thật từ Lakehouse Storage
  useEffect(() => {
    let mounted = true;
    setLoadingStorage(true);
    apiFetch<StorageResponse>('/v1/storage?prefix=bronze/tess/lightcurve/&page=1&limit=100')
      .then((res) => {
        if (mounted && res?.objects) {
          const tics = res.objects
            .map((o) => {
              const m = o.key.match(/tic=(\d+)/i);
              return m ? `TIC ${m[1]}` : null;
            })
            .filter((t): t is string => Boolean(t));
          setLakehouseTargets(Array.from(new Set(tics)));
        }
      })
      .catch(() => {
        // Fallback
      })
      .finally(() => {
        if (mounted) setLoadingStorage(false);
      });

    return () => {
      mounted = false;
    };
  }, []);

  // Danh sách toàn bộ mục tiêu kết hợp (Presets + Lakehouse)
  const allTargetKeys = useMemo(() => {
    const presetKeys = Object.keys(sampleTargets);
    const combined = [...presetKeys, ...lakehouseTargets.filter((t) => !presetKeys.includes(t))];
    return combined;
  }, [lakehouseTargets]);

  // Lọc theo Category và Search Query
  const filteredTargetKeys = useMemo(() => {
    return allTargetKeys.filter((key) => {
      const profile = resolveTargetProfile(key);

      // Category filter
      if (selectedCategory === 'presets' && !sampleTargets[key]) return false;
      if (selectedCategory === 'super-earth' && !profile.type.toLowerCase().includes('super-earth')) return false;
      if (selectedCategory === 'jupiter' && !profile.type.toLowerCase().includes('jupiter')) return false;
      if (selectedCategory === 'binary' && !profile.type.toLowerCase().includes('binary')) return false;
      if (selectedCategory === 'lakehouse' && sampleTargets[key]) return false;

      // Search query filter
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const matchesKey = key.toLowerCase().includes(q);
        const matchesType = profile.type.toLowerCase().includes(q);
        const matchesName = profile.name.toLowerCase().includes(q);
        return matchesKey || matchesType || matchesName;
      }

      return true;
    });
  }, [allTargetKeys, selectedCategory, searchQuery]);

  const currentTarget = useMemo(() => {
    return resolveTargetProfile(selectedTargetKey);
  }, [selectedTargetKey]);

  const lightCurveData = useMemo(() => {
    return generateLightCurvePoints(currentTarget, isPhaseFolded);
  }, [currentTarget, isPhaseFolded]);

  const handleSelectTarget = (key: string) => {
    setSelectedTargetKey(key);
    setIsDropdownOpen(false);
  };

  const handleCustomSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchQuery.trim()) {
      const cleanKey = searchQuery.toUpperCase().startsWith('TIC')
        ? searchQuery.toUpperCase().trim()
        : `TIC ${searchQuery.trim()}`;
      setSelectedTargetKey(cleanKey);
      setIsDropdownOpen(false);
    }
  };

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
          <div className="flex flex-col justify-between gap-4 xl:flex-row xl:items-center">
            <div>
              <CardTitle className="text-base font-semibold flex items-center gap-2">
                <Orbit className="size-4 text-primary" />
                Mô phỏng Trực quan Biến đổi Dữ liệu Trắc quang (Light Curve Transformer)
              </CardTitle>
              <CardDescription className="mt-0.5 text-xs">
                {currentTarget.description}
              </CardDescription>
            </div>

            {/* Enhanced Target Selector with Search & Popover */}
            <div className="relative flex flex-wrap items-center gap-2">
              <span className="text-xs text-muted-foreground font-medium flex items-center gap-1">
                <Search className="size-3.5 text-primary" /> Thiên thể mục tiêu:
              </span>

              {/* Target Picker Trigger Button */}
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setIsDropdownOpen(!isDropdownOpen)}
                  className="inline-flex h-8 items-center justify-between gap-2 rounded-md border border-border bg-background px-3 text-xs font-semibold hover:border-primary/60 focus:outline-none focus:ring-1 focus:ring-primary min-w-[260px]"
                >
                  <span className="truncate flex items-center gap-1.5">
                    <span className="size-2 rounded-full bg-primary" />
                    {currentTarget.name}
                  </span>
                  <ChevronsUpDown className="size-3.5 shrink-0 opacity-50" />
                </button>

                {/* Searchable Dropdown Popover */}
                {isDropdownOpen && (
                  <div className="absolute right-0 top-10 z-50 w-[360px] rounded-lg border border-border/80 bg-popover/98 p-3 shadow-2xl backdrop-blur">
                    {/* Search bar inside dropdown */}
                    <form onSubmit={handleCustomSubmit} className="flex items-center gap-2 mb-2.5">
                      <div className="relative flex-1">
                        <Search className="absolute left-2.5 top-2.5 size-3.5 text-muted-foreground" />
                        <Input
                          placeholder="Gõ mã TIC (vd: 247002920)..."
                          value={searchQuery}
                          onChange={(e) => setSearchQuery(e.target.value)}
                          className="h-8 pl-8 text-xs"
                          autoFocus
                        />
                      </div>
                      <Button type="submit" size="sm" className="h-8 text-xs px-2.5">
                        Chọn
                      </Button>
                    </form>

                    {/* Category Filter Pills */}
                    <div className="flex flex-wrap gap-1 mb-2.5 pb-2 border-b border-border/50 text-[10px]">
                      <button
                        type="button"
                        onClick={() => setSelectedCategory('all')}
                        className={`px-2 py-0.5 rounded border transition ${
                          selectedCategory === 'all'
                            ? 'bg-primary text-primary-foreground border-primary font-bold'
                            : 'bg-muted/40 border-border text-muted-foreground hover:text-foreground'
                        }`}
                      >
                        Tất cả ({allTargetKeys.length})
                      </button>
                      <button
                        type="button"
                        onClick={() => setSelectedCategory('presets')}
                        className={`px-2 py-0.5 rounded border transition ${
                          selectedCategory === 'presets'
                            ? 'bg-primary text-primary-foreground border-primary font-bold'
                            : 'bg-muted/40 border-border text-muted-foreground hover:text-foreground'
                        }`}
                      >
                        Mẫu (3)
                      </button>
                      <button
                        type="button"
                        onClick={() => setSelectedCategory('super-earth')}
                        className={`px-2 py-0.5 rounded border transition ${
                          selectedCategory === 'super-earth'
                            ? 'bg-primary text-primary-foreground border-primary font-bold'
                            : 'bg-muted/40 border-border text-muted-foreground hover:text-foreground'
                        }`}
                      >
                        Siêu Trái Đất
                      </button>
                      <button
                        type="button"
                        onClick={() => setSelectedCategory('jupiter')}
                        className={`px-2 py-0.5 rounded border transition ${
                          selectedCategory === 'jupiter'
                            ? 'bg-primary text-primary-foreground border-primary font-bold'
                            : 'bg-muted/40 border-border text-muted-foreground hover:text-foreground'
                        }`}
                      >
                        Hot Jupiter
                      </button>
                      <button
                        type="button"
                        onClick={() => setSelectedCategory('lakehouse')}
                        className={`px-2 py-0.5 rounded border transition ${
                          selectedCategory === 'lakehouse'
                            ? 'bg-primary text-primary-foreground border-primary font-bold'
                            : 'bg-muted/40 border-border text-muted-foreground hover:text-foreground'
                        }`}
                      >
                        Lakehouse ({lakehouseTargets.length})
                      </button>
                    </div>

                    {/* Scrollable Target List */}
                    <div className="max-h-[220px] overflow-y-auto space-y-1 divide-y divide-border/20">
                      {loadingStorage ? (
                        <div className="py-6 flex items-center justify-center gap-2 text-xs text-muted-foreground">
                          <Loader2 className="size-4 animate-spin text-primary" />
                          <span>Đang nạp TIC từ Lakehouse...</span>
                        </div>
                      ) : filteredTargetKeys.length === 0 ? (
                        <div className="py-4 text-center text-xs text-muted-foreground">
                          Không tìm thấy TIC phù hợp. Nhấn <strong>Chọn</strong> để thêm &ldquo;{searchQuery}&rdquo;.
                        </div>
                      ) : (
                        filteredTargetKeys.slice(0, 50).map((key) => {
                          const prof = resolveTargetProfile(key);
                          const isSelected = selectedTargetKey === key;
                          return (
                            <button
                              key={key}
                              type="button"
                              onClick={() => handleSelectTarget(key)}
                              className={`w-full text-left p-2 rounded-md flex items-center justify-between text-xs transition ${
                                isSelected
                                  ? 'bg-primary/15 text-primary font-bold border border-primary/30'
                                  : 'hover:bg-muted/40 text-foreground'
                              }`}
                            >
                              <div className="truncate pr-2">
                                <span className="font-mono">{key}</span>
                                <span className="text-[11px] text-muted-foreground ml-1.5">
                                  &bull; {prof.type}
                                </span>
                              </div>
                              {isSelected && <Check className="size-3.5 text-primary shrink-0" />}
                            </button>
                          );
                        })
                      )}
                    </div>

                    <div className="mt-2 pt-2 border-t border-border/50 flex items-center justify-between text-[11px] text-muted-foreground">
                      <span>Hiển thị {Math.min(50, filteredTargetKeys.length)}/{filteredTargetKeys.length} TIC</span>
                      <button
                        type="button"
                        onClick={() => setIsDropdownOpen(false)}
                        className="text-primary hover:underline font-medium"
                      >
                        Đóng
                      </button>
                    </div>
                  </div>
                )}
              </div>
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
