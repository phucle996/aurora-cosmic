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
  limit?: number;
  cursor?: string;
  next_cursor?: string;
  page?: number;
  page_size?: number;
  total?: number;
  total_bytes?: number;
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
  description: 'Immutable ingestion plan specifying TIC × sector samples and required FITS LC + TPF product pairs.',
  columns: [
    field('schema_version', 'Manifest', 'Int32', '—', 'Manifest structure schema version.'),
    field('source', 'Manifest', 'String', '—', 'Observational data source (NASA MAST).'),
    field('samples[].sample_id', 'Sample', 'String', '—', 'Stable target key for a TIC target within a sector.'),
    field('samples[].tic_id', 'Sample', 'Int64', 'TIC ID', 'Target identifier in the TESS Input Catalog.'),
    field('samples[].sector', 'Sample', 'Int32', 'TESS sector', 'Observational TESS sector.'),
    field('samples[].target_pixel', 'Product Pair', 'Object', '—', 'Required TARGET_PIXEL product for the research pair.'),
    field('samples[].light_curve', 'Product Pair', 'Object', '—', 'Required LIGHT_CURVE product for the research pair.'),
    field('*.source_product_id', 'Product', 'String', '—', 'Unique NASA MAST source product identifier.'),
    field('*.kind', 'Product', 'Enum', '—', 'LIGHT_CURVE or TARGET_PIXEL.'),
    field('*.filename', 'Product', 'String', '—', 'Source FITS filename.'),
    field('*.data_uri', 'Product', 'String', 'URI', 'MAST retrieval URI used to stream FITS.'),
    field('*.size_bytes', 'Product', 'Int64', 'Bytes', 'Estimated byte size published by MAST.'),
    field('*.sector', 'Product', 'Int32', 'TESS sector', 'Target observation sector.'),
    field('*.tic_id', 'Product', 'Int64', 'TIC ID', 'Target TIC identifier.'),
    field('*.camera', 'Product', 'Int32', 'Index', 'TESS camera index if provided by source metadata.', true),
    field('*.ccd', 'Product', 'Int32', 'Index', 'TESS CCD index if provided by source metadata.', true),
    field('statistics.paired_count', 'Statistics', 'Int32', 'Samples', 'Count of selected LC + TPF target pairs.'),
    field('statistics.tpf_bytes', 'Statistics', 'Int64', 'Bytes', 'Total planned Target Pixel byte budget.'),
    field('statistics.lc_bytes', 'Statistics', 'Int64', 'Bytes', 'Total planned Light Curve byte budget.'),
    field('statistics.total_bytes', 'Statistics', 'Int64', 'Bytes', 'Total planned download byte budget.'),
    field('catalog_snapshots', 'Provenance', 'Map<String,String>', '—', 'Pinned catalog snapshots (TIC/TOI) referenced by the plan.', true),
  ],
  note: 'The * wildcard represents samples[].target_pixel or samples[].light_curve. The manifest defines the ingestion plan; actual SHA-256 hashes and storage keys are committed to the checkpoint upon storage.',
};

export const bronzeLightCurveSchema: SchemaCatalog = {
  schemaVersion: 'fits-lightcurve-v1',
  title: 'Bronze Light Curve FITS (*_lc.fits)',
  description: 'Decoded TESS Light Curve file: target metadata headers combined with cadence time-series photometry.',
  columns: [
    field('TICID', 'Metadata', 'Int64', 'TIC ID', 'Target identifier in the TESS Input Catalog.'),
    field('SECTOR', 'Metadata', 'Int32', 'TESS sector', 'Observation sector.'),
    field('CAMERA', 'Metadata', 'Int32', '1–4', 'TESS camera detector number.'),
    field('CCD', 'Metadata', 'Int32', '1–4', 'CCD detector number.'),
    field('TESSMAG', 'Metadata', 'Float32', 'TESS mag', 'Apparent magnitude in the TESS bandpass.'),
    field('TEFF', 'Metadata', 'Float32', 'K', 'Stellar effective temperature.'),
    field('RA_OBJ', 'Metadata', 'Float64', 'degrees', 'Right ascension of target host star.'),
    field('DEC_OBJ', 'Metadata', 'Float64', 'degrees', 'Declination of target host star.'),
    field('TIME', 'Time series', 'Float64', 'BTJD days', 'Cadence midpoint timestamp in BTJD (BJD − 2457000).'),
    field('PDCSAP_FLUX', 'Photometry', 'Float32', 'e⁻/s', 'Systematic-corrected flux from Pre-search Data Conditioning.'),
    field('PDCSAP_FLUX_ERR', 'Photometry', 'Float32', 'e⁻/s', '1-sigma uncertainty of PDCSAP_FLUX.'),
    field('SAP_FLUX', 'Photometry', 'Float32', 'e⁻/s', 'Simple Aperture Photometry raw flux before systematic detrending.'),
    field('SAP_FLUX_ERR', 'Photometry', 'Float32', 'e⁻/s', '1-sigma uncertainty of SAP_FLUX.'),
    field('QUALITY', 'Quality', 'Int32', 'bitmask', 'Mission cadence quality flags (0 indicates nominal observation).'),
    field('CADENCENO', 'Sequence', 'Int32', 'count', 'Mission cadence sequence counter.'),
    field('MOM_CENTR1', 'Centroid', 'Float64', 'pixel', 'Flux-weighted column moment centroid.'),
    field('MOM_CENTR2', 'Centroid', 'Float64', 'pixel', 'Flux-weighted row moment centroid.'),
    field('POS_CORR1', 'Pointing', 'Float32', 'pixel', 'Spacecraft column position correction.'),
    field('POS_CORR2', 'Pointing', 'Float32', 'pixel', 'Spacecraft row position correction.'),
  ],
  note: 'Decoded directly by the rust-preprocessor (fits::lightcurve). NaN represents missing observational cadences. Aurora preserves TIME, QUALITY, and PDCSAP_FLUX/ERR, falling back to SAP_FLUX/ERR when required.',
};

export const bronzeTargetPixelSchema: SchemaCatalog = {
  schemaVersion: 'fits-target-pixel-v1',
  title: 'Bronze Target Pixel FITS (*_tp.fits)',
  description: 'Decoded TESS Target Pixel file: target metadata headers and cadence-by-cadence 2D pixel cutout cubes.',
  columns: [
    field('TICID', 'Metadata', 'Int64', 'TIC ID', 'Target identifier in the TESS Input Catalog.'),
    field('SECTOR', 'Metadata', 'Int32', 'TESS sector', 'Observation sector.'),
    field('CAMERA', 'Metadata', 'Int32', '1–4', 'TESS camera detector number.'),
    field('CCD', 'Metadata', 'Int32', '1–4', 'CCD detector number.'),
    field('RA_OBJ', 'Metadata', 'Float64', 'degrees', 'Right ascension of target host star.'),
    field('DEC_OBJ', 'Metadata', 'Float64', 'degrees', 'Declination of target host star.'),
    field('TIME', 'Time series', 'Float64', 'BTJD days', 'Cadence midpoint timestamp in BTJD (BJD − 2457000).'),
    field('FLUX', 'Pixel cube', 'Float32[N]', 'e⁻/s', 'Vector of calibrated pixel flux values per cadence; cutout matrix shape (rows × cols).'),
    field('FLUX_ERR', 'Pixel cube', 'Float32[N]', 'e⁻/s', '1-sigma flux uncertainty per pixel.'),
    field('FLUX_BKG', 'Pixel cube', 'Float32[N]', 'e⁻/s', 'Estimated background flux per pixel.'),
    field('FLUX_BKG_ERR', 'Pixel cube', 'Float32[N]', 'e⁻/s', 'Background flux uncertainty per pixel.'),
    field('QUALITY', 'Quality', 'Int32', 'bitmask', 'Mission cadence quality flags (0 indicates nominal observation).'),
    field('CADENCENO', 'Sequence', 'Int32', 'count', 'Mission cadence sequence counter.'),
    field('RAW_CNTS', 'Pixel cube', 'Int32[N]', 'count', 'Raw uncalibrated pixel detector counts.'),
    field('POS_CORR1', 'Pointing', 'Float32', 'pixel', 'Spacecraft column position correction.'),
    field('POS_CORR2', 'Pointing', 'Float32', 'pixel', 'Spacecraft row position correction.'),
  ],
  note: 'Streamed via TargetPixelChunkReader. Cutout dimensions (rows × cols) are unpacked from pixel vector shape TDIM. Materialized into Silver Parquet.',
};

export const bronzeFfiSchema: SchemaCatalog = {
  schemaVersion: 'fits-ffi-v1',
  title: 'Bronze Full Frame Image FITS (*_ffic.fits)',
  description: 'Decoded TESS Full Frame Image file: calibrated 2D science detector frame.',
  columns: [
    field('SECTOR', 'Metadata', 'Int32', 'TESS sector', 'Observation sector.'),
    field('CAMERA', 'Metadata', 'Int32', '1–4', 'TESS camera detector number.'),
    field('CCD', 'Metadata', 'Int32', '1–4', 'CCD detector number.'),
    field('NAXIS1', 'Geometry', 'Int32', 'pixels', 'Detector image width in pixels (typically 2048).'),
    field('NAXIS2', 'Geometry', 'Int32', 'pixels', 'Detector image height in pixels (typically 2048).'),
    field('PIXELS', 'Image data', 'Float32[W×H]', 'e⁻/s', 'Calibrated 2D full frame detector pixel flux buffer.'),
  ],
  note: 'Decoded by rust-preprocessor (fits::image::decode_ffi) to compute finite pixel statistics for Silver FFI.',
};

export const silverLightCurveSchema: SchemaCatalog = {
  schemaVersion: 'silver-lightcurve-v1',
  title: 'Silver LIGHT_CURVE Parquet',
  description: 'Selected time series with scientific validation, quality filtering, and ZSTD compression.',
  columns: [
    field('time', 'Cadence', 'Float64', 'BTJD days', 'Preserved cadence timestamp in BTJD days.'),
    field('flux', 'Photometry', 'Float32', 'Normalized flux', 'Normalized and detrended scientific flux.'),
    field('flux_err', 'Photometry', 'Float32', 'Relative flux', 'Relative flux error (flux_err / median(flux)); null when unavailable.', true),
    field('quality', 'Quality', 'Int32', 'Bitmask', 'Mission cadence quality bitmask.'),
  ],
};

export const silverTargetPixelSchema: SchemaCatalog = {
  schemaVersion: 'silver-target-pixel-v1',
  title: 'Silver TARGET_PIXEL Parquet',
  description: 'Filtered and normalized Target Pixel cutout cubes; pixel arrays are flattened in row-major order.',
  columns: [
    field('time', 'Cadence', 'Float64', 'BTJD days', 'Cadence timestamp in BTJD days.'),
    field('quality', 'Quality', 'Int32', 'Bitmask', 'Mission cadence quality bitmask.'),
    field('flux', 'Pixel array', 'List<Float32>', 'Relative flux', 'Normalized pixel flux ((pixel / reference) − 1) flattened row-major; item may be null.'),
    field('rows', 'Geometry', 'Int32', 'Pixels', 'Row dimension of the pixel cutout.'),
    field('cols', 'Geometry', 'Int32', 'Pixels', 'Column dimension of the pixel cutout.'),
  ],
  note: 'Preprocessed using chunked median reference detrending. Flux values in Silver are dimensionless relative variations rather than raw e⁻/s.',
};

export const silverFfiSchema: SchemaCatalog = {
  schemaVersion: 'silver-ffi-v1',
  title: 'Silver FFI Parquet',
  description: 'Finite statistical summary record per validated Full Frame Image.',
  columns: [
    field('width', 'Geometry', 'Int32', 'Pixels', 'Detector image width in pixels.'),
    field('height', 'Geometry', 'Int32', 'Pixels', 'Detector image height in pixels.'),
    field('finite_pixel_count', 'Quality', 'Int64', 'Pixels', 'Count of finite (non-NaN / non-infinite) pixels.'),
    field('finite_pixel_fraction', 'Quality', 'Float32', 'Fraction', 'Fraction of finite pixels (finite_pixel_count / (width × height)).'),
    field('median', 'Image statistics', 'Float32', 'Detector flux', 'Median flux of finite detector pixels.'),
    field('mean', 'Image statistics', 'Float32', 'Detector flux', 'Mean flux of finite detector pixels.'),
    field('stddev', 'Image statistics', 'Float32', 'Detector flux', 'Overall standard deviation of finite pixels.'),
    field('min', 'Image statistics', 'Float32', 'Detector flux', 'Minimum finite pixel flux value.'),
    field('max', 'Image statistics', 'Float32', 'Detector flux', 'Maximum finite pixel flux value.'),
  ],
  note: 'Silver FFI stores image statistics rather than full raw pixel matrices. Sector, camera, CCD, and provenance reside in object keys, metadata, and lineage records.',
};

export const goldFeatureCatalog: FeatureCatalogItem[] = [
  field('source_product_id', 'Identity & lineage', 'String', '—', 'Source NASA product identifier.'),
  field('lineage_id', 'Identity & lineage', 'String', '—', 'Immutable lineage ID connecting Bronze, Silver, and Gold.'),
  field('sample_id', 'Identity & lineage', 'String', '—', 'TIC × sector sample key; required for research-ready snapshots.'),
  field('tic_id', 'Identity & lineage', 'Int64', 'TIC ID', 'Target star identifier in the TESS Input Catalog.'),
  field('sector', 'Identity & lineage', 'Int32', 'TESS sector', 'TESS observation sector.'),
  field('silver_sha256', 'Identity & lineage', 'String', 'SHA-256', 'Input Silver artifact checksum.'),
  field('lc_feature_version', 'Identity & lineage', 'String', '—', 'Light curve feature extractor version.'),
  field('lc_feature_fingerprint', 'Identity & lineage', 'String', 'SHA-256', 'Reproducible feature extraction fingerprint.'),
  field('n_points', 'Time-series flux', 'Int64', 'Cadences', 'Count of valid cadences.'),
  field('time_span', 'Time-series flux', 'Float64', 'Days', 'time_max − time_min.'),
  field('median_cadence', 'Time-series flux', 'Float64', 'Days', 'Median cadence spacing.'),
  field('max_gap', 'Time-series flux', 'Float64', 'Days', 'Maximum cadence gap duration.'),
  field('flux_mean', 'Flux statistics', 'Float64', 'Normalized flux', 'Mean flux value.'),
  field('flux_median', 'Flux statistics', 'Float64', 'Normalized flux', 'Median flux value.'),
  field('flux_std', 'Flux statistics', 'Float64', 'Normalized flux', 'Flux standard deviation.'),
  field('flux_mad', 'Flux statistics', 'Float64', 'Normalized flux', 'Median absolute deviation of flux.'),
  field('flux_robust_sigma', 'Flux statistics', 'Float64', 'Normalized flux', 'Robust sigma estimate derived from MAD.'),
  field('flux_amplitude', 'Flux statistics', 'Float64', 'Normalized flux', 'Robust amplitude P95(flux) − P05(flux).'),
  field('flux_rms', 'Flux statistics', 'Float64', 'Normalized flux', 'Root-mean-square of flux.'),
  field('flux_skewness', 'Flux statistics', 'Float64', '—', 'Asymmetric skewness of flux distribution.'),
  field('flux_kurtosis', 'Flux statistics', 'Float64', '—', 'Kurtosis of flux distribution.'),
  field('median_flux_err', 'Flux statistics', 'Float64', 'Relative flux', 'Median relative flux uncertainty; null if unavailable.', true),
  field('bls_available', 'Transit BLS', 'Bool', '—', 'Sufficient data points available for Box Least Squares.'),
  field('bls_period', 'Transit BLS', 'Float64', 'Days', 'Best-fit transit period from BLS; null when unexecutable.', true),
  field('bls_duration', 'Transit BLS', 'Float64', 'Days', 'Best-fit transit duration.', true),
  field('bls_transit_time', 'Transit BLS', 'Float64', 'BTJD days', 'Best-fit transit epoch timestamp.', true),
  field('bls_depth', 'Transit BLS', 'Float64', 'Fraction ΔF/F', 'BLS transit depth relative to nominal flux.', true),
  field('bls_power', 'Transit BLS', 'Float64', 'BLS statistic', 'BLS periodogram peak strength; not equivalent to S/N.', true),
  field('pixel_mad_median', 'TPF spatial evidence', 'Float64', 'Relative flux', 'Median temporal MAD of normalized TPF pixels.', true),
  field('variability_peak_fraction', 'TPF spatial evidence', 'Float64', 'Fraction', 'Fraction of variability concentrated in peak pixel.', true),
  field('transit_evidence_available', 'TPF spatial evidence', 'Bool', '—', 'Spatial evidence available for transit window.'),
  field('transit_deficit_sum', 'TPF spatial evidence', 'Float64', 'Relative-flux sum', 'Sum of positive transit deficit across pixel map.', true),
  field('transit_deficit_centroid_row', 'TPF spatial evidence', 'Float64', 'Pixels', 'Weighted row centroid of transit deficit map.', true),
  field('transit_deficit_centroid_col', 'TPF spatial evidence', 'Float64', 'Pixels', 'Weighted column centroid of transit deficit map.', true),
  field('transit_deficit_center_offset_pixels', 'TPF spatial evidence', 'Float64', 'Pixels', 'Distance from deficit centroid to cutout center.', true),
  field('tic_available', 'TIC stellar context', 'Bool', '—', 'Target matched in TESS Input Catalog.'),
  field('ra_deg', 'TIC stellar context', 'Float64', 'Degrees', 'ICRS/J2000 Right Ascension coordinate of host star.', true),
  field('dec_deg', 'TIC stellar context', 'Float64', 'Degrees', 'ICRS/J2000 Declination coordinate of host star.', true),
  field('tmag', 'TIC stellar context', 'Float64', 'TESS mag', 'Apparent magnitude in TESS bandpass.', true),
  field('teff', 'TIC stellar context', 'Float64', 'Kelvin', 'Host star effective temperature.', true),
  field('stellar_radius', 'TIC stellar context', 'Float64', 'R☉', 'Host star radius in solar units.', true),
  field('stellar_mass', 'TIC stellar context', 'Float64', 'M☉', 'Host star mass in solar units.', true),
  field('logg', 'TIC stellar context', 'Float64', 'log₁₀(cm/s²)', 'Host star log surface gravity.', true),
  field('matched_toi_id', 'TOI evidence', 'String', 'TOI ID', 'Matched TOI ephemeris identifier if present.', true),
  field('toi_match_status', 'TOI evidence', 'String', '—', 'TOI evidence: match, no TOI record for the TIC, or measured-period mismatch.'),
  field('toi_period_error', 'TOI evidence', 'Float64', 'Relative error', '|P_BLS − P_TOI| / P_TOI; null when no TOI match exists.', true),
];

export const goldCandidateSchema: SchemaCatalog = {
  schemaVersion: 'gold-candidate-v4',
  title: 'Gold Candidate Feature Store',
  description: 'Research-ready light curves enriched with spatial TPF, TIC stellar context, and TOI ephemeris matches.',
  columns: goldFeatureCatalog,
  allFieldsNullable: true,
  note: 'Parquet v4 defines columns as nullable at the physical layer for schema evolution; producers enforce identity and status constraints. Candidate Gold records feed model inference and downstream vetting.',
};
