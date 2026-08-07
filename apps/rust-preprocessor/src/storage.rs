use std::collections::HashMap;
use std::path::{Path, PathBuf};

use anyhow::{bail, Context, Result};
use aws_credential_types::Credentials;
use aws_sdk_s3::config::{BehaviorVersion, Region};
use sha2::{Digest, Sha256};
use tempfile::NamedTempFile;
use tokio::io::AsyncWriteExt;

use crate::checkpoint::PreprocessingCheckpoint;
use crate::config::MinioConfig;

/// Opaque handle to a verified temporary FITS file on local disk.
///
/// The temp file is automatically deleted when this handle is dropped.
pub struct TempFitsFile {
    pub path: PathBuf,
    // Keeps the NamedTempFile alive so it is deleted on drop.
    _handle: NamedTempFile,
}

/// Simple struct containing object metadata after stat.
#[derive(Debug, Clone)]
pub struct StoredObjectStat {
    pub size_bytes: u64,
    #[allow(dead_code)]
    pub sha256: Option<String>,
}

/// MinIO / S3-compatible storage client.
///
/// Created once at startup — not per-event.
pub struct StorageClient {
    client: aws_sdk_s3::Client,
}

impl StorageClient {
    /// Build a storage client from the MinIO configuration.
    pub fn new(cfg: &MinioConfig) -> Result<Self> {
        let credentials = Credentials::new(
            &cfg.access_key,
            &cfg.secret_key,
            None,
            None,
            "aurora-preprocessor",
        );
        let s3_config = aws_sdk_s3::Config::builder()
            .endpoint_url(&cfg.endpoint)
            .credentials_provider(credentials)
            .region(Region::new("us-east-1"))
            .force_path_style(true)
            .behavior_version(BehaviorVersion::latest())
            .build();

        Ok(Self {
            client: aws_sdk_s3::Client::from_conf(s3_config),
        })
    }

    /// Stat an object and return its content length and optional user metadata SHA-256.
    pub async fn stat_object(&self, bucket: &str, key: &str) -> Result<StoredObjectStat> {
        let resp = self
            .client
            .head_object()
            .bucket(bucket)
            .key(key)
            .send()
            .await
            .with_context(|| format!("MinIO stat failed — object may not exist: {bucket}/{key}"))?;

        let size_bytes = resp.content_length().unwrap_or(0).unsigned_abs();
        let sha256 = resp
            .metadata()
            .and_then(|m| m.get("sha256").cloned());

        Ok(StoredObjectStat { size_bytes, sha256 })
    }

    /// Verify that the object exists and its size matches the event claim.
    ///
    /// Returns an error if the object is missing or the size does not match.
    pub async fn stat_and_verify_size(
        &self,
        bucket: &str,
        key: &str,
        expected_size: u64,
    ) -> Result<()> {
        let stat = self.stat_object(bucket, key).await?;
        if stat.size_bytes != expected_size {
            bail!(
                "Size mismatch for {bucket}/{key}: expected={expected_size} actual={}",
                stat.size_bytes
            );
        }

        tracing::debug!(
            bucket = bucket,
            object_key = key,
            size_bytes = expected_size,
            "Object stat verified"
        );
        Ok(())
    }

    /// Stream the Bronze object to a temporary local file, computing SHA-256 and
    /// byte count on the fly.
    pub async fn fetch_to_temp(
        &self,
        bucket: &str,
        key: &str,
        expected_size: u64,
        expected_sha256: &str,
        tmp_dir: &Path,
    ) -> Result<TempFitsFile> {
        let mut response = self
            .client
            .get_object()
            .bucket(bucket)
            .key(key)
            .send()
            .await
            .with_context(|| format!("MinIO GetObject failed for {bucket}/{key}"))?;

        let named_temp = NamedTempFile::new_in(tmp_dir).with_context(|| {
            format!(
                "Failed to create temp file in directory {}",
                tmp_dir.display()
            )
        })?;
        let temp_path = named_temp.path().to_path_buf();

        let mut file = tokio::fs::File::create(&temp_path)
            .await
            .with_context(|| format!("Failed to open temp file {}", temp_path.display()))?;

        let mut hasher = Sha256::new();
        let mut total_bytes: u64 = 0;

        while let Some(chunk_res) = response.body.next().await {
            let chunk = chunk_res
                .with_context(|| format!("Stream read error for {bucket}/{key}"))?;

            hasher.update(&chunk);
            total_bytes += chunk.len() as u64;

            file.write_all(&chunk)
                .await
                .with_context(|| format!("Failed writing chunk to temp file {}", temp_path.display()))?;
        }

        file.flush()
            .await
            .with_context(|| format!("Failed flushing temp file {}", temp_path.display()))?;

        if total_bytes != expected_size {
            bail!(
                "Downloaded byte count mismatch for {bucket}/{key}: \
                 expected={expected_size} downloaded={total_bytes}"
            );
        }

        let computed_sha256 = hex::encode(hasher.finalize());
        if !computed_sha256.eq_ignore_ascii_case(expected_sha256) {
            bail!(
                "SHA-256 checksum mismatch for {bucket}/{key}: \
                 expected={expected_sha256} computed={computed_sha256}"
            );
        }

        tracing::info!(
            bucket = bucket,
            object_key = key,
            size_bytes = total_bytes,
            sha256 = %computed_sha256,
            temp_path = %temp_path.display(),
            operation = "bronze_download",
            status = "verified",
            "Bronze FITS object downloaded and SHA-256 checksum verified"
        );

        Ok(TempFitsFile {
            path: temp_path,
            _handle: named_temp,
        })
    }

    /// Upload a local file to MinIO Silver with user metadata and verify durability.
    pub async fn put_file_and_verify(
        &self,
        bucket: &str,
        key: &str,
        file_path: &Path,
        expected_size: u64,
        metadata: HashMap<String, String>,
    ) -> Result<()> {
        let body = aws_sdk_s3::primitives::ByteStream::from_path(file_path)
            .await
            .with_context(|| {
                format!(
                    "Failed to read local file for upload: {}",
                    file_path.display()
                )
            })?;

        let mut builder = self.client.put_object().bucket(bucket).key(key).body(body);
        for (k, v) in metadata {
            builder = builder.metadata(k, v);
        }

        builder
            .send()
            .await
            .with_context(|| format!("MinIO PutObject failed for {bucket}/{key}"))?;

        // Stat verification
        self.stat_and_verify_size(bucket, key, expected_size)
            .await?;

        tracing::info!(
            bucket = bucket,
            object_key = key,
            size_bytes = expected_size,
            operation = "silver_put",
            status = "durable_verified",
            "Silver artifact uploaded and verified in MinIO"
        );

        Ok(())
    }

    /// Load a PreprocessingCheckpoint from MinIO. Returns `Ok(None)` if the checkpoint does not exist.
    pub async fn load_checkpoint(
        &self,
        bucket: &str,
        key: &str,
    ) -> Result<Option<PreprocessingCheckpoint>> {
        let response = match self
            .client
            .get_object()
            .bucket(bucket)
            .key(key)
            .send()
            .await
        {
            Ok(resp) => resp,
            Err(_) => return Ok(None),
        };

        let bytes = response
            .body
            .collect()
            .await
            .with_context(|| format!("Failed reading body for checkpoint {bucket}/{key}"))?
            .into_bytes();

        let checkpoint: PreprocessingCheckpoint = serde_json::from_slice(&bytes)
            .with_context(|| format!("Failed to parse JSON checkpoint from {bucket}/{key}"))?;

        checkpoint.validate_schema_version()?;
        Ok(Some(checkpoint))
    }

    /// Save a PreprocessingCheckpoint atomically to MinIO.
    pub async fn save_checkpoint(
        &self,
        bucket: &str,
        key: &str,
        checkpoint: &PreprocessingCheckpoint,
    ) -> Result<()> {
        let json_bytes = serde_json::to_vec_pretty(checkpoint)
            .with_context(|| format!("Failed serializing checkpoint {key}"))?;

        self.client
            .put_object()
            .bucket(bucket)
            .key(key)
            .body(json_bytes.into())
            .content_type("application/json")
            .send()
            .await
            .with_context(|| format!("Failed uploading checkpoint {bucket}/{key}"))?;

        tracing::debug!(
            bucket = bucket,
            object_key = key,
            state = ?checkpoint.state,
            operation = "checkpoint_save",
            "Checkpoint saved to MinIO"
        );

        Ok(())
    }
}
