use std::path::Path;

use anyhow::{bail, Context, Result};
use fitsio::hdu::HduInfo;
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

/// A bounded-memory reader for a Target Pixel File table.
///
/// FITS stores every cadence of the `FLUX` cube as a row in HDU 1.  Reading
/// the columns with `read_col` materializes the complete cube, which is not
/// viable for multi-GB TPF products.  This reader only materializes a caller
/// selected cadence range at a time.
pub struct TargetPixelChunkReader {
    fits: FitsFile,
    table_hdu_index: usize,
    next_cadence: usize,
    total_cadences: usize,
    rows: usize,
    cols: usize,
    tic_id: Option<u64>,
}

impl TargetPixelChunkReader {
    pub fn open(path: &Path, event: &BronzeObjectReady) -> Result<Self> {
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
        let total_cadences = match &table_hdu.info {
            HduInfo::TableInfo { num_rows, .. } => *num_rows,
            _ => bail!(
                "TPF HDU 1 is not a binary table for object {}",
                event.object_key
            ),
        };
        if total_cadences == 0 {
            bail!(
                "Decoded TPF table has zero cadences for object {}",
                event.object_key
            );
        }

        // One row is enough to discover the shape of the repeated FLUX column.
        let flux_sample: Vec<f32> = table_hdu
            .read_col_range(&mut fits, "FLUX", &(0..1))
            .context("Missing required column 'FLUX' in TPF table")?;
        if flux_sample.is_empty() {
            bail!(
                "TPF FLUX column has no pixels for object {}",
                event.object_key
            );
        }

        let pixels_per_cadence = flux_sample.len();
        let side = (pixels_per_cadence as f64).sqrt() as usize;
        let (rows, cols) = if side * side == pixels_per_cadence && side > 0 {
            (side, side)
        } else {
            (pixels_per_cadence, 1)
        };

        Ok(Self {
            fits,
            table_hdu_index: table_hdu.number,
            next_cadence: 0,
            total_cadences,
            rows,
            cols,
            tic_id: event.tic_id.or(header_tic),
        })
    }

    pub fn total_cadences(&self) -> usize {
        self.total_cadences
    }

    /// Reads at most `chunk_cadences` rows. `None` means EOF.
    pub fn next_chunk(&mut self, chunk_cadences: usize) -> Result<Option<RawTargetPixel>> {
        if chunk_cadences == 0 {
            bail!("TPF chunk cadence count must be >= 1");
        }
        if self.next_cadence >= self.total_cadences {
            return Ok(None);
        }

        let start = self.next_cadence;
        let end = (start + chunk_cadences).min(self.total_cadences);
        let range = start..end;
        let table_hdu = self
            .fits
            .hdu(self.table_hdu_index)
            .context("Failed to re-open TPF table HDU")?;

        let time: Vec<f64> = table_hdu
            .read_col_range(&mut self.fits, "TIME", &range)
            .context("Missing required column 'TIME' in TPF table")?;
        let quality: Vec<i32> = table_hdu
            .read_col_range(&mut self.fits, "QUALITY", &range)
            .context("Missing required column 'QUALITY' in TPF table")?;
        let flux_data: Vec<f32> = table_hdu
            .read_col_range(&mut self.fits, "FLUX", &range)
            .context("Missing required column 'FLUX' in TPF table")?;

        let cadence_count = end - start;
        let pixels_per_cadence = self.rows * self.cols;
        if time.len() != cadence_count || quality.len() != cadence_count {
            bail!(
                "TPF table row count mismatch for range {start}..{end}: TIME={}, QUALITY={}",
                time.len(),
                quality.len()
            );
        }
        if flux_data.len() != cadence_count * pixels_per_cadence {
            bail!(
                "TPF FLUX shape mismatch for range {start}..{end}: expected {} values, found {}",
                cadence_count * pixels_per_cadence,
                flux_data.len()
            );
        }

        let mut flux = Vec::with_capacity(cadence_count);
        for cadence in 0..cadence_count {
            let offset = cadence * pixels_per_cadence;
            let mut frame = Vec::with_capacity(self.rows);
            for row in 0..self.rows {
                let row_offset = offset + row * self.cols;
                frame.push(flux_data[row_offset..row_offset + self.cols].to_vec());
            }
            flux.push(frame);
        }

        self.next_cadence = end;
        Ok(Some(RawTargetPixel {
            time,
            quality,
            flux,
            rows: self.rows,
            cols: self.cols,
            tic_id: self.tic_id,
        }))
    }
}

/// Raw Full Frame Image (FFI) data structure.
#[derive(Debug, Clone)]
pub struct RawFfi {
    pub width: usize,
    pub height: usize,
    pub pixels: Vec<f32>,
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
        .context("Failed to read FFI pixel section")?;

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
