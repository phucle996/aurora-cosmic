mod app;

#[tokio::main]
async fn main() {
    println!("[aurora-inference] Service skeleton initialized.");
    if let Err(e) = app::run().await {
        eprintln!("[aurora-inference] Error: {}", e);
        std::process::exit(1);
    }
}
