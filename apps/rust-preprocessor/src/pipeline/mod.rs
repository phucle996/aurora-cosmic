pub mod image;
pub mod lightcurve;

pub use image::{preprocess_ffi, preprocess_target_pixel, ProcessedFfi, ProcessedTargetPixel};
pub use lightcurve::{preprocess_lc, ProcessedLightCurve};
