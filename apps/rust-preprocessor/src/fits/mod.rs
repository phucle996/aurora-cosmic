pub mod lightcurve;
pub mod target_pixel;

use std::path::Path;

use anyhow::{bail, Result};

use crate::event::{BronzeObjectReady, ProductKind};
pub use lightcurve::RawLightCurve;
pub use target_pixel::{RawTargetPixel, TargetPixelChunkReader};

/// Decoded FITS product — one variant per product kind.
///
/// This is the output of Phase 3.2 decode: a source-level representation.
/// No scientific preprocessing has been applied.
#[derive(Debug)]
pub enum DecodedProduct {
    LightCurve(RawLightCurve),
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
            bail!("Target Pixel products must be decoded through TargetPixelChunkReader")
        }
    }
}
