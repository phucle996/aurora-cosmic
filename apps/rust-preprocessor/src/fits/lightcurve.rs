use std::path::Path;

use anyhow::{bail, Context, Result};
use fitsio::FitsFile;

use crate::event::BronzeObjectReady;

/// Raw decoded Light Curve from a FITS file.
///
/// Contains source-level decoded columns and headers.
/// No scientific preprocessing or normalization has been applied.
#[derive(Debug, Clone)]
pub struct RawLightCurve {
    pub time: Vec<f64>,
    pub sap_flux: Option<Vec<f32>>,
    pub sap_flux_err: Option<Vec<f32>>,
    pub pdcsap_flux: Option<Vec<f32>>,
    pub pdcsap_flux_err: Option<Vec<f32>>,
    pub quality: Vec<i32>,

    pub tic_id: Option<u64>,
    pub sector: Option<u32>,
    pub camera: Option<u8>,
    pub ccd: Option<u8>,
}

/// Decode a Light Curve FITS file.
///
/// Reads HDU 1 (Light Curve Binary Table) for TIME, PDCSAP_FLUX, PDCSAP_FLUX_ERR, QUALITY columns.
/// Verifies identity matching with event metadata if present in FITS header.
pub fn decode_lc(path: &Path, event: &BronzeObjectReady) -> Result<RawLightCurve> {
    let mut fits = FitsFile::open(path)
        .with_context(|| format!("Failed to open LC FITS file at {}", path.display()))?;

    // Primary HDU (HDU 0) header metadata
    let primary_hdu = fits.hdu(0).context("Failed to open Primary HDU (0)")?;

    // fitsio ReadsKey is implemented for i64, i32, f64, f32 (not unsigned)
    let header_tic: Option<u64> = primary_hdu
        .read_key::<i64>(&mut fits, "TICID")
        .ok()
        .map(|v| v as u64);
    let header_sector: Option<u32> = primary_hdu
        .read_key::<i32>(&mut fits, "SECTOR")
        .ok()
        .map(|v| v as u32);
    let header_camera: Option<u8> = primary_hdu
        .read_key::<i32>(&mut fits, "CAMERA")
        .ok()
        .map(|v| v as u8);
    let header_ccd: Option<u8> = primary_hdu
        .read_key::<i32>(&mut fits, "CCD")
        .ok()
        .map(|v| v as u8);

    // Verify identity if available in header
    if let (Some(ev_tic), Some(hdr_tic)) = (event.tic_id, header_tic) {
        if ev_tic != hdr_tic {
            bail!(
                "TIC ID mismatch for object {}: event TIC={} vs FITS header TIC={}",
                event.object_key,
                ev_tic,
                hdr_tic
            );
        }
    }

    if let Some(hdr_sector) = header_sector {
        if event.sector != hdr_sector {
            bail!(
                "Sector mismatch for object {}: event Sector={} vs FITS header Sector={}",
                event.object_key,
                event.sector,
                hdr_sector
            );
        }
    }

    // HDU 1: Lightcurve Binary Table
    let table_hdu = fits
        .hdu(1)
        .context("Failed to open Light Curve Table HDU (1)")?;

    let time: Vec<f64> = table_hdu
        .read_col(&mut fits, "TIME")
        .context("Missing required column 'TIME' in Light Curve table")?;

    let pdcsap_flux: Option<Vec<f32>> = table_hdu.read_col(&mut fits, "PDCSAP_FLUX").ok();
    let pdcsap_flux_err: Option<Vec<f32>> = table_hdu.read_col(&mut fits, "PDCSAP_FLUX_ERR").ok();
    let sap_flux: Option<Vec<f32>> = table_hdu.read_col(&mut fits, "SAP_FLUX").ok();
    let sap_flux_err: Option<Vec<f32>> = table_hdu.read_col(&mut fits, "SAP_FLUX_ERR").ok();

    let quality: Vec<i32> = table_hdu
        .read_col(&mut fits, "QUALITY")
        .context("Missing required column 'QUALITY' in Light Curve table")?;

    if time.is_empty() {
        bail!(
            "Decoded Light Curve TIME column is empty for object {}",
            event.object_key
        );
    }

    if quality.len() != time.len() {
        bail!(
            "Column length mismatch for object {}: TIME len={} vs QUALITY len={}",
            event.object_key,
            time.len(),
            quality.len()
        );
    }

    if pdcsap_flux.is_none() && sap_flux.is_none() {
        bail!(
            "Missing both PDCSAP_FLUX and SAP_FLUX in Light Curve HDU for object {}",
            event.object_key
        );
    }

    tracing::info!(
        object_key = %event.object_key,
        rows = time.len(),
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
        sector: Some(event.sector),
        camera: event.camera.or(header_camera),
        ccd: event.ccd.or(header_ccd),
    })
}
