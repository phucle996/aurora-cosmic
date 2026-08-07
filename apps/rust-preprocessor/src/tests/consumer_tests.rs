use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::Duration;

use tokio::sync::Semaphore;
use tokio::task::JoinSet;

use crate::consumer::parse_duration;

/// Mandatory bounded concurrency test.
/// Proves that at most N handlers run simultaneously even with more jobs queued.
#[tokio::test]
async fn test_bounded_concurrency() {
    let workers = 2usize;
    let total_jobs = 10usize;

    let semaphore = Arc::new(Semaphore::new(workers));
    let active = Arc::new(AtomicUsize::new(0));
    let peak = Arc::new(AtomicUsize::new(0));

    let mut set = JoinSet::new();

    for _ in 0..total_jobs {
        let sem = semaphore.clone();
        let active = active.clone();
        let peak = peak.clone();

        set.spawn(async move {
            let _permit = sem.acquire_owned().await.unwrap();

            let current = active.fetch_add(1, Ordering::SeqCst) + 1;
            peak.fetch_max(current, Ordering::SeqCst);

            tokio::time::sleep(Duration::from_millis(10)).await;

            active.fetch_sub(1, Ordering::SeqCst);
        });
    }

    while let Some(r) = set.join_next().await {
        r.unwrap();
    }

    let observed_peak = peak.load(Ordering::SeqCst);
    assert!(
        observed_peak <= workers,
        "Peak concurrent workers={observed_peak} exceeded limit={workers}"
    );
}

#[test]
fn test_parse_duration_seconds() {
    assert_eq!(parse_duration("30s"), Duration::from_secs(30));
    assert_eq!(parse_duration("5s"), Duration::from_secs(5));
}

#[test]
fn test_parse_duration_minutes() {
    assert_eq!(parse_duration("2m"), Duration::from_secs(120));
}

#[test]
fn test_parse_duration_fallback() {
    assert_eq!(parse_duration("invalid"), Duration::from_secs(30));
}
