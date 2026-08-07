use tracing_subscriber::{fmt, EnvFilter};

pub fn init(log_level: &str, env: &str) {
    let filter = EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| EnvFilter::new(log_level));

    fmt()
        .json()
        .with_env_filter(filter)
        .with_target(false)
        .with_current_span(false)
        .init();

    tracing::info!(
        service = "aurora-preprocessor",
        env = env,
        "Structured JSON logger initialized"
    );
}
