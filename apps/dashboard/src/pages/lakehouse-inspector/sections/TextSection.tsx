import type { JSX } from 'react';
import { Copy } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

interface TextSectionProps {
  textContent?: string;
}

export function TextSection({ textContent }: TextSectionProps): JSX.Element {
  return (
    <Card className="rounded-none border-border/70">
      <CardHeader className="p-4 border-b border-border/60 pb-3 flex flex-row items-center justify-between">
        <div>
          <CardTitle className="text-base font-semibold">Plain Text / Log</CardTitle>
          <CardDescription className="text-xs">Decoded UTF-8 content stream</CardDescription>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="h-8 text-xs font-mono"
          onClick={() => void navigator.clipboard.writeText(textContent ?? '')}
        >
          <Copy className="size-3.5 mr-1.5" />
          Copy Text
        </Button>
      </CardHeader>
      <CardContent className="p-4 bg-muted/20">
        <pre className="font-mono text-xs text-foreground overflow-x-auto p-4 bg-background border border-border/60 rounded-none max-h-[640px] whitespace-pre-wrap">
          {textContent}
        </pre>
      </CardContent>
    </Card>
  );
}
