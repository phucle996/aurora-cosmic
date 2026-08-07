use std::collections::HashMap;
use std::path::{Path, PathBuf};

use anyhow::{bail, Context, Result};
use aws_credential_types::Credentials;
use aws_sdk_s3::config::{BehaviorVersion, Region};
use sha2::{Digest, Sha256};
use tempfile::NamedTempFile;
use tokio::io::AsyncWriteExt;

use crate::config::MinioConfig;

/// Opaque handle to a verified temporary FITS file on local disk.
///
/// The temp file is automatically deleted when this handle is dropped.
pub struct TempFitsFile {
    pub path: PathBuf,
    // Keeps the NamedTempFile alive so it is deleted on drop.
    _handle: NamedTempFile,
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

    /// Verify that the object exists and its size matches the event claim.
    ///
    /// Returns an error if the object is missing or the size does not match.
    pub async fn stat_and_verify_size(
        &self,
        bucket: &str,
        key: &str,
        expected_size: u64,
    ) -> Result<()> {
        let resp = self
            .client
            .head_object()
            .bucket(bucket)
            .key(key)
            .send()
            .await
            .with_context(|| format!("MinIO stat failed — object may not exist: {bucket}/{key}"))?;

        let actual_size = resp.content_length().unwrap_or(0).unsigned_abs();
        if actual_size != expected_size {
            bail!(
                "Size mismatch for {bucket}/{key}: \
                 expected={expected_size} actual={actual_size}"
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
    ///
    /// Order of operations (matches checklist §14):
    /// 1. GET object stream from MinIO.
    /// 2. Stream bytes → temp file + SHA-256 accumulator.
    /// 3. Verify byte count == `expected_size`.
    /// 4. Verify SHA-256 == `expected_sha256`.
    /// 5. Return the path to the verified temp file.
    ///
    /// The returned [`TempFitsFile`] deletes the file when dropped.
    pub async fn fetch_to_temp(
        &self,
        bucket: &str,
        key: &str,
        expected_size: u64,
        expected_sha256: &str,
        tmp_dir: &Path,
    ) -> Result<TempFitsFile> {
        // Ensure tmp directory exists.
        tokio::fs::create_dir_all(tmp_dir)
            .await
            .with_context(|| format!("Cannot create tmp dir: {}", tmp_dir.display()))?;

        // Create a unique temp file — deleted on drop.
        let temp = NamedTempFile::new_in(tmp_dir)
            .context("Failed to create temp FITS file")?;
        let temp_path = temp.path().to_path_buf();

        // GET object.
        let resp = self
            .client
            .get_object()
            .bucket(bucket)
            .key(key)
            .send()
            .await
            .with_context(|| format!("MinIO GET failed for {bucket}/{key}"))?;

        // Stream bytes → temp file + SHA-256.
        let mut body = resp.body.into_async_read();
        let mut file = tokio::fs::OpenOptions::new()
            .write(true)
            .open(&temp_path)
            .await
            .context("Failed to open temp file for writing")?;

        let mut hasher = Sha256::new();
        let mut bytes_written: u64 = 0;
        let mut buf = vec![0u8; 64 * 1024]; // 64 KiB chunks

        loop {
            use tokio::io::AsyncReadExt;
            let n = body
                .read(&mut buf)
                .await
                .context("Error reading MinIO response body")?;
            if n == 0 {
                break;
            }
            hasher.update(&buf[..n]);
            bytes_written += n as u64;
            file.write_all(&buf[..n])
                .await
                .context("Error writing to temp file")?;
        }
        file.flush().await.context("Failed to flush temp file")?;
        drop(file);

        // Verify byte count.
        if bytes_written != expected_size {
            // temp file deleted on drop of `temp`
            bail!(
                "Byte count mismatch for {bucket}/{key}: \
                 expected={expected_size} actual={bytes_written}"
            );
        }

        // Verify SHA-256.
        let actual_hash = hex::encode(hasher.finalize());
        let expected_lower = expected_sha256.to_lowercase();
        if actual_hash != expected_lower {
            bail!(
                "SHA-256 mismatch for {key}: \
                 expected={expected_lower} actual={actual_hash}"
            );
        }

        tracing::info!(
            bucket = bucket,
            object_key = key,
            size_bytes = bytes_written,
            operation = "bronze_fetch",
            status = "verified",
            "Bronze object fetched and verified"
        );

        Ok(TempFitsFile {
            path: temp_path,
            _handle: temp,
        })
    }

    /// Upload a local file to MinIO Silver and perform head_object size verification.
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
            .with_context(|| format!("Failed to read local file for upload: {}", file_path.display()))?;

        let mut builder = self.client.put_object().bucket(bucket).key(key).body(body);
        for (k, v) in metadata {
            builder = builder.metadata(k, v);
        }

        builder
            .send()
            .await
            .with_context(|| format!("MinIO PutObject failed for {bucket}/{key}"))?;

        // Stat verification
        self.stat_and_verify_size(bucket, key, expected_size).await?;

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
}
