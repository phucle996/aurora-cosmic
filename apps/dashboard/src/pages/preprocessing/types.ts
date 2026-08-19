export type HopStatus =
  | 'not_observed'
  | 'running'
  | 'completed'
  | 'retry'
  | 'failed'
  | 'cancelling'
  | 'canceled';

export type Hop = {
  id: string;
  stepNumber: number;
  label: string;
  shortTitle: string;
  description: string;
  astronomyGoal: string;
  formula?: string;
  contract: string;
  status: HopStatus;
  input: string;
  output: string;
  observed_at?: string;
  metrics?: Record<string, number>;
  details?: Record<string, string>;
};

export type HopNodeData = Hop & { onSelect?: () => void };

export type PreprocessingGraph = {
  status: HopStatus;
  observation_scope: string;
  observed_at: string;
  run?: PreprocessingJob | null;
  progress: {
    checkpoint_total: number;
    checkpoint_completed: number;
    checkpoint_pending: number;
    backlog_pending: number;
    backlog_ack_pending: number;
    items_to_process: number;
    observed_at?: string;
  };
  hops: Array<Pick<Hop, 'id' | 'status' | 'observed_at' | 'metrics'>>;
  edges: Array<{ id: string; source: string; target: string; status: HopStatus }>;
};

export type PreprocessingJob = {
  job_id: string;
  status: string;
  mode: string;
  ingest_run_id?: string;
  prefix?: string;
  started_at: string;
  updated_at: string;
  error?: string;
};

export type LineageRecord = {
  tic_id: string;
  sector: number;
  target_name: string;
  planet_type: string;
  source_fits_key: string;
  source_sha256: string;
  preprocessor_version: string;
  run_id?: string;
  silver_parquet_key: string;
  silver_sha256?: string;
  silver_records?: number;
  processed_at?: string;
  integrity: 'VERIFIED' | 'PENDING' | 'CORRUPTED';
  features?: {
    transit_depth_ppm: number;
    period_days: number;
    duration_hours: number;
    snr: number;
    odd_even_mismatch: number;
    radius_earth: number;
  };
};

export type TargetProfile = {
  tic_id: string;
  sector: number;
  name: string;
  object_key: string;
  size_bytes: number;
  last_modified: string;
  description: string;
  type: string;
  period: number;
  depth: number;
  duration: number;
  radius: number;
  snr: number;
  rawNoise: number;
  stellarDriftAmp: number;
};

export const defaultHops: Hop[] = [
  {
    id: 'bronze',
    stepNumber: 1,
    label: 'Bronze FITS Ingestion',
    shortTitle: '1. FITS Header & Flux',
    description: 'Đọc tệp FITS nhị phân nguyên bản từ NASA MAST, kiểm tra tính toàn vẹn HDU.',
    astronomyGoal: 'Trích xuất cột thời gian BJD (Barycentric Julian Date), SAP_FLUX và PDCSAP_FLUX.',
    contract: 'bronze/tess/<product>/sector=<sector>/tic=<tic>/',
    status: 'not_observed',
    input: 'NASA MAST FITS (Binary Table)',
    output: 'Raw Time Series & Metadata',
  },
  {
    id: 'decode',
    stepNumber: 2,
    label: 'Quality Masking & NaN Filter',
    shortTitle: '2. Lọc Cờ Chất Lượng',
    description: 'Loại bỏ các điểm đo bị lỗi định hướng vệ tinh, momentum dump, hoặc tia vũ trụ trực tiếp.',
    astronomyGoal: 'Áp dụng bitmask QUALITY == 0 và loại bỏ NaN/Inf để đảm bảo chuỗi dữ liệu liên tục.',
    formula: 'Flag \\& 0b1011111111111111 == 0',
    contract: 'quality-flag-bitmask-v1',
    status: 'not_observed',
    input: 'Raw Time Series (17,649 pts)',
    output: 'Valid Photometry Points',
  },
  {
    id: 'transform',
    stepNumber: 3,
    label: 'Spline Detrending & 5σ Outlier Rejection',
    shortTitle: '3. Khử Xu Hướng & Nhiễu 5σ',
    description: 'Khử biến thiên chu kỳ dài của sao mẹ và loại bỏ nhiễu cực đại bằng Spline / Median Filter.',
    astronomyGoal: 'Chuẩn hóa thông lượng quanh mức 1.0 (Relative Flux) và loại bỏ hiện tượng trôi nhiệt camera.',
    formula: 'F_{norm}(t) = \\frac{F(t)}{S_{trend}(t)}, \\quad |F_{norm} - 1.0| < 5\\sigma',
    contract: 'lc-preprocess-v1 / tpf-preprocess-v1',
    status: 'not_observed',
    input: 'Valid Photometry Points',
    output: 'Detrended Normalized Flux',
  },
  {
    id: 'silver',
    stepNumber: 4,
    label: 'BLS Search & Silver Parquet Export',
    shortTitle: '4. Gập Pha & Silver Parquet',
    description: 'Thuật toán Box Least Squares (BLS) dò tìm tín hiệu transit định kỳ và gập pha từ 0 đến 1.',
    astronomyGoal: 'Trích xuất độ sâu trũng sáng (Transit Depth), chu kỳ quỹ đạo P và xuất file Parquet nén Snappy.',
    formula: '\\phi(t) = \\left( \\frac{t - T_0}{P} \\right) \\bmod 1.0',
    contract: 'silver/tess/<product>/processor=v1.2.0/',
    status: 'not_observed',
    input: 'Detrended Normalized Flux',
    output: 'Silver Parquet & Phase Dips',
  },
  {
    id: 'checkpoint',
    stepNumber: 5,
    label: 'Crash-Safe Checkpoint Store',
    shortTitle: '5. Lưu Vết Checkpoint',
    description: 'Ghi nhận trạng thái hoàn tất vào MinIO để đảm bảo tính an toàn chống sập (Idempotent).',
    astronomyGoal: 'Bảo đảm pipeline có thể resume bất kỳ lúc nào mà không xử lý trùng lặp đối tượng.',
    contract: 'checkpoints/preprocessing/objects/<id>.json',
    status: 'not_observed',
    input: 'Silver Verification',
    output: 'Durable MinIO Checkpoint',
  },
  {
    id: 'lineage',
    stepNumber: 6,
    label: 'Lineage & Provenance Commit',
    shortTitle: '6. Khóa Phả Hệ Lineage',
    description: 'Tạo liên kết bất biến giữa Bronze Hash (SHA-256) → Thuật toán Rust v1.2.0 → Silver Hash.',
    astronomyGoal: 'Truy vết 100% nguồn gốc khoa học cho mọi ứng viên hành tinh downstream ML.',
    contract: 'lineage/v1/<lineage-id>.json',
    status: 'not_observed',
    input: 'Bronze + Silver Hashes',
    output: 'Committed Lineage Proof',
  },
];
