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
  run_id: string;
  silver_parquet_key: string;
  silver_sha256: string;
  silver_records: number;
  processed_at: string;
  integrity: 'VERIFIED' | 'PENDING' | 'CORRUPTED';
  features: {
    transit_depth_ppm: number;
    period_days: number;
    duration_hours: number;
    snr: number;
    odd_even_mismatch: number;
    radius_earth: number;
  };
};

export type TargetProfile = {
  name: string;
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

export const sampleTargets: Record<string, TargetProfile> = {
  'TIC 246980040': {
    name: 'TIC 246980040 (TOI-700 d / Super-Earth Transit)',
    description: 'Ứng viên siêu Trái Đất trong vùng có thể sống được (Habitable Zone), độ sâu trũng 1,420 ppm.',
    type: 'Super-Earth Exoplanet Candidate',
    period: 3.842,
    depth: 0.0142,
    duration: 2.35,
    radius: 1.18,
    snr: 28.4,
    rawNoise: 0.0055,
    stellarDriftAmp: 0.028,
  },
  'TIC 246980806': {
    name: 'TIC 246980806 (Hot Jupiter Giant Transit)',
    description: 'Hành tinh khí khổng lồ chu kỳ siêu ngắn (Hot Jupiter) quay sát sao mẹ, trũng transit sâu 2.1%.',
    type: 'Hot Jupiter Gas Giant',
    period: 1.825,
    depth: 0.0215,
    duration: 3.12,
    radius: 11.2,
    snr: 46.8,
    rawNoise: 0.0042,
    stellarDriftAmp: 0.035,
  },
  'TIC 246979427': {
    name: 'TIC 246979427 (Detached Eclipsing Binary Star)',
    description: 'Hệ sao đôi che khuất (Eclipsing Binary) với trũng sáng chính sâu và trũng phụ chu kỳ 5.2 ngày.',
    type: 'Eclipsing Binary Variable',
    period: 5.214,
    depth: 0.045,
    duration: 4.8,
    radius: 18.5,
    snr: 64.2,
    rawNoise: 0.006,
    stellarDriftAmp: 0.018,
  },
};

export const sampleLineageRecords: LineageRecord[] = [
  {
    tic_id: '246980040',
    sector: 42,
    target_name: 'TIC 246980040',
    planet_type: 'Super-Earth Candidate',
    source_fits_key: 'bronze/tess/lightcurve/sector=0042/tic=246980040/tess2021232031932-s0042-0000000246980040-0213-s_lc.fits',
    source_sha256: '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08',
    preprocessor_version: 'rust-preprocessor:v1.2.0 (ASTRO-VET-OPSET17)',
    run_id: 'preprocess-job-7b914ca2',
    silver_parquet_key: 'silver/tess/lightcurve/processor=v1.2.0/sector=0042/tic=246980040.parquet',
    silver_sha256: '5e884898da28047151d0e56f8dc6292773603d0d6aabbdd62a11ef721d1542d8',
    silver_records: 17420,
    processed_at: '2026-08-19T05:30:15Z',
    integrity: 'VERIFIED',
    features: {
      transit_depth_ppm: 1420,
      period_days: 3.842,
      duration_hours: 2.35,
      snr: 28.4,
      odd_even_mismatch: 0.02,
      radius_earth: 1.18,
    },
  },
  {
    tic_id: '246980806',
    sector: 42,
    target_name: 'TIC 246980806',
    planet_type: 'Hot Jupiter Giant',
    source_fits_key: 'bronze/tess/lightcurve/sector=0042/tic=246980806/tess2021232031932-s0042-0000000246980806-0213-s_lc.fits',
    source_sha256: '4b227777d4dd1fc61c6f884f48641d02b4d121d3fd328cb08b5531fcacdabf8a',
    preprocessor_version: 'rust-preprocessor:v1.2.0 (ASTRO-VET-OPSET17)',
    run_id: 'preprocess-job-7b914ca2',
    silver_parquet_key: 'silver/tess/lightcurve/processor=v1.2.0/sector=0042/tic=246980806.parquet',
    silver_sha256: 'ef2d127de37b942baad06145e54b0c619a1f22327b2ebbcfbec78f5564afe39d',
    silver_records: 17510,
    processed_at: '2026-08-19T05:30:18Z',
    integrity: 'VERIFIED',
    features: {
      transit_depth_ppm: 21500,
      period_days: 1.825,
      duration_hours: 3.12,
      snr: 46.8,
      odd_even_mismatch: 0.01,
      radius_earth: 11.2,
    },
  },
  {
    tic_id: '246979427',
    sector: 42,
    target_name: 'TIC 246979427',
    planet_type: 'Eclipsing Binary',
    source_fits_key: 'bronze/tess/lightcurve/sector=0042/tic=246979427/tess2021232031932-s0042-0000000246979427-0213-s_lc.fits',
    source_sha256: 'ef2d127de37b942baad06145e54b0c619a1f22327b2ebbcfbec78f5564afe39d',
    preprocessor_version: 'rust-preprocessor:v1.2.0 (ASTRO-VET-OPSET17)',
    run_id: 'preprocess-job-7b914ca2',
    silver_parquet_key: 'silver/tess/lightcurve/processor=v1.2.0/sector=0042/tic=246979427.parquet',
    silver_sha256: '8c6976e5b5410415bde908bd4dee15dfb167a9c873fc4bb8a81f6f2ab448a918',
    silver_records: 17380,
    processed_at: '2026-08-19T05:30:22Z',
    integrity: 'VERIFIED',
    features: {
      transit_depth_ppm: 45000,
      period_days: 5.214,
      duration_hours: 4.8,
      snr: 64.2,
      odd_even_mismatch: 0.15,
      radius_earth: 18.5,
    },
  },
];
