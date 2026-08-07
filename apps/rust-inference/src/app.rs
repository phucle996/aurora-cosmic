use crate::config::Config;

pub async fn run(config: Config) -> Result<(), Box<dyn std::error::Error>> {
    tracing::info!(device = %config.ml.device, "Service runner started");

    tokio::signal::ctrl_c().await?;
    tracing::info!("Shutdown signal received, stopping inference runtime...");

    Ok(())
}
