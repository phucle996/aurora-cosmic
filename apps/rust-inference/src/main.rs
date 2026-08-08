use aurora_inference::{application, config, logger};

#[tokio::main]
async fn main() {
    let cfg = match config::Config::from_env() {
        Ok(c) => c,
        Err(e) => {
            eprintln!("[aurora-inference] Startup configuration error: {}", e);
            std::process::exit(1);
        }
    };

    logger::init(&cfg.core.log_level, &cfg.core.env);
    cfg.log_summary();

    if let Err(e) = application::run(cfg).await {
        tracing::error!(error = %e, "Runtime error encountered");
        std::process::exit(1);
    }

    tracing::info!("Shutdown completed gracefully.");
}
