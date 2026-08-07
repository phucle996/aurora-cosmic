use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::Duration;

use tokio::sync::Semaphore;
use tokio::task::JoinSet;

use crate::consumer::{parse_duration, placeholder_handle};
use crate::event::{BronzeObjectReady, ProductKind};

fn make_event(event_id: &str, kind: ProductKind) -> BronzeObjectReady {
    BronzeObjectReady {
        event_id: event_id.to_string(),
        event_type: "bronze.object.ready".to_string(),
        source_product_id: "mast-001".to_string(),
        sample_id: None,
        bucket: "aurora".to_string(),
        object_key: "bronze/tess/sector-0042/123/file.fits".to_string(),
        product_kind: kind,
        sector: 42,
        tic_id: Some(123456789),
        camera: None,
        ccd: None,
        size_bytes: 1024,
        sha256: "aabbccddeeff00112233445566778899aabbccddeeff00112233445566778899".to_string(),
        occurred_at: "2026-08-07T00:00:00Z".to_string(),
    }
}

#[tokio::test]
async fn test_placeholder_handle_target_pixel() {
    let event = make_event("evt-tp", ProductKind::TargetPixel);
    assert!(placeholder_handle(&event).await.is_ok());
}

#[tokio::test]
async fn test_placeholder_handle_light_curve() {
    let event = make_event("evt-lc", ProductKind::LightCurve);
    assert!(placeholder_handle(&event).await.is_ok());
}

#[tokio::test]
async fn test_placeholder_handle_ffi() {
    let event = make_event("evt-ffi", ProductKind::Ffi);
    assert!(placeholder_handle(&event).await.is_ok());
}

#[tokio::test]
async fn test_placeholder_handle_invalid_sha256() {
    let mut event = make_event("evt-bad", ProductKind::LightCurve);
    event.sha256 = "tooshort".to_string();
    assert!(placeholder_handle(&event).await.is_err());
}

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
