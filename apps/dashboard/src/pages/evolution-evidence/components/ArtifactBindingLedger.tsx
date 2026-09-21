import { useState, type JSX } from 'react';
import { Check, Copy, GitBranch } from 'lucide-react';
import type { ModelRecord } from '@/pages/model-registry/types';
import type { EvolutionEvaluation } from '../types';

interface ArtifactBindingLedgerProps {
  model: ModelRecord;
  evaluation: EvolutionEvaluation;
}

interface BindingItemProps {
  label: string;
  value?: string;
  isDigest?: boolean;
}

function BindingRow({ label, value, isDigest = false }: BindingItemProps): JSX.Element {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    if (!value) return;
    void navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="group relative flex min-w-0 flex-col justify-between border-b border-r border-border/60 bg-card p-3 transition-colors hover:bg-muted/10">
      <div className="flex items-center justify-between gap-1.5">
        <dt className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground">{label}</dt>
        {value && isDigest && (
          <button
            type="button"
            onClick={handleCopy}
            title="Copy cryptographic hash"
            aria-label={`Copy ${label}`}
            className="opacity-0 transition-opacity group-hover:opacity-100 hover:text-primary focus:opacity-100"
          >
            {copied ? (
              <Check className="size-3 text-emerald-500" />
            ) : (
              <Copy className="size-3 text-muted-foreground" />
            )}
          </button>
        )}
      </div>
      <dd
        className={`mt-1.5 truncate font-mono text-[11px] select-all ${
          value ? 'text-foreground' : 'text-muted-foreground/60 italic'
        }`}
        title={value}
      >
        {value || 'not recorded'}
      </dd>
    </div>
  );
}

export function ArtifactBindingLedger({
  model,
  evaluation,
}: ArtifactBindingLedgerProps): JSX.Element {
  return (
    <article className="min-w-0 bg-card">
      <header className="border-b border-border/60 px-4 py-3">
        <div className="flex items-center gap-2 text-sm font-medium text-foreground">
          <GitBranch className="size-4 text-primary" />
          Artifact Binding Ledger
        </div>
        <p className="mt-0.5 text-[11px] text-muted-foreground">
          Cryptographic SHA-256 digests and fingerprints required to deterministically reproduce this generation.
        </p>
      </header>

      <dl className="grid grid-cols-1 sm:grid-cols-2">
        <BindingRow
          label="Gold Manifest SHA-256"
          value={evaluation.gold_manifest_sha256}
          isDigest
        />
        <BindingRow
          label="Dataset Fingerprint"
          value={evaluation.dataset_view_fingerprint}
          isDigest
        />
        <BindingRow
          label="Training Manifest SHA-256"
          value={evaluation.training_run_manifest_sha256}
          isDigest
        />
        <BindingRow
          label="Evaluation Manifest SHA-256"
          value={evaluation.evaluation_run_manifest_sha256}
          isDigest
        />
        <BindingRow
          label="Metrics SHA-256"
          value={evaluation.metrics_sha256}
          isDigest
        />
        <BindingRow
          label="ONNX Model SHA-256"
          value={evaluation.onnx_sha256 ?? model.onnx_sha256}
          isDigest
        />
        <BindingRow
          label="Preprocessing Version"
          value={evaluation.preprocessing_version ?? model.preprocessing_version}
        />
        <BindingRow
          label="Threshold Policy"
          value={evaluation.threshold_policy_version}
        />
      </dl>
    </article>
  );
}
