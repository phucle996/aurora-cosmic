import { useMemo, type JSX } from 'react';
import { BrainCircuit, Cpu, FlaskConical, MonitorCog } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { ModelRecord } from '@/pages/model-registry/types';

interface ExperimentSpecPanelProps {
  models: ModelRecord[];
  intent: 'new' | 'evolve';
  onIntentChange: (intent: 'new' | 'evolve') => void;
  baseModelId: string;
  onBaseModelIdChange: (id: string) => void;
  computeTarget: 'cpu' | 'gpu';
  onComputeTargetChange: (target: 'cpu' | 'gpu') => void;
  epochs: string;
  onEpochsChange: (epochs: string) => void;
  batchSize: string;
  onBatchSizeChange: (batchSize: string) => void;
  learningRate: string;
  onLearningRateChange: (lr: string) => void;
  seed: string;
  onSeedChange: (seed: string) => void;
}

export function ExperimentSpecPanel({
  models,
  intent,
  onIntentChange,
  baseModelId,
  onBaseModelIdChange,
  computeTarget,
  onComputeTargetChange,
  epochs,
  onEpochsChange,
  batchSize,
  onBatchSizeChange,
  learningRate,
  onLearningRateChange,
  seed,
  onSeedChange,
}: ExperimentSpecPanelProps): JSX.Element {
  const baseModels = useMemo(
    () => models.filter((model) => model.task === 'candidate_vetting'),
    [models],
  );

  return (
    <div className="min-w-0 p-4 sm:p-5">
      <div>
        <p className="font-mono text-[9px] uppercase tracking-[0.18em] text-primary">
          02 / Experiment Specification
        </p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Persisted locally and attached to job metadata dispatched to the ML Worker.
        </p>
      </div>

      <div className="mt-3 space-y-4">
        {/* Strategy Selector */}
        <div className="grid grid-cols-2 gap-px border border-border/70 bg-border/70">
          <button
            type="button"
            onClick={() => onIntentChange('new')}
            className={`p-3 text-left transition-colors ${
              intent === 'new' ? 'bg-primary text-primary-foreground' : 'bg-background hover:bg-muted/40'
            }`}
          >
            <span className="flex items-center gap-2 text-xs font-semibold">
              <FlaskConical className="size-4" />
              Train new
            </span>
            <span
              className={`mt-1 block text-[10px] ${
                intent === 'new' ? 'text-primary-foreground/75' : 'text-muted-foreground'
              }`}
            >
              Random weight initialization (Scratch)
            </span>
          </button>

          <button
            type="button"
            onClick={() => onIntentChange('evolve')}
            className={`p-3 text-left transition-colors ${
              intent === 'evolve' ? 'bg-primary text-primary-foreground' : 'bg-background hover:bg-muted/40'
            }`}
          >
            <span className="flex items-center gap-2 text-xs font-semibold">
              <BrainCircuit className="size-4" />
              Evolve
            </span>
            <span
              className={`mt-1 block text-[10px] ${
                intent === 'evolve' ? 'text-primary-foreground/75' : 'text-muted-foreground'
              }`}
            >
              Fine-tune from base model weights
            </span>
          </button>
        </div>

        {/* Base Model Dropdown when Evolve */}
        {intent === 'evolve' && (
          <label className="block space-y-1.5">
            <span className="text-xs font-medium">Base model</span>
            <select
              className="h-9 w-full rounded-none border border-input bg-background px-3 font-mono text-xs"
              value={baseModelId}
              onChange={(event) => onBaseModelIdChange(event.target.value)}
            >
              <option value="champion">Current Champion model</option>
              {baseModels.map((model) => (
                <option key={model.model_id} value={model.model_id}>
                  {model.model_id} · {model.model_version}
                </option>
              ))}
            </select>
          </label>
        )}

        {/* Compute Target */}
        <div>
          <Label className="text-xs">Compute target</Label>
          <div className="mt-1.5 grid grid-cols-2 gap-px border border-border/70 bg-border/70">
            <button
              type="button"
              onClick={() => onComputeTargetChange('gpu')}
              className={`p-3 text-left transition-colors ${
                computeTarget === 'gpu' ? 'bg-sky-500 text-white' : 'bg-background hover:bg-muted/40'
              }`}
            >
              <span className="flex items-center gap-2 text-xs font-semibold">
                <MonitorCog className="size-4" />
                GPU
              </span>
              <span
                className={`mt-1 block text-[10px] ${
                  computeTarget === 'gpu' ? 'text-white/75' : 'text-muted-foreground'
                }`}
              >
                CUDA + AMP FP16
              </span>
            </button>

            <button
              type="button"
              onClick={() => onComputeTargetChange('cpu')}
              className={`p-3 text-left transition-colors ${
                computeTarget === 'cpu' ? 'bg-sky-500 text-white' : 'bg-background hover:bg-muted/40'
              }`}
            >
              <span className="flex items-center gap-2 text-xs font-semibold">
                <Cpu className="size-4" />
                CPU
              </span>
              <span
                className={`mt-1 block text-[10px] ${
                  computeTarget === 'cpu' ? 'text-white/75' : 'text-muted-foreground'
                }`}
              >
                Reproducible baseline
              </span>
            </button>
          </div>
        </div>

        {/* Hyperparameter Inputs */}
        <div className="grid grid-cols-2 gap-3">
          <label className="block space-y-1.5">
            <span className="text-xs font-medium">Epochs</span>
            <Input
              type="number"
              min="1"
              value={epochs}
              onChange={(event) => onEpochsChange(event.target.value)}
              className="rounded-none font-mono text-xs"
            />
          </label>

          <label className="block space-y-1.5">
            <span className="text-xs font-medium">Batch size</span>
            <Input
              type="number"
              min="1"
              value={batchSize}
              onChange={(event) => onBatchSizeChange(event.target.value)}
              className="rounded-none font-mono text-xs"
            />
          </label>

          <label className="block space-y-1.5">
            <span className="text-xs font-medium">Learning rate</span>
            <Input
              type="number"
              min="0.000001"
              step="0.0001"
              value={learningRate}
              onChange={(event) => onLearningRateChange(event.target.value)}
              className="rounded-none font-mono text-xs"
            />
          </label>

          <label className="block space-y-1.5">
            <span className="text-xs font-medium">Random seed</span>
            <Input
              type="number"
              min="0"
              value={seed}
              onChange={(event) => onSeedChange(event.target.value)}
              className="rounded-none font-mono text-xs"
            />
          </label>
        </div>

        <div className="border-l-2 border-primary bg-muted/20 px-3 py-2 text-[10px] leading-4 text-muted-foreground">
          <span className="font-medium text-foreground">Reproducibility Contract.</span> Snapshot IDs, base model, seed, and all hyperparameters are locked into a deterministic experiment specification.
        </div>
      </div>
    </div>
  );
}
