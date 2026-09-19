import { useState } from 'react';
import type { JSX } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';

interface EmptyInspectorProps {
  onInspect: (key: string) => void;
}

export function EmptyInspector({ onInspect }: EmptyInspectorProps): JSX.Element {
  const [inputKey, setInputKey] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (inputKey.trim()) {
      onInspect(inputKey.trim());
    }
  };

  return (
    <Card className="rounded-none border-border/80">
      <CardHeader>
        <CardTitle className="text-base">Inspect an Object</CardTitle>
        <CardDescription>
          Enter any S3 key from the Aurora Medallion Lakehouse to inspect schema, scientific headers, or content.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="flex gap-2 max-w-xl">
          <Input
            placeholder="e.g. bronze/tess/... or silver/... or gold/snapshots/..."
            value={inputKey}
            onChange={(e) => setInputKey(e.target.value)}
            className="font-mono text-xs"
          />
          <Button type="submit" size="sm" className="font-mono text-xs shrink-0">
            Inspect Object
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
