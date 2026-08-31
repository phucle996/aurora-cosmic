import { Component, type ErrorInfo, type ReactNode } from 'react';

type Props = { children: ReactNode };
type State = { failed: boolean };

export class AppErrorBoundary extends Component<Props, State> {
  public state: State = { failed: false };

  public static getDerivedStateFromError(): State {
    return { failed: true };
  }

  public componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Dashboard render failed', error, info);
  }

  public render(): ReactNode {
    if (this.state.failed) {
      return <div className="flex min-h-64 flex-col items-center justify-center gap-3 rounded-lg border border-destructive/40 bg-destructive/5 p-8 text-center"><h1 className="font-heading text-xl font-semibold">This dashboard view could not be rendered</h1><p className="max-w-lg text-sm text-muted-foreground">No pipeline data was changed. Reload this view after the frontend has recovered.</p><button className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground" onClick={() => window.location.reload()}>Reload dashboard</button></div>;
    }
    return this.props.children;
  }
}
