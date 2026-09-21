use std::time::Duration;

use anyhow::{Context, Result};
use async_nats::jetstream::{self, AckKind};
use chrono::Utc;
use tokio_util::sync::CancellationToken;

use super::executor::JobOutput;
use crate::adapters::storage::ObjectStore;
use crate::domain::job::{InferenceJobManifest, InferenceJobStatusRecord};
use crate::runtime::RuntimeError;

pub fn status_key(job_id: &str) -> String {
    format!("inference/status/{job_id}.json")
}

pub fn status_record(
    job: &InferenceJobManifest,
    status: &str,
    attempt: i64,
    started_at: &str,
    output: Option<&JobOutput>,
    error: Option<String>,
) -> InferenceJobStatusRecord {
    InferenceJobStatusRecord {
        schema_version: 1,
        job_id: job.job_id.clone(),
        job_fingerprint: job.job_fingerprint.clone(),
        task: job.task.clone(),
        status: status.to_string(),
        attempt,
        started_at: started_at.to_string(),
        updated_at: Utc::now().to_rfc3339(),
        output_key: output.map(|o| o.key.clone()),
        output_sha256: output.map(|o| o.sha256.clone()),
        processed_rows: output.map(|o| o.rows as i64),
        error,
        producer: "rust-inference".to_string(),
    }
}

pub fn validate_status(
    status: &InferenceJobStatusRecord,
    job: &InferenceJobManifest,
) -> Result<()> {
    if status.schema_version != 1
        || status.job_id != job.job_id
        || status.job_fingerprint != job.job_fingerprint
        || status.task != job.task
    {
        anyhow::bail!("inference status conflicts with immutable job manifest")
    }
    Ok(())
}

pub async fn persist_status(
    store: &ObjectStore,
    bucket: &str,
    key: &str,
    status: InferenceJobStatusRecord,
) -> Result<()> {
    store
        .put_json(
            bucket,
            key,
            &serde_json::to_vec(&status).context("encode inference status")?,
        )
        .await
}

pub fn start_ack_heartbeat(
    message: jetstream::Message,
    ack_wait_secs: u64,
    cancel: CancellationToken,
) -> tokio::task::JoinHandle<()> {
    let period = Duration::from_secs((ack_wait_secs / 3).max(1));
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(period);
        interval.tick().await;
        loop {
            tokio::select! {
                _ = cancel.cancelled() => break,
                _ = interval.tick() => {
                    if let Err(error) = message.ack_with(AckKind::Progress).await {
                        tracing::warn!(%error, "failed to extend inference acknowledgement lease");
                    }
                }
            }
        }
    })
}

pub fn error_summary(error: &anyhow::Error) -> String {
    let text = format!("{error:#}");
    text.chars().take(1024).collect()
}

pub fn is_non_retryable_execution_error(error: &anyhow::Error) -> bool {
    matches!(
        error.downcast_ref::<RuntimeError>(),
        Some(
            RuntimeError::Json(_)
                | RuntimeError::Integrity(_)
                | RuntimeError::ParityFailed(_)
                | RuntimeError::UnknownFeature(_)
                | RuntimeError::MissingFeature(_)
                | RuntimeError::InvalidPackage(_)
                | RuntimeError::InvalidOutput(_)
                | RuntimeError::Ort(_)
        )
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_job() -> InferenceJobManifest {
        InferenceJobManifest {
            schema_version: 1,
            job_id: "inference-job-v1-test".to_string(),
            job_fingerprint: "f".repeat(64),
            task: "candidate_vetting".to_string(),
            selection_policy_version: "candidate-inference-selection-v1".to_string(),
            gold_snapshot_id: "gold-v1-test".to_string(),
            gold_manifest_key: "gold/snapshots/gold-v1-test/manifest.json".to_string(),
            gold_manifest_sha256: "a".repeat(64),
            gold_dataset: "candidate".to_string(),
            gold_schema_version: "gold-candidate-v1".to_string(),
            gold_artifact_key: "gold/candidate/part-0.parquet".to_string(),
            gold_artifact_content_sha256: "b".repeat(64),
            gold_artifact_parquet_sha256: None,
            gold_artifact_size_bytes: None,
            gold_artifact_row_count: 1,
            sector: 1,
            runtime_package_id: "runtime-v1-test".to_string(),
            runtime_manifest_key: "models/runtime/test/manifest.json".to_string(),
            runtime_manifest_sha256: "c".repeat(64),
            runtime_validation_id: "rval-v1-test".to_string(),
            runtime_validation_key: None,
            runtime_validation_sha256: None,
            model_id: "model-v1-test".to_string(),
            model_version: "1.0.0".to_string(),
            evaluation_run_id: "evaluation-v1-test".to_string(),
            dataset_view_version: "gold-v1".to_string(),
            dataset_view_fingerprint: "d".repeat(64),
            feature_names: vec!["feature".to_string()],
            expected_prediction_count: 1,
            created_at: "2026-08-31T00:00:00Z".to_string(),
            producer: "test".to_string(),
        }
    }

    #[test]
    fn completed_status_must_belong_to_the_same_immutable_job() {
        let job = sample_job();
        let output = JobOutput {
            key: "predictions/test.jsonl".to_string(),
            sha256: "e".repeat(64),
            rows: 1,
        };
        let mut status = status_record(
            &job,
            "completed",
            1,
            "2026-08-31T00:00:00Z",
            Some(&output),
            None,
        );
        assert!(validate_status(&status, &job).is_ok());
        status.job_fingerprint = "x".repeat(64);
        assert!(validate_status(&status, &job).is_err());
    }

    #[test]
    fn deterministic_runtime_contract_failures_are_not_retried() {
        let integrity =
            anyhow::Error::new(RuntimeError::Integrity("threshold mismatch".to_string()));
        let schema = anyhow::Error::new(RuntimeError::Json(
            serde_json::from_slice::<crate::domain::model::ThresholdConfig>(
                br#"{"schema_version":1,"decision_threshold":0.5}"#,
            )
            .expect_err("strict runtime threshold schema must reject metadata"),
        ));
        let transient = anyhow::Error::new(RuntimeError::Io(std::io::Error::new(
            std::io::ErrorKind::TimedOut,
            "temporary read timeout",
        )));

        assert!(is_non_retryable_execution_error(&integrity));
        assert!(is_non_retryable_execution_error(&schema));
        assert!(!is_non_retryable_execution_error(&transient));
    }
}
