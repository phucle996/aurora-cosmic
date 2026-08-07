use crate::config::Config;

pub async fn run(config: Config) -> Result<(), Box<dyn std::error::Error>> {
    println!("[aurora-inference] Service runner started with device '{}'.", config.device);
    Ok(())
}
