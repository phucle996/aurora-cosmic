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
use std::path::Path;
use tokio::io::{AsyncReadExt, AsyncWriteExt};

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
        self.ensure_max_size(bucket, key, max_bytes).await?;
        let bytes = self.get(bucket, key).await?;
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

    /// Download a verified object to a local file without retaining the full
    /// payload in memory. Gold Parquet is decoded from this file in batches.
    pub async fn download_verified_to_file(
        &self,
        bucket: &str,
        key: &str,
        expected_sha256: &str,
        max_bytes: usize,
        destination: &Path,
    ) -> Result<()> {
        self.ensure_max_size(bucket, key, max_bytes).await?;
        let response = self
            .client
            .get_object()
            .bucket(bucket)
            .key(key)
            .send()
            .await
            .with_context(|| format!("MinIO GET failed: {bucket}/{key}"))?;
        let mut body = response.body.into_async_read();
        let mut file = tokio::fs::File::create(destination)
            .await
            .with_context(|| format!("create download file {}", destination.display()))?;
        let mut hasher = Sha256::new();
        let mut buffer = vec![0_u8; 1024 * 1024];
        loop {
            let read = body
                .read(&mut buffer)
                .await
                .with_context(|| format!("MinIO body read failed: {bucket}/{key}"))?;
            if read == 0 {
                break;
            }
            hasher.update(&buffer[..read]);
            file.write_all(&buffer[..read]).await?;
        }
        file.flush().await?;
        let actual = hex::encode(hasher.finalize());
        if !actual.eq_ignore_ascii_case(expected_sha256) {
            anyhow::bail!(
                "SHA-256 mismatch for {bucket}/{key}: actual={actual} expected={expected_sha256}"
            );
        }
        Ok(())
    }

    async fn ensure_max_size(&self, bucket: &str, key: &str, max_bytes: usize) -> Result<()> {
        let head = self
            .client
            .head_object()
            .bucket(bucket)
            .key(key)
            .send()
            .await
            .with_context(|| format!("MinIO HEAD failed: {bucket}/{key}"))?;
        let content_length = head.content_length().unwrap_or_default();
        if content_length < 0 || content_length as u64 > max_bytes as u64 {
            anyhow::bail!(
                "object {bucket}/{key} is {content_length} bytes, exceeds configured limit {max_bytes}"
            );
        }
        Ok(())
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

    pub async fn put_file(
        &self,
        bucket: &str,
        key: &str,
        path: &Path,
        content_type: &str,
    ) -> Result<()> {
        let body = ByteStream::from_path(path)
            .await
            .with_context(|| format!("open upload file {}", path.display()))?;
        self.client
            .put_object()
            .bucket(bucket)
            .key(key)
            .content_type(content_type)
            .body(body)
            .send()
            .await
            .with_context(|| format!("MinIO PUT failed: {bucket}/{key}"))?;
        Ok(())
    }
}
