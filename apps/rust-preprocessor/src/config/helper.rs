use std::env;
use std::str::FromStr;

pub fn require_env(key: &str) -> Result<String, String> {
    env::var(key).map_err(|_| format!("Missing required environment variable '{key}'"))
}

pub fn require_env_parse<T: FromStr>(key: &str) -> Result<T, String> {
    let val = require_env(key)?;
    val.parse::<T>()
        .map_err(|_| format!("Invalid value for environment variable '{key}': '{val}'"))
}
