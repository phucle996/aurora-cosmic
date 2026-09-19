pub mod app;
pub mod domain;
pub mod fits;
pub mod infra;
pub mod observer;
pub mod output;
pub mod pipeline;
pub mod runtime;
pub mod worker;

#[cfg(test)]
pub mod tests;

// Re-export domain & infra modules for crate root compatibility
pub use domain::{checkpoint, event, failure, lineage};
pub use infra::{config, logger, minio};
