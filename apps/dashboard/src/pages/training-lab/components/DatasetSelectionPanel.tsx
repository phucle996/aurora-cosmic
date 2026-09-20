import { useMemo, useState, type JSX } from 'react';
import { Database, Search } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { formatBytes, formatDate } from '@/pages/model-registry/types';
import type { GoldSnapshotItem, TrainingReadiness } from '../types';
import { TrainingCohortReadiness } from './TrainingCohortReadiness';

interface DatasetSelectionPanelProps {
  availableSnapshots: GoldSnapshotItem[];
  snapshotsLoading: boolean;
  snapshotIds: string[];
  onSnapshotIdsChange: (ids: string[]) => void;
  readiness: TrainingReadiness | null;
  readinessLoading: boolean;
}

export function DatasetSelectionPanel({
  availableSnapshots,
  snapshotsLoading,
  snapshotIds,
  onSnapshotIdsChange,
  readiness,
  readinessLoading,
}: DatasetSelectionPanelProps): JSX.Element {
  const [snapshotQuery, setSnapshotQuery] = useState('');

  const filteredSnapshots = useMemo(() => {
    const query = snapshotQuery.trim().toLowerCase();
    return query
      ? availableSnapshots.filter(
          (snapshot) =>
            snapshot.snapshot_id.toLowerCase().includes(query) ||
            snapshot.trained_model_id?.toLowerCase().includes(query),
        )
      : availableSnapshots;
  }, [availableSnapshots, snapshotQuery]);

  const allVisibleSelected =
    filteredSnapshots.length > 0 &&
    filteredSnapshots.every((snapshot) => snapshotIds.includes(snapshot.snapshot_id));

  const selectedSnapshots = useMemo(
    () => availableSnapshots.filter((snapshot) => snapshotIds.includes(snapshot.snapshot_id)),
    [availableSnapshots, snapshotIds],
  );
  const selectedBytes = selectedSnapshots.reduce((sum, snapshot) => sum + snapshot.size_bytes, 0);

  const toggleSnapshot = (snapshotId: string, selected: boolean) => {
    onSnapshotIdsChange(
      selected ? [...new Set([...snapshotIds, snapshotId])] : snapshotIds.filter((val) => val !== snapshotId),
    );
  };

  const toggleVisibleSnapshots = (selected: boolean) => {
    const visible = new Set(filteredSnapshots.map((snapshot) => snapshot.snapshot_id));
    onSnapshotIdsChange(
      selected
        ? [...new Set([...snapshotIds, ...visible])]
        : snapshotIds.filter((val) => !visible.has(val)),
    );
  };

  return (
    <div className="min-w-0 border-b border-border/60 p-4 sm:p-5 xl:border-b-0 xl:border-r">
      <div>
        <p className="font-mono text-[9px] uppercase tracking-[0.18em] text-primary">
          01 / Select Gold Snapshots
        </p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Only COMMITTED Gold snapshots are eligible for training.
        </p>
      </div>

      <div className="mt-3 relative min-w-0">
        <Search className="absolute left-2.5 top-2.5 size-3.5 text-muted-foreground" />
        <Input
          value={snapshotQuery}
          onChange={(event) => setSnapshotQuery(event.target.value)}
          placeholder="Filter snapshot or trained model ID…"
          className="h-9 rounded-none pl-8 font-mono text-xs"
        />
      </div>

      <div className="mt-2 overflow-hidden border border-border/70">
        <div className="flex items-center justify-between border-b border-border/60 bg-muted/20 px-3 py-2">
          <label className="flex cursor-pointer items-center gap-2 text-xs font-medium">
            <Checkbox
              checked={
                allVisibleSelected
                  ? true
                  : filteredSnapshots.some((snapshot) => snapshotIds.includes(snapshot.snapshot_id))
                    ? 'indeterminate'
                    : false
              }
              onCheckedChange={(checked) => toggleVisibleSnapshots(checked === true)}
              disabled={snapshotsLoading || filteredSnapshots.length === 0}
            />
            Select all visible
          </label>
          <span className="font-mono text-[10px] text-muted-foreground">
            {snapshotIds.length} selected · {formatBytes(selectedBytes)}
          </span>
        </div>

        <div className="max-h-[300px] overflow-y-auto">
          {snapshotsLoading && (
            <div className="flex min-h-32 flex-col items-center justify-center px-5 text-center">
              <Database className="mb-2 size-5 text-muted-foreground/60" />
              <p className="text-xs text-muted-foreground">Loading Gold snapshots catalog…</p>
            </div>
          )}

          {!snapshotsLoading && filteredSnapshots.length === 0 && (
            <div className="flex min-h-32 flex-col items-center justify-center px-5 text-center">
              <Database className="mb-2 size-5 text-muted-foreground/60" />
              <p className="text-xs text-muted-foreground">
                {availableSnapshots.length === 0
                  ? 'No Gold snapshots available.'
                  : 'No snapshots matching filter.'}
              </p>
            </div>
          )}

          {!snapshotsLoading &&
            filteredSnapshots.map((snapshot) => (
              <label
                key={snapshot.snapshot_id}
                className="grid cursor-pointer grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 border-b border-border/50 px-3 py-2.5 last:border-b-0 hover:bg-muted/30"
              >
                <Checkbox
                  checked={snapshotIds.includes(snapshot.snapshot_id)}
                  onCheckedChange={(checked) => toggleSnapshot(snapshot.snapshot_id, checked === true)}
                />
                <span className="min-w-0">
                  <span className="block truncate font-mono text-[11px] font-medium" title={snapshot.snapshot_id}>
                    {snapshot.snapshot_id}
                  </span>
                  <span className="mt-0.5 block truncate text-[10px] text-muted-foreground">
                    {formatDate(snapshot.last_modified)} · {snapshot.key}
                  </span>
                </span>
                <span className="text-right">
                  <span className="block font-mono text-[10px]">{formatBytes(snapshot.size_bytes)}</span>
                  <Badge
                    variant="outline"
                    className={`mt-1 rounded-none text-[8px] ${
                      snapshot.is_trained ? '' : 'border-primary/30 text-primary'
                    }`}
                  >
                    {snapshot.is_trained ? 'USED' : 'UNUSED'}
                  </Badge>
                </span>
              </label>
            ))}
        </div>
      </div>

      <div className="mt-3">
        <TrainingCohortReadiness
          readiness={readiness}
          loading={readinessLoading}
          selectedCount={snapshotIds.length}
        />
      </div>
    </div>
  );
}
