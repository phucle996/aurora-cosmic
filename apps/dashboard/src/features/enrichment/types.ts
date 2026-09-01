// Shared Silver-to-Gold control and runtime contract.
export type GoldControlOverview = {
  control: {
    mode: 'PAUSED' | 'STREAM' | 'BATCH';
    max_batch_records: number;
    idle_flush_seconds: number;
    command_id?: string;
    updated_at?: string;
    requested_by?: string;
  };
  runtime?: {
    state: 'IDLE' | 'RUNNING' | 'DRAINING' | 'FROZEN' | string;
    mode: string;
    max_batch_records: number;
    idle_flush_seconds: number;
    pending_total: number;
    pending_by_kind: Record<string, number>;
    readiness?: {
      catalog_ready: boolean;
      tic_catalog_ready: boolean;
      toi_catalog_ready: boolean;
      waiting_lightcurves: number;
      ready_lightcurves: number;
      missing_tpf: number;
      tpf_contexts: number;
      contracted_lightcurves: number;
      uncontracted_lightcurves: number;
    };
    catalog_sync?: {
      mode: 'ON_DEMAND' | string;
      state: 'IDLE' | 'SYNCING' | 'READY' | 'RETRYING' | string;
      target_count: number;
      tic_records: number;
      toi_records: number;
      snapshot_ids: Record<string, string>;
      cache_hit: boolean;
      error?: string;
    };
    active_builds: number;
    workers: GoldWorkerTelemetry[];
    first_silver_at?: string;
    last_silver_at?: string;
    next_flush_at?: string;
    last_snapshot_id?: string;
    last_error?: string;
    updated_at?: string;
  };
};

export type GoldWorkerTelemetry = {
  worker_id: string;
  lifecycle: 'SPAWNED' | 'ALIVE' | 'KILLED' | string;
  action: string;
  command_id?: string;
  batch_ref?: string;
  input_count: number;
  snapshot_id?: string;
  detail?: string;
  updated_at: string;
};

export type GoldLiveEvent = {
  id?: string;
  type?: string;
  workflow?: string;
  status?: string;
  job_id?: string;
  ticket_id?: string;
  occurred_at?: string;
  payload?: {
    event_type?: 'gold.worker.lifecycle' | 'gold.runtime.updated' | string;
    ticket_id?: string;
    command_id?: string;
    occurred_at?: string;
    worker?: GoldWorkerTelemetry;
    runtime?: GoldControlOverview['runtime'];
  };
};
