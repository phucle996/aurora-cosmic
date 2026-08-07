mod app;

#[tokio::main]
async fn main() {
    println!("[aurora-preprocessor] Service skeleton initialized.");
    if let Err(e) = app::run().await {
        eprintln!("[aurora-preprocessor] Error: {}", e);
        std::process::exit(1);
    }
}
