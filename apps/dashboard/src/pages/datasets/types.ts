export type StorageObject = {
  key: string;
  size_bytes: number;
  etag?: string;
  last_modified: string;
};

export type StorageListing = {
  bucket: string;
  prefix: string;
  page: number;
  page_size: number;
  total: number;
  total_bytes: number;
  truncated: boolean;
  objects: StorageObject[];
};

export type FeatureCatalogItem = {
  name: string;
  category: string;
  unit: string;
  dtype: string;
  description: string;
};

export function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '0 B';
  if (value < 1024) return `${value} B`;
  if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 ** 3) return `${(value / 1024 ** 2).toFixed(1)} MB`;
  return `${(value / 1024 ** 3).toFixed(2)} GB`;
}

export function formatDate(value?: string): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? value : date.toLocaleString();
}

export const goldFeatureCatalog: FeatureCatalogItem[] = [
  {
    name: 'bls_period',
    category: 'Orbital Kinematics',
    unit: 'Days',
    dtype: 'Float64',
    description: 'Chu kỳ quỹ đạo phát hiện qua thuật toán Box Least Squares (BLS).',
  },
  {
    name: 'bls_depth',
    category: 'Photometry',
    unit: 'Fraction (ΔF/F)',
    dtype: 'Float64',
    description: 'Độ sụt giảm cường độ sáng cực đại khi hành tinh đi qua đĩa sao.',
  },
  {
    name: 'bls_duration',
    category: 'Orbital Kinematics',
    unit: 'Days',
    dtype: 'Float64',
    description: 'Tổng thời lượng một pha quá cảnh (Transit Duration).',
  },
  {
    name: 'bls_power',
    category: 'Statistical Signal',
    unit: 'S/N Peak',
    dtype: 'Float64',
    description: 'Tỷ số tín hiệu trên nhiễu của đỉnh chu kỳ BLS Periodogram.',
  },
  {
    name: 'transit_deficit_sum',
    category: 'Photometry',
    unit: 'Flux Integral',
    dtype: 'Float64',
    description: 'Tích phân diện tích phần sáng bị che khuất trong pha quá cảnh.',
  },
  {
    name: 'flux_mean / flux_rms',
    category: 'Lightcurve Stats',
    unit: 'Normalized e-/s',
    dtype: 'Float64',
    description: 'Giá trị cường độ sáng trung bình và độ lệch quân phương RMS.',
  },
  {
    name: 'flux_amplitude',
    category: 'Lightcurve Stats',
    unit: 'ΔFlux Peak-to-Peak',
    dtype: 'Float64',
    description: 'Biên độ dao động ánh sáng đỉnh-đáy của ngôi sao.',
  },
  {
    name: 'pixel_mad_median',
    category: 'Target Pixel (TPF)',
    unit: 'MAD Pixels',
    dtype: 'Float64',
    description: 'Độ biến thiên không gian trung vị giữa các điểm ảnh TPF (Loại trừ nhiễu nền).',
  },
  {
    name: 'stellar_radius',
    category: 'TIC Stellar',
    unit: 'R_☉ (Solar)',
    dtype: 'Float32',
    description: 'Bán kính sao chủ đối chiếu từ TESS Input Catalog.',
  },
  {
    name: 'stellar_mass',
    category: 'TIC Stellar',
    unit: 'M_☉ (Solar)',
    dtype: 'Float32',
    description: 'Khối lượng sao chủ đối chiếu từ TESS Input Catalog.',
  },
  {
    name: 'teff',
    category: 'TIC Stellar',
    unit: 'Kelvin (K)',
    dtype: 'Float32',
    description: 'Nhiệt độ hiệu dụng bề mặt của ngôi sao chủ.',
  },
  {
    name: 'tmag',
    category: 'TIC Stellar',
    unit: 'TESS Magnitude',
    dtype: 'Float32',
    description: 'Cấp sao biểu kiến trong dải phổ của kính thiên văn TESS.',
  },
  {
    name: 'matched_toi_id / matched_tce_id',
    category: 'Ground Truth Labels',
    unit: 'Catalog ID',
    dtype: 'String',
    description: 'Nhãn đối chiếu ứng viên TESS Object of Interest / TCE chính thức từ NASA.',
  },
];
