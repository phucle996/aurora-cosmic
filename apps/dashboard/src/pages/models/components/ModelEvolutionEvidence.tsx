import { Link } from 'react-router-dom';
import type { JSX } from 'react';
import { BadgeCheck, Box, Database, GitBranch, ShieldCheck } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

import { formatDate, formatBytes, statusVariant, taskLabel } from '../types';
import type { InferenceJob, ModelRecord } from '../types';

interface ModelEvolutionEvidenceProps {
  model?: ModelRecord;
  jobs?: InferenceJob[];
  compact?: boolean;
}

export function ModelEvolutionEvidence({ model, jobs = [], compact = false }: ModelEvolutionEvidenceProps): JSX.Element {
  if (!model) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-sm text-muted-foreground">
          Chọn một model trong Registry để xem chuỗi bằng chứng tiến hóa.
        </CardContent>
      </Card>
    );
  }

  const linkedJobs = jobs.filter((job) => job.model_id === model.model_id || job.runtime_package_id === model.runtime_package_id);
  const completedJobs = linkedJobs.filter((job) => job.status === 'completed').length;

  return (
    <Card className="overflow-hidden">
      <CardHeader className="border-b border-border/60 bg-muted/10">
        <CardTitle className="flex items-center gap-2 text-base">
          <GitBranch className="size-4 text-primary" />
          Evolution Evidence
        </CardTitle>
        <CardDescription>
          Chuỗi bất biến từ Gold input đến runtime package và inference output của model này.
        </CardDescription>
      </CardHeader>
      <CardContent className={compact ? 'p-4' : 'p-5'}>
        <div className="grid gap-3 lg:grid-cols-4">
          <EvidenceNode icon={Database} eyebrow="Training input" title="Gold snapshot" tone="cyan">
            {model.gold_snapshot_id ? (
              <Link className="font-mono text-xs text-primary hover:underline" to={`/gold/snapshots/${encodeURIComponent(model.gold_snapshot_id)}`}>
                {model.gold_snapshot_id}
              </Link>
            ) : <span className="text-xs text-muted-foreground">Chưa ghi nhận snapshot</span>}
          </EvidenceNode>
          <EvidenceNode icon={BadgeCheck} eyebrow="Evaluation gate" title="Quality evidence" tone="emerald">
            <p className="font-mono text-xs text-foreground">{model.evaluation_run_id || 'evaluation run pending'}</p>
            <p className="mt-1 text-[11px] text-muted-foreground">Parity: {model.parity_status || 'not recorded'}</p>
          </EvidenceNode>
          <EvidenceNode icon={Box} eyebrow="Registered artifact" title="Runtime package" tone="violet">
            <p className="truncate font-mono text-xs text-foreground" title={model.runtime_package_id}>{model.runtime_package_id}</p>
            <p className="mt-1 text-[11px] text-muted-foreground">ONNX {formatBytes(model.onnx_size_bytes)} · SHA {model.onnx_sha256.slice(0, 12) || '—'}</p>
          </EvidenceNode>
          <EvidenceNode icon={ShieldCheck} eyebrow="Serving evidence" title="Inference use" tone="amber">
            <p className="text-xs font-medium text-foreground">{completedJobs} completed / {linkedJobs.length} total jobs</p>
            <p className="mt-1 text-[11px] text-muted-foreground">Registry status: <Badge variant={statusVariant(model.status)} className="ml-1 h-4 px-1 text-[9px]">{model.status}</Badge></p>
          </EvidenceNode>
        </div>

        {!compact && (
          <div className="mt-4 rounded-md border border-border/70 bg-muted/20 p-3 text-xs">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-muted-foreground">
              <span>{taskLabel[model.task] ?? model.task}</span><span>→</span>
              <span>created {formatDate(model.created_at)}</span><span>→</span>
              <span className="font-mono">{model.preprocessing_version}</span><span>→</span>
              <span>{model.feature_count} ordered features</span>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function EvidenceNode({ icon: Icon, eyebrow, title, tone, children }: {
  icon: typeof Database;
  eyebrow: string;
  title: string;
  tone: 'cyan' | 'emerald' | 'violet' | 'amber';
  children: JSX.Element | JSX.Element[];
}): JSX.Element {
  const classes = {
    cyan: 'border-cyan-500/30 bg-cyan-500/5 text-cyan-400',
    emerald: 'border-emerald-500/30 bg-emerald-500/5 text-emerald-400',
    violet: 'border-violet-500/30 bg-violet-500/5 text-violet-400',
    amber: 'border-amber-500/30 bg-amber-500/5 text-amber-400',
  }[tone];
  return (
    <div className={`min-w-0 rounded-lg border p-3 ${classes}`}>
      <div className="mb-2 flex items-center gap-2"><Icon className="size-3.5" /><span className="text-[10px] font-semibold uppercase tracking-wide">{eyebrow}</span></div>
      <p className="mb-1 text-xs font-semibold text-foreground">{title}</p>
      {children}
    </div>
  );
}
