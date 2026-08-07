pub mod image;
pub mod lightcurve;

use std::path::Path;

use anyhow::Result;

use crate::event::{BronzeObjectReady, ProductKind};
pub use image::{RawFfi, RawTargetPixel};
pub use lightcurve::RawLightCurve;

/// Decoded FITS product — one variant per product kind.
///
/// This is the output of Phase 3.2 decode: a source-level representation.
/// No scientific preprocessing has been applied.
#[derive(Debug)]
pub enum DecodedProduct {
    LightCurve(RawLightCurve),
    TargetPixel(RawTargetPixel),
    Ffi(RawFfi),
}

/// Decoded source bundle: original event + decoded FITS data.
///
/// Preserves all event metadata (object_key, sha256, sample_id, etc.) so
/// downstream pipeline phases never lose source traceability.
#[derive(Debug)]
pub struct DecodedSource {
    pub event: BronzeObjectReady,
    pub product: DecodedProduct,
}

/// Dispatch FITS decode based on `product_kind`.
///
/// This function runs **synchronously** and is intended to be called from
/// `tokio::task::spawn_blocking`.
pub fn decode(path: &Path, event: &BronzeObjectReady) -> Result<DecodedProduct> {
    match event.product_kind {
        ProductKind::LightCurve => {
            let lc = lightcurve::decode_lc(path, event)?;
            Ok(DecodedProduct::LightCurve(lc))
        }
        ProductKind::TargetPixel => {
            let tpf = image::decode_tpf(path, event)?;
            Ok(DecodedProduct::TargetPixel(tpf))
        }
        ProductKind::Ffi => {
            let ffi = image::decode_ffi(path, event)?;
            Ok(DecodedProduct::Ffi(ffi))
        }
    }
}
