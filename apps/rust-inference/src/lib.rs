pub mod adapters;
pub mod application;
pub mod config;
pub mod domain;
pub mod runtime;
pub mod telemetry;

// Preserve the original public paths for downstream contract tests and callers.
pub use domain::{job, model, prediction};
