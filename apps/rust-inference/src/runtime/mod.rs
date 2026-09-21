//! Runtime Package Engine & Numerical Parity Validation (Phase 6.6).

pub mod error;
pub mod math;
pub mod parity;
pub mod preprocessing;
pub mod session;

pub use error::RuntimeError;
pub use math::{compute_sha256, stable_sigmoid};
pub use parity::{validate_runtime_package_parity, validate_runtime_package_parity_with_device};
pub use preprocessing::preprocess_features;
pub use session::OnnxRuntime;
