pub mod adapters;
pub mod application;
pub mod config;
pub mod domain;
pub mod observer;
pub mod runtime;
pub mod logger;

// Preserve the original public paths for downstream contract tests and callers.
pub use domain::{job, model, prediction};
