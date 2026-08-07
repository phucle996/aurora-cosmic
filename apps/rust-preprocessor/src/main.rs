mod app;
mod config;

#[tokio::main]
async fn main() {
    let cfg = match config::Config::from_env() {
        Ok(c) => c,
        Err(e) => {
            eprintln!("[aurora-preprocessor] Startup configuration error: {}", e);
            std::process::exit(1);
        }
    };

    cfg.log_summary();

    if let Err(e) = app::run(cfg).await {
        eprintln!("[aurora-preprocessor] Runtime error: {}", e);
        std::process::exit(1);
    }

    println!("[aurora-preprocessor] Shutdown completed gracefully.");
}
