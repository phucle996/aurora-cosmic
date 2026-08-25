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

export type SchemaCatalog = {
  schemaVersion: string;
  title: string;
  description: string;
  columns: FeatureCatalogItem[];
  note?: string;
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

const field = (
  name: string,
  category: string,
  dtype: string,
  unit: string,
  description: string,
): FeatureCatalogItem => ({ name, category, dtype, unit, description });

export const bronzeManifestSchema: SchemaCatalog = {
  schemaVersion: 'ingestion-manifest-v1 / ManifestProduct',
  title: 'Bronze Ingestion Manifest (mỗi sản phẩm)',
  description: 'Metadata định danh và truy xuất của mỗi FITS nguyên bản trước khi ghi vào bronze/.',
  columns: [
    field('source_product_id', 'Định danh', 'String', '—', 'ID sản phẩm nguồn duy nhất từ NASA MAST.'),
    field('kind', 'Phân loại', 'Enum', '—', 'LIGHT_CURVE, TARGET_PIXEL hoặc FFI.'),
    field('filename', 'Nguồn', 'String', '—', 'Tên tệp FITS gốc.'),
    field('data_uri', 'Nguồn', 'String', 'URI', 'Đường dẫn tải sản phẩm tại NASA MAST.'),
    field('size_bytes', 'Lưu trữ', 'Int64', 'Bytes', 'Dung lượng FITS dự kiến trong manifest.'),
    field('sector', 'Quan sát', 'Int32', 'TESS sector', 'Số sector quan sát của TESS.'),
    field('tic_id', 'Mục tiêu', 'Int64?', 'TIC ID', 'ID ngôi sao trong TESS Input Catalog; FFI có thể không có.'),
    field('camera', 'Thiết bị', 'Int32?', 'Index', 'Camera TESS; có thể không có với Light Curve.'),
    field('ccd', 'Thiết bị', 'Int32?', 'Index', 'CCD TESS; có thể không có với Light Curve.'),
  ],
};

export const bronzeLightCurveFitsSchema: SchemaCatalog = {
  schemaVersion: 'TESS Light Curve FITS BINTABLE (pipeline-read columns)',
  title: 'Bronze LIGHT_CURVE FITS',
  description: 'FITS được giữ nguyên; bảng chỉ liệt kê các cột BINTABLE mà decoder thực sự đọc.',
  columns: [
    field('TIME', 'Cadence', 'Float64', 'BTJD days', 'Thời điểm mỗi phép đo.'),
    field('QUALITY', 'Chất lượng', 'Int32', 'Bitmask', 'Cờ chất lượng cadence từ TESS.'),
    field('SAP_FLUX', 'Quang trắc', 'Float32', 'e⁻/s', 'Simple Aperture Photometry flux gốc.'),
    field('SAP_FLUX_ERR', 'Quang trắc', 'Float32', 'e⁻/s', 'Sai số của SAP_FLUX.'),
    field('PDCSAP_FLUX', 'Quang trắc', 'Float32', 'e⁻/s', 'Flux đã được PDC hiệu chỉnh systematics.'),
    field('PDCSAP_FLUX_ERR', 'Quang trắc', 'Float32', 'e⁻/s', 'Sai số của PDCSAP_FLUX.'),
  ],
  note: 'Pipeline ưu tiên PDCSAP_FLUX; chỉ fallback sang SAP_FLUX khi cấu hình cho phép.',
};

export const bronzeTargetPixelFitsSchema: SchemaCatalog = {
  schemaVersion: 'TESS Target Pixel FITS BINTABLE (pipeline-read columns)',
  title: 'Bronze TARGET_PIXEL FITS',
  description: 'FITS được giữ nguyên; mỗi row biểu diễn một cadence và ma trận pixel của mục tiêu.',
  columns: [
    field('TIME', 'Cadence', 'Float64', 'BTJD days', 'Thời điểm mỗi cadence.'),
    field('QUALITY', 'Chất lượng', 'Int32', 'Bitmask', 'Cờ chất lượng cadence.'),
    field('FLUX', 'Ảnh pixel', 'Float32[][]', 'e⁻/s', 'Cutout pixel 2D của mục tiêu tại cadence tương ứng.'),
  ],
};

export const bronzeFfiFitsSchema: SchemaCatalog = {
  schemaVersion: 'TESS FFI Image HDU (pipeline-read layout)',
  title: 'Bronze FFI FITS',
  description: 'Ảnh toàn trường FITS được giữ nguyên; decoder đọc Image HDU và kích thước ảnh từ header.',
  columns: [
    field('NAXIS1', 'FITS header', 'Int64', 'Pixels', 'Chiều rộng ảnh trong Image HDU.'),
    field('NAXIS2', 'FITS header', 'Int64', 'Pixels', 'Chiều cao ảnh trong Image HDU.'),
    field('IMAGE pixels', 'Ảnh pixel', 'Float32[]', 'e⁻/s', 'Buffer pixel toàn trường theo row-major sau khi decode.'),
  ],
};

export const silverLightCurveSchema: SchemaCatalog = {
  schemaVersion: 'silver-lightcurve-v1',
  title: 'Silver LIGHT_CURVE Parquet',
  description: 'Chuỗi thời gian đã chọn flux, lọc/chuẩn hoá khoa học và nén ZSTD.',
  columns: [
    field('time', 'Cadence', 'Float64', 'BTJD days', 'Thời điểm cadence đã giữ lại.'),
    field('flux', 'Quang trắc', 'Float32', 'Normalized flux', 'Flux khoa học đã chọn và tiền xử lý.'),
    field('flux_err', 'Quang trắc', 'Float32?', 'Normalized flux', 'Sai số flux; null khi nguồn không cung cấp.'),
    field('quality', 'Chất lượng', 'Int32', 'Bitmask', 'Cờ quality tương ứng cadence.'),
  ],
};

export const silverTargetPixelSchema: SchemaCatalog = {
  schemaVersion: 'silver-target-pixel-v1',
  title: 'Silver TARGET_PIXEL Parquet',
  description: 'Target Pixel File theo cadence; ma trận pixel được flatten trong Parquet.',
  columns: [
    field('time', 'Cadence', 'Float64', 'BTJD days', 'Thời điểm cadence.'),
    field('quality', 'Chất lượng', 'Int32', 'Bitmask', 'Cờ quality cadence.'),
    field('flux', 'Ảnh pixel', 'List<Float32>', 'e⁻/s', 'Pixel flux flatten theo row-major cho mỗi cadence.'),
    field('rows', 'Hình học', 'Int32', 'Pixels', 'Số hàng của cutout pixel.'),
    field('cols', 'Hình học', 'Int32', 'Pixels', 'Số cột của cutout pixel.'),
  ],
};

export const silverFfiSchema: SchemaCatalog = {
  schemaVersion: 'silver-ffi-v1',
  title: 'Silver FFI Parquet',
  description: 'Thống kê ảnh toàn trường sau khi kiểm tra pixel hữu hạn; không ghi toàn bộ ma trận FFI.',
  columns: [
    field('width', 'Hình học', 'Int32', 'Pixels', 'Chiều rộng ảnh.'),
    field('height', 'Hình học', 'Int32', 'Pixels', 'Chiều cao ảnh.'),
    field('finite_pixel_count', 'Chất lượng ảnh', 'Int64', 'Pixels', 'Số pixel hữu hạn.'),
    field('finite_pixel_fraction', 'Chất lượng ảnh', 'Float32', 'Fraction', 'Tỷ lệ pixel hữu hạn.'),
    field('median', 'Thống kê ảnh', 'Float32', 'e⁻/s', 'Trung vị pixel hữu hạn.'),
    field('mean', 'Thống kê ảnh', 'Float32', 'e⁻/s', 'Trung bình pixel hữu hạn.'),
    field('stddev', 'Thống kê ảnh', 'Float32', 'e⁻/s', 'Độ lệch chuẩn pixel hữu hạn.'),
    field('min', 'Thống kê ảnh', 'Float32', 'e⁻/s', 'Giá trị nhỏ nhất của pixel hữu hạn.'),
    field('max', 'Thống kê ảnh', 'Float32', 'e⁻/s', 'Giá trị lớn nhất của pixel hữu hạn.'),
  ],
};

export const goldFeatureCatalog: FeatureCatalogItem[] = [
  field('source_product_id', 'Identity & lineage', 'String', '—', 'ID sản phẩm NASA nguồn.'),
  field('lineage_id', 'Identity & lineage', 'String', '—', 'ID lineage bất biến nối Bronze, Silver và Gold.'),
  field('sample_id', 'Identity & lineage', 'String', '—', 'Khoá mẫu TIC × sector.'),
  field('tic_id', 'Identity & lineage', 'Int64', 'TIC ID', 'ID sao mục tiêu trong TESS Input Catalog.'),
  field('sector', 'Identity & lineage', 'Int32', 'TESS sector', 'Sector quan sát của TESS.'),
  field('silver_sha256', 'Identity & lineage', 'String', 'SHA-256', 'Checksum artifact Silver đầu vào.'),
  field('lc_feature_version', 'Identity & lineage', 'String', '—', 'Phiên bản extractor đặc trưng light curve.'),
  field('lc_feature_fingerprint', 'Identity & lineage', 'String', 'SHA-256', 'Fingerprint tái lập của feature extraction.'),
  field('n_points', 'Light curve thời gian', 'Int64', 'Cadences', 'Số cadence hợp lệ.'),
  field('time_span', 'Light curve thời gian', 'Float64', 'Days', 'time_max − time_min.'),
  field('median_cadence', 'Light curve thời gian', 'Float64', 'Days', 'Trung vị khoảng cách giữa các cadence.'),
  field('max_gap', 'Light curve thời gian', 'Float64', 'Days', 'Khoảng trống cadence lớn nhất.'),
  field('flux_mean', 'Thống kê flux', 'Float64', 'Normalized flux', 'Trung bình flux.'),
  field('flux_median', 'Thống kê flux', 'Float64', 'Normalized flux', 'Trung vị flux.'),
  field('flux_std', 'Thống kê flux', 'Float64', 'Normalized flux', 'Độ lệch chuẩn flux.'),
  field('flux_mad', 'Thống kê flux', 'Float64', 'Normalized flux', 'Median absolute deviation của flux.'),
  field('flux_robust_sigma', 'Thống kê flux', 'Float64', 'Normalized flux', 'Ước lượng sigma bền vững từ MAD.'),
  field('flux_amplitude', 'Thống kê flux', 'Float64', 'Normalized flux', 'Biên độ robust P95(flux) − P05(flux), không phải max − min.'),
  field('flux_rms', 'Thống kê flux', 'Float64', 'Normalized flux', 'Root-mean-square của flux.'),
  field('flux_skewness', 'Thống kê flux', 'Float64', '—', 'Độ lệch bất đối xứng của phân bố flux.'),
  field('flux_kurtosis', 'Thống kê flux', 'Float64', '—', 'Độ nhọn của phân bố flux.'),
  field('median_flux_err', 'Thống kê flux', 'Float64', 'Normalized flux', 'Trung vị sai số flux.'),
  field('bls_available', 'Transit BLS', 'Bool', '—', 'Có đủ dữ liệu để chạy Box Least Squares.'),
  field('bls_period', 'Transit BLS', 'Float64', 'Days', 'Chu kỳ transit tốt nhất từ BLS.'),
  field('bls_duration', 'Transit BLS', 'Float64', 'Days', 'Thời lượng transit tốt nhất.'),
  field('bls_transit_time', 'Transit BLS', 'Float64', 'BTJD days', 'Epoch transit tốt nhất.'),
  field('bls_depth', 'Transit BLS', 'Float64', 'Fraction ΔF/F', 'Độ sâu transit BLS.'),
  field('bls_power', 'Transit BLS', 'Float64', 'BLS statistic', 'Độ mạnh đỉnh periodogram BLS; không mặc định là S/N.'),
  field('tpf_evidence_available', 'TPF spatial evidence', 'Bool', '—', 'TPF matching đã có để trích spatial evidence.'),
  field('pixel_mad_median', 'TPF spatial evidence', 'Float64', 'Pixel flux', 'Trung vị MAD của pixel TPF.'),
  field('variability_peak_fraction', 'TPF spatial evidence', 'Float64', 'Fraction', 'Phần năng lượng biến thiên tập trung ở pixel đỉnh.'),
  field('transit_evidence_available', 'TPF spatial evidence', 'Bool', '—', 'Có evidence spatial cho cửa sổ transit.'),
  field('transit_deficit_sum', 'TPF spatial evidence', 'Float64', 'Pixel flux·cadence', 'Tổng deficit pixel trong cửa sổ transit.'),
  field('transit_deficit_centroid_row', 'TPF spatial evidence', 'Float64', 'Pixels', 'Tâm hàng của deficit transit.'),
  field('transit_deficit_centroid_col', 'TPF spatial evidence', 'Float64', 'Pixels', 'Tâm cột của deficit transit.'),
  field('transit_deficit_center_offset_pixels', 'TPF spatial evidence', 'Float64', 'Pixels', 'Khoảng cách tâm deficit tới tâm cutout.'),
  field('tic_available', 'TIC stellar context', 'Bool', '—', 'Có bản ghi TIC khớp mục tiêu.'),
  field('tmag', 'TIC stellar context', 'Float64', 'TESS mag', 'Độ sáng biểu kiến trong dải TESS.'),
  field('teff', 'TIC stellar context', 'Float64', 'Kelvin', 'Nhiệt độ hiệu dụng của sao.'),
  field('stellar_radius', 'TIC stellar context', 'Float64', 'R☉', 'Bán kính sao chủ.'),
  field('stellar_mass', 'TIC stellar context', 'Float64', 'M☉', 'Khối lượng sao chủ.'),
  field('logg', 'TIC stellar context', 'Float64', 'log₁₀(cm/s²)', 'Log gravity của sao.'),
  field('matched_toi_id', 'Audit & supervision', 'String', 'TOI ID', 'TOI khớp ephemeris, nếu có.'),
  field('toi_match_status', 'Audit & supervision', 'String', '—', 'Trạng thái khớp TOI.'),
  field('toi_period_error', 'Audit & supervision', 'Float64', 'Relative error', 'Sai số chu kỳ so với TOI khớp.'),
  field('matched_tce_id', 'Audit & supervision', 'String', 'TCE ID', 'TCE khớp ephemeris, nếu có.'),
  field('tce_match_status', 'Audit & supervision', 'String', '—', 'Trạng thái khớp TCE.'),
  field('training_label', 'Audit & supervision', 'String', '—', 'POSITIVE, NEGATIVE, UNRESOLVED hoặc EXCLUDED.'),
  field('label_policy_version', 'Audit & supervision', 'String', '—', 'Phiên bản policy gán nhãn.'),
];

export const goldCandidateSchema: SchemaCatalog = {
  schemaVersion: 'gold-candidate-v1',
  title: 'Gold Candidate Feature Store',
  description: '49 cột bất biến: lineage, đặc trưng Light Curve/TPF/TIC và audit-supervision. Model chỉ chọn feature order đã freeze từ tập này.',
  columns: goldFeatureCatalog,
};
