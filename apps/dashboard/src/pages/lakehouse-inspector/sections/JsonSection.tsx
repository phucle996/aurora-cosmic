import type { JSX } from 'react';
import { Copy, FileCode2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

interface JsonSectionProps {
  content: unknown;
}

export function JsonSection({ content }: JsonSectionProps): JSX.Element {
  const jsonString = JSON.stringify(content, null, 2);

  return (
    <Card className="rounded-none border-border/70">
      <CardHeader className="p-4 border-b border-border/60 pb-3 flex flex-row items-center justify-between">
        <div>
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <FileCode2 className="size-4 text-primary" />
            Formatted JSON Content
          </CardTitle>
          <CardDescription className="text-xs">Structured manifest / metadata payload</CardDescription>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="h-8 text-xs font-mono"
          onClick={() => void navigator.clipboard.writeText(jsonString)}
        >
          <Copy className="size-3.5 mr-1.5" />
          Copy JSON
        </Button>
      </CardHeader>
      <CardContent className="p-4 bg-muted/20">
        <pre className="font-mono text-xs text-foreground overflow-x-auto p-4 bg-background border border-border/60 rounded-none max-h-[640px]">
          {jsonString}
        </pre>
      </CardContent>
    </Card>
  );
}
