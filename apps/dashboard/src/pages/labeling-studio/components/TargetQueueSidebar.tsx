import { useMemo, useState, type JSX } from 'react';
import { CheckCircle2, ChevronLeft, ChevronRight, LoaderCircle, Search } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { LabelingQueueSummaryItem } from '../types';

function itemKey(item: LabelingQueueSummaryItem): string {
  return `${item.snapshot_id}:${item.source_product_id}`;
}

function percentage(value: number): string {
  return Number.isFinite(value) ? `${(value * 100).toFixed(1)}%` : '—';
}

function number(value: number, digits = 2): string {
  return Number.isFinite(value) ? value.toLocaleString(undefined, { maximumFractionDigits: digits }) : '—';
}

function QueueState({ icon, label }: { icon?: JSX.Element; label: string }): JSX.Element {
  return (
    <div className="flex min-h-40 flex-col items-center justify-center gap-2 p-6 text-center text-xs text-muted-foreground">
      {icon}
      {label}
    </div>
  );
}

type FilterMode = 'ALL' | 'AI_POS' | 'AI_NEG' | 'TOI';
type SortMode = 'DEFAULT' | 'SCORE_DESC' | 'POWER_DESC';

export function TargetQueueSidebar({
  items,
  count,
  offset,
  loading,
  error,
  selectedKey,
  hasMore,
  onSelectKey,
  onPrevPage,
  onNextPage,
}: {
  items: LabelingQueueSummaryItem[];
  count: number;
  offset: number;
  loading: boolean;
  error?: string;
  selectedKey: string;
  hasMore: boolean;
  onSelectKey: (key: string) => void;
  onPrevPage: () => void;
  onNextPage: () => void;
}): JSX.Element {
  const [filter, setFilter] = useState<FilterMode>('ALL');
  const [sort, setSort] = useState<SortMode>('DEFAULT');
  const [search, setSearch] = useState('');

  const displayItems = useMemo(() => {
    let result = [...items];
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      result = result.filter(
        (item) =>
          String(item.tic_id).includes(q) ||
          item.source_product_id.toLowerCase().includes(q) ||
          (item.matched_toi_id && item.matched_toi_id.toLowerCase().includes(q))
      );
    }
    if (filter === 'AI_POS') {
      result = result.filter((item) => item.above_threshold);
    } else if (filter === 'AI_NEG') {
      result = result.filter((item) => item.above_threshold === false && item.candidate_score !== undefined);
    } else if (filter === 'TOI') {
      result = result.filter(
        (item) =>
          item.matched_toi_id &&
          item.matched_toi_id !== '' &&
          item.matched_toi_id !== 'NO_TOI_FOR_TARGET'
      );
    }

    if (sort === 'SCORE_DESC') {
      result.sort((a, b) => (b.candidate_score ?? -1) - (a.candidate_score ?? -1));
    } else if (sort === 'POWER_DESC') {
      result.sort((a, b) => (b.bls_power ?? 0) - (a.bls_power ?? 0));
    }

    return result;
  }, [items, search, filter, sort]);

  return (
    <div className="min-w-0 border-b border-border/60 xl:border-b-0 xl:border-r">
      <div className="flex items-center justify-between border-b border-border/60 bg-muted/20 px-3 py-2">
        <span className="font-mono text-xs uppercase tracking-wide">{count.toLocaleString()} unresolved targets</span>
        <span className="font-mono text-xs text-muted-foreground">
          {count > 0 ? `${offset + 1}–${Math.min(offset + items.length, count)} / ${count}` : '0 targets'}
        </span>
      </div>

      {/* SEARCH AND FILTERS */}
      <div className="space-y-1.5 border-b border-border/60 bg-muted/10 p-2 text-xs">
        <div className="relative flex items-center">
          <Search className="absolute left-2 size-3.5 text-muted-foreground" />
          <input
            type="text"
            placeholder="Filter by TIC ID or TOI…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-7 w-full border border-border/70 bg-background pl-7 pr-2 font-mono text-xs outline-none focus:border-primary"
          />
        </div>
        <div className="flex items-center justify-between gap-1 pt-0.5">
          <div className="flex gap-1">
            {(['ALL', 'AI_POS', 'AI_NEG', 'TOI'] as FilterMode[]).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => setFilter(mode)}
                className={`px-1.5 py-0.5 font-mono text-[10px] uppercase transition-colors ${
                  filter === mode
                    ? 'bg-primary font-bold text-primary-foreground'
                    : 'bg-muted/40 text-muted-foreground hover:bg-muted'
                }`}
              >
                {mode === 'ALL' ? 'All' : mode === 'AI_POS' ? 'AI +' : mode === 'AI_NEG' ? 'AI -' : 'TOI'}
              </button>
            ))}
          </div>
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as SortMode)}
            className="h-5 border border-border/60 bg-background px-1 font-mono text-[10px] text-muted-foreground outline-none"
          >
            <option value="DEFAULT">Sort: Default</option>
            <option value="SCORE_DESC">Sort: AI Score ↓</option>
            <option value="POWER_DESC">Sort: BLS Power ↓</option>
          </select>
        </div>
      </div>

      <div className="max-h-[600px] overflow-y-auto">
        {loading ? (
          <QueueState icon={<LoaderCircle className="size-5 animate-spin" />} label="Đang tải cohort evidence…" />
        ) : error && items.length === 0 ? (
          <QueueState label={error} />
        ) : items.length === 0 ? (
          <QueueState icon={<CheckCircle2 className="size-5 text-emerald-500" />} label="Không còn target UNRESOLVED trong các snapshot đã chọn." />
        ) : displayItems.length === 0 ? (
          <QueueState label="Không có target nào khớp bộ lọc." />
        ) : (
          displayItems.map((item) => {
            const hasScore = item.candidate_score !== undefined && item.candidate_score !== null;
            const active = itemKey(item) === selectedKey;
            return (
              <button
                type="button"
                key={itemKey(item)}
                onClick={() => onSelectKey(itemKey(item))}
                className={`grid w-full grid-cols-[minmax(0,1fr)_auto] gap-3 border-b border-border/50 px-3 py-3 text-left transition-colors ${
                  active ? 'bg-primary/10 shadow-[inset_3px_0_0_var(--primary)]' : 'hover:bg-muted/30'
                }`}
              >
                <span className="min-w-0">
                  <span className="block font-mono text-sm font-semibold text-primary">TIC {item.tic_id} · S{item.sector}</span>
                  <span className="mt-1 block truncate font-mono text-xs text-muted-foreground" title={item.source_product_id}>
                    {item.source_product_id}
                  </span>
                  <span className="mt-1 block text-xs text-muted-foreground">
                    BLS power {number(item.bls_power, 3)} · {item.toi_match_status || 'TOI unavailable'}
                  </span>
                </span>
                <span className="text-right">
                  <Badge
                    variant={hasScore ? (item.above_threshold ? 'default' : 'secondary') : 'outline'}
                    className="rounded-none text-[11px]"
                  >
                    {hasScore ? `${item.above_threshold ? 'AI POS' : 'AI NEG'} ${percentage(item.candidate_score!)}` : 'NO AI SCORE'}
                  </Badge>
                  <span className="mt-1 block font-mono text-[11px] text-muted-foreground">{item.snapshot_id.slice(-12)}</span>
                </span>
              </button>
            );
          })
        )}
      </div>
      <div className="flex items-center justify-between border-t border-border/60 p-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="rounded-none"
          disabled={loading || offset === 0}
          onClick={onPrevPage}
        >
          <ChevronLeft className="size-3.5" />Previous
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="rounded-none"
          disabled={loading || !hasMore}
          onClick={onNextPage}
        >
          Next<ChevronRight className="size-3.5" />
        </Button>
      </div>
    </div>
  );
}
