import type { JSX } from 'react';
import { HelpCircle } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

import { Card, CardContent } from '@/components/ui/card';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

export function number(value: number | null | undefined, digits = 2): string {
  return value == null || !Number.isFinite(value) ? '—' : value.toFixed(digits);
}

interface InfoProps {
  label: string;
  value: string;
  tooltip?: string;
  valueClass?: string;
}

export function Info({ label, value, tooltip, valueClass }: InfoProps): JSX.Element {
  return (
    <div>
      <dt className="flex items-center gap-1 font-mono text-xs uppercase tracking-[0.06em] text-muted-foreground">
        <span>{label}</span>
        {tooltip && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                className="inline-flex cursor-help text-muted-foreground/60 transition-colors hover:text-foreground focus:outline-none"
                aria-label={`Chú thích ${label}`}
              >
                <HelpCircle className="size-3" />
              </button>
            </TooltipTrigger>
            <TooltipContent
              side="top"
              className="max-w-xs rounded-none border border-border/80 bg-popover p-2.5 font-sans text-xs text-popover-foreground shadow-xl"
            >
              <p className="font-semibold text-primary">{label}</p>
              <p className="mt-1 leading-relaxed text-muted-foreground">{tooltip}</p>
            </TooltipContent>
          </Tooltip>
        )}
      </dt>
      <dd className={`mt-1 font-mono font-medium tabular-nums ${valueClass ?? ''}`}>{value}</dd>
    </div>
  );
}

interface MetricCardProps {
  icon: LucideIcon;
  label: string;
  value: string;
  detail: string;
  tooltip?: string;
}

export function MetricCard({
  icon: Icon,
  label,
  value,
  detail,
  tooltip,
}: MetricCardProps): JSX.Element {
  return (
    <Card className="rounded-none border border-border/80 py-0 shadow-none ring-0">
      <CardContent className="flex items-center gap-3 p-4">
        <div className="flex size-10 shrink-0 items-center justify-center border border-primary/20 bg-primary/5 text-primary">
          <Icon className="size-5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-1">
            <p className="font-mono text-xs uppercase tracking-[0.06em] text-muted-foreground">{label}</p>
            {tooltip && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    className="inline-flex cursor-help text-muted-foreground/60 transition-colors hover:text-foreground focus:outline-none"
                    aria-label={`Chú thích ${label}`}
                  >
                    <HelpCircle className="size-3" />
                  </button>
                </TooltipTrigger>
                <TooltipContent
                  side="top"
                  className="max-w-xs rounded-none border border-border/80 bg-popover p-2.5 font-sans text-xs text-popover-foreground shadow-xl"
                >
                  <p className="font-semibold text-primary">{label}</p>
                  <p className="mt-1 leading-relaxed text-muted-foreground">{tooltip}</p>
                </TooltipContent>
              </Tooltip>
            )}
          </div>
          <p className="truncate font-mono text-lg font-semibold tabular-nums">{value}</p>
          <p className="text-xs text-muted-foreground">{detail}</p>
        </div>
      </CardContent>
    </Card>
  );
}
