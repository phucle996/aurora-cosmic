pub mod adapters;
pub mod application;
pub mod config;
pub mod domain;
pub mod logger;
pub mod observer;
pub mod runtime;

// Preserve the original public paths for downstream contract tests and callers.
pub use domain::{job, model, prediction};
