use crate::config::Config;

pub async fn run(config: Config) -> Result<(), Box<dyn std::error::Error>> {
    println!("[aurora-preprocessor] Worker runtime started with {} Tokio workers.", config.workers);
    Ok(())
}
