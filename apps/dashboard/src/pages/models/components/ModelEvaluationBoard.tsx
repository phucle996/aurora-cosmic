import type { JSX } from 'react';
import { Activity, CheckCircle2, CircleAlert, FlaskConical } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

import { formatDate, statusVariant, taskLabel } from '../types';
import type { ModelRecord } from '../types';

export function ModelEvaluationBoard({ models, onSelect }: { models: ModelRecord[]; onSelect: (runtimePackageID: string) => void }): JSX.Element {
  return (
    <Card className="overflow-hidden">
      <CardHeader className="border-b border-border/60">
        <CardTitle className="flex items-center gap-2 text-base"><FlaskConical className="size-4 text-primary" /> Evaluation runs</CardTitle>
        <CardDescription>Chỉ hiển thị bằng chứng thực sự được Registry lưu: evaluation run, parity và trạng thái promotion; không bịa metric khoa học khi backend chưa xuất metric đó.</CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        {models.length === 0 ? <p className="p-8 text-center text-sm text-muted-foreground">Chưa có model để đánh giá.</p> : (
          <div className="divide-y divide-border/60">
            {models.map((model) => {
              const passed = model.parity_status.toLowerCase() === 'pass' || model.parity_status.toLowerCase() === 'passed';
              return <button key={model.runtime_package_id} type="button" onClick={() => onSelect(model.runtime_package_id)} className="grid w-full gap-3 p-4 text-left transition hover:bg-muted/30 md:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_auto] md:items-center">
                <div className="min-w-0"><p className="truncate font-mono text-xs font-semibold text-foreground">{model.model_id}</p><p className="mt-1 text-xs text-muted-foreground">{taskLabel[model.task] ?? model.task} · {formatDate(model.created_at)}</p></div>
                <div className="min-w-0 text-xs"><p className="flex items-center gap-1.5 text-muted-foreground"><Activity className="size-3.5 text-primary" /> {model.evaluation_run_id || 'evaluation run not recorded'}</p><p className="mt-1 flex items-center gap-1.5 text-muted-foreground">{passed ? <CheckCircle2 className="size-3.5 text-emerald-400" /> : <CircleAlert className="size-3.5 text-amber-400" />} ONNX parity: {model.parity_status || 'not recorded'}</p></div>
                <Badge variant={statusVariant(model.status)} className="justify-self-start md:justify-self-end">{model.status}</Badge>
              </button>;
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
