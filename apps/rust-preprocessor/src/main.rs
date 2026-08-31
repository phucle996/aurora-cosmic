mod app;
mod domain;
mod fits;
mod infra;
mod observer;
mod output;
mod pipeline;
mod runtime;
mod worker;

#[cfg(test)]
mod tests;

// Re-export domain & infra modules for crate root compatibility
pub use domain::{checkpoint, event, failure, lineage};
pub use infra::{config, logger};

#[tokio::main]
async fn main() {
    let cfg = match config::Config::from_env() {
        Ok(c) => c,
        Err(e) => {
            eprintln!("[aurora-preprocessor] Startup configuration error: {}", e);
            std::process::exit(1);
        }
    };

    logger::init(&cfg.core.log_level, &cfg.core.env);
    cfg.log_summary();

    if let Err(e) = app::run(cfg).await {
        tracing::error!(error = %e, "Runtime error encountered");
        std::process::exit(1);
    }

    tracing::info!("Shutdown completed gracefully.");
}
