#[test]
fn test_config_loads_runtime_controls() {
    std::env::set_var("AURORA_ENV", "test");
    std::env::set_var("AURORA_LOG_LEVEL", "info");
    std::env::set_var("AURORA_ML_DEVICE", "cuda");
    std::env::set_var("MINIO_ENDPOINT", "http://localhost:9000");
    std::env::set_var("MINIO_BUCKET", "aurora");
    std::env::set_var("NATS_URL", "nats://localhost:4222");

    let config = aurora_inference::config::Config::from_env().expect("config should load");
    assert_eq!(config.ml.intra_threads, 1);
    assert_eq!(config.nats.subject, "aurora.v1.inference.*.requested");
}
