use std::path::Path;

use anyhow::{bail, Context, Result};
use fitsio::FitsFile;

use crate::event::BronzeObjectReady;

/// Raw Target Pixel File (TPF) data structure.
#[derive(Debug, Clone)]
pub struct RawTargetPixel {
    pub time: Vec<f64>,
    pub quality: Vec<i32>,
    pub flux: Vec<Vec<Vec<f32>>>, // [cadence][row][col]
    pub rows: usize,
    pub cols: usize,
    pub tic_id: Option<u64>,
}

/// Raw Full Frame Image (FFI) data structure.
#[derive(Debug, Clone)]
pub struct RawFfi {
    pub width: usize,
    pub height: usize,
    pub pixels: Vec<f32>,
}

/// Decode TPF FITS file (Target Pixel File).
pub fn decode_tpf(path: &Path, event: &BronzeObjectReady) -> Result<RawTargetPixel> {
    let mut fits = FitsFile::open(path)
        .with_context(|| format!("Failed to open TPF FITS file at {}", path.display()))?;

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

    let table_hdu = fits.hdu(1).context("Failed to open TPF Table HDU (1)")?;

    let time: Vec<f64> = table_hdu
        .read_col(&mut fits, "TIME")
        .context("Missing required column 'TIME' in TPF table")?;

    let quality: Vec<i32> = table_hdu
        .read_col(&mut fits, "QUALITY")
        .context("Missing required column 'QUALITY' in TPF table")?;

    if time.is_empty() {
        bail!(
            "Decoded TPF TIME column is empty for object {}",
            event.object_key
        );
    }

    // Flux array in TPF binary table: 3D pixel cube per cadence or 2D image column
    let flux_data: Vec<f32> = table_hdu.read_col(&mut fits, "FLUX").unwrap_or_default();

    let cadences = time.len();
    let total_pixels = flux_data.len();
    let pixels_per_cadence = total_pixels.checked_div(cadences).unwrap_or(0);

    let side = (pixels_per_cadence as f64).sqrt() as usize;
    let (rows, cols) = if side * side == pixels_per_cadence && side > 0 {
        (side, side)
    } else {
        (pixels_per_cadence, 1)
    };

    let mut flux = Vec::with_capacity(cadences);
    if rows > 0 && cols > 0 && total_pixels == cadences * rows * cols {
        for c in 0..cadences {
            let offset = c * rows * cols;
            let mut frame = Vec::with_capacity(rows);
            for r in 0..rows {
                let row_offset = offset + r * cols;
                frame.push(flux_data[row_offset..row_offset + cols].to_vec());
            }
            flux.push(frame);
        }
    }

    tracing::info!(
        object_key = %event.object_key,
        cadences = time.len(),
        rows = rows,
        cols = cols,
        operation = "fits_decode",
        status = "decoded",
        "TPF FITS decoded successfully"
    );

    Ok(RawTargetPixel {
        time,
        quality,
        flux,
        rows,
        cols,
        tic_id: event.tic_id.or(header_tic),
    })
}

/// Decode Full Frame Image (FFI) FITS file.
pub fn decode_ffi(path: &Path, event: &BronzeObjectReady) -> Result<RawFfi> {
    let mut fits = FitsFile::open(path)
        .with_context(|| format!("Failed to open FFI FITS file at {}", path.display()))?;

    // Image HDU (HDU 1 for FFI)
    let image_hdu = fits.hdu(1).context("Failed to open FFI Image HDU (1)")?;

    // Read image dimensions as i64
    let width = image_hdu
        .read_key::<i64>(&mut fits, "NAXIS1")
        .context("Missing NAXIS1 in FFI header")? as usize;
    let height = image_hdu
        .read_key::<i64>(&mut fits, "NAXIS2")
        .context("Missing NAXIS2 in FFI header")? as usize;

    // Read single primary pixel buffer
    let pixels: Vec<f32> = image_hdu
        .read_section(&mut fits, 0, width * height)
        .unwrap_or_default();

    tracing::info!(
        object_key = %event.object_key,
        width = width,
        height = height,
        operation = "fits_decode",
        status = "decoded",
        "FFI FITS decoded successfully"
    );

    Ok(RawFfi {
        width,
        height,
        pixels,
    })
}
