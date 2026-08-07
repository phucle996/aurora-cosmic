mod app;
mod config;
mod consumer;
mod event;
mod logger;

#[cfg(test)]
mod tests;

// Unused until Phase 3.2 — kept as stubs.
#[allow(dead_code)]
mod storage;
// Unused until Stage 4 — kept as stub.
#[allow(dead_code)]
mod checkpoint;

// Unused until Phase 3.2+ — kept as stubs.
#[allow(dead_code)]
mod fits {
    pub mod image;
    pub mod lightcurve;
}
#[allow(dead_code)]
mod pipeline {
    pub mod image;
    pub mod lightcurve;
}
// Unused until Phase 3.5 — kept as stub.
#[allow(dead_code)]
mod output {
    pub mod silver;
}

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
