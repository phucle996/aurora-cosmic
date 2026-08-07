use std::env;

pub fn require_env(key: &str) -> Result<String, String> {
    env::var(key).map_err(|_| format!("Missing required environment variable '{key}'"))
}
