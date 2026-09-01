// Shared lakehouse inventory, schema catalog, and formatting contracts.
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
    field('kind', 'Phân loại', 'Enum', '—', 'LIGHT_CURVE hoặc TARGET_PIXEL.'),
    field('filename', 'Nguồn', 'String', '—', 'Tên tệp FITS gốc.'),
    field('data_uri', 'Nguồn', 'String', 'URI', 'Đường dẫn tải sản phẩm tại NASA MAST.'),
    field('size_bytes', 'Lưu trữ', 'Int64', 'Bytes', 'Dung lượng FITS dự kiến trong manifest.'),
    field('sector', 'Quan sát', 'Int32', 'TESS sector', 'Số sector quan sát của TESS.'),
    field('tic_id', 'Mục tiêu', 'Int64', 'TIC ID', 'ID ngôi sao trong TESS Input Catalog.'),
    field('camera', 'Thiết bị', 'Int32?', 'Index', 'Camera TESS; có thể không có với Light Curve.'),
    field('ccd', 'Thiết bị', 'Int32?', 'Index', 'CCD TESS; có thể không có với Light Curve.'),
  ],
};

export const bronzeLightCurveFitsSchema: SchemaCatalog = {
  schemaVersion: 'NASA TESS Light Curve FITS Standard (Multi-HDU Series)',
  title: 'Bronze LIGHT_CURVE FITS',
  description: 'Tệp FITS nguyên bản 3 HDU lưu trữ chuỗi thời gian quang trắc độ sáng tích phân của ngôi sao.',
  columns: [
    field('TIME', 'HDU 1: BINTABLE', 'Float64', 'BTJD days', 'Thời điểm mỗi phép đo (Barycentric TESS Julian Date).'),
    field('TIMECORR', 'HDU 1: BINTABLE', 'Float32', 'days', 'Hiệu chỉnh thời gian photon đến tâm hệ Mặt Trời.'),
    field('CADENCENO', 'HDU 1: BINTABLE', 'Int32', 'Index', 'Số thứ tự cadence duy nhất trong kỳ quan sát.'),
    field('SAP_FLUX', 'HDU 1: BINTABLE', 'Float32', 'e⁻/s', 'Simple Aperture Photometry: Tổng thông lượng ánh sáng thô qua khẩu độ.'),
    field('SAP_FLUX_ERR', 'HDU 1: BINTABLE', 'Float32', 'e⁻/s', 'Sai số đo quang trắc của SAP_FLUX.'),
    field('SAP_BKG / ERR', 'HDU 1: BINTABLE', 'Float32', 'e⁻/s', 'Ước lượng cường độ nền và sai số nền trong khẩu độ.'),
    field('PDCSAP_FLUX', 'HDU 1: BINTABLE', 'Float32', 'e⁻/s', 'Pre-search Data Conditioning: Flux đã hiệu chỉnh nhiễu hệ thống và biến thiên quang học.'),
    field('PDCSAP_FLUX_ERR', 'HDU 1: BINTABLE', 'Float32', 'e⁻/s', 'Sai số của PDCSAP_FLUX.'),
    field('QUALITY', 'HDU 1: BINTABLE', 'Int32', 'Bitmask', 'Cờ chất lượng đo từ vệ tinh TESS.'),
    field('PSF_CENTR1 / 2', 'HDU 1: BINTABLE', 'Float64', 'pixel', 'Tọa độ tâm sao theo mô hình hàm truyền điểm (PSF Centroid).'),
    field('MOM_CENTR1 / 2', 'HDU 1: BINTABLE', 'Float64', 'pixel', 'Tọa độ tâm quang trắc Moment Centroid trên cảm biến CCD.'),
    field('POS_CORR1 / 2', 'HDU 1: BINTABLE', 'Float32', 'pixels', 'Độ lệch dịch chuyển centroid sao theo trục X/Y.'),
    field('HDU 0: PRIMARY', 'HDU 0: Header', 'Metadata', '—', 'Metadata định danh đối tượng: TICID, SECTOR, CAMERA, CCD, RA/DEC, TSTART, TSTOP.'),
    field('HDU 2: APERTURE', 'HDU 2: Image 2D', 'Int32[][]', 'Bitmask', 'Ma trận mask khẩu độ quang trắc tối ưu tính toán SAP/PDCSAP.'),
  ],
  note: 'Pipeline ưu tiên trích xuất PDCSAP_FLUX để nén sang Silver Parquet; chỉ fallback sang SAP_FLUX khi cấu hình cho phép.',
};

export const bronzeTargetPixelFitsSchema: SchemaCatalog = {
  schemaVersion: 'NASA TESS Target Pixel FITS Standard (Multi-HDU Data Cube)',
  title: 'Bronze TARGET_PIXEL FITS',
  description: 'Tệp FITS nguyên bản 4 HDU lưu trữ Data Cube 3D (thời gian & không gian) gồm Header metadata, bảng Pixel cadences và Aperture mask.',
  columns: [
    field('TIME', 'HDU 1: BINTABLE', 'Float64', 'BTJD days', 'Thời điểm mỗi cadence quan sát (Barycentric TESS Julian Date).'),
    field('TIMECORR', 'HDU 1: BINTABLE', 'Float32', 'days', 'Hiệu chỉnh thời gian photon đến hệ tọa độ khối tâm Mặt Trời.'),
    field('CADENCENO', 'HDU 1: BINTABLE', 'Int32', 'Index', 'Số thứ tự cadence duy nhất trong kỳ quan sát (Sector).'),
    field('RAW_CNTS', 'HDU 1: BINTABLE', 'Int32[][]', 'count (ADU)', 'Ma trận giá trị số đếm thô trực tiếp từ cảm biến CCD của camera.'),
    field('FLUX', 'HDU 1: BINTABLE', 'Float32[][]', 'e⁻/s', 'Ma trận cường độ sáng hiệu chỉnh (đã trừ nền và hiệu chuẩn) của pixel stamp (11x11 hoặc dải mở rộng).'),
    field('FLUX_ERR', 'HDU 1: BINTABLE', 'Float32[][]', 'e⁻/s', 'Sai số đo quang trắc 1-sigma tương ứng cho từng pixel trong ma trận.'),
    field('FLUX_BKG', 'HDU 1: BINTABLE', 'Float32[][]', 'e⁻/s', 'Cường độ nền bầu trời ước tính cục bộ (Local background flux).'),
    field('FLUX_BKG_ERR', 'HDU 1: BINTABLE', 'Float32[][]', 'e⁻/s', 'Sai số của giá trị nền bầu trời cho từng pixel.'),
    field('QUALITY', 'HDU 1: BINTABLE', 'Int32', 'Bitmask', 'Cờ chất lượng cadence (0: Hợp lệ; >0: Cảnh báo vệt nhiễu, rung lắc, momentum dump).'),
    field('POS_CORR1 / POS_CORR2', 'HDU 1: BINTABLE', 'Float32', 'pixel', 'Độ dịch chuyển vị trí tâm sao theo trục X và Y (Centroid drift).'),
    field('HDU 0: PRIMARY', 'HDU 0: Header', 'Metadata', '—', 'Siêu dữ liệu quan sát: TICID, SECTOR, CAMERA, CCD, TSTART, TSTOP, RA_OBJ, DEC_OBJ.'),
    field('HDU 2: APERTURE', 'HDU 2: Image 2D', 'Int32[][]', 'Bitmask', 'Ma trận mask 2D phân biệt các pixel thuộc khẩu độ quan trắc của sao và pixel nền.'),
    field('HDU 3: COSMIC RAY', 'HDU 3: BINTABLE', 'Event Log', '—', 'Bảng ghi nhận tọa độ và năng lượng các hạt tia vũ trụ va chạm CCD.'),
  ],
  note: 'Cấu trúc chuẩn NASA MAST gồm 4 HDU. Pipeline tiền xử lý Rust (rust-preprocessor) đọc TIME, QUALITY, FLUX để chuyển đổi sang Silver Parquet.',
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
  field('pixel_mad_median', 'TPF spatial evidence', 'Float64', 'Pixel flux', 'Trung vị MAD của pixel TPF.'),
  field('variability_peak_fraction', 'TPF spatial evidence', 'Float64', 'Fraction', 'Phần năng lượng biến thiên tập trung ở pixel đỉnh.'),
  field('transit_evidence_available', 'TPF spatial evidence', 'Bool', '—', 'Có evidence spatial cho cửa sổ transit.'),
  field('transit_deficit_sum', 'TPF spatial evidence', 'Float64', 'Pixel flux·cadence', 'Tổng deficit pixel trong cửa sổ transit.'),
  field('transit_deficit_centroid_row', 'TPF spatial evidence', 'Float64', 'Pixels', 'Tâm hàng của deficit transit.'),
  field('transit_deficit_centroid_col', 'TPF spatial evidence', 'Float64', 'Pixels', 'Tâm cột của deficit transit.'),
  field('transit_deficit_center_offset_pixels', 'TPF spatial evidence', 'Float64', 'Pixels', 'Khoảng cách tâm deficit tới tâm cutout.'),
  field('tic_available', 'TIC stellar context', 'Bool', '—', 'Có bản ghi TIC khớp mục tiêu.'),
  field('ra_deg', 'TIC stellar context', 'Float64', 'Degrees', 'Tọa độ xích kinh (Right Ascension) của sao mẹ.'),
  field('dec_deg', 'TIC stellar context', 'Float64', 'Degrees', 'Tọa độ xích vĩ (Declination) của sao mẹ.'),
  field('tmag', 'TIC stellar context', 'Float64', 'TESS mag', 'Độ sáng biểu kiến trong dải TESS.'),
  field('teff', 'TIC stellar context', 'Float64', 'Kelvin', 'Nhiệt độ hiệu dụng của sao.'),
  field('stellar_radius', 'TIC stellar context', 'Float64', 'R☉', 'Bán kính sao chủ.'),
  field('stellar_mass', 'TIC stellar context', 'Float64', 'M☉', 'Khối lượng sao chủ.'),
  field('logg', 'TIC stellar context', 'Float64', 'log₁₀(cm/s²)', 'Log gravity của sao.'),
  field('matched_toi_id', 'TOI evidence', 'String', 'TOI ID', 'TOI khớp ephemeris, nếu có.'),
  field('toi_match_status', 'TOI evidence', 'String', '—', 'TOI evidence: match, no TOI record for the TIC, or a measured-period mismatch.'),
  field('toi_period_error', 'TOI evidence', 'Float64', 'Relative error', 'Sai số chu kỳ so với TOI khớp.'),
];

export const goldCandidateSchema: SchemaCatalog = {
  schemaVersion: 'gold-candidate-v4',
  title: 'Gold Candidate Feature Store',
  description: 'Candidate discovery evidence: lineage, Light Curve/TPF/TIC and TOI evidence. Curated supervised labels are stored outside this Gold dataset.',
  columns: goldFeatureCatalog,
};
