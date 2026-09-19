import { useState } from 'react';
import type { JSX } from 'react';
import { ArrowLeft, Check, Copy, Database, RefreshCw } from 'lucide-react';
import { Link } from 'react-router-dom';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { formatBytes, formatDate, type StoragePreviewResponse } from '../../lakehouse/types';

interface InspectorHeaderProps {
  objectKey: string;
  data: StoragePreviewResponse | null;
  loading: boolean;
  onRefresh: () => void;
}

export function InspectorHeader({ objectKey, data, loading, onRefresh }: InspectorHeaderProps): JSX.Element {
  const [copiedKey, setCopiedKey] = useState(false);
  const [copiedSha, setCopiedSha] = useState(false);

  const copyToClipboard = (text: string, type: 'key' | 'sha') => {
    void navigator.clipboard.writeText(text);
    if (type === 'key') {
      setCopiedKey(true);
      setTimeout(() => setCopiedKey(false), 2000);
    } else {
      setCopiedSha(true);
      setTimeout(() => setCopiedSha(false), 2000);
    }
  };

  const formatBadgeVariant = (format?: string) => {
    switch (format) {
      case 'parquet':
        return 'default';
      case 'fits':
        return 'secondary';
      case 'json':
        return 'outline';
      default:
        return 'outline';
    }
  };

  const tierBadgeVariant = (tier?: string) => {
    switch (tier) {
      case 'gold':
        return 'default';
      case 'silver':
        return 'secondary';
      case 'bronze':
        return 'outline';
      default:
        return 'outline';
    }
  };

  return (
    <div className="space-y-4">
      {/* Navigation Breadcrumb */}
      <div>
        <Button asChild variant="ghost" size="sm" className="-ml-3 gap-1.5 font-mono text-xs text-muted-foreground hover:text-foreground">
          <Link to="/lakehouse">
            <ArrowLeft className="size-4" />
            Back to Lakehouse Catalog
          </Link>
        </Button>
      </div>

      {/* Header Banner */}
      <section className="relative overflow-hidden border border-border/70 bg-card p-5 shadow-sm sm:p-6">
        <div className="pointer-events-none absolute inset-0 opacity-[0.15] [background-image:linear-gradient(to_right,var(--border)_1px,transparent_1px),linear-gradient(to_bottom,var(--border)_1px,transparent_1px)] [background-size:28px_28px]" />
        <div className="relative flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="space-y-2 min-w-0 max-w-4xl">
            <div className="flex flex-wrap items-center gap-2">
              <span className="flex items-center gap-1.5 font-mono text-[10px] font-semibold uppercase tracking-wider text-primary">
                <Database className="size-3.5" />
                Lakehouse Object Inspector
              </span>
              {data?.tier && (
                <Badge variant={tierBadgeVariant(data.tier)} className="font-mono text-[10px] uppercase">
                  {data.tier} tier
                </Badge>
              )}
              {data?.format && (
                <Badge variant={formatBadgeVariant(data.format)} className="font-mono text-[10px] uppercase">
                  {data.format}
                </Badge>
              )}
            </div>

            <h2 className="font-mono text-xl font-bold tracking-tight text-foreground sm:text-2xl break-all">
              {objectKey || 'No Object Selected'}
            </h2>

            {data && (
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-xs text-muted-foreground">
                <span>Size: <strong className="text-foreground">{formatBytes(data.size_bytes)}</strong></span>
                <span>•</span>
                <span>Modified: <strong className="text-foreground">{formatDate(data.last_modified)}</strong></span>
                {data.content_sha256 && (
                  <>
                    <span>•</span>
                    <span className="flex items-center gap-1.5">
                      SHA: <code className="text-foreground">{data.content_sha256.slice(0, 10)}…</code>
                      <button
                        type="button"
                        onClick={() => copyToClipboard(data.content_sha256, 'sha')}
                        className="text-muted-foreground hover:text-foreground"
                        title="Copy full SHA-256"
                      >
                        {copiedSha ? <Check className="size-3 text-green-500" /> : <Copy className="size-3" />}
                      </button>
                    </span>
                  </>
                )}
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            {objectKey && (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => copyToClipboard(objectKey, 'key')}
                  className="h-8 gap-1.5 text-xs font-mono"
                >
                  {copiedKey ? <Check className="size-3.5 text-green-500" /> : <Copy className="size-3.5" />}
                  {copiedKey ? 'Key Copied' : 'Copy Key'}
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={onRefresh}
                  disabled={loading}
                  className="h-8 gap-1.5 text-xs font-mono"
                >
                  <RefreshCw className={`size-3.5 ${loading ? 'animate-spin' : ''}`} />
                  Refresh
                </Button>
              </>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
