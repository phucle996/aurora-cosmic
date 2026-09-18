import type { JSX } from 'react';
import { BrainCircuit, CircleAlert, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useModelWorkspace } from '@/hooks/useModelWorkspace';
import { ModelRegistryTable } from '../components/ModelRegistryTable';
import { SelectedModelDetails } from '../components/SelectedModelDetails';

export default function ModelRegistrySection(): JSX.Element {
  const {
    models,
    selectedModel,
    selectedRuntimeId,
    setSelectedRuntimeId,
    taskFilter,
    setTaskFilter,
    loading,
    refreshing,
    error,
    loadData,
    handleDeployModel,
    deploying,
    promotion,
  } = useModelWorkspace('registry');

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
        <div>
          <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
            <BrainCircuit className="size-4 text-primary" />
            AI Factory · Model Registry
          </div>
          <h2 className="font-heading text-2xl font-semibold tracking-tight md:text-3xl">Model Registry</h2>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            Quản lý version, candidate/validated/champion và deployment có thể rollback.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
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

      <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1.45fr)_minmax(320px,0.55fr)]">
        <ModelRegistryTable
          models={models}
          selectedRuntimeId={selectedRuntimeId}
          onSelectRuntimeId={setSelectedRuntimeId}
          taskFilter={taskFilter}
          onTaskFilterChange={setTaskFilter}
          loading={loading}
          onDeployModel={handleDeployModel}
          isDeploying={deploying}
          promotion={promotion}
        />

        <SelectedModelDetails
          selectedModel={selectedModel}
          onDeployModel={handleDeployModel}
          isDeploying={deploying}
        />
      </div>
    </div>
  );
}
