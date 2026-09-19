import type { GoldConfig } from './types';

export const CONFIG_KEY = 'aurora.gold.console.config.v1';

export const PIPELINE_STEPS = [
  { step: 1, label: '01 Intake', key: 'INTAKE' },
  { step: 2, label: '02 Pairing', key: 'PAIRING' },
  { step: 3, label: '03 Catalog', key: 'CATALOG' },
  { step: 4, label: '04 Extract', key: 'EXTRACT' },
  { step: 5, label: '05 Parquet', key: 'PARQUET' },
  { step: 6, label: '06 Index', key: 'INDEX' },
  { step: 7, label: '07 Commit', key: 'COMMIT' },
] as const;

export const stateLabel: Record<string, string> = {
  IDLE: 'IDLE',
  RUNNING: 'RUNNING',
  DRAINING: 'DRAINING',
  FROZEN: 'FROZEN',
  CATALOG_SYNCING: 'CATALOG SYNC',
  WAITING_FOR_CATALOG_SYNC: 'CATALOG RETRY',
  WAITING_FOR_MODALITY: 'WAITING LC/TPF',
  READY: 'READY',
};

export const actionLabel: Record<string, string> = {
  WAITING_FOR_BATCH: 'WAITING FOR BATCH',
  FROZEN: 'FROZEN BY OPERATOR',
  DEQUEUED_BATCH: 'CLAIMED BATCH',
  WAITING_FOR_RESUME: 'WAITING FOR RESUME',
  VERIFYING_PAIRING: 'VERIFYING PAIRING',
  SYNCING_CATALOGS: 'SYNCING TIC / TOI',
  EXTRACTING_FEATURES: 'EXTRACTING LC+TPF',
  MATERIALIZING_PARQUET: 'WRITING PARQUET',
  MATERIALIZING_AND_INDEXING: 'MATERIALIZING + INDEXING',
  INDEXING_CLICKHOUSE: 'INDEXING CLICKHOUSE',
  COMMITTING_SNAPSHOT: 'COMMITTING SNAPSHOT',
  SNAPSHOT_COMMITTED: 'SNAPSHOT COMMITTED',
  RETRYING_CATALOG_SYNC: 'CATALOG RETRY',
  FAILED_RETRY_SCHEDULED: 'FAILED · RETRY SCHEDULED',
  CANCELLED: 'KILLED / CANCELLED',
};

export function loadLocalConfig(): GoldConfig {
  const fallback: GoldConfig = { mode: 'stream', maxBatchRecords: 500, idleFlushSeconds: 180 };
  try {
    const parsed = JSON.parse(window.localStorage.getItem(CONFIG_KEY) ?? 'null') as Partial<GoldConfig> | null;
    if (!parsed) return fallback;
    return {
      mode: parsed.mode === 'batch' ? 'batch' : 'stream',
      maxBatchRecords: Number(parsed.maxBatchRecords) || fallback.maxBatchRecords,
      idleFlushSeconds: Number(parsed.idleFlushSeconds) || fallback.idleFlushSeconds,
    };
  } catch {
    return fallback;
  }
}

export function formatDate(value?: string): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('en-US');
}

export function shortTime(value?: string): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleTimeString('en-US');
}

export function statusVariant(status: string): 'default' | 'secondary' | 'destructive' | 'outline' {
  const s = status.toUpperCase();
  if (s === 'RUNNING' || s === 'READY' || s === 'MATERIALIZING' || s === 'COMMITTED') return 'default';
  if (s === 'FROZEN' || s === 'PAUSED' || s === 'DRAINING') return 'secondary';
  if (s === 'FAILED' || s === 'KILLED' || s === 'ERROR') return 'destructive';
  return 'outline';
}
