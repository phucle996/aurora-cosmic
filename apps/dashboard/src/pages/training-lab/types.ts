export type TrainingParams = {
  task: 'candidate_vetting';
  baseModelId: string;
  mode: 'fine_tune' | 'scratch';
  snapshotIds: string[];
  epochs: number;
  learningRate: number;
  batchSize: number;
  seed: number;
  computeTarget: 'cpu' | 'gpu';
};

export type TrainingResponse = {
  ticket_id: string;
  task: string;
  gold_snapshot_ids: string[];
  training_mode: string;
  base_model_id?: string;
  compute_target: 'cpu' | 'gpu';
  status: string;
  created_at: string;
  message: string;
};

export type GoldSnapshotItem = {
  snapshot_id: string;
  key: string;
  size_bytes: number;
  last_modified: string;
  is_trained: boolean;
  trained_model_id?: string;
};

export type GoldSnapshotInventoryResponse = {
  snapshots: Array<{
    snapshot_id: string;
    manifest_key: string;
    size_bytes: number;
    last_modified: string;
    created_at: string;
    status: string;
  }>;
};

export interface ActiveTrainingState {
  ticketId: string;
  task: string;
  snapshotCount: number;
  baseModel: string;
  epochs: number;
  computeTarget?: 'cpu' | 'gpu';
  startedAt: number;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
  phase?: string;
  progressPercent?: number;
  currentEpoch?: number;
  totalEpochs?: number;
  bestEpoch?: number;
  bestValidationLoss?: number;
  trainLoss?: number;
  valLoss?: number;
  lossHistory?: Array<{ epoch: number; trainLoss: number; valLoss: number; isBest?: boolean }>;
  logs?: Array<{ timestamp: string; message: string; level?: 'info' | 'warn' | 'error' | 'success' }>;
  updatedAt?: string;
}

export type TrainingReadiness = {
  snapshot_id?: string;
  snapshot_ids: string[];
  total_rows: number;
  positive_rows: number;
  negative_rows: number;
  unresolved_rows: number;
  positive_targets: number;
  negative_targets: number;
  ready?: boolean;
  tier: 'BLOCKED' | 'EXPERIMENTAL' | 'PRODUCTION_CANDIDATE';
  policy_version?: string;
  experimental_minimum_positive_targets: number;
  experimental_minimum_negative_targets: number;
  production_candidate_minimum_positive_targets: number;
  production_candidate_minimum_negative_targets: number;
  negative_diversity_target: number;
  negative_diversity_target_met?: boolean;
  blocker?: string;
};

export type StoredTrainingConfig = {
  intent: 'new' | 'evolve';
  computeTarget: 'cpu' | 'gpu';
  baseModelId: string;
  epochs: string;
  learningRate: string;
  batchSize: string;
  seed: string;
};

export const TRAINING_CONFIG_KEY = 'aurora.training-lab.config.v1';

export const DEFAULT_CONFIG: StoredTrainingConfig = {
  intent: 'new',
  computeTarget: 'gpu',
  baseModelId: 'champion',
  epochs: '50',
  learningRate: '0.001',
  batchSize: '32',
  seed: '42',
};

export function readStoredConfig(): StoredTrainingConfig {
  if (typeof window === 'undefined') return DEFAULT_CONFIG;
  try {
    const stored = JSON.parse(
      window.localStorage.getItem(TRAINING_CONFIG_KEY) ?? '{}',
    ) as Partial<StoredTrainingConfig>;
    return {
      intent: stored.intent === 'evolve' ? 'evolve' : 'new',
      computeTarget: stored.computeTarget === 'cpu' ? 'cpu' : 'gpu',
      baseModelId: stored.baseModelId || DEFAULT_CONFIG.baseModelId,
      epochs: stored.epochs || DEFAULT_CONFIG.epochs,
      learningRate: stored.learningRate || DEFAULT_CONFIG.learningRate,
      batchSize: stored.batchSize || DEFAULT_CONFIG.batchSize,
      seed: stored.seed || DEFAULT_CONFIG.seed,
    };
  } catch {
    return DEFAULT_CONFIG;
  }
}
