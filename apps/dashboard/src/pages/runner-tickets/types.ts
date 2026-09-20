/**
 * @file types.ts
 * @description Types for Runner Tickets management and execution history.
 */

import type { FactoryRun } from '@/types/ticket';

export interface TicketRecord {
  ticket_id: string;
  runs: FactoryRun[];
  primaryRun?: FactoryRun;
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
  ingestRun?: FactoryRun;
  silverRun?: FactoryRun;
  goldRun?: FactoryRun;
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
