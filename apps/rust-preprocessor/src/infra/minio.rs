use std::collections::HashMap;
use std::path::{Path, PathBuf};

use anyhow::{bail, Context, Result};
use aws_credential_types::Credentials;
use aws_sdk_s3::config::{BehaviorVersion, Region};
use aws_sdk_s3::primitives::{ByteStream, Length};
use aws_sdk_s3::types::{CompletedMultipartUpload, CompletedPart};
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

/// Simple struct containing object metadata after stat.
#[derive(Debug, Clone)]
pub struct StoredObjectStat {
    pub size_bytes: u64,
    #[allow(dead_code)]
    pub sha256: Option<String>,
    /// Full user metadata map from MinIO object headers.
    pub metadata: HashMap<String, String>,
}

impl StoredObjectStat {
    /// Retrieve a metadata value by key (case-insensitive, dash-normalised).
    pub fn metadata_value(&self, key: &str) -> Option<String> {
        let normalised = key.to_lowercase().replace('_', "-");
        self.metadata
            .iter()
            .find(|(k, _)| k.to_lowercase().replace('_', "-") == normalised)
            .map(|(_, v)| v.clone())
    }
}

/// MinIO / S3-compatible infrastructure storage client.
pub struct MinioClient {
    client: aws_sdk_s3::Client,
}

/// Multipart parts must be >= 5 MiB on S3. 64 MiB keeps request overhead low
/// while retaining bounded local memory because each part is streamed from disk.
const MULTIPART_THRESHOLD_BYTES: u64 = 64 * 1024 * 1024;
const MULTIPART_PART_BYTES: u64 = 64 * 1024 * 1024;

impl MinioClient {
    /// Build a storage client from MinIO configuration.
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
        let all_metadata: HashMap<String, String> = resp
            .metadata()
            .map(|m| m.iter().map(|(k, v)| (k.clone(), v.clone())).collect())
            .unwrap_or_default();
        let sha256 = all_metadata.get("sha256").cloned();

        Ok(StoredObjectStat {
            size_bytes,
            sha256,
            metadata: all_metadata,
        })
    }

    /// Verify that the object exists and its size matches the event claim.
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
            let chunk =
                chunk_res.with_context(|| format!("Stream read error for {bucket}/{key}"))?;

            hasher.update(&chunk);
            total_bytes += chunk.len() as u64;

            file.write_all(&chunk).await.with_context(|| {
                format!("Failed writing chunk to temp file {}", temp_path.display())
            })?;
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
        if expected_size >= MULTIPART_THRESHOLD_BYTES {
            self.put_file_multipart(bucket, key, file_path, expected_size, metadata)
                .await?;
        } else {
            let body = ByteStream::from_path(file_path).await.with_context(|| {
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
        }

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

    /// Upload one large Silver artifact as retryable disk-backed S3 parts.
    async fn put_file_multipart(
        &self,
        bucket: &str,
        key: &str,
        file_path: &Path,
        expected_size: u64,
        metadata: HashMap<String, String>,
    ) -> Result<()> {
        let mut create = self
            .client
            .create_multipart_upload()
            .bucket(bucket)
            .key(key);
        for (name, value) in metadata {
            create = create.metadata(name, value);
        }
        let created = create
            .send()
            .await
            .with_context(|| format!("MinIO CreateMultipartUpload failed for {bucket}/{key}"))?;
        let upload_id = created
            .upload_id()
            .context("MinIO did not return an upload ID for multipart upload")?
            .to_string();

        let upload_parts = async {
            let mut completed_parts = Vec::new();
            let mut offset = 0u64;
            let mut part_number = 1i32;

            while offset < expected_size {
                let length = (expected_size - offset).min(MULTIPART_PART_BYTES);
                let body = ByteStream::read_from()
                    .path(file_path)
                    .offset(offset)
                    .length(Length::Exact(length))
                    .build()
                    .await
                    .with_context(|| {
                        format!(
                            "Failed to read multipart upload part {part_number} from {}",
                            file_path.display()
                        )
                    })?;
                let uploaded = self
                    .client
                    .upload_part()
                    .bucket(bucket)
                    .key(key)
                    .upload_id(&upload_id)
                    .part_number(part_number)
                    .body(body)
                    .send()
                    .await
                    .with_context(|| {
                        format!("MinIO UploadPart {part_number} failed for {bucket}/{key}")
                    })?;
                let e_tag = uploaded
                    .e_tag()
                    .context("MinIO did not return an ETag for multipart upload part")?;
                completed_parts.push(
                    CompletedPart::builder()
                        .part_number(part_number)
                        .e_tag(e_tag)
                        .build(),
                );
                offset += length;
                part_number += 1;
            }

            Result::<Vec<CompletedPart>>::Ok(completed_parts)
        }
        .await;

        let completed_parts = match upload_parts {
            Ok(parts) => parts,
            Err(error) => {
                let _ = self
                    .client
                    .abort_multipart_upload()
                    .bucket(bucket)
                    .key(key)
                    .upload_id(&upload_id)
                    .send()
                    .await;
                return Err(error);
            }
        };

        let completion = CompletedMultipartUpload::builder()
            .set_parts(Some(completed_parts))
            .build();
        if let Err(error) = self
            .client
            .complete_multipart_upload()
            .bucket(bucket)
            .key(key)
            .upload_id(&upload_id)
            .multipart_upload(completion)
            .send()
            .await
        {
            let _ = self
                .client
                .abort_multipart_upload()
                .bucket(bucket)
                .key(key)
                .upload_id(&upload_id)
                .send()
                .await;
            return Err(error).with_context(|| {
                format!("MinIO CompleteMultipartUpload failed for {bucket}/{key}")
            });
        }

        tracing::info!(
            bucket = bucket,
            object_key = key,
            size_bytes = expected_size,
            part_size_bytes = MULTIPART_PART_BYTES,
            operation = "silver_multipart_put",
            status = "uploaded",
            "Large Silver artifact uploaded through multipart MinIO upload"
        );
        Ok(())
    }

    /// Load JSON bytes from an object in MinIO. Returns `Ok(None)` if object does not exist.
    pub async fn get_json_object<T: serde::de::DeserializeOwned>(
        &self,
        bucket: &str,
        key: &str,
    ) -> Result<Option<T>> {
        let response = match self
            .client
            .get_object()
            .bucket(bucket)
            .key(key)
            .send()
            .await
        {
            Ok(resp) => resp,
            Err(error) => {
                // Only a genuine NoSuchKey is a cache miss. Authentication,
                // network, timeout, and permission failures must propagate so
                // recovery cannot mistake an outage for missing state.
                if error
                    .as_service_error()
                    .is_some_and(|service_error| service_error.is_no_such_key())
                {
                    return Ok(None);
                }
                return Err(anyhow::anyhow!(
                    "MinIO JSON GET failed for {bucket}/{key}: {error}"
                ));
            }
        };

        let bytes = response
            .body
            .collect()
            .await
            .with_context(|| format!("Failed reading body for {bucket}/{key}"))?
            .into_bytes();

        let obj: T = serde_json::from_slice(&bytes)
            .with_context(|| format!("Failed parsing JSON object from {bucket}/{key}"))?;

        Ok(Some(obj))
    }

    /// Save a JSON object to MinIO atomically.
    pub async fn put_json_object<T: serde::Serialize>(
        &self,
        bucket: &str,
        key: &str,
        data: &T,
    ) -> Result<()> {
        let json_bytes = serde_json::to_vec_pretty(data)
            .with_context(|| format!("Failed serializing JSON for {key}"))?;

        self.client
            .put_object()
            .bucket(bucket)
            .key(key)
            .body(json_bytes.into())
            .content_type("application/json")
            .send()
            .await
            .with_context(|| format!("Failed uploading JSON object to {bucket}/{key}"))?;

        Ok(())
    }
}
