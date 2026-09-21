import type { JSX } from 'react';
import { CheckCircle2, CircleAlert, Database } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { formatDate, statusVariant, type ModelRecord } from '@/pages/model-registry/types';

interface GenerationLedgerTableProps {
  models: ModelRecord[];
  selectedRuntimeId?: string;
  onSelect?: (runtimePackageId: string) => void;
}

function ParityBadge({ status }: { status: string }): JSX.Element {
  const isPass = ['PASS', 'PASSED'].includes((status || '').toUpperCase());
  return (
    <span
      className={`inline-flex items-center gap-1 font-mono text-[10px] ${
        isPass ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'
      }`}
    >
      {isPass ? <CheckCircle2 className="size-3" /> : <CircleAlert className="size-3" />}
      {status || 'UNVERIFIED'}
    </span>
  );
}

export function GenerationLedgerTable({
  models,
  selectedRuntimeId,
  onSelect,
}: GenerationLedgerTableProps): JSX.Element {
  return (
    <section className="min-w-0 border-t border-border/60 bg-card">
      <header className="border-b border-border/60 px-4 py-3">
        <div className="flex items-center gap-2 text-sm font-medium text-foreground">
          <Database className="size-4 text-primary" />
          Generation Ledger
        </div>
        <p className="mt-0.5 text-[11px] text-muted-foreground">
          Registered model generations in active registry; click a record to switch lineage subject.
        </p>
      </header>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[850px] text-left text-xs">
          <thead className="border-b border-border/60 bg-muted/20 font-mono text-[9px] uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="p-3">Created</th>
              <th className="p-3">Model Generation</th>
              <th className="p-3">Evaluation Run</th>
              <th className="p-3">Parity</th>
              <th className="p-3">Runtime Package ID</th>
              <th className="p-3 text-right">State</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/40 font-mono">
            {models.map((item) => {
              const isSelected = item.runtime_package_id === selectedRuntimeId;
              return (
                <tr
                  key={item.runtime_package_id}
                  onClick={() => onSelect?.(item.runtime_package_id)}
                  className={`cursor-pointer transition-colors hover:bg-muted/30 ${
                    isSelected
                      ? 'bg-primary/[0.08] text-foreground font-medium'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  <td className="p-3 text-[11px] text-muted-foreground">
                    {formatDate(item.created_at)}
                  </td>
                  <td className="p-3">
                    <p className="font-semibold text-foreground">{item.model_id}</p>
                    <p className="text-[10px] text-muted-foreground">
                      {item.model_version || 'unversioned'}
                    </p>
                  </td>
                  <td className="p-3 text-[11px] text-foreground">
                    {item.evaluation_run_id || '—'}
                  </td>
                  <td className="p-3">
                    <ParityBadge status={item.parity_status} />
                  </td>
                  <td
                    className="max-w-56 truncate p-3 text-[11px] text-foreground"
                    title={item.runtime_package_id}
                  >
                    {item.runtime_package_id}
                  </td>
                  <td className="p-3 text-right">
                    <Badge
                      variant={statusVariant(item.status)}
                      className="rounded-none font-mono text-[9px] uppercase tracking-wider"
                    >
                      {item.status}
                    </Badge>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
