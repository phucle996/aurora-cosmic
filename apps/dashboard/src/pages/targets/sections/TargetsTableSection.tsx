import { useCallback, useEffect, useMemo, useState } from 'react';
import type { FormEvent, JSX } from 'react';
import {
  Activity,
  AlertTriangle,
  CircleAlert,
  ChevronLeft,
  ChevronRight,
  Database,
  Filter,
  Gauge,
  LoaderCircle,
  MapPin,
  RefreshCw,
  Search,
  Telescope,
} from 'lucide-react';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { apiFetch } from '@/lib/api';

type TargetRecord = {
  tic_id: number;
  tess_mag: number;
  ra: number;
  dec: number;
  effective_t: number;
  surface_grav: number;
  radius: number;
  sector: number;
  matched_toi: string;
  disposition: string;
  has_lightcurve: boolean;
  lightcurve_points: number;
  lightcurve_time_span: number;
  has_candidate: boolean;
  candidate_prediction_id: string;
  candidate_score: number;
  candidate_above_threshold: boolean;
  has_anomaly: boolean;
  anomaly_prediction_id: string;
  anomaly_score: number;
  pipeline_status: 'discovered' | 'ingested' | 'scored' | string;
};

type TargetResponse = { count: number; targets: TargetRecord[]; page: { limit: number; offset: number; has_more: boolean } };
type TargetDetailResponse = { target: TargetRecord };
type LightcurveResponse = { tic_id: number; sector: number; time: number[]; flux: number[] };

type TargetFilters = {
  tic_id: string;
  sector: string;
  tmag_min: string;
  tmag_max: string;
  teff_min: string;
  teff_max: string;
  ra_min: string;
  ra_max: string;
  dec_min: string;
  dec_max: string;
  pipeline_status: string;
  has_lightcurve: string;
  has_candidate: string;
  has_anomaly: string;
  sort: string;
};

const emptyFilters: TargetFilters = {
  tic_id: '', sector: '', tmag_min: '', tmag_max: '', teff_min: '', teff_max: '',
  ra_min: '', ra_max: '', dec_min: '', dec_max: '', pipeline_status: '',
  has_lightcurve: '', has_candidate: '', has_anomaly: '', sort: '',
};

function formatNumber(value: number, digits = 2): string {
  return Number.isFinite(value) ? value.toFixed(digits) : '—';
}

function formatInteger(value: number): string {
  return Number.isFinite(value) ? value.toLocaleString() : '—';
}

function statusVariant(status: string): 'default' | 'secondary' | 'outline' {
  if (status === 'scored') return 'default';
  if (status === 'ingested') return 'secondary';
  return 'outline';
}

function buildQuery(filters: TargetFilters, offset: number): string {
  const params = new URLSearchParams({ limit: '100', offset: `${offset}` });
  Object.entries(filters).forEach(([key, value]) => {
    if (value) params.set(key, value);
  });
  return params.toString();
}

export default function TargetsTableSection(): JSX.Element {
  const [filters, setFilters] = useState<TargetFilters>(emptyFilters);
  const [targets, setTargets] = useState<TargetRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [selected, setSelected] = useState<TargetRecord>();
  const [detail, setDetail] = useState<TargetRecord>();
  const [lightcurve, setLightcurve] = useState<LightcurveResponse>();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState<string>();

  const loadTarget = useCallback(async (target: TargetRecord): Promise<void> => {
    setSelected(target);
    setDetailLoading(true);
    setError(undefined);
    try {
      const [targetResponse, curve] = await Promise.all([
        apiFetch<TargetDetailResponse>(`/v1/targets/${target.tic_id}?sector=${target.sector}`),
        apiFetch<LightcurveResponse>(`/v1/lightcurves?tic_id=${target.tic_id}&sector=${target.sector}&limit=1000`),
      ]);
      setDetail(targetResponse.target);
      setLightcurve(curve);
    } catch (loadError) {
      setDetail(undefined);
      setLightcurve(undefined);
      setError(loadError instanceof Error ? loadError.message : 'Unable to load target detail');
    } finally {
      setDetailLoading(false);
    }
  }, []);

  const loadTargets = useCallback(async (nextFilters: TargetFilters, isRefresh = false, nextOffset = 0): Promise<void> => {
    setError(undefined);
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    try {
      const response = await apiFetch<TargetResponse>(`/v1/targets?${buildQuery(nextFilters, nextOffset)}`);
      setTargets(response.targets ?? []);
      setTotal(response.count ?? 0);
      setOffset(nextOffset);
      setHasMore(response.page?.has_more ?? false);
      setSelected(undefined);
      setDetail(undefined);
      setLightcurve(undefined);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Unable to load TESS targets');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void loadTargets(emptyFilters, false, 0);
  }, [loadTargets]);

  const onSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    setOffset(0);
    void loadTargets(filters, false, 0);
  };

  const setFilter = (key: keyof TargetFilters, value: string): void => {
    setFilters((current) => ({ ...current, [key]: value }));
  };

  const clearFilters = (): void => {
    setFilters(emptyFilters);
    setOffset(0);
    void loadTargets(emptyFilters, false, 0);
  };

  const visibleLightcurves = targets.filter((target) => target.has_lightcurve).length;
  const visibleScored = targets.filter((target) => target.has_candidate || target.has_anomaly).length;
  const sectorCount = useMemo(() => new Set(targets.map((target) => target.sector)).size, [targets]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
        <div>
          <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
            <Telescope className="size-4 text-primary" />
            TESS catalog explorer
          </div>
          <h2 className="font-heading text-2xl font-semibold tracking-tight md:text-3xl">TESS Target Discovery</h2>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">Tra cứu TIC theo Sector, độ sáng, nhiệt độ và trạng thái dữ liệu; mở thẳng light curve hoặc kết quả ML.</p>
        </div>
        <Button variant="outline" onClick={() => void loadTargets(filters, true, offset)} disabled={loading || refreshing}>
          <RefreshCw className={refreshing ? 'animate-spin' : ''} />
          Refresh catalog
        </Button>
      </div>

      {error && <div className="flex items-start gap-3 rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive"><CircleAlert className="mt-0.5 size-4 shrink-0" /><div><p className="font-medium">Không tải được target catalog</p><p className="mt-1 opacity-90">{error}</p></div></div>}

      <div className="grid min-w-0 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard icon={Database} label="Matching targets" value={formatInteger(total)} detail="Current filter result" />
        <MetricCard icon={MapPin} label="Sectors" value={sectorCount} detail="Visible page" />
        <MetricCard icon={Activity} label="With light curve" value={visibleLightcurves} detail="Visible page" />
        <MetricCard icon={Gauge} label="ML scored" value={visibleScored} detail="Candidate or anomaly" />
      </div>

      <Card>
        <CardHeader><CardTitle>Discovery filters</CardTitle><CardDescription>Numeric ranges are inclusive. TESS magnitude thấp hơn nghĩa là target sáng hơn.</CardDescription></CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={onSubmit}>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <FilterField label="TIC ID"><Input value={filters.tic_id} onChange={(event) => setFilter('tic_id', event.target.value)} placeholder="882271" inputMode="numeric" /></FilterField>
              <FilterField label="Sector"><Input value={filters.sector} onChange={(event) => setFilter('sector', event.target.value)} placeholder="42" inputMode="numeric" /></FilterField>
              <FilterField label="Tmag min / max"><div className="grid grid-cols-2 gap-2"><Input value={filters.tmag_min} onChange={(event) => setFilter('tmag_min', event.target.value)} placeholder="8" inputMode="decimal" /><Input value={filters.tmag_max} onChange={(event) => setFilter('tmag_max', event.target.value)} placeholder="14" inputMode="decimal" /></div></FilterField>
              <FilterField label="Teff min / max"><div className="grid grid-cols-2 gap-2"><Input value={filters.teff_min} onChange={(event) => setFilter('teff_min', event.target.value)} placeholder="3000" inputMode="numeric" /><Input value={filters.teff_max} onChange={(event) => setFilter('teff_max', event.target.value)} placeholder="7000" inputMode="numeric" /></div></FilterField>
              <FilterField label="RA min / max"><div className="grid grid-cols-2 gap-2"><Input value={filters.ra_min} onChange={(event) => setFilter('ra_min', event.target.value)} placeholder="0" inputMode="decimal" /><Input value={filters.ra_max} onChange={(event) => setFilter('ra_max', event.target.value)} placeholder="360" inputMode="decimal" /></div></FilterField>
              <FilterField label="Dec min / max"><div className="grid grid-cols-2 gap-2"><Input value={filters.dec_min} onChange={(event) => setFilter('dec_min', event.target.value)} placeholder="-90" inputMode="decimal" /><Input value={filters.dec_max} onChange={(event) => setFilter('dec_max', event.target.value)} placeholder="90" inputMode="decimal" /></div></FilterField>
              <FilterField label="Pipeline status"><Select value={filters.pipeline_status || 'all'} onValueChange={(value) => setFilter('pipeline_status', value === 'all' ? '' : value)}><SelectTrigger className="w-full"><SelectValue placeholder="All stages" /></SelectTrigger><SelectContent><SelectItem value="all">All stages</SelectItem><SelectItem value="discovered">Discovered</SelectItem><SelectItem value="ingested">Ingested</SelectItem><SelectItem value="scored">ML scored</SelectItem></SelectContent></Select></FilterField>
              <FilterField label="Sort"><Select value={filters.sort || 'tic'} onValueChange={(value) => setFilter('sort', value === 'tic' ? '' : value)}><SelectTrigger className="w-full"><SelectValue placeholder="TIC / Sector" /></SelectTrigger><SelectContent><SelectItem value="tic">TIC / Sector</SelectItem><SelectItem value="tmag_asc">Brightest first</SelectItem><SelectItem value="tmag_desc">Faintest first</SelectItem><SelectItem value="teff_asc">Coolest first</SelectItem><SelectItem value="teff_desc">Hottest first</SelectItem><SelectItem value="candidate_desc">Candidate score</SelectItem><SelectItem value="anomaly_desc">Anomaly score</SelectItem></SelectContent></Select></FilterField>
            </div>
            <div className="flex flex-wrap items-center gap-2 border-t border-border pt-4">
              <Button type="submit"><Search />Apply filters</Button>
              <Button type="button" variant="outline" onClick={clearFilters}><Filter />Clear</Button>
              <FilterToggle label="Light curve" value={filters.has_lightcurve} onChange={(value) => setFilter('has_lightcurve', value)} />
              <FilterToggle label="Candidate" value={filters.has_candidate} onChange={(value) => setFilter('has_candidate', value)} />
              <FilterToggle label="Anomaly" value={filters.has_anomaly} onChange={(value) => setFilter('has_anomaly', value)} />
            </div>
          </form>
        </CardContent>
      </Card>

      <div className="grid min-w-0 gap-6 2xl:grid-cols-[minmax(0,1.2fr)_minmax(360px,0.8fr)]">
        <Card className="min-w-0 overflow-hidden">
          <CardHeader className="gap-3 md:flex-row md:items-center md:justify-between"><div><CardTitle>Target catalog</CardTitle><CardDescription>{total.toLocaleString()} targets match the active filter.</CardDescription></div><div className="flex items-center gap-2"><Badge variant="secondary">page {targets.length ? Math.floor(offset / 100) + 1 : 0}</Badge><Button variant="outline" size="sm" onClick={() => void loadTargets(filters, false, Math.max(0, offset - 100))} disabled={loading || offset === 0}><ChevronLeft />Prev</Button><Button variant="outline" size="sm" onClick={() => void loadTargets(filters, false, offset + 100)} disabled={loading || !hasMore}>Next<ChevronRight /></Button></div></CardHeader>
          <CardContent>
            {loading ? <LoadingState /> : targets.length === 0 ? <EmptyState label="Không có target khớp bộ lọc hiện tại." /> : <div className="overflow-x-auto"><Table className="min-w-[980px]"><TableHeader><TableRow><TableHead>TIC / Sector</TableHead><TableHead>Tmag</TableHead><TableHead>Teff</TableHead><TableHead>RA / Dec</TableHead><TableHead>Data</TableHead><TableHead>ML</TableHead><TableHead>Status</TableHead></TableRow></TableHeader><TableBody>{targets.map((target) => { const key = `${target.tic_id}-${target.sector}`; const selectedKey = selected ? `${selected.tic_id}-${selected.sector}` : ''; return <TableRow key={key} data-state={key === selectedKey ? 'selected' : undefined} className="cursor-pointer" onClick={() => void loadTarget(target)}><TableCell><p className="font-mono font-medium text-primary">TIC {target.tic_id}</p><p className="mt-1 text-xs text-muted-foreground">Sector {target.sector}</p></TableCell><TableCell className="font-mono">{formatNumber(target.tess_mag, 2)}</TableCell><TableCell className="font-mono">{formatNumber(target.effective_t, 0)} K</TableCell><TableCell className="font-mono text-xs">{formatNumber(target.ra, 3)}°<br />{formatNumber(target.dec, 3)}°</TableCell><TableCell><Badge variant={target.has_lightcurve ? 'secondary' : 'outline'}>{target.has_lightcurve ? `${formatInteger(target.lightcurve_points)} pts` : 'no LC'}</Badge></TableCell><TableCell><div className="space-y-1">{target.has_candidate && <p className="font-mono text-xs text-primary">C {formatNumber(target.candidate_score, 3)}</p>}{target.has_anomaly && <p className="font-mono text-xs text-destructive">A {formatNumber(target.anomaly_score, 3)}</p>}{!target.has_candidate && !target.has_anomaly && <span className="text-xs text-muted-foreground">—</span>}</div></TableCell><TableCell><Badge variant={statusVariant(target.pipeline_status)}>{target.pipeline_status}</Badge></TableCell></TableRow>; })}</TableBody></Table></div>}
          </CardContent>
        </Card>

        <TargetDetail target={detail} lightcurve={lightcurve} loading={detailLoading} />
      </div>
    </div>
  );
}

function TargetDetail({ target, lightcurve, loading }: { target?: TargetRecord; lightcurve?: LightcurveResponse; loading: boolean }): JSX.Element {
  const chartData = useMemo(() => lightcurve?.time.map((time, index) => ({ time, flux: lightcurve.flux[index] ?? 0 })) ?? [], [lightcurve]);
  return (
    <Card className="min-w-0 overflow-hidden">
      <CardHeader>
        <CardTitle>Target detail</CardTitle>
        <CardDescription>Catalog context, data coverage and downstream ML signals.</CardDescription>
      </CardHeader>
      <CardContent>
        {loading ? <LoadingState /> : !target ? <EmptyState label="Chọn một target để mở detail." /> : (
          <div className="space-y-4">
            <div className="rounded-lg border border-border bg-muted/30 p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-mono font-semibold text-primary">TIC {target.tic_id}</p>
                  <p className="mt-1 text-xs text-muted-foreground">Sector {target.sector} · {target.disposition || 'No catalog disposition'}</p>
                </div>
                <Badge variant={statusVariant(target.pipeline_status)}>{target.pipeline_status}</Badge>
              </div>
              <Separator className="my-3" />
              <dl className="grid grid-cols-2 gap-3 text-xs">
                <InfoItem label="TESS magnitude" value={formatNumber(target.tess_mag)} />
                <InfoItem label="Effective temperature" value={`${formatNumber(target.effective_t, 0)} K`} />
                <InfoItem label="Coordinates" value={`${formatNumber(target.ra, 3)}°, ${formatNumber(target.dec, 3)}°`} />
                <InfoItem label="Radius" value={`${formatNumber(target.radius)} R☉`} />
                <InfoItem label="Surface gravity" value={formatNumber(target.surface_grav)} />
                <InfoItem label="TOI" value={target.matched_toi || '—'} />
              </dl>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <EvidenceChip icon={Database} label="Light curve" value={target.has_lightcurve ? `${formatInteger(target.lightcurve_points)} points · ${formatNumber(target.lightcurve_time_span, 1)} d` : 'not ingested'} />
              <EvidenceChip icon={Gauge} label="Candidate" value={target.has_candidate ? formatNumber(target.candidate_score, 4) : 'not scored'} />
              <EvidenceChip icon={AlertTriangle} label="Anomaly" value={target.has_anomaly ? formatNumber(target.anomaly_score, 4) : 'not scored'} />
              <EvidenceChip icon={Telescope} label="TOI match" value={target.matched_toi || 'unmatched'} />
            </div>
            <div className="flex flex-wrap gap-2 text-xs">
              <a className="text-primary underline-offset-4 hover:underline" href={`/candidates${target.has_candidate ? `?prediction_id=${encodeURIComponent(target.candidate_prediction_id)}` : ''}`}>Open candidate review</a>
              <a className="text-primary underline-offset-4 hover:underline" href={`/anomalies${target.has_anomaly ? `?prediction_id=${encodeURIComponent(target.anomaly_prediction_id)}` : ''}`}>Open anomaly review</a>
            </div>
            {chartData.length > 0 ? (
              <div>
                <div className="mb-2 flex items-center justify-between"><p className="text-sm font-medium">Raw light curve</p><span className="text-xs text-muted-foreground">ClickHouse query index</span></div>
                <div className="h-56">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 8 }}>
                      <CartesianGrid vertical={false} strokeDasharray="3 3" />
                      <XAxis dataKey="time" tickLine={false} axisLine={false} tickFormatter={(value: number) => value.toFixed(1)} />
                      <YAxis width={52} tickLine={false} axisLine={false} tickFormatter={(value: number) => value.toFixed(3)} />
                      <Tooltip labelFormatter={(value) => `time ${Number(value).toFixed(4)}`} formatter={(value: number) => [value.toFixed(6), 'flux']} />
                      <Line type="monotone" dataKey="flux" stroke="var(--primary)" dot={false} strokeWidth={1.5} isAnimationActive={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>
            ) : <EmptyState label="Target chưa có light curve trong query index." />}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function FilterField({ label, children }: { label: string; children: JSX.Element }): JSX.Element { return <label className="space-y-1.5"><span className="text-xs font-medium text-muted-foreground">{label}</span>{children}</label>; }
function FilterToggle({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }): JSX.Element { const next = value === '' ? 'true' : value === 'true' ? 'false' : ''; return <Button type="button" variant={value === 'true' ? 'default' : 'outline'} size="sm" onClick={() => onChange(next)}>{label}{value === 'false' ? ': no' : value === 'true' ? ': yes' : ''}</Button>; }
function EvidenceChip({ icon: Icon, label, value }: { icon: typeof Database; label: string; value: string }): JSX.Element { return <div className="rounded-md border border-border bg-muted/20 p-3"><div className="flex items-center gap-2 text-xs text-muted-foreground"><Icon className="size-3.5 text-primary" />{label}</div><p className="mt-1 truncate text-sm font-medium">{value}</p></div>; }
function MetricCard({ icon: Icon, label, value, detail }: { icon: typeof Database; label: string; value: string | number; detail: string }): JSX.Element { return <Card><CardContent className="flex items-center gap-3 p-4"><div className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary"><Icon className="size-5" /></div><div className="min-w-0"><p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p><p className="mt-0.5 truncate text-xl font-semibold">{value}</p><p className="truncate text-xs text-muted-foreground">{detail}</p></div></CardContent></Card>; }
function InfoItem({ label, value }: { label: string; value: string }): JSX.Element { return <div><dt className="text-muted-foreground">{label}</dt><dd className="mt-0.5 truncate font-medium text-foreground">{value}</dd></div>; }
function LoadingState(): JSX.Element { return <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground"><LoaderCircle className="animate-spin" />Loading target data…</div>; }
function EmptyState({ label }: { label: string }): JSX.Element { return <div className="flex flex-col items-center justify-center gap-2 py-12 text-center text-sm text-muted-foreground"><Database className="size-6 opacity-60" /><p>{label}</p></div>; }
