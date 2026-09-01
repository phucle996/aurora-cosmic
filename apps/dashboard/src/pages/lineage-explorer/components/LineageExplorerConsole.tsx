import { useCallback, useEffect, useMemo, useState, type JSX, type ReactNode } from 'react';
import {
  AlertCircle,
  Box,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleDot,
  Copy,
  Database,
  FileCheck2,
  FileClock,
  Fingerprint,
  LoaderCircle,
  RefreshCw,
  Search,
  ShieldCheck,
} from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { apiFetch } from '@/lib/api';

type ProductKind = 'lightcurve' | 'target-pixel';
type StageFilter = 'all' | 'bronze' | 'silver' | 'lineage' | 'gold';

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

type GoldLineageResolution = {
  source_product_id: string;
  silver_object_key?: string;
  status: 'EXTRACTED' | 'PENDING';
  snapshot_id?: string;
  datasets?: string[];
};

type GoldLineageResponse = { items: GoldLineageResolution[] };

type LineageRecord = {
  identity: string;
  ticID: string;
  sector: number | null;
  productKind: ProductKind;
  sourceProductID: string;
  bronze: StorageObject;
  silver?: StorageObject;
  processorVersion?: string;
  lineageID?: string;
  lineage?: StorageObject;
  gold?: GoldLineageResolution;
};

const PRODUCT_CONFIG: Record<ProductKind, { label: string; shortLabel: string; bronzePrefix: string; silverPrefix: string; lineagePrefix: string }> = {
  lightcurve: {
    label: 'Light curves',
    shortLabel: 'LC',
    bronzePrefix: 'bronze/tess/lightcurve/',
    silverPrefix: 'silver/tess/lightcurve/',
    lineagePrefix: 'lineage/v1/tess/lightcurve/',
  },
  'target-pixel': {
    label: 'Target pixels',
    shortLabel: 'TPF',
    bronzePrefix: 'bronze/tess/target-pixel/',
    silverPrefix: 'silver/tess/target-pixel/',
    lineagePrefix: 'lineage/v1/tess/target-pixel/',
  },
};

function sourceProductIDFromBronzeKey(key: string): string {
  const filename = key.split('/').pop() ?? '';
  return filename ? `mast:TESS/product/${filename}` : '';
}

function sourceProductIDFromSilverKey(key: string): string {
  const marker = 'mast:TESS/product/';
  const start = key.indexOf(marker);
  if (start < 0 || !key.endsWith('.parquet')) return '';
  return key.slice(start, -'.parquet'.length);
}

function processorVersionFromSilverKey(key: string): string | undefined {
  return key.match(/\/processor=([^/]+)\//)?.[1];
}

function lineageIDFromKey(key: string): string {
  return key.split('/').pop()?.replace(/\.json$/i, '') ?? '';
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function loadCompletePrefix(prefix: string): Promise<StorageResponse> {
  const encoded = encodeURIComponent(prefix);
  const first = await apiFetch<StorageResponse>(`/v1/storage?prefix=${encoded}&page=1&limit=200`);
  const pages = Math.ceil(first.total / 200);
  if (pages <= 1) return first;
  const remaining = await Promise.all(
    Array.from({ length: pages - 1 }, (_, index) =>
      apiFetch<StorageResponse>(`/v1/storage?prefix=${encoded}&page=${index + 2}&limit=200`),
    ),
  );
  return { ...first, objects: [...first.objects, ...remaining.flatMap((listing) => listing.objects)] };
}

function cleanETag(value: string): string {
  return value.replaceAll('"', '');
}

function formatBytes(bytes?: number): string {
  if (bytes === undefined || !Number.isFinite(bytes)) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KiB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(2)} MiB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GiB`;
}

function formatDate(value?: string): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('vi-VN');
}

function short(value?: string, length = 12): string {
  if (!value) return '—';
  return value.length <= length ? value : `${value.slice(0, length)}…`;
}

function recordStage(record: LineageRecord): Exclude<StageFilter, 'all'> {
  if (record.gold?.status === 'EXTRACTED') return 'gold';
  if (record.lineage) return 'lineage';
  if (record.silver) return 'silver';
  return 'bronze';
}

const STAGE_LABELS: Record<Exclude<StageFilter, 'all'>, string> = {
  bronze: 'BRONZE ONLY',
  silver: 'SILVER / NO COMMIT',
  lineage: 'LINEAGE COMMITTED',
  gold: 'GOLD VERIFIED',
};

const STAGE_CLASSES: Record<Exclude<StageFilter, 'all'>, string> = {
  bronze: 'border-amber-500/35 bg-amber-500/10 text-amber-700 dark:text-amber-300',
  silver: 'border-sky-500/35 bg-sky-500/10 text-sky-700 dark:text-sky-300',
  lineage: 'border-emerald-500/35 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  gold: 'border-violet-500/35 bg-violet-500/10 text-violet-700 dark:text-violet-300',
};

function CopyValue({ value, id, copied, onCopy }: { value?: string; id: string; copied: string | null; onCopy: (value: string, id: string) => void }): JSX.Element | null {
  if (!value) return null;
  return (
    <button
      type="button"
      onClick={() => onCopy(value, id)}
      className="inline-flex shrink-0 items-center gap-1 font-mono text-[10px] uppercase tracking-wider text-primary hover:text-primary/75"
    >
      {copied === id ? <Check className="size-3" /> : <Copy className="size-3" />}
      {copied === id ? 'Copied' : 'Copy'}
    </button>
  );
}

function EvidenceStep({ index, title, status, tone, children }: { index: string; title: string; status: string; tone: 'observed' | 'pending' | 'anomaly' | 'gold'; children: ReactNode }): JSX.Element {
  const color = tone === 'observed'
    ? 'border-emerald-500/35 bg-emerald-500/5'
    : tone === 'gold'
      ? 'border-violet-500/35 bg-violet-500/5'
      : tone === 'anomaly'
        ? 'border-sky-500/35 bg-sky-500/5'
        : 'border-border/70 bg-muted/10';
  const dot = tone === 'observed'
    ? 'bg-emerald-500 text-white'
    : tone === 'gold'
      ? 'bg-violet-500 text-white'
      : tone === 'anomaly'
        ? 'bg-sky-500 text-white'
        : 'bg-muted text-muted-foreground';
  return (
    <div className={`relative border p-3.5 ${color}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className={`flex size-5 items-center justify-center font-mono text-[9px] font-bold ${dot}`}>{index}</span>
          <p className="text-xs font-semibold text-foreground">{title}</p>
        </div>
        <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-muted-foreground">{status}</span>
      </div>
      <div className="mt-3">{children}</div>
    </div>
  );
}

export function LineageExplorerConsole(): JSX.Element {
  const [productKind, setProductKind] = useState<ProductKind>('lightcurve');
  const [stageFilter, setStageFilter] = useState<StageFilter>('all');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [records, setRecords] = useState<LineageRecord[]>([]);
  const [selectedIdentity, setSelectedIdentity] = useState<string>();
  const [inventory, setInventory] = useState({ bronze: 0, silver: 0, lineage: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [goldError, setGoldError] = useState<string>();
  const [copied, setCopied] = useState<string | null>(null);

  const loadLineage = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(undefined);
    setGoldError(undefined);
    const config = PRODUCT_CONFIG[productKind];
    try {
      const [bronzeListing, silverListing, lineageListing] = await Promise.all([
        apiFetch<StorageResponse>(
          `/v1/storage?prefix=${encodeURIComponent(config.bronzePrefix)}&page=${page}&limit=${pageSize}`,
        ),
        loadCompletePrefix(config.silverPrefix),
        loadCompletePrefix(config.lineagePrefix),
      ]);

      const silverBySource = new Map<string, StorageObject>();
      for (const object of silverListing.objects) {
        const sourceID = sourceProductIDFromSilverKey(object.key);
        if (!sourceID) continue;
        const current = silverBySource.get(sourceID);
        if (!current || Date.parse(object.last_modified) > Date.parse(current.last_modified)) {
          silverBySource.set(sourceID, object);
        }
      }
      const lineageByID = new Map(lineageListing.objects.map((object) => [lineageIDFromKey(object.key), object]));

      let joined = await Promise.all(bronzeListing.objects.map(async (bronze): Promise<LineageRecord> => {
        const sourceProductID = sourceProductIDFromBronzeKey(bronze.key);
        const silver = silverBySource.get(sourceProductID);
        const processorVersion = silver ? processorVersionFromSilverKey(silver.key) : undefined;
        const lineageID = processorVersion ? await sha256(`${sourceProductID}:${processorVersion}`) : undefined;
        const ticID = bronze.key.match(/\/tic=(\d+)/i)?.[1] ?? '—';
        const sectorRaw = bronze.key.match(/\/sector=(\d+)/i)?.[1];
        return {
          identity: `${productKind}:${sourceProductID}`,
          ticID,
          sector: sectorRaw ? Number.parseInt(sectorRaw, 10) : null,
          productKind,
          sourceProductID,
          bronze,
          silver,
          processorVersion,
          lineageID,
          lineage: lineageID ? lineageByID.get(lineageID) : undefined,
        };
      }));

      if (joined.length > 0) {
        try {
          const gold = await apiFetch<GoldLineageResponse>('/v1/gold/lineage/resolve', {
            method: 'POST',
            body: JSON.stringify({
              inputs: joined.map((record) => ({
                source_product_id: record.sourceProductID,
                ...(record.silver ? { silver_object_key: record.silver.key } : {}),
              })),
            }),
          });
          const goldBySource = new Map(gold.items.map((item) => [item.source_product_id, item]));
          joined = joined.map((record) => ({ ...record, gold: goldBySource.get(record.sourceProductID) }));
        } catch (cause) {
          setGoldError(cause instanceof Error ? cause.message : 'Gold manifest resolver unavailable');
        }
      }

      setRecords(joined);
      setInventory({ bronze: bronzeListing.total, silver: silverListing.total, lineage: lineageListing.total });
      setSelectedIdentity((current) => joined.some((record) => record.identity === current) ? current : joined[0]?.identity);
    } catch (cause) {
      setRecords([]);
      setInventory({ bronze: 0, silver: 0, lineage: 0 });
      setSelectedIdentity(undefined);
      setError(cause instanceof Error ? cause.message : 'Không tải được lineage evidence');
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, productKind]);

  useEffect(() => {
    void loadLineage();
  }, [loadLineage]);

  const counts = useMemo(() => {
    const result = { bronze: 0, silver: 0, lineage: 0, gold: 0 };
    for (const record of records) result[recordStage(record)] += 1;
    return result;
  }, [records]);

  const filteredRecords = useMemo(() => {
    const query = search.trim().toLowerCase();
    return records.filter((record) => {
      if (stageFilter !== 'all' && recordStage(record) !== stageFilter) return false;
      if (!query) return true;
      return [record.ticID, record.sourceProductID, record.bronze.key, record.silver?.key, record.lineageID, record.gold?.snapshot_id]
        .some((value) => value?.toLowerCase().includes(query));
    });
  }, [records, search, stageFilter]);

  const selected = records.find((record) => record.identity === selectedIdentity) ?? filteredRecords[0];
  const totalPages = Math.max(1, Math.ceil(inventory.bronze / pageSize));
  const kindConfig = PRODUCT_CONFIG[productKind];
  const observedLineage = records.filter((record) => Boolean(record.lineage)).length;
  const observedGold = records.filter((record) => record.gold?.status === 'EXTRACTED').length;

  const copyValue = (value: string, id: string): void => {
    void navigator.clipboard.writeText(value).then(() => {
      setCopied(id);
      window.setTimeout(() => setCopied((current) => current === id ? null : current), 1600);
    });
  };

  return (
    <div className="space-y-4">
      {(error || goldError) && (
        <div className="flex items-start gap-3 border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
          <AlertCircle className="mt-0.5 size-4 shrink-0" />
          <div>
            <p className="font-medium">Lineage observation incomplete</p>
            <p className="mt-0.5 text-xs">{error ?? `Bronze→Silver evidence vẫn khả dụng; Gold resolver: ${goldError}`}</p>
          </div>
        </div>
      )}

      <section className="grid border border-border/70 bg-card sm:grid-cols-2 xl:grid-cols-4">
        {[
          { label: 'Bronze inventory', value: inventory.bronze, detail: `${kindConfig.shortLabel} source objects`, icon: Database },
          { label: 'Silver inventory', value: inventory.silver, detail: 'Parquet artifacts in prefix', icon: Box },
          { label: 'Durable lineage', value: inventory.lineage, detail: 'Immutable commit records', icon: Fingerprint },
          { label: 'Gold / loaded page', value: observedGold, detail: `${observedGold}/${records.length} manifest-resolved`, icon: ShieldCheck },
        ].map((metric, index) => {
          const borders = [
            '',
            'border-t border-border/60 sm:border-l sm:border-t-0',
            'border-t border-border/60 xl:border-l xl:border-t-0',
            'border-t border-border/60 sm:border-l xl:border-t-0',
          ][index];
          return (
            <div key={metric.label} className={`p-4 ${borders}`}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-mono text-[9px] uppercase tracking-[0.15em] text-muted-foreground">{metric.label}</p>
                  <p className="mt-1.5 font-mono text-xl font-semibold tabular-nums text-foreground">{metric.value.toLocaleString()}</p>
                  <p className="mt-1 text-[11px] text-muted-foreground">{metric.detail}</p>
                </div>
                <metric.icon className="size-4 text-primary" />
              </div>
            </div>
          );
        })}
      </section>

      <section className="border border-border/70 bg-card">
        <div className="flex flex-col gap-4 border-b border-border/60 p-4 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <p className="font-mono text-[9px] uppercase tracking-[0.15em] text-primary">Evidence coverage / loaded page</p>
            <h3 className="mt-1 text-sm font-semibold">Identity-resolved provenance</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              {records.length === 0 ? 'Chưa có sample trong trang này.' : `${observedLineage}/${records.length} products có lineage commit khớp source identity và processor version.`}
            </p>
          </div>
          <div className="grid min-w-0 flex-1 gap-1 sm:grid-cols-4 xl:max-w-2xl">
            {(['bronze', 'silver', 'lineage', 'gold'] as const).map((stage) => (
              <div key={stage} className="border border-border/60 bg-muted/15 px-3 py-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground">{STAGE_LABELS[stage]}</span>
                  <strong className="font-mono text-xs tabular-nums">{counts[stage]}</strong>
                </div>
                <div className="mt-2 h-1 bg-muted">
                  <div className="h-full bg-primary" style={{ width: `${records.length ? (counts[stage] / records.length) * 100 : 0}%` }} />
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-3 p-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap gap-1 border border-border/60 bg-muted/15 p-1">
            {(Object.entries(PRODUCT_CONFIG) as Array<[ProductKind, (typeof PRODUCT_CONFIG)[ProductKind]]>).map(([kind, config]) => (
              <button
                key={kind}
                type="button"
                onClick={() => { setProductKind(kind); setPage(1); setStageFilter('all'); }}
                className={`px-3 py-1.5 font-mono text-[10px] uppercase tracking-wider transition-colors ${productKind === kind ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-background hover:text-foreground'}`}
              >
                {config.label}
              </button>
            ))}
          </div>
          <div className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row lg:max-w-3xl lg:justify-end">
            <div className="relative min-w-0 flex-1 sm:max-w-sm">
              <Search className="absolute left-2.5 top-2.5 size-3.5 text-muted-foreground" />
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Lọc TIC, source, object key, lineage ID..."
                className="h-8 rounded-none pl-8 text-xs"
              />
            </div>
            <Button variant="outline" size="sm" onClick={() => void loadLineage()} disabled={loading} className="rounded-none font-mono text-[10px] uppercase tracking-wider">
              <RefreshCw className={`size-3.5 ${loading ? 'animate-spin' : ''}`} />
              Resync evidence
            </Button>
          </div>
        </div>

        <div className="flex flex-wrap gap-1 border-t border-border/60 px-4 py-3">
          {([
            ['all', `All ${records.length}`],
            ['bronze', `Bronze only ${counts.bronze}`],
            ['silver', `Silver anomaly ${counts.silver}`],
            ['lineage', `Committed ${counts.lineage}`],
            ['gold', `Gold ${counts.gold}`],
          ] as Array<[StageFilter, string]>).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setStageFilter(value)}
              className={`border px-2.5 py-1 font-mono text-[9px] uppercase tracking-wider transition-colors ${stageFilter === value ? 'border-primary bg-primary text-primary-foreground' : 'border-border/60 text-muted-foreground hover:border-primary/50 hover:text-foreground'}`}
            >
              {label}
            </button>
          ))}
          <span className="ml-auto self-center text-[10px] text-muted-foreground">Search lọc trên trang đang tải</span>
        </div>
      </section>

      <div className="grid gap-4 xl:grid-cols-12">
        <Card className="overflow-hidden rounded-none border-border/70 shadow-none xl:col-span-7 2xl:col-span-8">
          <CardHeader className="border-b border-border/60 p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="font-mono text-[9px] uppercase tracking-[0.15em] text-primary">Provenance ledger</p>
                <CardTitle className="mt-1 text-base">Artifact identity matrix</CardTitle>
              </div>
              <Badge variant="outline" className="rounded-none font-mono text-[9px] uppercase tracking-wider">page {page}/{totalPages}</Badge>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <Table className="min-w-[940px]">
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="w-[190px] pl-4 font-mono text-[9px] uppercase tracking-wider">Target / source</TableHead>
                  <TableHead className="font-mono text-[9px] uppercase tracking-wider">Bronze evidence</TableHead>
                  <TableHead className="font-mono text-[9px] uppercase tracking-wider">Silver artifact</TableHead>
                  <TableHead className="font-mono text-[9px] uppercase tracking-wider">Lineage commit</TableHead>
                  <TableHead className="pr-4 text-right font-mono text-[9px] uppercase tracking-wider">Resolved stage</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading && records.length === 0 ? (
                  <TableRow><TableCell colSpan={5} className="h-40 text-center"><LoaderCircle className="mx-auto size-5 animate-spin text-primary" /><p className="mt-2 text-xs text-muted-foreground">Joining persisted evidence…</p></TableCell></TableRow>
                ) : filteredRecords.length === 0 ? (
                  <TableRow><TableCell colSpan={5} className="h-40 text-center text-sm text-muted-foreground">Không có product khớp bộ lọc trong trang hiện tại.</TableCell></TableRow>
                ) : filteredRecords.map((record) => {
                  const stage = recordStage(record);
                  const active = selected?.identity === record.identity;
                  return (
                    <TableRow
                      key={record.identity}
                      tabIndex={0}
                      aria-selected={active}
                      onClick={() => setSelectedIdentity(record.identity)}
                      onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') setSelectedIdentity(record.identity); }}
                      className={`cursor-pointer ${active ? 'bg-primary/5 shadow-[inset_3px_0_0_hsl(var(--primary))]' : ''}`}
                    >
                      <TableCell className="pl-4">
                        <p className="font-mono text-xs font-semibold text-foreground">TIC {record.ticID}</p>
                        <p className="mt-1 font-mono text-[10px] text-muted-foreground">sector {record.sector ?? '—'} · {kindConfig.shortLabel}</p>
                        <p className="mt-1 max-w-[180px] truncate font-mono text-[9px] text-muted-foreground" title={record.sourceProductID}>{record.sourceProductID}</p>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2"><FileCheck2 className="size-3.5 text-emerald-500" /><span className="font-mono text-[10px]">{formatBytes(record.bronze.size_bytes)}</span></div>
                        <p className="mt-1 max-w-[170px] truncate font-mono text-[9px] text-muted-foreground" title={record.bronze.key}>{record.bronze.key}</p>
                      </TableCell>
                      <TableCell>
                        {record.silver ? <><div className="flex items-center gap-2"><FileCheck2 className="size-3.5 text-sky-500" /><span className="font-mono text-[10px]">{formatBytes(record.silver.size_bytes)}</span></div><p className="mt-1 font-mono text-[9px] text-muted-foreground">{record.processorVersion}</p></> : <span className="font-mono text-[10px] text-muted-foreground">NO MATCHED OBJECT</span>}
                      </TableCell>
                      <TableCell>
                        {record.lineage ? <><div className="flex items-center gap-2"><Fingerprint className="size-3.5 text-emerald-500" /><span className="font-mono text-[10px] text-emerald-600 dark:text-emerald-300">COMMITTED</span></div><p className="mt-1 font-mono text-[9px] text-muted-foreground" title={record.lineageID}>{short(record.lineageID, 16)}</p></> : <span className={`font-mono text-[10px] ${record.silver ? 'text-sky-600 dark:text-sky-300' : 'text-muted-foreground'}`}>{record.silver ? 'COMMIT MISSING' : 'NOT PRODUCED'}</span>}
                      </TableCell>
                      <TableCell className="pr-4 text-right">
                        <Badge variant="outline" className={`rounded-none font-mono text-[8px] uppercase tracking-wider ${STAGE_CLASSES[stage]}`}>{STAGE_LABELS[stage]}</Badge>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
            <div className="flex flex-col gap-3 border-t border-border/60 bg-muted/10 p-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-[11px] text-muted-foreground">
                {inventory.bronze === 0 ? '0 objects' : `Objects ${(page - 1) * pageSize + 1}–${Math.min(page * pageSize, inventory.bronze)} / ${inventory.bronze.toLocaleString()}`}
              </p>
              <div className="flex items-center gap-2">
                <select
                  value={pageSize}
                  onChange={(event) => { setPageSize(Number(event.target.value)); setPage(1); }}
                  className="h-8 rounded-none border border-border bg-background px-2 font-mono text-[10px]"
                  aria-label="Số object mỗi trang"
                >
                  <option value={10}>10 / page</option><option value={25}>25 / page</option><option value={50}>50 / page</option>
                </select>
                <Button variant="outline" size="icon-sm" className="rounded-none" disabled={page <= 1 || loading} onClick={() => setPage((value) => Math.max(1, value - 1))}><ChevronLeft className="size-3.5" /></Button>
                <span className="min-w-14 text-center font-mono text-[10px]">{page} / {totalPages}</span>
                <Button variant="outline" size="icon-sm" className="rounded-none" disabled={page >= totalPages || loading} onClick={() => setPage((value) => Math.min(totalPages, value + 1))}><ChevronRight className="size-3.5" /></Button>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="h-fit rounded-none border-border/70 shadow-none xl:sticky xl:top-4 xl:col-span-5 2xl:col-span-4">
          <CardHeader className="border-b border-border/60 p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-mono text-[9px] uppercase tracking-[0.15em] text-primary">Evidence inspector</p>
                <CardTitle className="mt-1 truncate text-base">{selected ? `TIC ${selected.ticID}` : 'No selection'}</CardTitle>
                <p className="mt-1 font-mono text-[10px] text-muted-foreground">{selected ? `sector ${selected.sector ?? '—'} · ${kindConfig.shortLabel}` : 'Select a ledger row'}</p>
              </div>
              {selected && <Badge variant="outline" className={`rounded-none font-mono text-[8px] uppercase tracking-wider ${STAGE_CLASSES[recordStage(selected)]}`}>{STAGE_LABELS[recordStage(selected)]}</Badge>}
            </div>
          </CardHeader>
          <CardContent className="space-y-2 p-4">
            {!selected ? (
              <div className="py-20 text-center text-sm text-muted-foreground">Chọn một product để inspect evidence.</div>
            ) : (
              <>
                <EvidenceStep index="01" title="NASA MAST source identity" status="observed from Bronze key" tone="observed">
                  <div className="flex items-start justify-between gap-3">
                    <p className="break-all font-mono text-[10px] leading-5 text-foreground">{selected.sourceProductID}</p>
                    <CopyValue value={selected.sourceProductID} id="source" copied={copied} onCopy={copyValue} />
                  </div>
                </EvidenceStep>

                <div className="ml-2 h-3 border-l border-dashed border-primary/40" />
                <EvidenceStep index="02" title="Bronze FITS object" status="inventory observed" tone="observed">
                  <div className="flex items-start justify-between gap-3">
                    <p className="break-all font-mono text-[10px] leading-5 text-foreground">{selected.bronze.key}</p>
                    <CopyValue value={selected.bronze.key} id="bronze-key" copied={copied} onCopy={copyValue} />
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-2 border-t border-border/50 pt-2 font-mono text-[9px] text-muted-foreground">
                    <span>size <strong className="text-foreground">{formatBytes(selected.bronze.size_bytes)}</strong></span>
                    <span>ETag <strong className="text-foreground" title={cleanETag(selected.bronze.etag)}>{short(cleanETag(selected.bronze.etag))}</strong></span>
                    <span className="col-span-2">observed <strong className="text-foreground">{formatDate(selected.bronze.last_modified)}</strong></span>
                  </div>
                </EvidenceStep>

                <div className="ml-2 h-3 border-l border-dashed border-primary/40" />
                <EvidenceStep index="03" title="Rust processor → Silver Parquet" status={selected.silver ? 'artifact observed' : 'awaiting artifact'} tone={selected.silver ? 'anomaly' : 'pending'}>
                  {selected.silver ? (
                    <>
                      <div className="flex items-start justify-between gap-3">
                        <p className="break-all font-mono text-[10px] leading-5 text-foreground">{selected.silver.key}</p>
                        <CopyValue value={selected.silver.key} id="silver-key" copied={copied} onCopy={copyValue} />
                      </div>
                      <div className="mt-2 grid grid-cols-2 gap-2 border-t border-border/50 pt-2 font-mono text-[9px] text-muted-foreground">
                        <span>processor <strong className="text-foreground">{selected.processorVersion}</strong></span>
                        <span>size <strong className="text-foreground">{formatBytes(selected.silver.size_bytes)}</strong></span>
                        <span className="col-span-2">ETag <strong className="break-all text-foreground">{cleanETag(selected.silver.etag)}</strong></span>
                      </div>
                    </>
                  ) : <p className="text-xs leading-5 text-muted-foreground">Không có Silver object nào mang cùng MAST source identity trong prefix đang quan sát.</p>}
                </EvidenceStep>

                <div className="ml-2 h-3 border-l border-dashed border-primary/40" />
                <EvidenceStep index="04" title="Immutable lineage commit" status={selected.lineage ? 'lineage_committed' : 'no durable commit'} tone={selected.lineage ? 'observed' : 'pending'}>
                  {selected.lineage ? (
                    <>
                      <div className="flex items-start justify-between gap-3">
                        <p className="break-all font-mono text-[10px] leading-5 text-foreground">{selected.lineage.key}</p>
                        <CopyValue value={selected.lineage.key} id="lineage-key" copied={copied} onCopy={copyValue} />
                      </div>
                      <div className="mt-2 space-y-1 border-t border-border/50 pt-2 font-mono text-[9px] text-muted-foreground">
                        <p>identity <strong className="break-all text-foreground">SHA256(source_product_id:processor_version)</strong></p>
                        <p>lineage ID <strong className="break-all text-foreground">{selected.lineageID}</strong></p>
                        <p>committed <strong className="text-foreground">{formatDate(selected.lineage.last_modified)}</strong></p>
                      </div>
                    </>
                  ) : (
                    <div className="flex items-start gap-2 text-xs leading-5 text-muted-foreground">
                      <FileClock className="mt-0.5 size-3.5 shrink-0" />
                      <p>{selected.silver ? 'Silver object tồn tại nhưng chưa tìm thấy lineage commit tương ứng; đây là trạng thái cần điều tra.' : 'Lineage chỉ được commit sau khi Silver artifact đã durable và được xác minh.'}</p>
                    </div>
                  )}
                </EvidenceStep>

                <div className="ml-2 h-3 border-l border-dashed border-primary/40" />
                <EvidenceStep index="05" title="Gold research snapshot" status={selected.gold?.status === 'EXTRACTED' ? 'manifest resolved' : goldError ? 'resolver unavailable' : 'not in committed manifest'} tone={selected.gold?.status === 'EXTRACTED' ? 'gold' : 'pending'}>
                  {selected.gold?.status === 'EXTRACTED' ? (
                    <div className="space-y-2">
                      <div className="flex items-start justify-between gap-3">
                        <p className="break-all font-mono text-[10px] text-violet-700 dark:text-violet-300">{selected.gold.snapshot_id}</p>
                        <CopyValue value={selected.gold.snapshot_id} id="gold-snapshot" copied={copied} onCopy={copyValue} />
                      </div>
                      <div className="flex flex-wrap gap-1">{selected.gold.datasets?.map((dataset) => <Badge key={dataset} variant="outline" className="rounded-none font-mono text-[8px]">{dataset}</Badge>)}</div>
                    </div>
                  ) : <p className="text-xs leading-5 text-muted-foreground">Chưa có immutable Gold manifest `COMMITTED` thuộc contract research-ready ghi nhận input này.</p>}
                </EvidenceStep>

                <div className="mt-3 flex items-center gap-2 border border-border/60 bg-muted/15 p-3 text-[10px] leading-4 text-muted-foreground">
                  <CircleDot className="size-3.5 shrink-0 text-primary" />
                  ETag là object identity từ storage; UI không gọi nó là SHA-256. Hash khoa học chỉ được công nhận khi có lineage record durable.
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
