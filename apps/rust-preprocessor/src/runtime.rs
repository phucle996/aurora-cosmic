//! Ephemeral, bounded preprocessing runtime telemetry over Core NATS.
//!
//! This is intentionally separate from JetStream data events: no cadence data,
//! no durable heartbeat history and a bounded channel that drops telemetry
//! rather than slowing scientific processing.

use chrono::Utc;
use serde::Serialize;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use tokio::sync::mpsc;
use tokio::task::JoinHandle;
use tokio_util::sync::CancellationToken;

pub const SUBJECT: &str = "aurora.v1.preprocessing.runtime";

#[derive(Clone, Serialize)]
pub struct RuntimeEvent {
    pub event: String,
    pub job_id: String,
    pub worker_id: String,
    pub worker_state: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub product_kind: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub object_key: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stage: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub elapsed_ms: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    pub occurred_at: String,
}

#[derive(Clone)]
pub struct RuntimeReporter {
    sender: mpsc::Sender<RuntimeEvent>,
    dropped: Arc<AtomicU64>,
}

impl RuntimeReporter {
    #[expect(
        clippy::too_many_arguments,
        reason = "the values mirror the compact Core NATS runtime event contract"
    )]
    pub fn emit(
        &self,
        event: impl Into<String>,
        job_id: &str,
        worker_id: &str,
        worker_state: &str,
        product_kind: Option<String>,
        object_key: Option<String>,
        stage: Option<String>,
        elapsed_ms: Option<u64>,
        error: Option<String>,
    ) {
        if self
            .sender
            .try_send(RuntimeEvent {
                event: event.into(),
                job_id: job_id.to_string(),
                worker_id: worker_id.to_string(),
                worker_state: worker_state.to_string(),
                product_kind,
                object_key,
                stage,
                elapsed_ms,
                error,
                occurred_at: Utc::now().to_rfc3339(),
            })
            .is_err()
        {
            let dropped = self.dropped.fetch_add(1, Ordering::Relaxed) + 1;
            if dropped.is_power_of_two() {
                tracing::warn!(
                    dropped,
                    "Preprocessing runtime telemetry is saturated; events were dropped"
                );
            }
        }
    }
}

pub fn start(
    client: async_nats::Client,
    cancel: CancellationToken,
) -> (RuntimeReporter, JoinHandle<()>) {
    let (sender, mut receiver) = mpsc::channel::<RuntimeEvent>(1024);
    let task = tokio::spawn(async move {
        loop {
            tokio::select! {
                _ = cancel.cancelled() => break,
                item = receiver.recv() => match item {
                    Some(event) => match serde_json::to_vec(&event) {
                        Ok(payload) => { let _ = client.publish(SUBJECT, payload.into()).await; }
                        Err(error) => tracing::warn!(error = %error, "Unable to encode preprocessing runtime event"),
                    },
                    None => break,
                }
            }
        }
    });
    (
        RuntimeReporter {
            sender,
            dropped: Arc::new(AtomicU64::new(0)),
        },
        task,
    )
}
