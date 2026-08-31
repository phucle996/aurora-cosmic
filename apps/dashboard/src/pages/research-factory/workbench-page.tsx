import { useCallback, useEffect, useMemo, useState } from 'react';
import type { FormEvent, JSX } from 'react';
import { Activity, CircleAlert, Database, LoaderCircle, Microscope, RefreshCw, Search, Waves } from 'lucide-react';
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { apiFetch } from '@/lib/api';
import type { LightcurveResponse, TargetDetailResponse, TargetRecord } from '@/lib/analytics-types';

type TargetListResponse = { count: number; targets: TargetRecord[] };
type ViewMode = 'timeseries' | 'phase';

function fixed(value: number | null | undefined, digits = 3): string {
  return value == null || !Number.isFinite(value) ? '—' : value.toFixed(digits);
}

function targetKey(target: Pick<TargetRecord, 'tic_id' | 'sector'>): string {
  return `${target.tic_id}:${target.sector}`;
}

function Metric({ label, value, detail }: { label: string; value: string; detail: string }): JSX.Element {
  return <div className="rounded-md border border-border/70 bg-muted/15 p-3"><p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</p><p className="mt-1 font-mono text-base font-semibold tabular-nums">{value}</p><p className="mt-1 text-[11px] text-muted-foreground">{detail}</p></div>;
}

export default function ResearchWorkbenchPage(): JSX.Element {
  const [targets, setTargets] = useState<TargetRecord[]>([]);
  const [selectedKey, setSelectedKey] = useState('');
  const [detail, setDetail] = useState<TargetDetailResponse>();
  const [curve, setCurve] = useState<LightcurveResponse>();
  const [query, setQuery] = useState('');
  const [view, setView] = useState<ViewMode>('timeseries');
  const [loadingTargets, setLoadingTargets] = useState(true);
  const [loadingCurve, setLoadingCurve] = useState(false);
  const [error, setError] = useState<string>();

  const loadTarget = useCallback(async (target: TargetRecord): Promise<void> => {
    setSelectedKey(targetKey(target)); setLoadingCurve(true); setError(undefined);
    try {
      const [nextDetail, nextCurve] = await Promise.all([
				apiFetch<TargetDetailResponse>(`/v1/targets/${target.tic_id}?sector=${target.sector}${target.gold_snapshot_id ? `&snapshot_id=${encodeURIComponent(target.gold_snapshot_id)}` : ''}`),
        apiFetch<LightcurveResponse>(`/v1/lightcurves?tic_id=${target.tic_id}&sector=${target.sector}&limit=1000`),
      ]);
      setDetail(nextDetail); setCurve(nextCurve);
    } catch (reason) {
      setDetail(undefined); setCurve(undefined); setError(reason instanceof Error ? reason.message : 'Không tải được dữ liệu quan sát.');
    } finally { setLoadingCurve(false); }
  }, []);

  const loadTargets = useCallback(async (preferredTic = ''): Promise<void> => {
    setLoadingTargets(true); setError(undefined);
    try {
      const params = new URLSearchParams({ has_lightcurve: 'true', limit: '100', sort: 'tmag_asc' });
      if (preferredTic) params.set('tic_id', preferredTic);
      const response = await apiFetch<TargetListResponse>(`/v1/targets?${params.toString()}`);
      const observedTargets = response.targets ?? [];
      setTargets(observedTargets);
      if (observedTargets.length > 0) await loadTarget(observedTargets[0]);
      else { setSelectedKey(''); setDetail(undefined); setCurve(undefined); }
    } catch (reason) {
      setTargets([]); setDetail(undefined); setCurve(undefined); setError(reason instanceof Error ? reason.message : 'Không tải được chỉ mục quan sát.');
    } finally { setLoadingTargets(false); }
  }, [loadTarget]);

  useEffect(() => { void loadTargets(); }, [loadTargets]);
  const onSearch = (event: FormEvent<HTMLFormElement>): void => { event.preventDefault(); void loadTargets(query.trim()); };

  const evidence = detail?.evidence;
  const hasPhaseEvidence = evidence?.bls_available === true && (evidence.bls_period ?? 0) > 0 && (evidence.bls_transit_time ?? 0) > 0;
  const timeSeries = useMemo(() => (curve?.time ?? []).map((time, index) => ({ time, flux: curve?.flux[index] ?? null })), [curve]);
  const phaseSeries = useMemo(() => {
    if (!curve || !hasPhaseEvidence || !evidence) return [];
    const period = evidence.bls_period; const epoch = evidence.bls_transit_time;
    return curve.time.map((time, index) => ({ phase: ((((time - epoch + period / 2) % period) + period) % period) / period - 0.5, flux: curve.flux[index] ?? null })).sort((left, right) => left.phase - right.phase);
  }, [curve, evidence, hasPhaseEvidence]);
  const chartSeries: Array<{ time?: number; phase?: number; flux: number | null }> = view === 'phase'
    ? phaseSeries.map((point) => ({ phase: point.phase, flux: point.flux }))
    : timeSeries.map((point) => ({ time: point.time, flux: point.flux }));
  const fluxValues = timeSeries.map((point) => point.flux).filter((value): value is number => value != null && Number.isFinite(value));
  const fluxMean = fluxValues.length ? fluxValues.reduce((sum, value) => sum + value, 0) / fluxValues.length : undefined;
  const minTime = timeSeries[0]?.time; const maxTime = timeSeries.at(-1)?.time;
  const selected = targets.find((target) => targetKey(target) === selectedKey);

  return <div className="space-y-6">
    <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between"><div><div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground"><Microscope className="size-4 text-primary" /> Scientific Research Factory · measured evidence</div><h2 className="font-heading text-2xl font-semibold tracking-tight md:text-3xl">Observation Workbench</h2><p className="mt-1 max-w-3xl text-sm text-muted-foreground">Explore exact indexed Silver light-curve samples. Phase folding is enabled only when the selected target has measured BLS ephemeris in its evidence.</p></div><Button variant="outline" onClick={() => void loadTargets(query.trim())} disabled={loadingTargets || loadingCurve}><RefreshCw className={loadingTargets || loadingCurve ? 'animate-spin' : ''} /> Refresh observed data</Button></div>
    <Card><CardContent className="flex flex-col gap-3 p-4 lg:flex-row lg:items-end"><form className="flex min-w-0 flex-1 gap-2" onSubmit={onSearch}><div className="relative min-w-0 flex-1"><Search className="pointer-events-none absolute left-3 top-2.5 size-4 text-muted-foreground" /><Input value={query} onChange={(event) => setQuery(event.target.value)} className="pl-9 font-mono" inputMode="numeric" placeholder="Search exact TIC ID" /></div><Button type="submit" variant="secondary" disabled={loadingTargets}>Find</Button></form><label className="grid min-w-0 flex-1 gap-1 text-xs font-medium text-muted-foreground">Indexed target<select className="h-10 min-w-0 rounded-md border border-input bg-background px-3 font-mono text-sm text-foreground" value={selectedKey} disabled={loadingTargets || targets.length === 0} onChange={(event) => { const next = targets.find((target) => targetKey(target) === event.target.value); if (next) void loadTarget(next); }}>{targets.length === 0 ? <option>No observed light curves</option> : targets.map((target) => <option key={targetKey(target)} value={targetKey(target)}>TIC {target.tic_id} · Sector {target.sector}</option>)}</select></label></CardContent></Card>
    {error && <div className="flex gap-3 rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive"><CircleAlert className="mt-0.5 size-4 shrink-0" /><span>{error}</span></div>}
    {loadingTargets || loadingCurve ? <div className="flex items-center justify-center gap-2 rounded-lg border border-dashed py-20 text-sm text-muted-foreground"><LoaderCircle className="animate-spin" /> Loading measured samples…</div> : !selected || !detail || !curve || timeSeries.length === 0 ? <Card><CardContent className="flex flex-col items-center justify-center gap-2 py-20 text-center text-sm text-muted-foreground"><Database className="size-6" />No indexed light-curve samples are available yet. The workbench will remain empty until a Gold projection has indexed real observations.</CardContent></Card> : <>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><Metric label="Indexed samples" value={timeSeries.length.toLocaleString()} detail={`TIC ${selected.tic_id} · Sector ${selected.sector}`} /><Metric label="Observed span" value={minTime != null && maxTime != null ? `${fixed(maxTime - minTime, 2)} d` : '—'} detail="Calculated from returned timestamps" /><Metric label="Mean flux" value={fixed(fluxMean, 6)} detail="Calculated from displayed samples" /><Metric label="BLS ephemeris" value={hasPhaseEvidence ? `${fixed(evidence?.bls_period, 4)} d` : 'Not available'} detail={hasPhaseEvidence ? `epoch ${fixed(evidence?.bls_transit_time, 4)}` : 'Phase folding disabled'} /></div>
      <Card className="overflow-hidden">
        <CardHeader className="border-b border-border/60 bg-muted/15 pb-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2 text-base"><Activity className="size-4 text-primary" /> Measured light curve · TIC {selected.tic_id}</CardTitle>
              <CardDescription className="mt-1">Source: ClickHouse lightcurve index projected from checksum-verified Silver LC. No generated points or inferred trend are shown.</CardDescription>
            </div>
            <div className="flex gap-2">
              <Button size="sm" variant={view === 'timeseries' ? 'default' : 'outline'} onClick={() => setView('timeseries')}>Time series</Button>
              <Button size="sm" variant={view === 'phase' ? 'default' : 'outline'} disabled={!hasPhaseEvidence} onClick={() => setView('phase')}><Waves /> Phase fold</Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-4">
          <div className="h-[440px] min-w-0">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart<{ time?: number; phase?: number; flux: number | null }> data={chartSeries} margin={{ top: 12, right: 18, bottom: 8, left: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.55} />
                <XAxis dataKey={view === 'phase' ? 'phase' : 'time'} type="number" domain={['dataMin', 'dataMax']} tickFormatter={(value) => Number(value).toFixed(view === 'phase' ? 2 : 1)} tick={{ fontSize: 11 }} />
                <YAxis dataKey="flux" type="number" domain={['auto', 'auto']} tickFormatter={(value) => Number(value).toFixed(4)} tick={{ fontSize: 11 }} width={74} />
                <Tooltip formatter={(value) => fixed(typeof value === 'number' ? value : null, 7)} labelFormatter={(value) => view === 'phase' ? `Phase ${fixed(Number(value), 5)}` : `Time ${fixed(Number(value), 6)}`} />
                {view === 'phase' && <ReferenceLine x={0} stroke="hsl(var(--primary))" strokeDasharray="5 4" />}
                <Line type="monotone" dataKey="flux" dot={false} stroke="hsl(var(--primary))" strokeWidth={1.5} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-3 flex flex-wrap gap-2 text-xs text-muted-foreground">
            <Badge variant="outline">Pipeline: {detail.target.pipeline_status}</Badge>
            <Badge variant="outline">TOI: {detail.target.matched_toi || detail.target.toi_match_status || 'not matched'}</Badge>
            <Badge variant="outline">Labels: curated cohort only</Badge>
          </div>
        </CardContent>
      </Card>
    </>}
  </div>;
}
