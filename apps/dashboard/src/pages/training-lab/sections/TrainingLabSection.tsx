import type { JSX } from 'react';
import { BrainCircuit, CircleAlert, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useModelWorkspace } from '@/hooks/useModelWorkspace';
import { LiveTrainingBanner } from '../components/LiveTrainingBanner';
import { TrainingLabControl } from '../components/TrainingLabControl';
import { TrainingRuntimePanel } from '../components/TrainingRuntimePanel';

function TrainingStat({ label, value, detail }: { label: string; value: string | number; detail: string }): JSX.Element {
  return (
    <div className="min-w-0 bg-card p-3.5">
      <p className="font-mono text-[9px] uppercase tracking-[0.12em] text-muted-foreground">{label}</p>
      <p className="mt-1 font-mono text-lg font-semibold text-foreground">{value}</p>
      <p className="mt-0.5 truncate text-[10px] text-muted-foreground" title={detail}>
        {detail}
      </p>
    </div>
  );
}

export default function TrainingLabSection(): JSX.Element {
  const {
    models,
    loading,
    refreshing,
    error,
    loadData,
    availableSnapshots,
    snapshotsLoading,
    loadAvailableSnapshots,
    activeTraining,
    trainingElapsed,
    handleStartTraining,
    trainingSubmitting,
    validatedCount,
    championCount,
  } = useModelWorkspace('training');

  const untrainedSnapshots = availableSnapshots.filter((snapshot) => !snapshot.is_trained).length;

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="relative flex flex-col justify-between gap-4 overflow-hidden border border-border/70 bg-card px-4 py-5 shadow-sm sm:px-6 md:flex-row md:items-end">
        <div className="pointer-events-none absolute inset-0 opacity-[0.18] [background-image:linear-gradient(to_right,var(--border)_1px,transparent_1px),linear-gradient(to_bottom,var(--border)_1px,transparent_1px)] [background-size:28px_28px]" />
        <div className="relative">
          <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
            <BrainCircuit className="size-4 text-primary" />
            AI Factory / Experimental ML
          </div>
          <h2 className="font-heading text-2xl font-semibold tracking-tight md:text-3xl">Training Lab</h2>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            Thiết kế experiment từ immutable Gold snapshots, kiểm tra cohort, khóa cấu hình tái lập và quan sát tài nguyên huấn luyện.
          </p>
        </div>
        <div className="relative flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => void loadData(true)} disabled={loading || refreshing}>
            <RefreshCw className={`size-3.5 ${refreshing ? 'animate-spin' : ''}`} />
            Refresh evidence
          </Button>
        </div>
      </div>

      {/* Error Alert */}
      {error && (
        <div className="flex items-start gap-3 rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
          <CircleAlert className="mt-0.5 size-4 shrink-0" />
          <div>
            <p className="font-medium">Lỗi kết nối / Model Registry</p>
            <p className="mt-1 opacity-90">{error}</p>
          </div>
        </div>
      )}

      {/* Live GPU Training Active Monitor Banner */}
      {activeTraining && (activeTraining.status === 'queued' || activeTraining.status === 'running') && (
        <LiveTrainingBanner activeTraining={activeTraining} trainingElapsed={trainingElapsed} />
      )}

      <section
        aria-label="Training laboratory summary"
        className="grid gap-px overflow-hidden border border-border/70 bg-border/70 sm:grid-cols-2 xl:grid-cols-4"
      >
        <TrainingStat
          label="Committed Gold inputs"
          value={availableSnapshots.length || '—'}
          detail={snapshotsLoading ? 'Reading inventory…' : `${untrainedSnapshots} snapshots unused`}
        />
        <TrainingStat
          label="Registered models"
          value={models.length}
          detail={`${validatedCount} validated · ${championCount} champion`}
        />
        <TrainingStat
          label="Current experiment"
          value={activeTraining ? activeTraining.status.toUpperCase() : 'NONE'}
          detail={
            activeTraining
              ? `${activeTraining.computeTarget?.toUpperCase()} · ${activeTraining.jobId}`
              : 'No active experiment in this view'
          }
        />
        <TrainingStat label="Task contract" value="VETTING" detail="Light Curve + Target Pixel evidence" />
      </section>

      <TrainingLabControl
        models={models}
        availableSnapshots={availableSnapshots}
        snapshotsLoading={snapshotsLoading}
        onRefreshSnapshots={() => void loadAvailableSnapshots()}
        onSubmitTraining={handleStartTraining}
        submitting={trainingSubmitting}
        trainingProgress={activeTraining}
      />
      <TrainingRuntimePanel />
    </div>
  );
}
