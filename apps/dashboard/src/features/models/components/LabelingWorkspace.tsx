import { useEffect, useMemo, useRef, useState, type JSX } from 'react';
import { Database, RefreshCw, Search, Tags } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { apiFetch } from '@/lib/api';
import { formatBytes, formatDate, type GoldSnapshotItem, type ModelRecord } from '../types';
import { TrainingLabelingQueue } from './TrainingLabelingQueue';

type TrainingReadiness = {
  total_rows: number;
  positive_rows: number;
  negative_rows: number;
  unresolved_rows: number;
  positive_targets: number;
  negative_targets: number;
  ready: boolean;
  tier: 'BLOCKED' | 'EXPERIMENTAL' | 'PRODUCTION_CANDIDATE';
  policy_version: string;
  experimental_minimum_positive_targets: number;
  experimental_minimum_negative_targets: number;
  production_candidate_minimum_positive_targets: number;
  production_candidate_minimum_negative_targets: number;
  negative_diversity_target: number;
  negative_diversity_target_met: boolean;
};

const LABELING_SCOPE_KEY = 'aurora.ai-factory.labeling.snapshots.v1';

function readStoredScope(): string[] | undefined {
  if (typeof window === 'undefined') return undefined;
  try {
    const stored = window.localStorage.getItem(LABELING_SCOPE_KEY);
    if (stored === null) return undefined;
    const value = JSON.parse(stored);
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : undefined;
  } catch {
    return undefined;
  }
}

export function LabelingWorkspace({ models, availableSnapshots, snapshotsLoading, onRefreshSnapshots }: { models: ModelRecord[]; availableSnapshots: GoldSnapshotItem[]; snapshotsLoading: boolean; onRefreshSnapshots: () => void }): JSX.Element {
  const storedScope = useMemo(readStoredScope, []);
  const [snapshotIds, setSnapshotIds] = useState<string[]>(storedScope ?? []);
  const [query, setQuery] = useState('');
  const [readiness, setReadiness] = useState<TrainingReadiness>();
  const [readinessLoading, setReadinessLoading] = useState(false);
  const [readinessRevision, setReadinessRevision] = useState(0);
  const initialized = useRef(storedScope !== undefined);
  const champion = models.find((model) => model.task === 'candidate_vetting' && model.status === 'champion');
  const filteredSnapshots = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return normalized ? availableSnapshots.filter((snapshot) => snapshot.snapshot_id.toLowerCase().includes(normalized)) : availableSnapshots;
  }, [availableSnapshots, query]);
  const selectedSnapshots = useMemo(() => availableSnapshots.filter((snapshot) => snapshotIds.includes(snapshot.snapshot_id)), [availableSnapshots, snapshotIds]);
  const allVisibleSelected = filteredSnapshots.length > 0 && filteredSnapshots.every((snapshot) => snapshotIds.includes(snapshot.snapshot_id));

  useEffect(() => {
    if (snapshotsLoading) return;
    const available = new Set(availableSnapshots.map((snapshot) => snapshot.snapshot_id));
    setSnapshotIds((current) => {
      const valid = current.filter((snapshotId) => available.has(snapshotId));
      if (valid.length > 0 || initialized.current || availableSnapshots.length === 0) return valid;
      return availableSnapshots.map((snapshot) => snapshot.snapshot_id);
    });
    initialized.current = true;
  }, [availableSnapshots, snapshotsLoading]);

  useEffect(() => {
    if (!initialized.current) return;
    window.localStorage.setItem(LABELING_SCOPE_KEY, JSON.stringify(snapshotIds));
  }, [snapshotIds]);

  useEffect(() => {
    let active = true;
    if (snapshotIds.length === 0) {
      setReadiness(undefined);
      setReadinessLoading(false);
      return () => { active = false; };
    }
    const search = new URLSearchParams();
    snapshotIds.forEach((snapshotId) => search.append('snapshot_id', snapshotId));
    setReadinessLoading(true);
    void apiFetch<TrainingReadiness>(`/v1/models/training-readiness?${search.toString()}`)
      .then((value) => { if (active) setReadiness(value); })
      .catch(() => { if (active) setReadiness(undefined); })
      .finally(() => { if (active) setReadinessLoading(false); });
    return () => { active = false; };
  }, [snapshotIds, readinessRevision]);

  const toggleSnapshot = (snapshotId: string, selected: boolean): void => {
    setSnapshotIds((current) => selected ? [...new Set([...current, snapshotId])] : current.filter((value) => value !== snapshotId));
  };

  const toggleVisible = (selected: boolean): void => {
    const visible = new Set(filteredSnapshots.map((snapshot) => snapshot.snapshot_id));
    setSnapshotIds((current) => selected ? [...new Set([...current, ...visible])] : current.filter((snapshotId) => !visible.has(snapshotId)));
  };

  const selectedBytes = selectedSnapshots.reduce((sum, snapshot) => sum + snapshot.size_bytes, 0);
  const total = readiness?.total_rows ?? 0;
  const ratio = (value: number): number => total > 0 ? value / total * 100 : 0;

  return <>
    <section className="min-w-0 border border-border/80 bg-card">
      <header className="flex flex-col gap-3 border-b border-border/60 p-4 sm:flex-row sm:items-start sm:justify-between sm:p-5">
        <div><p className="font-mono text-xs uppercase tracking-[0.14em] text-primary">Label scope / immutable Gold evidence</p><h3 className="mt-1 text-lg font-semibold">Choose the cohort to review</h3><p className="mt-1 text-sm text-muted-foreground">Phạm vi được lưu trên trình duyệt này; mặc định lần đầu chọn toàn bộ snapshot đã commit.</p></div>
        <div className="flex flex-wrap items-center gap-2"><Badge variant={champion ? 'default' : 'outline'} className="rounded-none font-mono text-xs">{champion ? `CHAMPION · ${champion.model_version || champion.model_id}` : 'NO CHAMPION MODEL'}</Badge><Button type="button" variant="outline" size="sm" className="rounded-none" onClick={onRefreshSnapshots} disabled={snapshotsLoading}><RefreshCw className={`size-3.5 ${snapshotsLoading ? 'animate-spin' : ''}`} />Rescan Gold</Button></div>
      </header>

      <div className="grid min-w-0 xl:grid-cols-[minmax(28rem,0.58fr)_minmax(22rem,0.42fr)]">
        <div className="min-w-0 border-b border-border/60 p-4 xl:border-b-0 xl:border-r sm:p-5">
          <div className="relative"><Search className="absolute left-2.5 top-2.5 size-3.5 text-muted-foreground" /><Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Filter committed snapshot…" className="h-9 rounded-none pl-8 font-mono text-xs" /></div>
          <div className="mt-2 overflow-hidden border border-border/70">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 bg-muted/20 px-3 py-2"><label className="flex cursor-pointer items-center gap-2 text-sm"><Checkbox checked={allVisibleSelected ? true : filteredSnapshots.some((snapshot) => snapshotIds.includes(snapshot.snapshot_id)) ? 'indeterminate' : false} onCheckedChange={(checked) => toggleVisible(checked === true)} />Select visible</label><div className="flex items-center gap-2"><span className="font-mono text-xs text-muted-foreground">{snapshotIds.length} selected · {formatBytes(selectedBytes)}</span><Button type="button" variant="ghost" size="xs" onClick={() => setSnapshotIds([])}>Clear</Button></div></div>
            <div className="max-h-[230px] overflow-y-auto">
              {snapshotsLoading ? <ScopeState label="Reading committed Gold inventory…" /> : filteredSnapshots.length === 0 ? <ScopeState label="No committed snapshot matches this filter." /> : filteredSnapshots.map((snapshot) => <label key={snapshot.snapshot_id} className="grid cursor-pointer grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 border-b border-border/50 px-3 py-3 last:border-b-0 hover:bg-muted/30"><Checkbox checked={snapshotIds.includes(snapshot.snapshot_id)} onCheckedChange={(checked) => toggleSnapshot(snapshot.snapshot_id, checked === true)} /><span className="min-w-0"><span className="block truncate font-mono text-sm font-medium">{snapshot.snapshot_id}</span><span className="mt-0.5 block text-xs text-muted-foreground">{formatDate(snapshot.last_modified)}</span></span><span className="font-mono text-xs text-muted-foreground">{formatBytes(snapshot.size_bytes)}</span></label>)}
            </div>
          </div>
        </div>

        <div className="min-w-0 p-4 sm:p-5">
          <div className="flex items-center justify-between"><div><p className="flex items-center gap-2 text-base font-semibold"><Tags className="size-4 text-primary" />Cohort disposition</p><p className="mt-1 text-xs text-muted-foreground">Independent TIC targets from the selected scope.</p></div><Badge variant={readiness?.ready ? 'default' : 'outline'} className="rounded-none font-mono text-xs">{readinessLoading ? 'CALCULATING' : readiness?.tier?.replaceAll('_', ' ') ?? 'REVIEW REQUIRED'}</Badge></div>
          {!readiness ? <div className="mt-4 border border-dashed border-border/70 p-8 text-center text-xs text-muted-foreground">{snapshotIds.length === 0 ? 'Select Gold snapshots to calculate the review cohort.' : readinessLoading ? 'Calculating label coverage…' : 'Cohort evidence is unavailable.'}</div> : <div className="mt-4">
            <div className="flex h-2 overflow-hidden bg-muted"><span className="bg-emerald-500" style={{ width: `${ratio(readiness.positive_rows)}%` }} /><span className="bg-sky-500" style={{ width: `${ratio(readiness.negative_rows)}%` }} /><span className="bg-amber-500" style={{ width: `${ratio(readiness.unresolved_rows)}%` }} /></div>
            <div className="mt-3 grid grid-cols-3 gap-px border border-border/70 bg-border/70"><CohortMetric label="Positive" value={readiness.positive_rows} detail={`${readiness.positive_targets.toLocaleString()} TIC targets`} tone="text-emerald-500" /><CohortMetric label="Hard negative" value={readiness.negative_rows} detail={`${readiness.negative_targets.toLocaleString()} TIC targets`} tone="text-sky-500" /><CohortMetric label="Unresolved" value={readiness.unresolved_rows} detail="cohort rows to review" tone="text-amber-500" /></div>
            <div className="mt-3 border border-border/70 bg-background/60 px-3 py-2 text-xs text-muted-foreground"><span className="font-mono text-foreground">Experimental gate {readiness.experimental_minimum_positive_targets}/{readiness.experimental_minimum_negative_targets}</span><span> · Production candidate {readiness.production_candidate_minimum_positive_targets}/{readiness.production_candidate_minimum_negative_targets}</span><span> · {readiness.negative_diversity_target} negatives is an advisory diversity target and does not block training.</span></div>
            <p className="mt-3 font-mono text-xs text-muted-foreground">{readiness.policy_version} · {readiness.total_rows.toLocaleString()} unique cohort rows</p>
          </div>}
        </div>
      </div>
    </section>

    <TrainingLabelingQueue snapshotIds={snapshotIds} models={models} onReviewSaved={() => setReadinessRevision((value) => value + 1)} />
  </>;
}

function CohortMetric({ label, value, detail, tone }: { label: string; value: number; detail: string; tone: string }): JSX.Element {
  return <div className="min-w-0 bg-background p-3"><p className={`font-mono text-xs uppercase ${tone}`}>{label}</p><p className="mt-1 font-mono text-xl font-semibold">{value.toLocaleString()}</p><p className="mt-0.5 truncate text-xs text-muted-foreground">{detail}</p></div>;
}

function ScopeState({ label }: { label: string }): JSX.Element {
  return <div className="flex min-h-28 flex-col items-center justify-center gap-2 p-5 text-center text-xs text-muted-foreground"><Database className="size-5 opacity-60" />{label}</div>;
}
