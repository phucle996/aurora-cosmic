export type IngestProduct = {
  id: string;
  kind: string;
  object_key: string;
  state: string;
  size_bytes: number;
  expected_size_bytes: number;
  attempts: number;
  last_error?: string;
  updated_at: string;
};

export type IngestKindSummary = {
  planned: number;
  completed: number;
  downloading: number;
  failed: number;
};

export type IngestStatus = {
  observed: boolean;
  run_id?: string;
  ticket_id?: string;
  status: string;
  error?: string;
  manifest_path?: string;
  started_at?: string;
  updated_at?: string;
  total_products: number;
  completed_products: number;
  downloading: number;
  failed_products: number;
  expected_bytes: number;
  completed_bytes: number;
  products_per_second: number;
  bytes_per_second: number;
  queue_depth: number;
  inflight_products: number;
  observed_at: string;
  products?: IngestProduct[];
  products_truncated?: boolean;
  product_kinds?: Record<string, IngestKindSummary>;
  catalog_progress?: {
    state: string;
    stage: string;
    tic_rows: number;
    toi_rows: number;
    completed: number;
    total: number;
    tic_snapshot_id?: string;
    toi_snapshot_id?: string;
    error?: string;
  };
  manifest_progress?: {
    state: string;
    stage: string;
    completed: number;
    total: number;
    stage_completed?: number;
    stage_total?: number;
    discovered_products: number;
    paired_samples: number;
    selected_samples: number;
    priority_samples: number;
    catalog_snapshots?: Record<string, string>;
    error?: string;
    updated_at?: string;
  };
};

export type IngestControlJob = {
  ticket_id: string;
  status: string;
  sector?: number;
  concurrency?: number;
  manifest_path?: string;
  started_at: string;
  updated_at: string;
  error?: string;
};

export type PlanningSignal = {
  stage?: string;
  completed?: number;
  total?: number;
  products?: number;
  occurredAt?: string;
};

export type WorkerSignal = {
  workerId: number;
  productId: string;
  productKind?: string;
  bytesRead: number;
  expectedBytes: number;
  occurredAt?: string;
};

export function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '—';
  if (value < 1024) return `${value} B`;
  if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 ** 3) return `${(value / 1024 ** 2).toFixed(1)} MB`;
  return `${(value / 1024 ** 3).toFixed(2)} GB`;
}

export function formatTransferBytes(value: number): string {
  return value === 0 ? '0 B' : formatBytes(value);
}

export function formatRate(value: number, unit: string): string {
  return value > 0 ? `${formatBytes(value)}/${unit}` : '—';
}

export function formatDate(value?: string): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? value : date.toLocaleString();
}

export function statusVariant(status: string): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (status === 'completed' || status === 'published') return 'default';
  if (status === 'failed' || status === 'completed_with_failures') return 'destructive';
  if (status === 'running' || status === 'planning' || status === 'downloading' || status === 'draining') return 'secondary';
  return 'outline';
}
