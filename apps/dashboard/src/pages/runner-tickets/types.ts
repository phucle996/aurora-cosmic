/**
 * @file types.ts
 * @description Types for Runner Tickets management and execution history.
 */

import type {
  BLSSearchEvidence,
  CandidateAssemblyEvidence,
  GoldCommitEvidence,
  GoldMaterializationEvidence,
  GoldProjectionEvidence,
  LCFeatureEvidence,
  TPFSpatialEvidence,
} from '@/pages/pipeline-dag/types';

export type RunnerTicket = {
  ticket_id: string;
  created_at: string;
  description?: string;
  updated_at?: string;
};

export type PipelineRun = {
  pipeline: string;
  run_id: string;
  mode: string;
  status: string;
  started_at: string;
  finished_at?: string;
  max_batch_records: number;
  idle_flush_seconds: number;
  pending_inputs: number;
  completed_batches: number;
  input_records: number;
  output_rows: number;
  indexed_rows: number;
  last_snapshot_id?: string;
  last_error?: string;
  updated_at: string;
};

export type PipelineBatch = {
  batch_id: string;
  mode: string;
  status: string;
  started_at: string;
  completed_at?: string;
  input_records: number;
  candidate_rows: number;
  artifact_count: number;
  indexed_rows: number;
  snapshot_id?: string;
  snapshot_fingerprint?: string;
  manifest_key?: string;
  manifest_sha256?: string;
  error?: string;
};

export type PipelineComponentEvent = {
  component_id: string;
  status: string;
  occurred_at: string;
  input_records: number;
  output_rows: number;
  indexed_rows: number;
  snapshot_id?: string;
  error?: string;
};

export type PipelineRunDetail = {
  run: PipelineRun;
  batches: PipelineBatch[];
  components: PipelineComponentEvent[];
  scientific_evidence?: {
    lc_features?: LCFeatureEvidence;
    bls_search?: BLSSearchEvidence;
    tpf_spatial?: TPFSpatialEvidence;
    candidate_assembly?: CandidateAssemblyEvidence;
    gold_materialization?: GoldMaterializationEvidence;
    gold_projection?: GoldProjectionEvidence;
    gold_commit?: GoldCommitEvidence;
  };
};

export interface TicketRecord {
  ticket_id: string;
  runs: PipelineRun[];
  primaryRun?: PipelineRun;
  mode: string;
  status: string;
  started_at?: string;
  finished_at?: string;
  updated_at?: string;
  last_snapshot_id?: string;
  last_error?: string;
  hasIngest: boolean;
  hasSilver: boolean;
  hasGold: boolean;
  ingestRun?: PipelineRun;
  silverRun?: PipelineRun;
  goldRun?: PipelineRun;
}

export type ExecutionActionType =
  | 'started'
  | 'stopped'
  | 'completed'
  | 'failed'
  | 'running'
  | 'draining'
  | 'syncing';

export interface ExecutionActionRecord {
  id: string;
  timestamp: string;
  action: ExecutionActionType;
  actionLabel: string;
  target: string;
  detail?: string;
  snapshotId?: string;
}
