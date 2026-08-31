export type GoldSnapshotInput = {
  lineage_id: string;
  source_product_id: string;
  product_kind: string;
  silver_bucket: string;
  silver_object_key: string;
  silver_sha256: string;
  silver_schema_version: string;
  processor_version: string;
  sample_id: string;
};

export type GoldArtifact = {
  dataset: string;
  sector: number;
  object_key: string;
  row_count: number;
  content_sha256: string;
  parquet_sha256: string;
  size_bytes: number;
};

export type GoldSnapshotDetail = {
  snapshot_id: string;
  snapshot_fingerprint: string;
  snapshot_type: string;
  gold_schema_version: string;
  feature_versions: Record<string, string>;
  status: string;
  created_at: string;
  producer: string;
  dataset_row_counts: Record<string, number>;
  artifacts: GoldArtifact[];
  inputs: GoldSnapshotInput[];
};

export type GoldParquetColumn = {
  name: string;
  path: string;
  type: string;
  nullable: boolean;
  repeated: boolean;
};

export type GoldArtifactDetail = {
  snapshot_id: string;
  artifact: GoldArtifact;
  schema: GoldParquetColumn[];
  preview: Array<Record<string, unknown>>;
  preview_offset: number;
  preview_limit: number;
  matched_rows: number;
};
