//! S3-compatible storage adapter used by the inference worker.
//!
//! All reads are returned as bounded byte buffers. Job manifests and runtime
//! packages are small; Gold partitions are bounded by the job planner and are
//! validated against the declared row count before inference starts.

use anyhow::{Context, Result};
use aws_credential_types::Credentials;
use aws_sdk_s3::config::{BehaviorVersion, Region};
use aws_sdk_s3::primitives::ByteStream;
use sha2::{Digest, Sha256};

use crate::config::MinioConfig;

#[derive(Clone)]
pub struct ObjectStore {
    client: aws_sdk_s3::Client,
}

impl ObjectStore {
    pub fn new(config: &MinioConfig) -> Self {
        let credentials = Credentials::new(
            &config.access_key,
            &config.secret_key,
            None,
            None,
            "aurora-inference",
        );
        let s3_config = aws_sdk_s3::Config::builder()
            .endpoint_url(&config.endpoint)
            .credentials_provider(credentials)
            .region(Region::new("us-east-1"))
            .force_path_style(true)
            .behavior_version(BehaviorVersion::latest())
            .build();
        Self {
            client: aws_sdk_s3::Client::from_conf(s3_config),
        }
    }

    pub async fn get(&self, bucket: &str, key: &str) -> Result<Vec<u8>> {
        let response = self
            .client
            .get_object()
            .bucket(bucket)
            .key(key)
            .send()
            .await
            .with_context(|| format!("MinIO GET failed: {bucket}/{key}"))?;
        let bytes = response
            .body
            .collect()
            .await
            .with_context(|| format!("MinIO body read failed: {bucket}/{key}"))?
            .into_bytes();
        Ok(bytes.to_vec())
    }

    pub async fn get_verified(
        &self,
        bucket: &str,
        key: &str,
        expected_sha256: &str,
        max_bytes: usize,
    ) -> Result<Vec<u8>> {
        let bytes = self.get(bucket, key).await?;
        if bytes.len() > max_bytes {
            anyhow::bail!(
                "object {bucket}/{key} is {} bytes, exceeds configured limit {max_bytes}",
                bytes.len()
            );
        }
        let mut hasher = Sha256::new();
        hasher.update(&bytes);
        let actual = hex::encode(hasher.finalize());
        if !actual.eq_ignore_ascii_case(expected_sha256) {
            anyhow::bail!(
                "SHA-256 mismatch for {bucket}/{key}: actual={actual} expected={expected_sha256}"
            );
        }
        Ok(bytes)
    }

    pub async fn put_json(&self, bucket: &str, key: &str, value: &[u8]) -> Result<()> {
        self.put_bytes(bucket, key, value, "application/json").await
    }

    pub async fn put_bytes(
        &self,
        bucket: &str,
        key: &str,
        value: &[u8],
        content_type: &str,
    ) -> Result<()> {
        self.client
            .put_object()
            .bucket(bucket)
            .key(key)
            .content_type(content_type)
            .body(ByteStream::from(value.to_vec()))
            .send()
            .await
            .with_context(|| format!("MinIO PUT failed: {bucket}/{key}"))?;
        Ok(())
    }
}
