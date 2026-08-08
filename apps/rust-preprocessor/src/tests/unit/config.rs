use std::env;
use std::sync::Mutex;

use crate::config::Config;

static ENV_MUTEX: Mutex<()> = Mutex::new(());

fn set_required_vars(workers: &str) {
    env::set_var("AURORA_ENV", "test");
    env::set_var("AURORA_LOG_LEVEL", "debug");
    env::set_var("MINIO_ENDPOINT", "http://localhost:9000");
    env::set_var("MINIO_ACCESS_KEY", "minioadmin");
    env::set_var("MINIO_SECRET_KEY", "minioadmin");
    env::set_var("MINIO_BUCKET", "aurora");
    env::set_var("NATS_URL", "nats://localhost:4222");
    env::set_var("AURORA_PREPROCESS_WORKERS", workers);
}

#[test]
fn test_zero_workers_rejected() {
    let _guard = ENV_MUTEX.lock().unwrap();
    set_required_vars("0");
    let result = Config::from_env();
    assert!(result.is_err());
    let msg = result.unwrap_err();
    assert!(msg.contains("AURORA_PREPROCESS_WORKERS"));
}

#[test]
fn test_valid_workers_accepted() {
    let _guard = ENV_MUTEX.lock().unwrap();
    set_required_vars("4");
    let result = Config::from_env();
    assert!(result.is_ok());
    assert_eq!(result.unwrap().consumer.workers, 4);
}

#[test]
fn test_defaults_applied() {
    let _guard = ENV_MUTEX.lock().unwrap();
    set_required_vars("2");
    env::remove_var("AURORA_PREPROCESS_DURABLE");
    env::remove_var("AURORA_PREPROCESS_STREAM");
    let cfg = Config::from_env().unwrap();
    assert_eq!(cfg.consumer.durable, "aurora-rust-preprocessor");
    assert_eq!(cfg.consumer.stream, "AURORA_BRONZE");
}

#[test]
fn test_custom_durable_and_stream() {
    let _guard = ENV_MUTEX.lock().unwrap();
    set_required_vars("2");
    env::remove_var("AURORA_PREPROCESS_DURABLE");
    env::remove_var("AURORA_PREPROCESS_STREAM");
    env::set_var("AURORA_PREPROCESS_DURABLE", "my-consumer");
    env::set_var("AURORA_PREPROCESS_STREAM", "MY_STREAM");
    let cfg = Config::from_env().unwrap();
    assert_eq!(cfg.consumer.durable, "my-consumer");
    assert_eq!(cfg.consumer.stream, "MY_STREAM");
    env::remove_var("AURORA_PREPROCESS_DURABLE");
    env::remove_var("AURORA_PREPROCESS_STREAM");
}
