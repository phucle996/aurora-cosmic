import { useEffect, useRef, useState, type JSX } from 'react';
import {
  Activity,
  AlertOctagon,
  Check,
  CheckCircle2,
  Circle,
  Copy,
  Cpu,
  Eye,
  LoaderCircle,
  MonitorCog,
  RotateCcw,
  Scissors,
  Terminal,
  XCircle,
} from 'lucide-react';
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { ActiveTrainingState } from '../types';

interface LiveTrainingMonitorProps {
  activeTraining: ActiveTrainingState;
  trainingElapsed: number;
  onControl: (action: 'cancel' | 'checkpoint') => Promise<void>;
  onViewConfig: () => void;
  onNewRun: () => void;
}

const TRAINING_PHASES = [
  { key: 'gold', label: 'Gold load', phases: ['worker_acknowledged', 'loading_gold'] },
  { key: 'dataset', label: 'Dataset + split', phases: ['preparing_dataset'] },
  { key: 'training', label: 'Optimization', phases: ['training'] },
  { key: 'evaluation', label: 'Evaluation', phases: ['evaluating'] },
  {
    key: 'package',
    label: 'Runtime package',
    phases: ['packaging_runtime', 'persisting_artifacts', 'planning_inference', 'completed'],
  },
] as const;

const phaseLabels: Record<string, string> = {
  queued: 'Queued, waiting for ML worker confirmation…',
  worker_acknowledged: 'ML Worker accepted experiment specification',
  loading_gold: 'Validating and loading Gold snapshots',
  preparing_dataset: 'Building dataset and deterministic group split',
  training: 'Neural network parameter optimization',
  evaluating: 'Evaluating frozen validation cohort and confusion matrix',
  packaging_runtime: 'Packaging ONNX runtime artifact',
  persisting_artifacts: 'Persisting immutable manifest and weights',
  planning_inference: 'Planning verification inference run',
  completed: 'Experiment completed and Model Package registered',
  failed: 'Experiment execution failed',
  cancelled: 'Experiment cancelled by operator',
};

function formatElapsed(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remaining = seconds % 60;
  return hours > 0
    ? `${hours}h ${String(minutes).padStart(2, '0')}m ${String(remaining).padStart(2, '0')}s`
    : `${minutes}m ${String(remaining).padStart(2, '0')}s`;
}

export function LiveTrainingMonitor({
  activeTraining,
  trainingElapsed,
  onControl,
  onViewConfig,
  onNewRun,
}: LiveTrainingMonitorProps): JSX.Element {
  const [autoScroll, setAutoScroll] = useState(true);
  const [controlLoading, setControlLoading] = useState<'cancel' | 'checkpoint' | null>(null);
  const logContainerRef = useRef<HTMLDivElement>(null);

  const isRunning = activeTraining.status === 'running' || activeTraining.status === 'queued';
  const isCompleted = activeTraining.status === 'completed';
  const isCancelled = activeTraining.status === 'cancelled';
  const isFailed = activeTraining.status === 'failed';
  const observedPercent = Math.max(0, Math.min(100, activeTraining.progressPercent ?? 0));
  const currentPhaseIndex = TRAINING_PHASES.findIndex((stage) =>
    stage.phases.includes(activeTraining.phase as never),
  );
  const logs = activeTraining.logs ?? [];
  const lossHistory = activeTraining.lossHistory ?? [];

  useEffect(() => {
    if (autoScroll && logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [logs, autoScroll]);

  const handleAction = async (action: 'cancel' | 'checkpoint') => {
    setControlLoading(action);
    try {
      await onControl(action);
    } finally {
      setControlLoading(null);
    }
  };

  const copyLogs = () => {
    if (!logs.length) return;
    const text = logs.map((l) => `[${l.timestamp}] ${l.message}`).join('\n');
    void navigator.clipboard.writeText(text);
    toast.success('Console logs copied to clipboard');
  };

  return (
    <section className="min-w-0 border border-border/80 bg-card shadow-sm">
      {/* Header */}
      <header className="flex flex-col gap-3 border-b border-border/60 p-4 sm:flex-row sm:items-start sm:justify-between sm:p-5">
        <div>
          <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-primary">
            <span>Experiment protocol / candidate vetting</span>
            <Badge
              variant="outline"
              className={`rounded-none font-mono text-[9px] ${
                isRunning
                  ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                  : isCompleted
                    ? 'border-sky-500/50 bg-sky-500/10 text-sky-600 dark:text-sky-400'
                    : isCancelled
                      ? 'border-amber-500/50 bg-amber-500/10 text-amber-600 dark:text-amber-400'
                      : 'border-destructive/50 bg-destructive/10 text-destructive'
              }`}
            >
              {isRunning ? (
                <span className="flex items-center gap-1">
                  <Activity className="size-2.5 animate-pulse" /> RUNNING
                </span>
              ) : isCompleted ? (
                <span className="flex items-center gap-1">
                  <CheckCircle2 className="size-2.5" /> COMPLETED
                </span>
              ) : isCancelled ? (
                <span className="flex items-center gap-1">
                  <AlertOctagon className="size-2.5" /> CANCELLED
                </span>
              ) : (
                <span className="flex items-center gap-1">
                  <XCircle className="size-2.5" /> FAILED
                </span>
              )}
            </Badge>
          </div>

          <h3 className="mt-1 font-heading text-lg font-semibold">
            Training run · {activeTraining.ticketId}
          </h3>

          <p className="mt-0.5 text-xs text-muted-foreground">
            {phaseLabels[activeTraining.phase ?? activeTraining.status] ?? activeTraining.phase}
          </p>
        </div>

        {/* Actions */}
        <div className="flex flex-wrap items-center gap-2">
          {isRunning && (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={() => void handleAction('checkpoint')}
                disabled={controlLoading !== null || activeTraining.phase !== 'training'}
                title="Stop optimization early, preserve best epoch checkpoint and package ONNX runtime."
                className="rounded-none border-primary/40 gap-1.5 hover:bg-primary/10"
              >
                {controlLoading === 'checkpoint' ? (
                  <LoaderCircle className="size-3.5 animate-spin" />
                ) : (
                  <Scissors className="size-3.5 text-primary" />
                )}
                Stop at best checkpoint
              </Button>

              <Button
                variant="destructive"
                size="sm"
                onClick={() => void handleAction('cancel')}
                disabled={controlLoading !== null}
                title="Cancel this training execution completely."
                className="rounded-none gap-1.5"
              >
                {controlLoading === 'cancel' ? (
                  <LoaderCircle className="size-3.5 animate-spin" />
                ) : (
                  <XCircle className="size-3.5" />
                )}
                Cancel run
              </Button>

              <Button
                variant="ghost"
                size="sm"
                onClick={onViewConfig}
                className="rounded-none gap-1.5 text-xs text-muted-foreground hover:text-foreground"
                title="Inspect locked parameters for this run."
              >
                <Eye className="size-3.5" />
                View config
              </Button>
            </>
          )}

          {!isRunning && (
            <Button
              onClick={onNewRun}
              size="sm"
              variant="outline"
              className="rounded-none gap-1.5"
            >
              <RotateCcw className="size-3.5 text-primary" />
              Configure new run
            </Button>
          )}
        </div>
      </header>

      {/* Fact Strip */}
      <div className="grid grid-cols-2 gap-px border-b border-border/60 bg-border/60 sm:grid-cols-3 lg:grid-cols-6">
        <div className="bg-card p-3">
          <p className="font-mono text-[9px] uppercase tracking-wide text-muted-foreground">Compute target</p>
          <p className="mt-1 flex items-center gap-1.5 font-mono text-xs font-medium">
            {activeTraining.computeTarget === 'gpu' ? (
              <MonitorCog className="size-3.5 text-sky-500" />
            ) : (
              <Cpu className="size-3.5 text-amber-500" />
            )}
            {activeTraining.computeTarget?.toUpperCase() || 'GPU'}
          </p>
        </div>

        <div className="bg-card p-3">
          <p className="font-mono text-[9px] uppercase tracking-wide text-muted-foreground">Epoch progress</p>
          <p className="mt-1 font-mono text-xs font-medium">
            {activeTraining.currentEpoch ?? 0} / {activeTraining.totalEpochs ?? activeTraining.epochs}
          </p>
        </div>

        <div className="bg-card p-3">
          <p className="font-mono text-[9px] uppercase tracking-wide text-muted-foreground">Best Epoch</p>
          <p className="mt-1 font-mono text-xs font-semibold text-emerald-600 dark:text-emerald-400">
            {activeTraining.bestEpoch ? `Epoch ${activeTraining.bestEpoch}` : '—'}
          </p>
        </div>

        <div className="bg-card p-3">
          <p className="font-mono text-[9px] uppercase tracking-wide text-muted-foreground">Best Val Loss</p>
          <p className="mt-1 font-mono text-xs font-semibold tabular-nums text-foreground">
            {Number.isFinite(activeTraining.bestValidationLoss)
              ? activeTraining.bestValidationLoss?.toFixed(5)
              : '—'}
          </p>
        </div>

        <div className="bg-card p-3">
          <p className="font-mono text-[9px] uppercase tracking-wide text-muted-foreground">Gold snapshots</p>
          <p className="mt-1 font-mono text-xs font-medium">
            {activeTraining.snapshotCount} snapshots
          </p>
        </div>

        <div className="bg-card p-3">
          <p className="font-mono text-[9px] uppercase tracking-wide text-muted-foreground">Elapsed time</p>
          <p className="mt-1 font-mono text-xs font-medium tabular-nums">
            {formatElapsed(trainingElapsed)}
          </p>
        </div>
      </div>

      {/* 5-Phase Stepper */}
      <div className="border-b border-border/60 p-4 sm:p-5">
        <div className="flex items-center justify-between text-xs">
          <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            Experiment Progress (5 phases)
          </span>
          <span className="font-mono text-xs font-semibold tabular-nums text-foreground">
            {observedPercent.toFixed(0)}%
          </span>
        </div>

        <div className="mt-2 h-1.5 overflow-hidden bg-muted">
          <div
            className={`h-full transition-[width] duration-300 ${
              isFailed || isCancelled
                ? 'bg-destructive'
                : isCompleted
                  ? 'bg-emerald-500'
                  : 'bg-primary'
            }`}
            style={{ width: `${observedPercent}%` }}
          />
        </div>

        <div className="mt-4 grid grid-cols-5 gap-2">
          {TRAINING_PHASES.map((stage, index) => {
            const isDone = isCompleted || currentPhaseIndex > index;
            const isActive = !isFailed && !isCancelled && currentPhaseIndex === index;
            return (
              <div key={stage.key} className="min-w-0">
                <div
                  className={`flex h-7 items-center justify-center border transition-colors ${
                    isDone
                      ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                      : isActive
                        ? 'border-primary/60 bg-primary/10 text-primary ring-1 ring-primary/30'
                        : 'border-border/70 bg-muted/20 text-muted-foreground'
                  }`}
                >
                  {isDone ? (
                    <Check className="size-3.5" />
                  ) : isActive ? (
                    <LoaderCircle className="size-3.5 animate-spin" />
                  ) : (
                    <Circle className="size-2.5" />
                  )}
                </div>
                <p
                  className={`mt-1.5 truncate text-center font-mono text-[9px] uppercase tracking-wide ${
                    isActive ? 'font-semibold text-primary' : 'text-muted-foreground'
                  }`}
                  title={stage.label}
                >
                  {stage.label}
                </p>
              </div>
            );
          })}
        </div>
      </div>

      {/* Loss Curve & Logs Grid */}
      <div className="grid min-w-0 xl:grid-cols-[minmax(0,1.25fr)_minmax(20rem,0.75fr)]">
        {/* Loss Curve Chart */}
        <div className="min-w-0 border-b border-border/60 p-4 sm:p-5 xl:border-b-0 xl:border-r">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-mono text-[9px] uppercase tracking-[0.18em] text-primary">
                Real-time Optimization / Loss Convergence
              </p>
              <h4 className="mt-0.5 text-sm font-semibold">Loss Curve</h4>
            </div>
            {lossHistory.length > 0 && (
              <div className="flex items-center gap-3 font-mono text-[10px]">
                <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
                  <span className="size-1.5 rounded-full bg-emerald-500" />
                  Train: {lossHistory.at(-1)?.trainLoss.toFixed(4)}
                </span>
                <span className="flex items-center gap-1 text-sky-600 dark:text-sky-400">
                  <span className="size-1.5 rounded-full bg-sky-500" />
                  Val: {lossHistory.at(-1)?.valLoss.toFixed(4)}
                </span>
              </div>
            )}
          </div>

          <div className="mt-3">
            {lossHistory.length === 0 ? (
              <div className="flex min-h-[240px] flex-col items-center justify-center border border-dashed border-border/70 p-6 text-center">
                <LoaderCircle className="size-5 animate-spin text-muted-foreground" />
                <p className="mt-2 text-xs font-medium text-foreground">
                  {activeTraining.phase === 'training'
                    ? 'Calculating first epoch…'
                    : 'Preparing dataset and initializing neural network…'}
                </p>
                <p className="mt-0.5 text-[10px] text-muted-foreground">
                  Loss curve updates automatically with each epoch streamed via SSE.
                </p>
              </div>
            ) : (
              <div className="h-[250px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={lossHistory} margin={{ top: 10, right: 20, bottom: 5, left: -10 }}>
                    <CartesianGrid vertical={false} strokeDasharray="3 3" opacity={0.2} />
                    <XAxis
                      dataKey="epoch"
                      tick={{ fontSize: 10 }}
                      tickLine={false}
                      label={{ value: 'Epoch', position: 'insideBottomRight', offset: -4, fontSize: 10 }}
                    />
                    <YAxis
                      tick={{ fontSize: 10 }}
                      tickLine={false}
                      domain={['auto', 'auto']}
                      tickFormatter={(val) => Number(val).toFixed(3)}
                      width={48}
                    />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: 'hsl(var(--card))',
                        borderColor: 'hsl(var(--border))',
                        fontSize: 11,
                      }}
                      formatter={(value, name) => [
                        Number(value).toFixed(5),
                        name === 'trainLoss' ? 'Train Loss' : 'Validation Loss',
                      ]}
                      labelFormatter={(label) => `Epoch ${label}`}
                    />
                    <Legend wrapperStyle={{ fontSize: 11, paddingTop: 4 }} />
                    <Line
                      type="monotone"
                      dataKey="trainLoss"
                      name="Train Loss"
                      stroke="#10b981"
                      strokeWidth={2}
                      dot={false}
                      isAnimationActive={false}
                    />
                    <Line
                      type="monotone"
                      dataKey="valLoss"
                      name="Validation Loss"
                      stroke="#0ea5e9"
                      strokeWidth={2}
                      dot={{ r: 2 }}
                      activeDot={{ r: 4 }}
                      isAnimationActive={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
        </div>

        {/* Worker Console Logs */}
        <div className="min-w-0 p-4 sm:p-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-[0.18em] text-primary">
              <Terminal className="size-3.5" />
              <span>Worker Console Logs</span>
              <Badge variant="outline" className="rounded-none font-mono text-[8px]">
                {logs.length}
              </Badge>
            </div>

            <div className="flex items-center gap-2">
              <label className="flex cursor-pointer items-center gap-1 text-[10px] text-muted-foreground">
                <input
                  type="checkbox"
                  checked={autoScroll}
                  onChange={(e) => setAutoScroll(e.target.checked)}
                  className="size-2.5 rounded-none"
                />
                Scroll
              </label>
              <Button
                variant="ghost"
                size="sm"
                onClick={copyLogs}
                disabled={logs.length === 0}
                className="h-6 rounded-none px-1.5 text-[10px]"
              >
                <Copy className="mr-1 size-2.5" />
                Copy
              </Button>
            </div>
          </div>

          <div
            ref={logContainerRef}
            className="mt-3 h-[250px] overflow-y-auto bg-zinc-950 p-2.5 font-mono text-[10px] leading-4 text-zinc-300 border border-border/80"
          >
            {logs.length === 0 ? (
              <div className="flex h-full items-center justify-center text-zinc-500">
                Waiting for next event from ML Worker…
              </div>
            ) : (
              logs.map((log, idx) => (
                <div key={idx} className="flex items-start gap-1.5 hover:bg-zinc-900/50">
                  <span className="shrink-0 text-zinc-500">[{log.timestamp}]</span>
                  <span
                    className={
                      log.level === 'error'
                        ? 'text-rose-400'
                        : log.level === 'warn'
                          ? 'text-amber-400'
                          : log.level === 'success'
                            ? 'text-emerald-400'
                            : 'text-zinc-200'
                    }
                  >
                    {log.message}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Footer */}
      <footer className="flex flex-col gap-3 border-t border-border/60 bg-muted/15 p-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
        <div className="min-w-0">
          <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
            Experiment Execution Summary
          </p>
          <p className="mt-0.5 truncate font-mono text-xs text-foreground">
            Run: {activeTraining.ticketId} · {activeTraining.computeTarget?.toUpperCase()} · {activeTraining.snapshotCount} snapshots
            {isCompleted ? ' · Artifacts persisted and registered in Model Registry' : ''}
          </p>
        </div>

        {isCompleted && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onNewRun}
            className="rounded-none gap-1.5"
          >
            <RotateCcw className="size-3.5" />
            Configure new run
          </Button>
        )}
      </footer>
    </section>
  );
}
