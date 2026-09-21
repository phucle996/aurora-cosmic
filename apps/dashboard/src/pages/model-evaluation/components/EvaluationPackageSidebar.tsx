import type { JSX } from 'react';
import { CheckCircle2, CircleAlert } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { statusVariant, taskLabel, type ModelRecord } from '@/pages/model-registry/types';

type Props = {
  models: ModelRecord[];
  selectedRuntimeId?: string;
  onSelect: (runtimePackageId: string) => void;
};

function statusPass(value: string): boolean {
  return ['PASS', 'PASSED'].includes(value.toUpperCase());
}

export function EvaluationPackageSidebar({ models, selectedRuntimeId, onSelect }: Props): JSX.Element {
  return (
    <aside className="min-w-0 border-b border-border/60 xl:border-b-0 xl:border-r">
      <div className="border-b border-border/60 bg-muted/20 px-3 py-2 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
        {models.length} registered {models.length === 1 ? 'package' : 'packages'}
      </div>
      <div className="max-h-[720px] overflow-y-auto">
        {models.map((model) => {
          const active = model.runtime_package_id === selectedRuntimeId;
          const parity = statusPass(model.parity_status);

          return (
            <button
              key={model.runtime_package_id}
              type="button"
              onClick={() => onSelect(model.runtime_package_id)}
              className={`w-full border-b border-border/50 p-3 text-left transition-colors ${
                active
                  ? 'bg-primary/10 shadow-[inset_3px_0_0_var(--primary)]'
                  : 'hover:bg-muted/30'
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <span className="min-w-0">
                  <span className="block truncate font-mono text-xs font-semibold">
                    {model.model_id}
                  </span>
                  <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
                    {taskLabel[model.task] ?? model.task}
                  </span>
                </span>
                <Badge
                  variant={statusVariant(model.status)}
                  className="rounded-none font-mono text-[9px] uppercase"
                >
                  {model.status}
                </Badge>
              </div>

              <div className="mt-2 flex items-center justify-between gap-2 text-[10px] text-muted-foreground">
                <span className="truncate font-mono">
                  {model.evaluation_run_id || 'NO EVALUATION'}
                </span>
                <span
                  className={`flex shrink-0 items-center gap-1 ${
                    parity
                      ? 'text-emerald-600 dark:text-emerald-300'
                      : 'text-amber-700 dark:text-amber-300'
                  }`}
                >
                  {parity ? <CheckCircle2 className="size-3" /> : <CircleAlert className="size-3" />}
                  parity
                </span>
              </div>
            </button>
          );
        })}
      </div>
    </aside>
  );
}
