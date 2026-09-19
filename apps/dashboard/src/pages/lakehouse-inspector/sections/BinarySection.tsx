import type { JSX } from 'react';
import { Layers } from 'lucide-react';

import { Card } from '@/components/ui/card';
import { formatBytes } from '../../lakehouse/types';

interface BinarySectionProps {
  sizeBytes: number;
  contentSha256: string;
}

export function BinarySection({ sizeBytes, contentSha256 }: BinarySectionProps): JSX.Element {
  return (
    <Card className="rounded-none border-border/70 p-12 text-center space-y-3">
      <Layers className="size-12 text-muted-foreground mx-auto" />
      <h4 className="text-base font-semibold text-foreground">Binary Lakehouse Object</h4>
      <p className="text-xs text-muted-foreground max-w-md mx-auto">
        This file is stored as binary data without an inline text or table decoder.
        File size is {formatBytes(sizeBytes)} with SHA-256 fingerprint{' '}
        <code className="text-foreground font-mono">{contentSha256}</code>.
      </p>
    </Card>
  );
}
