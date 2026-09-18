import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent, JSX, ReactNode } from 'react';
import {
  Activity,
  ArrowUpRight,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Database,
  Filter,
  Gauge,
  LoaderCircle,
  MapPin,
  RefreshCw,
  RotateCcw,
  Search,
  Sparkles,
  Telescope,
  Thermometer,
  Waves,
} from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { apiFetch } from '@/lib/api';
import type { TargetRecord } from '@/lib/analytics-types';

type TargetResponse = {
  count: number;
  targets: TargetRecord[];
  page: { limit: number; offset: number; has_more: boolean };
};

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
  sort: string;
};

type LoadMode = 'initial' | 'query' | 'refresh';

const PAGE_SIZE = 100;
const emptyFilters: TargetFilters = {
  tic_id: '',
  sector: '',
  tmag_min: '',
  tmag_max: '',
  teff_min: '',
  teff_max: '',
  ra_min: '',
  ra_max: '',
  dec_min: '',
  dec_max: '',
  pipeline_status: '',
  has_lightcurve: '',
  has_candidate: '',
  sort: '',
};

const filterLabels: Record<keyof TargetFilters, string> = {
  tic_id: 'TIC',
  sector: 'Sector',
  tmag_min: 'Tmag ≥',
  tmag_max: 'Tmag ≤',
  teff_min: 'Teff ≥',
  teff_max: 'Teff ≤',
  ra_min: 'RA ≥',
  ra_max: 'RA ≤',
  dec_min: 'Dec ≥',
  dec_max: 'Dec ≤',
  pipeline_status: 'State',
  has_lightcurve: 'Light curve',
  has_candidate: 'Candidate',
  sort: 'Sort',
};

function formatNumber(value: number | null | undefined, digits = 2): string {
  return value != null && Number.isFinite(value) ? value.toFixed(digits) : '—';
}

function formatInteger(value: number | null | undefined): string {
  return value != null && Number.isFinite(value) ? value.toLocaleString() : '—';
}

function formatPercent(value: number): string {
  return `${Math.max(0, Math.min(100, value)).toFixed(1)}%`;
}

function buildQuery(filters: TargetFilters, offset: number): string {
  const params = new URLSearchParams({ limit: `${PAGE_SIZE}`, offset: `${offset}` });
  Object.entries(filters).forEach(([key, value]) => {
    if (value) params.set(key, value);
  });
  return params.toString();
}

function targetUrl(target: TargetRecord): string {
  const snapshot = target.gold_snapshot_id
    ? `&snapshot_id=${encodeURIComponent(target.gold_snapshot_id)}`
    : '';
  return `/research-factory/workbench/${target.tic_id}?sector=${target.sector}${snapshot}`;
}

function targetKey(target: Pick<TargetRecord, 'tic_id' | 'sector' | 'gold_snapshot_id'>): string {
  return `${target.tic_id}:${target.sector}:${target.gold_snapshot_id}`;
}

function filterDisplayValue(key: keyof TargetFilters, value: string): string {
  if (key === 'has_lightcurve' || key === 'has_candidate') {
    return value === 'true' ? 'available' : 'missing';
  }
  if (key === 'sort') {
    return {
      tmag_asc: 'brightest first',
      tmag_desc: 'faintest first',
      teff_asc: 'coolest first',
      teff_desc: 'hottest first',
      candidate_desc: 'candidate score',
    }[value] ?? value;
  }
  return value;
}

export default function TargetsTableSection(): JSX.Element {
  const navigate = useNavigate();
  const requestSequence = useRef(0);
  const [draftFilters, setDraftFilters] = useState<TargetFilters>(emptyFilters);
  const [appliedFilters, setAppliedFilters] = useState<TargetFilters>(emptyFilters);
  const [targets, setTargets] = useState<TargetRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(false);
  const [error, setError] = useState<string>();

  const loadTargets = useCallback(
    async (nextFilters: TargetFilters, nextOffset: number, mode: LoadMode): Promise<void> => {
      const requestId = ++requestSequence.current;
      setError(undefined);
      if (mode === 'initial') setLoading(true);
      else setUpdating(true);

      try {
        const response = await apiFetch<TargetResponse>(
          `/v1/targets?${buildQuery(nextFilters, nextOffset)}`
        );
        if (requestId !== requestSequence.current) return;
        setTargets(response.targets ?? []);
        setTotal(response.count ?? 0);
        setOffset(nextOffset);
        setHasMore(response.page?.has_more ?? false);
        setAppliedFilters(nextFilters);
      } catch (loadError) {
        if (requestId !== requestSequence.current) return;
        setError(loadError instanceof Error ? loadError.message : 'Unable to load TESS targets');
      } finally {
        if (requestId === requestSequence.current) {
          setLoading(false);
          setUpdating(false);
        }
      }
    },
    []
  );

  useEffect(() => {
    void loadTargets(emptyFilters, 0, 'initial');
  }, [loadTargets]);

  const onSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    void loadTargets(draftFilters, 0, 'query');
  };
  const setFilter = (key: keyof TargetFilters, value: string): void => {
    setDraftFilters((current) => ({ ...current, [key]: value }));
  };
  const clearFilters = (): void => {
    setDraftFilters(emptyFilters);
    void loadTargets(emptyFilters, 0, 'query');
  };

  const activeFilters = useMemo(
    () =>
      (Object.entries(appliedFilters) as Array<[keyof TargetFilters, string]>).filter(
        ([, value]) => value !== ''
      ),
    [appliedFilters]
  );
  const visibleLightcurves = targets.filter((target) => target.has_lightcurve).length;
  const visibleCandidates = targets.filter((target) => target.has_candidate).length;
  const sectorCount = useMemo(() => new Set(targets.map((target) => target.sector)).size, [targets]);
  const catalogContext = targets.filter((target) => target.tic_context_available);
  const tessMagnitudes = catalogContext.map((target) => target.tess_mag).filter(Number.isFinite);
  const temperatures = catalogContext.map((target) => target.effective_t).filter(Number.isFinite);
  const firstResult = total === 0 ? 0 : offset + 1;
  const lastResult = Math.min(offset + targets.length, total);

  return (
    <div className="min-w-0 space-y-4">
      <header className="flex flex-col gap-4 border border-border/80 bg-card p-4 sm:p-5 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          <p className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.16em] text-primary">
            <Telescope className="size-4" /> Research catalog / observed target index
          </p>
          <h1 className="mt-2 font-heading text-2xl font-semibold tracking-tight md:text-3xl">
            TESS Target Discovery
          </h1>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-muted-foreground">
            Xác định mẫu nghiên cứu từ target đã được lập chỉ mục, sau đó mở light curve, bằng
            chứng transit và ngữ cảnh vật lý của từng TIC để phân tích.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className="hidden items-center gap-2 border border-border/70 bg-muted/20 px-3 py-2 font-mono text-[10px] uppercase text-muted-foreground sm:flex">
            <span
              className={`size-1.5 rounded-full ${
                updating ? 'animate-pulse bg-amber-500' : 'bg-emerald-500'
              }`}
            />
            {updating ? 'querying index' : 'catalog ready'}
          </span>
          <Button
            variant="outline"
            onClick={() => void loadTargets(appliedFilters, offset, 'refresh')}
            disabled={loading || updating}
          >
            <RefreshCw className={updating ? 'animate-spin' : ''} />
            Refresh
          </Button>
        </div>
      </header>

      {error && (
        <div className="flex items-start gap-3 border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          <CircleAlert className="mt-0.5 size-4 shrink-0" />
          <div className="min-w-0">
            <p className="font-medium">Không tải được target catalog</p>
            <p className="mt-0.5 break-words opacity-90">{error}</p>
          </div>
        </div>
      )}

      <section className="grid gap-px border border-border/80 bg-border/80 sm:grid-cols-2 xl:grid-cols-4">
        <ConsoleMetric
          icon={<Database className="size-4" />}
          label="Matching targets"
          value={formatInteger(total)}
          detail="Toàn bộ kết quả của query"
        />
        <ConsoleMetric
          icon={<MapPin className="size-4" />}
          label="Sector coverage"
          value={formatInteger(sectorCount)}
          detail="Sector trong trang đang xem"
        />
        <ConsoleMetric
          icon={<Waves className="size-4" />}
          label="Measured light curves"
          value={`${visibleLightcurves}/${targets.length}`}
          detail="Target có cadence đã lập chỉ mục"
        />
        <ConsoleMetric
          icon={<Sparkles className="size-4" />}
          label="Candidate evidence"
          value={`${visibleCandidates}/${targets.length}`}
          detail="Target có kết quả candidate vetting"
        />
      </section>

      <section className="border border-border/80 bg-card">
        <div className="flex flex-col gap-2 border-b border-border/70 bg-muted/15 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.14em] text-primary">
              <Filter className="size-3.5" /> Query specification
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Khoảng số là inclusive; Tmag càng nhỏ thì nguồn càng sáng.
            </p>
          </div>
          <span className="font-mono text-[10px] uppercase text-muted-foreground">
            {activeFilters.length} active constraints
          </span>
        </div>

        <form onSubmit={onSubmit}>
          <div className="grid gap-px bg-border/60 lg:grid-cols-2 2xl:grid-cols-4">
            <QueryGroup index="01" title="Identity">
              <div className="grid grid-cols-2 gap-2">
                <FilterField label="TIC ID">
                  <Input
                    value={draftFilters.tic_id}
                    onChange={(event) => setFilter('tic_id', event.target.value)}
                    placeholder="100014454"
                    inputMode="numeric"
                    className="font-mono"
                  />
                </FilterField>
                <FilterField label="Sector">
                  <Input
                    value={draftFilters.sector}
                    onChange={(event) => setFilter('sector', event.target.value)}
                    placeholder="2"
                    inputMode="numeric"
                    className="font-mono"
                  />
                </FilterField>
              </div>
              <FilterField label="Pipeline state">
                <Select
                  value={draftFilters.pipeline_status || 'all'}
                  onValueChange={(value) =>
                    setFilter('pipeline_status', value === 'all' ? '' : value)
                  }
                >
                  <SelectTrigger className="w-full font-mono text-xs">
                    <SelectValue placeholder="All states" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All states</SelectItem>
                    <SelectItem value="discovered">Discovered</SelectItem>
                    <SelectItem value="ingested">Ingested</SelectItem>
                    <SelectItem value="scored">ML scored</SelectItem>
                  </SelectContent>
                </Select>
              </FilterField>
            </QueryGroup>

            <QueryGroup index="02" title="Stellar parameter space">
              <RangeField
                label="TESS magnitude"
                min={draftFilters.tmag_min}
                max={draftFilters.tmag_max}
                minPlaceholder="8"
                maxPlaceholder="14"
                onMin={(value) => setFilter('tmag_min', value)}
                onMax={(value) => setFilter('tmag_max', value)}
              />
              <RangeField
                label="Effective temperature · K"
                min={draftFilters.teff_min}
                max={draftFilters.teff_max}
                minPlaceholder="3000"
                maxPlaceholder="7000"
                onMin={(value) => setFilter('teff_min', value)}
                onMax={(value) => setFilter('teff_max', value)}
              />
            </QueryGroup>

            <QueryGroup index="03" title="Sky window">
              <RangeField
                label="Right ascension · deg"
                min={draftFilters.ra_min}
                max={draftFilters.ra_max}
                minPlaceholder="0"
                maxPlaceholder="360"
                onMin={(value) => setFilter('ra_min', value)}
                onMax={(value) => setFilter('ra_max', value)}
              />
              <RangeField
                label="Declination · deg"
                min={draftFilters.dec_min}
                max={draftFilters.dec_max}
                minPlaceholder="-90"
                maxPlaceholder="90"
                onMin={(value) => setFilter('dec_min', value)}
                onMax={(value) => setFilter('dec_max', value)}
              />
            </QueryGroup>

            <QueryGroup index="04" title="Evidence & order">
              <div className="grid grid-cols-2 gap-2">
                <FilterField label="Light curve">
                  <EvidenceSelect
                    value={draftFilters.has_lightcurve}
                    availableLabel="Available"
                    missingLabel="Missing"
                    onChange={(value) => setFilter('has_lightcurve', value)}
                  />
                </FilterField>
                <FilterField label="Candidate">
                  <EvidenceSelect
                    value={draftFilters.has_candidate}
                    availableLabel="Scored"
                    missingLabel="Unscored"
                    onChange={(value) => setFilter('has_candidate', value)}
                  />
                </FilterField>
              </div>
              <FilterField label="Result order">
                <Select
                  value={draftFilters.sort || 'tic'}
                  onValueChange={(value) => setFilter('sort', value === 'tic' ? '' : value)}
                >
                  <SelectTrigger className="w-full font-mono text-xs">
                    <SelectValue placeholder="TIC / Sector" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="tic">TIC / Sector</SelectItem>
                    <SelectItem value="tmag_asc">Brightest first</SelectItem>
                    <SelectItem value="tmag_desc">Faintest first</SelectItem>
                    <SelectItem value="teff_asc">Coolest first</SelectItem>
                    <SelectItem value="teff_desc">Hottest first</SelectItem>
                    <SelectItem value="candidate_desc">Candidate score</SelectItem>
                  </SelectContent>
                </Select>
              </FilterField>
            </QueryGroup>
          </div>

          <div className="flex flex-col gap-3 border-t border-border/70 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-h-7 min-w-0 flex-wrap items-center gap-1.5">
              {activeFilters.length === 0 ? (
                <span className="font-mono text-[10px] uppercase text-muted-foreground">
                  Full indexed catalog
                </span>
              ) : (
                activeFilters.map(([key, value]) => (
                  <span
                    key={key}
                    className="border border-primary/25 bg-primary/5 px-2 py-1 font-mono text-[10px] text-primary"
                  >
                    {filterLabels[key]} {filterDisplayValue(key, value)}
                  </span>
                ))
              )}
            </div>
            <div className="flex shrink-0 gap-2">
              <Button type="button" variant="outline" onClick={clearFilters} disabled={updating}>
                <RotateCcw /> Reset
              </Button>
              <Button type="submit" disabled={updating}>
                {updating ? <LoaderCircle className="animate-spin" /> : <Search />}
                Run query
              </Button>
            </div>
          </div>
        </form>
      </section>

      {!loading && targets.length > 0 && (
        <section className="grid gap-px border border-border/80 bg-border/80 lg:grid-cols-[1fr_1fr_1.15fr]">
          <RangeSummary
            icon={<Gauge className="size-4" />}
            label="Tmag page range"
            values={tessMagnitudes}
            digits={2}
            unit="mag"
          />
          <RangeSummary
            icon={<Thermometer className="size-4" />}
            label="Teff page range"
            values={temperatures}
            digits={0}
            unit="K"
          />
          <div className="bg-card p-3.5">
            <p className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
              <Activity className="size-4 text-primary" /> Visible evidence coverage
            </p>
            <div className="mt-3 space-y-2.5">
              <CoverageBar label="Light curve" count={visibleLightcurves} total={targets.length} />
              <CoverageBar label="Candidate score" count={visibleCandidates} total={targets.length} />
            </div>
          </div>
        </section>
      )}

      <section className="relative min-w-0 overflow-hidden border border-border/80 bg-card">
        {updating && targets.length > 0 && (
          <div className="absolute inset-x-0 top-0 z-20 h-0.5 overflow-hidden bg-primary/15">
            <div className="h-full w-1/3 animate-pulse bg-primary" />
          </div>
        )}
        <div className="flex flex-col gap-3 border-b border-border/70 bg-muted/15 px-4 py-3 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-primary">
              Observation index / query result
            </p>
            <h2 className="mt-1 text-base font-semibold">Target catalog</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Showing {formatInteger(firstResult)}–{formatInteger(lastResult)} of{' '}
              {formatInteger(total)} matching targets.
            </p>
          </div>
          <Pagination
            offset={offset}
            count={targets.length}
            total={total}
            hasMore={hasMore}
            disabled={loading || updating}
            onPrevious={() =>
              void loadTargets(appliedFilters, Math.max(0, offset - PAGE_SIZE), 'query')
            }
            onNext={() => void loadTargets(appliedFilters, offset + PAGE_SIZE, 'query')}
          />
        </div>

        {loading ? (
          <LoadingState />
        ) : targets.length === 0 ? (
          <EmptyState label="Không có target khớp query hiện tại." />
        ) : (
          <>
            <div className="hidden overflow-x-auto lg:block">
              <table className="w-full min-w-[1120px] border-collapse text-left">
                <thead className="bg-muted/25 font-mono text-[9px] uppercase tracking-[0.12em] text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3 font-medium">Target identity</th>
                    <th className="px-4 py-3 font-medium">Stellar context</th>
                    <th className="px-4 py-3 font-medium">Sky position</th>
                    <th className="px-4 py-3 font-medium">Observed series</th>
                    <th className="px-4 py-3 font-medium">Transit context</th>
                    <th className="px-4 py-3 font-medium">Data state</th>
                    <th className="px-4 py-3 text-right font-medium">Analysis</th>
                  </tr>
                </thead>
                <tbody className={updating ? 'opacity-60' : ''}>
                  {targets.map((target) => (
                    <TargetTableRow
                      key={targetKey(target)}
                      target={target}
                      onOpen={() => navigate(targetUrl(target))}
                    />
                  ))}
                </tbody>
              </table>
            </div>
            <div className={`divide-y divide-border/70 lg:hidden ${updating ? 'opacity-60' : ''}`}>
              {targets.map((target) => (
                <TargetCard key={targetKey(target)} target={target} />
              ))}
            </div>
          </>
        )}

        {!loading && targets.length > 0 && (
          <footer className="flex flex-col gap-3 border-t border-border/70 bg-muted/10 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <span className="font-mono text-[10px] uppercase text-muted-foreground">
              Page {Math.floor(offset / PAGE_SIZE) + 1} · {targets.length} records loaded
            </span>
            <Pagination
              offset={offset}
              count={targets.length}
              total={total}
              hasMore={hasMore}
              disabled={loading || updating}
              onPrevious={() =>
                void loadTargets(appliedFilters, Math.max(0, offset - PAGE_SIZE), 'query')
              }
              onNext={() => void loadTargets(appliedFilters, offset + PAGE_SIZE, 'query')}
            />
          </footer>
        )}
      </section>
    </div>
  );
}

function ConsoleMetric({
  icon,
  label,
  value,
  detail,
}: {
  icon: JSX.Element;
  label: string;
  value: string;
  detail: string;
}): JSX.Element {
  return (
    <div className="min-w-0 bg-card p-3.5">
      <p className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
        <span className="text-primary">{icon}</span> {label}
      </p>
      <p className="mt-2 font-mono text-xl font-semibold tabular-nums">{value}</p>
      <p className="mt-1 truncate text-[11px] text-muted-foreground">{detail}</p>
    </div>
  );
}

function QueryGroup({
  index,
  title,
  children,
}: {
  index: string;
  title: string;
  children: ReactNode;
}): JSX.Element {
  return (
    <fieldset className="min-w-0 space-y-3 bg-card p-4">
      <legend className="sr-only">{title}</legend>
      <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
        <span className="text-primary">{index}</span> / {title}
      </p>
      {children}
    </fieldset>
  );
}

function FilterField({ label, children }: { label: string; children: JSX.Element }): JSX.Element {
  return (
    <label className="block min-w-0 space-y-1.5">
      <span className="font-mono text-[10px] uppercase text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

function RangeField({
  label,
  min,
  max,
  minPlaceholder,
  maxPlaceholder,
  onMin,
  onMax,
}: {
  label: string;
  min: string;
  max: string;
  minPlaceholder: string;
  maxPlaceholder: string;
  onMin: (value: string) => void;
  onMax: (value: string) => void;
}): JSX.Element {
  return (
    <FilterField label={label}>
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
        <Input
          value={min}
          onChange={(event) => onMin(event.target.value)}
          placeholder={minPlaceholder}
          inputMode="decimal"
          aria-label={`${label} minimum`}
          className="min-w-0 font-mono"
        />
        <span className="text-xs text-muted-foreground">→</span>
        <Input
          value={max}
          onChange={(event) => onMax(event.target.value)}
          placeholder={maxPlaceholder}
          inputMode="decimal"
          aria-label={`${label} maximum`}
          className="min-w-0 font-mono"
        />
      </div>
    </FilterField>
  );
}

function EvidenceSelect({
  value,
  availableLabel,
  missingLabel,
  onChange,
}: {
  value: string;
  availableLabel: string;
  missingLabel: string;
  onChange: (value: string) => void;
}): JSX.Element {
  return (
    <Select value={value || 'all'} onValueChange={(next) => onChange(next === 'all' ? '' : next)}>
      <SelectTrigger className="w-full font-mono text-xs">
        <SelectValue placeholder="All" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all">All</SelectItem>
        <SelectItem value="true">{availableLabel}</SelectItem>
        <SelectItem value="false">{missingLabel}</SelectItem>
      </SelectContent>
    </Select>
  );
}

function RangeSummary({
  icon,
  label,
  values,
  digits,
  unit,
}: {
  icon: JSX.Element;
  label: string;
  values: number[];
  digits: number;
  unit: string;
}): JSX.Element {
  const sorted = [...values].sort((left, right) => left - right);
  const minimum = sorted[0];
  const maximum = sorted.at(-1);
  const middle = sorted.length
    ? sorted.length % 2 === 0
      ? (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
      : sorted[Math.floor(sorted.length / 2)]
    : undefined;
  const medianPosition =
    minimum != null && maximum != null && middle != null && maximum > minimum
      ? ((middle - minimum) / (maximum - minimum)) * 100
      : 50;

  return (
    <div className="min-w-0 bg-card p-3.5">
      <p className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
        <span className="text-primary">{icon}</span> {label}
      </p>
      {sorted.length === 0 ? (
        <p className="mt-4 text-xs text-muted-foreground">No catalog values on this page.</p>
      ) : (
        <>
          <div className="relative mt-4 h-1 bg-primary/20" aria-hidden="true">
            <span className="absolute inset-y-0 left-0 w-px bg-primary" />
            <span
              className="absolute top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 border-2 border-card bg-primary"
              style={{ left: `${medianPosition}%` }}
            />
            <span className="absolute inset-y-0 right-0 w-px bg-primary" />
          </div>
          <div className="mt-2 grid grid-cols-3 gap-2 font-mono text-[10px] tabular-nums">
            <RangeValue label="min" value={`${formatNumber(minimum, digits)} ${unit}`} />
            <RangeValue
              label="median"
              value={`${formatNumber(middle, digits)} ${unit}`}
              align="center"
            />
            <RangeValue
              label="max"
              value={`${formatNumber(maximum, digits)} ${unit}`}
              align="right"
            />
          </div>
        </>
      )}
    </div>
  );
}

function RangeValue({
  label,
  value,
  align = 'left',
}: {
  label: string;
  value: string;
  align?: 'left' | 'center' | 'right';
}): JSX.Element {
  return (
    <div className={align === 'center' ? 'text-center' : align === 'right' ? 'text-right' : ''}>
      <p className="uppercase text-muted-foreground">{label}</p>
      <p className="mt-0.5 truncate font-semibold text-foreground">{value}</p>
    </div>
  );
}

function CoverageBar({ label, count, total }: { label: string; count: number; total: number }): JSX.Element {
  const percent = total > 0 ? (count / total) * 100 : 0;
  return (
    <div>
      <div className="mb-1 flex items-center justify-between gap-3 font-mono text-[10px]">
        <span>{label}</span>
        <span className="tabular-nums text-muted-foreground">
          {count}/{total} · {formatPercent(percent)}
        </span>
      </div>
      <div className="h-1.5 overflow-hidden bg-muted">
        <div className="h-full bg-primary transition-[width]" style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}

function TargetTableRow({ target, onOpen }: { target: TargetRecord; onOpen: () => void }): JSX.Element {
  const url = targetUrl(target);
  return (
    <tr
      className="cursor-pointer border-t border-border/60 transition-colors hover:bg-primary/[0.045] focus-within:bg-primary/[0.045]"
      onClick={onOpen}
    >
      <td className="px-4 py-3 align-top">
        <Link
          to={url}
          onClick={(event) => event.stopPropagation()}
          className="font-mono text-sm font-semibold text-primary underline-offset-4 hover:underline"
        >
          TIC {target.tic_id}
        </Link>
        <p className="mt-1 font-mono text-[10px] text-muted-foreground">
          SECTOR {target.sector}
          {target.gold_snapshot_id ? ` · ${target.gold_snapshot_id.replace('gold-v1-', '')}` : ''}
        </p>
      </td>
      <td className="px-4 py-3 align-top">
        {target.tic_context_available ? (
          <div className="space-y-1 font-mono text-xs tabular-nums">
            <p>{formatNumber(target.tess_mag, 2)} Tmag</p>
            <p className="text-muted-foreground">
              {formatNumber(target.effective_t, 0)} K · {formatNumber(target.radius, 2)} R☉
            </p>
          </div>
        ) : (
          <MissingEvidence label="TIC context missing" />
        )}
      </td>
      <td className="px-4 py-3 align-top font-mono text-xs tabular-nums">
        {target.tic_context_available ? (
          <>
            <p>RA {formatNumber(target.ra, 3)}°</p>
            <p className="mt-1 text-muted-foreground">DEC {formatNumber(target.dec, 3)}°</p>
          </>
        ) : (
          '—'
        )}
      </td>
      <td className="px-4 py-3 align-top">
        {target.has_lightcurve ? (
          <div className="space-y-1 font-mono text-xs tabular-nums">
            <p className="flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400">
              <CheckCircle2 className="size-3.5" /> {formatInteger(target.lightcurve_points)} cadences
            </p>
            <p className="text-muted-foreground">
              {formatNumber(target.lightcurve_time_span, 2)} d span
            </p>
          </div>
        ) : (
          <MissingEvidence label="No light curve" />
        )}
      </td>
      <td className="px-4 py-3 align-top">
        <TransitEvidence target={target} />
      </td>
      <td className="px-4 py-3 align-top">
        <PipelineBadge status={target.pipeline_status} />
      </td>
      <td className="px-4 py-3 text-right align-top">
        <Button asChild variant="ghost" size="sm" onClick={(event) => event.stopPropagation()}>
          <Link to={url}>
            Inspect <ArrowUpRight />
          </Link>
        </Button>
      </td>
    </tr>
  );
}

function TargetCard({ target }: { target: TargetRecord }): JSX.Element {
  const url = targetUrl(target);
  return (
    <article className="p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <Link to={url} className="font-mono text-sm font-semibold text-primary">
            TIC {target.tic_id}
          </Link>
          <p className="mt-1 font-mono text-[10px] uppercase text-muted-foreground">
            Sector {target.sector}
            {target.matched_toi ? ` · ${target.matched_toi}` : ''}
          </p>
        </div>
        <PipelineBadge status={target.pipeline_status} />
      </div>
      <div className="mt-3 grid grid-cols-2 gap-px bg-border/70">
        <MobileFact
          label="Stellar context"
          value={
            target.tic_context_available
              ? `${formatNumber(target.tess_mag, 2)} Tmag · ${formatNumber(target.effective_t, 0)} K`
              : 'Unavailable'
          }
        />
        <MobileFact
          label="Coordinates"
          value={
            target.tic_context_available
              ? `${formatNumber(target.ra, 2)}° / ${formatNumber(target.dec, 2)}°`
              : 'Unavailable'
          }
        />
        <MobileFact
          label="Observed series"
          value={
            target.has_lightcurve
              ? `${formatInteger(target.lightcurve_points)} pts · ${formatNumber(target.lightcurve_time_span, 1)} d`
              : 'No light curve'
          }
        />
        <MobileFact
          label="Candidate"
          value={target.has_candidate ? formatPercent(target.candidate_score * 100) : 'Not scored'}
        />
      </div>
      <div className="mt-3 flex items-center justify-between gap-3">
        <span className="truncate font-mono text-[10px] text-muted-foreground">
          {target.matched_toi || target.toi_match_status || 'No TOI association'}
        </span>
        <Button asChild size="sm">
          <Link to={url}>
            Open analysis <ArrowUpRight />
          </Link>
        </Button>
      </div>
    </article>
  );
}

function MobileFact({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="min-w-0 bg-card p-2.5">
      <p className="font-mono text-[9px] uppercase text-muted-foreground">{label}</p>
      <p className="mt-1 truncate font-mono text-xs tabular-nums">{value}</p>
    </div>
  );
}

function TransitEvidence({ target }: { target: TargetRecord }): JSX.Element {
  if (target.has_candidate) {
    return (
      <div className="space-y-1">
        <p
          className={`font-mono text-xs font-semibold tabular-nums ${
            target.candidate_above_threshold ? 'text-primary' : ''
          }`}
        >
          {formatPercent(target.candidate_score * 100)} score
        </p>
        <p className="font-mono text-[10px] uppercase text-muted-foreground">
          {target.candidate_above_threshold ? 'above threshold' : 'below threshold'}
        </p>
      </div>
    );
  }
  if (target.matched_toi) {
    return (
      <div>
        <p className="font-mono text-xs font-semibold text-primary">{target.matched_toi}</p>
        <p className="mt-1 font-mono text-[10px] uppercase text-muted-foreground">
          {target.disposition || 'TOI matched'}
        </p>
      </div>
    );
  }
  return <MissingEvidence label={target.toi_match_status || 'Not candidate-scored'} />;
}

function MissingEvidence({ label }: { label: string }): JSX.Element {
  return <span className="font-mono text-[10px] uppercase text-muted-foreground">{label}</span>;
}

function PipelineBadge({ status }: { status: string }): JSX.Element {
  const tone =
    status === 'scored'
      ? 'border-primary/35 bg-primary/10 text-primary'
      : status === 'ingested'
        ? 'border-emerald-500/35 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
        : 'border-border bg-muted/40 text-muted-foreground';
  return (
    <Badge variant="outline" className={`rounded-none font-mono text-[9px] uppercase ${tone}`}>
      {status || 'unknown'}
    </Badge>
  );
}

function Pagination({
  offset,
  count,
  total,
  hasMore,
  disabled,
  onPrevious,
  onNext,
}: {
  offset: number;
  count: number;
  total: number;
  hasMore: boolean;
  disabled: boolean;
  onPrevious: () => void;
  onNext: () => void;
}): JSX.Element {
  const page = total > 0 ? Math.floor(offset / PAGE_SIZE) + 1 : 0;
  const pageCount = total > 0 ? Math.ceil(total / PAGE_SIZE) : 0;
  return (
    <div className="flex items-center gap-2">
      <Button
        variant="outline"
        size="icon-sm"
        onClick={onPrevious}
        disabled={disabled || offset === 0}
        aria-label="Previous page"
      >
        <ChevronLeft />
      </Button>
      <span className="min-w-20 text-center font-mono text-[10px] uppercase tabular-nums text-muted-foreground">
        {count > 0 ? `${page} / ${pageCount}` : '0 / 0'}
      </span>
      <Button
        variant="outline"
        size="icon-sm"
        onClick={onNext}
        disabled={disabled || !hasMore}
        aria-label="Next page"
      >
        <ChevronRight />
      </Button>
    </div>
  );
}

function LoadingState(): JSX.Element {
  return (
    <div className="flex items-center justify-center gap-2 py-24 text-sm text-muted-foreground">
      <LoaderCircle className="size-4 animate-spin" />
      Reading observed target index…
    </div>
  );
}

function EmptyState({ label }: { label: string }): JSX.Element {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-4 py-24 text-center text-sm text-muted-foreground">
      <Database className="size-6 opacity-60" />
      <p>{label}</p>
      <p className="max-w-lg text-xs">
        Nới rộng parameter space hoặc reset query để kiểm tra lại catalog.
      </p>
    </div>
  );
}
