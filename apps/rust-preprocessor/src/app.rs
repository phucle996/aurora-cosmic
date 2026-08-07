use crate::config::Config;

pub async fn run(config: Config) -> Result<(), Box<dyn std::error::Error>> {
    tracing::info!(workers = config.preprocess.workers, "Worker runtime started");

    tokio::signal::ctrl_c().await?;
    tracing::info!("Shutdown signal received, stopping Tokio workers...");

    Ok(())
}
