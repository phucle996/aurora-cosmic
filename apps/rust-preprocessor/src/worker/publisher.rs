use anyhow::Result;
use async_nats::jetstream;
use chrono::Utc;
use uuid::Uuid;

use crate::event::{BronzeObjectReady, ProductKind, SilverObjectReady};

/// Build a SilverObjectReady event struct.
pub fn build_silver_event(
    event: &BronzeObjectReady,
    bucket: &str,
    object_key: &str,
    sha256: &str,
    size_bytes: u64,
    schema_version: &str,
    processor_version: &str,
    processing_fingerprint: &str,
) -> SilverObjectReady {
    SilverObjectReady {
        event_id: Uuid::new_v4().to_string(),
        event_type: "silver.object.ready".to_string(),
        source_event_id: event.event_id.clone(),
        source_product_id: event.source_product_id.clone(),
        sample_id: event.sample_id.clone(),
        bucket: bucket.to_string(),
        object_key: object_key.to_string(),
        product_kind: event.product_kind.clone(),
        schema_version: schema_version.to_string(),
        processor_version: processor_version.to_string(),
        processing_fingerprint: processing_fingerprint.to_string(),
        sector: event.sector,
        tic_id: event.tic_id,
        camera: event.camera,
        ccd: event.ccd,
        size_bytes,
        sha256: sha256.to_string(),
        occurred_at: Utc::now().to_rfc3339(),
    }
}

/// Publish SilverObjectReady event to NATS JetStream.
pub async fn publish_silver_event(
    jetstream: &jetstream::Context,
    event: &SilverObjectReady,
) -> Result<()> {
    let subject = match event.product_kind {
        ProductKind::LightCurve => "aurora.v1.silver.lightcurve.ready",
        ProductKind::TargetPixel => "aurora.v1.silver.target_pixel.ready",
        ProductKind::Ffi => "aurora.v1.silver.ffi.ready",
    };

    let payload = serde_json::to_vec(event)?;
    jetstream
        .publish(subject.to_string(), payload.into())
        .await?
        .await?;

    Ok(())
}
