use std::env;
use std::str::FromStr;

pub fn get_env(key: &str, fallback: &str) -> String {
    env::var(key).unwrap_or_else(|_| fallback.to_string())
}

pub fn get_env_parse<T: FromStr>(key: &str, fallback: T) -> Result<T, String> {
    match env::var(key) {
        Ok(val) => val
            .parse::<T>()
            .map_err(|_| format!("Invalid value for environment variable '{key}': '{val}'")),
        Err(_) => Ok(fallback),
    }
}
