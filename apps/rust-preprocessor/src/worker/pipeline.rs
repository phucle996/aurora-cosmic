use std::path::PathBuf;

use anyhow::{Context, Result};

use crate::config::{ImageConfig, LightCurveConfig};
use crate::event::BronzeObjectReady;
use crate::fits::{self, DecodedProduct};
use crate::infra::MinioClient;
use crate::output::silver::{self, SilverArtifact};
use crate::pipeline;

/// Helper function to perform Steps 1..4 (Ingest, Decode, Preprocess, Serialize).
pub async fn execute_item_pipeline(
    minio: &MinioClient,
    event: &BronzeObjectReady,
    tmp_dir: &PathBuf,
    lc_cfg: &LightCurveConfig,
    img_cfg: &ImageConfig,
) -> Result<SilverArtifact> {
    // Step 1: Ingest (Stat & Fetch)
    minio
        .stat_and_verify_size(&event.bucket, &event.object_key, event.size_bytes)
        .await?;

    let temp_fits_file = minio
        .fetch_to_temp(
            &event.bucket,
            &event.object_key,
            event.size_bytes,
            &event.sha256,
            tmp_dir,
        )
        .await?;

    // Steps 2, 3, 4: CPU-bound Decode -> Preprocess -> Parquet Serialization
    let event_clone = event.clone();
    let temp_fits_path = temp_fits_file.path.clone();
    let tmp_dir_clone = tmp_dir.clone();
    let lc_config = lc_cfg.clone();
    let img_config = img_cfg.clone();

    let artifact = tokio::task::spawn_blocking(move || -> Result<SilverArtifact> {
        let decoded = fits::decode(&temp_fits_path, &event_clone)?;
        match decoded {
            DecodedProduct::LightCurve(raw_lc) => {
                let processed =
                    pipeline::lightcurve::preprocess_lc(raw_lc, &event_clone, &lc_config)?;
                silver::serialize_lightcurve(&processed, &event_clone, &tmp_dir_clone)
            }
            DecodedProduct::TargetPixel(raw_tpf) => {
                let processed =
                    pipeline::image::preprocess_target_pixel(raw_tpf, &event_clone, &img_config)?;
                silver::serialize_target_pixel(&processed, &event_clone, &tmp_dir_clone)
            }
            DecodedProduct::Ffi(raw_ffi) => {
                let processed =
                    pipeline::image::preprocess_ffi(raw_ffi, &event_clone, &img_config, None)?;
                silver::serialize_ffi(&processed, &event_clone, &tmp_dir_clone)
            }
        }
    })
    .await
    .context("CPU task panicked")??;

    Ok(artifact)
}
