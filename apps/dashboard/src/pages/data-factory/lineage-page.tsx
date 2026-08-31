import type { JSX } from 'react';
import { GitBranch } from 'lucide-react';

import { LineageMatrix } from '@/pages/preprocessing/components/LineageMatrix';

export default function DataFactoryLineagePage(): JSX.Element {
  return (
    <div className="space-y-6">
      <div>
        <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground"><GitBranch className="size-4 text-primary" /> Data Factory provenance</div>
        <h2 className="font-heading text-2xl font-semibold tracking-tight md:text-3xl">Lineage Explorer</h2>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">Duyệt cây phả hệ artifact từ Bronze source qua Silver Parquet đến lớp Gold downstream.</p>
      </div>
      <LineageMatrix />
    </div>
  );
}
