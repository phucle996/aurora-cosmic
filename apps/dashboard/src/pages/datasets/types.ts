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
  nullable: boolean;
  description: string;
};

export type SchemaCatalog = {
  schemaVersion: string;
  title: string;
  description: string;
  columns: FeatureCatalogItem[];
  itemLabel?: string;
  allFieldsNullable?: boolean;
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
  nullable = false,
): FeatureCatalogItem => ({ name, category, dtype, unit, nullable, description });

export const bronzeManifestSchema: SchemaCatalog = {
  schemaVersion: 'ingestion-manifest-v1',
  title: 'Bronze Ingestion Manifest',
  description: 'Kế hoạch tải bất biến gồm các mẫu TIC × sector và cặp FITS LC + TPF bắt buộc.',
  columns: [
    field('schema_version', 'Manifest', 'Int32', '—', 'Phiên bản cấu trúc manifest.'),
    field('source', 'Manifest', 'String', '—', 'Nguồn dữ liệu quan sát, hiện tại là NASA MAST.'),
    field('samples[].sample_id', 'Mẫu quan sát', 'String', '—', 'Khoá ghép ổn định của một TIC trong một sector.'),
    field('samples[].tic_id', 'Mẫu quan sát', 'Int64', 'TIC ID', 'ID mục tiêu trong TESS Input Catalog.'),
    field('samples[].sector', 'Mẫu quan sát', 'Int32', 'TESS sector', 'Sector quan sát của mẫu.'),
    field('samples[].target_pixel', 'Cặp sản phẩm', 'Object', '—', 'Sản phẩm TARGET_PIXEL bắt buộc của mẫu nghiên cứu.'),
    field('samples[].light_curve', 'Cặp sản phẩm', 'Object', '—', 'Sản phẩm LIGHT_CURVE bắt buộc của mẫu nghiên cứu.'),
    field('*.source_product_id', 'Sản phẩm', 'String', '—', 'Định danh sản phẩm nguồn duy nhất từ NASA MAST.'),
    field('*.kind', 'Sản phẩm', 'Enum', '—', 'LIGHT_CURVE hoặc TARGET_PIXEL.'),
    field('*.filename', 'Sản phẩm', 'String', '—', 'Tên tệp FITS nguồn.'),
    field('*.data_uri', 'Sản phẩm', 'String', 'URI', 'MAST retrieval URI dùng để stream FITS.'),
    field('*.size_bytes', 'Sản phẩm', 'Int64', 'Bytes', 'Kích thước dự kiến do MAST công bố.'),
    field('*.sector', 'Sản phẩm', 'Int32', 'TESS sector', 'Sector gắn với sản phẩm.'),
    field('*.tic_id', 'Sản phẩm', 'Int64', 'TIC ID', 'TIC của LC/TPF.'),
    field('*.camera', 'Sản phẩm', 'Int32', 'Index', 'Camera TESS nếu metadata nguồn cung cấp.', true),
    field('*.ccd', 'Sản phẩm', 'Int32', 'Index', 'CCD TESS nếu metadata nguồn cung cấp.', true),
    field('statistics.paired_count', 'Thống kê', 'Int32', 'Samples', 'Số cặp LC + TPF được chọn.'),
    field('statistics.tpf_bytes', 'Thống kê', 'Int64', 'Bytes', 'Tổng kích thước Target Pixel dự kiến.'),
    field('statistics.lc_bytes', 'Thống kê', 'Int64', 'Bytes', 'Tổng kích thước Light Curve dự kiến.'),
    field('statistics.total_bytes', 'Thống kê', 'Int64', 'Bytes', 'Tổng dung lượng tải dự kiến.'),
    field('catalog_snapshots', 'Provenance', 'Map<String,String>', '—', 'Catalog snapshot được pin vào kế hoạch nếu có.', true),
  ],
  note: 'Dấu * đại diện cho samples[].target_pixel hoặc samples[].light_curve. Manifest chỉ lập kế hoạch; SHA-256 và object key thực tế được ghi trong ingestion checkpoint sau khi tải.',
};

export const bronzeLightCurveFitsSchema: SchemaCatalog = {
  schemaVersion: 'NASA TESS Light Curve FITS Standard (Multi-HDU Series)',
  title: 'Bronze LIGHT_CURVE — HDU 1 LIGHTCURVE',
  description: 'Đúng 20 cột cadence trong binary table của sản phẩm SPOC Light Curve đang được ingest.',
  itemLabel: 'columns',
  columns: [
    field('TIME', 'Cadence', 'Float64 · FITS D', 'BJD − 2457000 days', 'Thời điểm giữa cadence theo thang BTJD.'),
    field('TIMECORR', 'Cadence', 'Float32 · FITS E', 'days', 'Hiệu chỉnh barycentric đã áp dụng vào TIME.'),
    field('CADENCENO', 'Cadence', 'Int32 · FITS J', 'count', 'Số cadence kể từ đầu nhiệm vụ.'),
    field('SAP_FLUX', 'Aperture photometry', 'Float32 · FITS E', 'e⁻/s', 'Simple Aperture Photometry trước bước khử systematics của PDC.'),
    field('SAP_FLUX_ERR', 'Aperture photometry', 'Float32 · FITS E', 'e⁻/s', 'Sai số 1-sigma của SAP_FLUX.'),
    field('SAP_BKG', 'Aperture photometry', 'Float32 · FITS E', 'e⁻/s', 'Thông lượng nền ước lượng trong khẩu độ.'),
    field('SAP_BKG_ERR', 'Aperture photometry', 'Float32 · FITS E', 'e⁻/s', 'Sai số 1-sigma của SAP_BKG.'),
    field('PDCSAP_FLUX', 'Corrected photometry', 'Float32 · FITS E', 'e⁻/s', 'SAP flux đã khử xu hướng hệ thống bằng Pre-search Data Conditioning.'),
    field('PDCSAP_FLUX_ERR', 'Corrected photometry', 'Float32 · FITS E', 'e⁻/s', 'Sai số 1-sigma của PDCSAP_FLUX.'),
    field('QUALITY', 'Quality', 'Int32 · FITS J', 'bitmask', 'Cờ chất lượng cadence; 0 là không có bit cảnh báo. FITS hiển thị bằng B16.16 nhưng storage vẫn là Int32.'),
    field('PSF_CENTR1', 'PSF centroid', 'Float64 · FITS D', 'pixel', 'Tọa độ cột từ PSF fitting.'),
    field('PSF_CENTR1_ERR', 'PSF centroid', 'Float32 · FITS E', 'pixel', 'Sai số tọa độ cột PSF.'),
    field('PSF_CENTR2', 'PSF centroid', 'Float64 · FITS D', 'pixel', 'Tọa độ hàng từ PSF fitting.'),
    field('PSF_CENTR2_ERR', 'PSF centroid', 'Float32 · FITS E', 'pixel', 'Sai số tọa độ hàng PSF.'),
    field('MOM_CENTR1', 'Moment centroid', 'Float64 · FITS D', 'pixel', 'Tọa độ cột của flux-weighted centroid.'),
    field('MOM_CENTR1_ERR', 'Moment centroid', 'Float32 · FITS E', 'pixel', 'Sai số tọa độ cột moment centroid.'),
    field('MOM_CENTR2', 'Moment centroid', 'Float64 · FITS D', 'pixel', 'Tọa độ hàng của flux-weighted centroid.'),
    field('MOM_CENTR2_ERR', 'Moment centroid', 'Float32 · FITS E', 'pixel', 'Sai số tọa độ hàng moment centroid.'),
    field('POS_CORR1', 'Position correction', 'Float32 · FITS E', 'pixel', 'Hiệu chỉnh vị trí theo trục cột.'),
    field('POS_CORR2', 'Position correction', 'Float32 · FITS E', 'pixel', 'Hiệu chỉnh vị trí theo trục hàng.'),
  ],
  note: 'Số dòng thay đổi theo object. Ví dụ TIC 100014454 / Sector 2 có 19.737 cadence. NaN là giá trị thiếu trong FITS, không phải cột nullable kiểu database. AURORA giữ TIME, QUALITY, PDCSAP_FLUX/ERR và chỉ fallback sang SAP_FLUX/ERR khi được cấu hình.',
};

export const bronzeLightCurveHduSchema: SchemaCatalog = {
  schemaVersion: 'Observed SPOC Light Curve layout',
  title: 'Bronze LIGHT_CURVE — FITS structure',
  description: 'Ba Header Data Unit có vai trò khác nhau; không được tính HDU như cột của bảng cadence.',
  itemLabel: 'HDUs',
  columns: [
    field('HDU 0 · PRIMARY', 'Header', 'PrimaryHDU', '44 cards in sample', 'Metadata toàn cục; không chứa data array.'),
    field('HDU 1 · LIGHTCURVE', 'Time series', 'BinTableHDU', 'rows × 20 columns', 'Mỗi dòng tương ứng một cadence quan sát.'),
    field('HDU 2 · APERTURE', 'Pixel mask', 'ImageHDU · Int32[H,W]', 'bitmask', 'Mặt nạ khẩu độ 2D; kích thước phụ thuộc mục tiêu, ví dụ 13 × 11 trong NumPy.'),
  ],
};

export const bronzeLightCurvePrimaryHeaderSchema: SchemaCatalog = {
  schemaVersion: 'TESS SPOC PRIMARY header / selected science keys',
  title: 'Bronze LIGHT_CURVE — HDU 0 PRIMARY metadata',
  description: 'Các header key khoa học quan trọng; đây không phải toàn bộ 44 FITS cards của file mẫu.',
  itemLabel: 'header keys',
  columns: [
    field('TELESCOP', 'Mission', 'String', '—', 'Kính thiên văn/nhiệm vụ, hiện tại là TESS.'),
    field('INSTRUME', 'Mission', 'String', '—', 'Thiết bị quan sát: TESS Photometer.'),
    field('OBJECT', 'Target', 'String', '—', 'Tên mục tiêu, thường có dạng TIC <id>.'),
    field('TICID', 'Target', 'Int64', 'TIC ID', 'Định danh mục tiêu trong TESS Input Catalog.'),
    field('SECTOR', 'Observation', 'Int32', 'TESS sector', 'Sector quan sát.'),
    field('CAMERA', 'Detector', 'Int32', '1–4', 'Camera TESS.'),
    field('CCD', 'Detector', 'Int32', '1–4', 'CCD trong camera.'),
    field('RA_OBJ', 'Sky position', 'Float64', 'degrees', 'Xích kinh của mục tiêu.'),
    field('DEC_OBJ', 'Sky position', 'Float64', 'degrees', 'Xích vĩ của mục tiêu.'),
    field('TESSMAG', 'Stellar context', 'Float32', 'TESS mag', 'Độ sáng biểu kiến trong dải TESS.'),
    field('TEFF', 'Stellar context', 'Float32', 'K', 'Nhiệt độ hiệu dụng của sao.'),
    field('LOGG', 'Stellar context', 'Float32', 'log₁₀(cm/s²)', 'Trọng trường bề mặt sao.'),
    field('RADIUS', 'Stellar context', 'Float32', 'R☉', 'Bán kính sao theo đơn vị bán kính Mặt Trời.'),
    field('DATE-OBS', 'Observation', 'ISO-8601 String', 'UTC', 'Thời điểm bắt đầu quan sát.'),
    field('DATE-END', 'Observation', 'ISO-8601 String', 'UTC', 'Thời điểm kết thúc quan sát.'),
  ],
};

export const bronzeTargetPixelFitsSchema: SchemaCatalog = {
  schemaVersion: 'NASA TESS Target Pixel FITS Standard (Multi-HDU Data Cube)',
  title: 'Bronze TARGET_PIXEL — HDU 1 PIXELS',
  description: 'Mười một cột cadence trong binary table; mỗi trường ảnh dùng TDIM để phục hồi ma trận pixel.',
  itemLabel: 'columns',
  columns: [
    field('TIME', 'Cadence', 'Float64 · FITS D', 'BJD − 2457000 days', 'Thời điểm giữa cadence theo thang BTJD.'),
    field('TIMECORR', 'Cadence', 'Float32 · FITS E', 'days', 'Hiệu chỉnh barycentric của TIME.'),
    field('CADENCENO', 'Cadence', 'Int32 · FITS J', 'count', 'Số cadence kể từ đầu nhiệm vụ.'),
    field('RAW_CNTS', 'Pixel cube', 'Int32[N] · FITS J', 'count', 'Pixel counts dạng vector; TDIM=(width,height) phục hồi ma trận.'),
    field('FLUX', 'Pixel cube', 'Float32[N] · FITS E', 'e⁻/s', 'Pixel flux đã hiệu chuẩn dạng vector.'),
    field('FLUX_ERR', 'Pixel cube', 'Float32[N] · FITS E', 'e⁻/s', 'Sai số 1-sigma tương ứng cho từng pixel.'),
    field('FLUX_BKG', 'Pixel cube', 'Float32[N] · FITS E', 'e⁻/s', 'Thông lượng nền ước lượng theo pixel.'),
    field('FLUX_BKG_ERR', 'Pixel cube', 'Float32[N] · FITS E', 'e⁻/s', 'Sai số thông lượng nền theo pixel.'),
    field('QUALITY', 'Quality', 'Int32 · FITS J', 'bitmask', 'Cờ chất lượng cadence; 0 là không có bit cảnh báo.'),
    field('POS_CORR1', 'Position correction', 'Float32 · FITS E', 'pixel', 'Hiệu chỉnh vị trí theo trục cột.'),
    field('POS_CORR2', 'Position correction', 'Float32 · FITS E', 'pixel', 'Hiệu chỉnh vị trí theo trục hàng.'),
  ],
  note: 'N và TDIM phụ thuộc cutout. File TIC 100014454 có N=143 và TDIM=(11,13). AURORA hiện chỉ materialize TIME, QUALITY và FLUX sang Silver.',
};

export const bronzeTargetPixelHduSchema: SchemaCatalog = {
  schemaVersion: 'Observed SPOC Target Pixel layout',
  title: 'Bronze TARGET_PIXEL — FITS structure',
  description: 'Bốn HDU của Target Pixel File; số cadence và kích thước cutout thay đổi theo object.',
  itemLabel: 'HDUs',
  columns: [
    field('HDU 0 · PRIMARY', 'Header', 'PrimaryHDU', 'FITS cards', 'Metadata toàn cục của mục tiêu và quan sát.'),
    field('HDU 1 · PIXELS', 'Time × pixel', 'BinTableHDU', 'rows × 11 columns', 'Một cadence trên mỗi dòng; các cột ảnh được lưu dạng vector có TDIM.'),
    field('HDU 2 · APERTURE', 'Pixel mask', 'ImageHDU · Int32[H,W]', 'bitmask', 'Mặt nạ khẩu độ của cutout.'),
    field('HDU 3 · TARGET COSMIC RAY', 'Correction events', 'BinTableHDU', 'rows × 4 columns', 'Các hiệu chỉnh cosmic ray; bảng có thể rỗng.'),
  ],
};

export const bronzeTargetPixelCosmicRaySchema: SchemaCatalog = {
  schemaVersion: 'TESS SPOC TARGET COSMIC RAY extension',
  title: 'Bronze TARGET_PIXEL — HDU 3 cosmic-ray corrections',
  description: 'Bốn cột của extension hiệu chỉnh cosmic ray, tách khỏi 11 cột PIXELS.',
  itemLabel: 'columns',
  columns: [
    field('CADENCENO', 'Event identity', 'Int32 · FITS J', 'count', 'Cadence chứa hiệu chỉnh cosmic ray.'),
    field('RAWX', 'Pixel position', 'Int16 · FITS I', 'pixel', 'Tọa độ cột CCD của pixel.'),
    field('RAWY', 'Pixel position', 'Int16 · FITS I', 'pixel', 'Tọa độ hàng CCD của pixel.'),
    field('COSMIC_RAY', 'Correction', 'Float32 · FITS E', 'e⁻/s', 'Giá trị hiệu chỉnh áp dụng lên pixel; không phải năng lượng hạt.'),
  ],
};

export const silverLightCurveSchema: SchemaCatalog = {
  schemaVersion: 'silver-lightcurve-v1',
  title: 'Silver LIGHT_CURVE Parquet',
  description: 'Chuỗi thời gian đã chọn flux, lọc/chuẩn hoá khoa học và nén ZSTD.',
  columns: [
    field('time', 'Cadence', 'Float64', 'BTJD days', 'Thời điểm cadence đã giữ lại.'),
    field('flux', 'Quang trắc', 'Float32', 'Normalized flux', 'Flux khoa học đã chọn và tiền xử lý.'),
    field('flux_err', 'Quang trắc', 'Float32', 'Relative flux', 'Sai số tương đối flux_err / median(flux); null khi nguồn không cung cấp.', true),
    field('quality', 'Chất lượng', 'Int32', 'Bitmask', 'Cờ quality tương ứng cadence.'),
  ],
};

export const silverTargetPixelSchema: SchemaCatalog = {
  schemaVersion: 'silver-target-pixel-v1',
  title: 'Silver TARGET_PIXEL Parquet',
  description: 'Target Pixel File đã lọc cadence và chuẩn hoá; mỗi ma trận pixel được flatten theo row-major.',
  columns: [
    field('time', 'Cadence', 'Float64', 'BTJD days', 'Thời điểm cadence.'),
    field('quality', 'Chất lượng', 'Int32', 'Bitmask', 'Cờ quality cadence.'),
    field('flux', 'Ảnh pixel', 'List<Float32>', 'Relative flux', 'Pixel đã chuẩn hoá theo (pixel / reference) − 1 và flatten row-major; item có thể null theo Arrow schema.'),
    field('rows', 'Hình học', 'Int32', 'Pixels', 'Số hàng của cutout pixel.'),
    field('cols', 'Hình học', 'Int32', 'Pixels', 'Số cột của cutout pixel.'),
  ],
  note: 'Processor hiện dùng tpf-preprocess-v2-chunked với reference median theo chunk. Vì vậy flux Silver là đại lượng tương đối không thứ nguyên, không còn đơn vị e⁻/s của FITS nguồn.',
};

export const silverFfiSchema: SchemaCatalog = {
  schemaVersion: 'silver-ffi-v1',
  title: 'Silver FFI Parquet',
  description: 'Một bản ghi thống kê hữu hạn cho mỗi Full Frame Image đã kiểm tra.',
  columns: [
    field('width', 'Hình học', 'Int32', 'Pixels', 'Chiều rộng ảnh detector.'),
    field('height', 'Hình học', 'Int32', 'Pixels', 'Chiều cao ảnh detector.'),
    field('finite_pixel_count', 'Chất lượng', 'Int64', 'Pixels', 'Số pixel có giá trị hữu hạn.'),
    field('finite_pixel_fraction', 'Chất lượng', 'Float32', 'Fraction', 'finite_pixel_count / (width × height).'),
    field('median', 'Thống kê ảnh', 'Float32', 'Detector flux', 'Trung vị của các pixel hữu hạn.'),
    field('mean', 'Thống kê ảnh', 'Float32', 'Detector flux', 'Trung bình của các pixel hữu hạn.'),
    field('stddev', 'Thống kê ảnh', 'Float32', 'Detector flux', 'Độ lệch chuẩn tổng thể của các pixel hữu hạn.'),
    field('min', 'Thống kê ảnh', 'Float32', 'Detector flux', 'Giá trị pixel hữu hạn nhỏ nhất.'),
    field('max', 'Thống kê ảnh', 'Float32', 'Detector flux', 'Giá trị pixel hữu hạn lớn nhất.'),
  ],
  note: 'FFI Silver lưu thống kê ảnh, không lưu lại toàn bộ ma trận pixel. Sector, camera, CCD và provenance nằm trong object key, metadata và lineage record.',
};

export const goldFeatureCatalog: FeatureCatalogItem[] = [
  field('source_product_id', 'Identity & lineage', 'String', '—', 'ID sản phẩm NASA nguồn.'),
  field('lineage_id', 'Identity & lineage', 'String', '—', 'ID lineage bất biến nối Bronze, Silver và Gold.'),
  field('sample_id', 'Identity & lineage', 'String', '—', 'Khoá mẫu TIC × sector; bắt buộc với snapshot research-ready.'),
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
  field('median_flux_err', 'Thống kê flux', 'Float64', 'Relative flux', 'Trung vị sai số flux tương đối; null nếu FITS không có uncertainty.', true),
  field('bls_available', 'Transit BLS', 'Bool', '—', 'Có đủ dữ liệu để chạy Box Least Squares.'),
  field('bls_period', 'Transit BLS', 'Float64', 'Days', 'Chu kỳ transit tốt nhất từ BLS; null khi BLS không chạy được.', true),
  field('bls_duration', 'Transit BLS', 'Float64', 'Days', 'Thời lượng transit tốt nhất.', true),
  field('bls_transit_time', 'Transit BLS', 'Float64', 'BTJD days', 'Epoch transit tốt nhất.', true),
  field('bls_depth', 'Transit BLS', 'Float64', 'Fraction ΔF/F', 'Độ sâu transit BLS trên flux tương đối.', true),
  field('bls_power', 'Transit BLS', 'Float64', 'BLS statistic', 'Độ mạnh đỉnh periodogram BLS; không mặc định là S/N.', true),
  field('pixel_mad_median', 'TPF spatial evidence', 'Float64', 'Relative flux', 'Trung vị MAD theo thời gian của các pixel TPF đã chuẩn hoá.', true),
  field('variability_peak_fraction', 'TPF spatial evidence', 'Float64', 'Fraction', 'Tỷ lệ biến thiên tập trung tại pixel mạnh nhất.', true),
  field('transit_evidence_available', 'TPF spatial evidence', 'Bool', '—', 'Có evidence spatial cho cửa sổ transit.'),
  field('transit_deficit_sum', 'TPF spatial evidence', 'Float64', 'Relative-flux sum', 'Tổng deficit dương trên bản đồ pixel median(out-of-transit) − median(in-transit).', true),
  field('transit_deficit_centroid_row', 'TPF spatial evidence', 'Float64', 'Pixels', 'Tâm hàng có trọng số của bản đồ deficit transit.', true),
  field('transit_deficit_centroid_col', 'TPF spatial evidence', 'Float64', 'Pixels', 'Tâm cột có trọng số của bản đồ deficit transit.', true),
  field('transit_deficit_center_offset_pixels', 'TPF spatial evidence', 'Float64', 'Pixels', 'Khoảng cách từ deficit centroid tới tâm cutout.', true),
  field('tic_available', 'TIC stellar context', 'Bool', '—', 'Có bản ghi TIC khớp mục tiêu.'),
  field('ra_deg', 'TIC stellar context', 'Float64', 'Degrees', 'Tọa độ xích kinh ICRS/J2000 của sao mẹ.', true),
  field('dec_deg', 'TIC stellar context', 'Float64', 'Degrees', 'Tọa độ xích vĩ ICRS/J2000 của sao mẹ.', true),
  field('tmag', 'TIC stellar context', 'Float64', 'TESS mag', 'Độ sáng biểu kiến trong dải TESS.', true),
  field('teff', 'TIC stellar context', 'Float64', 'Kelvin', 'Nhiệt độ hiệu dụng của sao.', true),
  field('stellar_radius', 'TIC stellar context', 'Float64', 'R☉', 'Bán kính sao chủ.', true),
  field('stellar_mass', 'TIC stellar context', 'Float64', 'M☉', 'Khối lượng sao chủ.', true),
  field('logg', 'TIC stellar context', 'Float64', 'log₁₀(cm/s²)', 'Log gravity của sao.', true),
  field('matched_toi_id', 'TOI evidence', 'String', 'TOI ID', 'TOI khớp ephemeris, nếu có.', true),
  field('toi_match_status', 'TOI evidence', 'String', '—', 'TOI evidence: match, no TOI record for the TIC, or a measured-period mismatch.'),
  field('toi_period_error', 'TOI evidence', 'Float64', 'Relative error', '|P_BLS − P_TOI| / P_TOI; null khi không có TOI khớp.', true),
];

export const goldCandidateSchema: SchemaCatalog = {
  schemaVersion: 'gold-candidate-v4',
  title: 'Gold Candidate Feature Store',
  description: 'Mỗi dòng là một LC research-ready đã ghép TPF, TIC và TOI evidence; đây là schema producer đang ghi thực tế.',
  columns: goldFeatureCatalog,
  allFieldsNullable: true,
  note: 'Parquet v4 khai báo mọi cột nullable ở tầng vật lý để hợp nhất artifact an toàn; producer vẫn bắt buộc các trường identity và trạng thái. Candidate Gold không chứa training_label, TCE match hay quyết định con người; các nhãn nằm trong candidate_training_cohort_v1.',
};
