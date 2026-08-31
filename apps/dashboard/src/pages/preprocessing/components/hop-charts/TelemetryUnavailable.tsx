import type { JSX } from 'react';

export function TelemetryUnavailable({ detail = 'Worker chưa phát telemetry cho component này.' }: { detail?: string }): JSX.Element {
  return (
    <div className="flex h-[min(28svh,280px)] items-center justify-center rounded-md border border-dashed border-border/70 bg-background/40 p-6 text-center text-xs text-muted-foreground">
      <div><p className="font-semibold text-foreground">Chưa có telemetry quan sát được</p><p className="mt-1 max-w-md">{detail}</p></div>
    </div>
  );
}
