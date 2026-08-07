use std::path::Path;

use anyhow::{bail, Context, Result};
use fitsio::FitsFile;

use crate::event::BronzeObjectReady;

/// Raw decoded Light Curve data structure directly from FITS HDU.
#[derive(Debug, Clone)]
pub struct RawLightCurve {
    pub time: Vec<f64>,
    pub sap_flux: Option<Vec<f32>>,
    pub sap_flux_err: Option<Vec<f32>>,
    pub pdcsap_flux: Option<Vec<f32>>,
    pub pdcsap_flux_err: Option<Vec<f32>>,
    pub quality: Vec<i32>,

    pub tic_id: Option<u64>,
}

/// Decode Light Curve FITS file.
pub fn decode_lc(path: &Path, event: &BronzeObjectReady) -> Result<RawLightCurve> {
    let mut fits = FitsFile::open(path)
        .with_context(|| format!("Failed to open FITS file at {}", path.display()))?;

    // Primary HDU (0) — Header metadata verification
    let primary_hdu = fits.hdu(0).context("Failed to open Primary HDU (0)")?;
    let header_tic: Option<u64> = primary_hdu
        .read_key::<i64>(&mut fits, "TICID")
        .ok()
        .map(|v| v as u64);

    if let (Some(ev_tic), Some(hdr_tic)) = (event.tic_id, header_tic) {
        if ev_tic != hdr_tic {
            bail!(
                "TIC ID mismatch for object {}: event TIC={} vs header TIC={}",
                event.object_key,
                ev_tic,
                hdr_tic
            );
        }
    }

    // Binary Table HDU (1) — Time series columns
    let table_hdu = fits
        .hdu(1)
        .context("Failed to open Light Curve Binary Table HDU (1)")?;

    let time: Vec<f64> = table_hdu
        .read_col(&mut fits, "TIME")
        .context("Missing required column 'TIME' in Light Curve table")?;

    let quality: Vec<i32> = table_hdu
        .read_col(&mut fits, "QUALITY")
        .context("Missing required column 'QUALITY' in Light Curve table")?;

    let sap_flux: Option<Vec<f32>> = table_hdu.read_col(&mut fits, "SAP_FLUX").ok();
    let sap_flux_err: Option<Vec<f32>> = table_hdu.read_col(&mut fits, "SAP_FLUX_ERR").ok();

    let pdcsap_flux: Option<Vec<f32>> = table_hdu.read_col(&mut fits, "PDCSAP_FLUX").ok();
    let pdcsap_flux_err: Option<Vec<f32>> = table_hdu.read_col(&mut fits, "PDCSAP_FLUX_ERR").ok();

    if pdcsap_flux.is_none() && sap_flux.is_none() {
        bail!(
            "Neither PDCSAP_FLUX nor SAP_FLUX columns were found for object {}",
            event.object_key
        );
    }

    tracing::info!(
        object_key = %event.object_key,
        points = time.len(),
        has_pdcsap = pdcsap_flux.is_some(),
        has_sap = sap_flux.is_some(),
        operation = "fits_decode",
        status = "decoded",
        "Light Curve FITS decoded successfully"
    );

    Ok(RawLightCurve {
        time,
        sap_flux,
        sap_flux_err,
        pdcsap_flux,
        pdcsap_flux_err,
        quality,
        tic_id: event.tic_id.or(header_tic),
    })
}
