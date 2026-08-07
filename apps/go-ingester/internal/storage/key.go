package storage

import (
	"fmt"
	"path"

	"go-ingester/internal/manifest"
	"go-ingester/internal/mast"
)

// BuildObjectKey generates a deterministic Bronze MinIO object key for a ManifestProduct.
//
// Layout rules:
// Target Pixel:  bronze/tess/target-pixel/sector=0042/tic=123456789/filename.fits
// Light Curve:   bronze/tess/lightcurve/sector=0042/tic=123456789/filename.fits
// FFI:           bronze/tess/ffi/sector=0042/camera=1/ccd=3/filename.fits
func BuildObjectKey(p manifest.ManifestProduct) (string, error) {
	if p.Filename == "" {
		return "", fmt.Errorf("storage: filename cannot be empty")
	}
	if p.Sector <= 0 {
		return "", fmt.Errorf("storage: invalid sector %d for product %s", p.Sector, p.Filename)
	}

	sectorStr := fmt.Sprintf("sector=%04d", p.Sector)

	switch p.Kind {
	case mast.KindTargetPixel:
		if p.TICID <= 0 {
			return "", fmt.Errorf("storage: missing tic_id for target pixel product %s", p.Filename)
		}
		ticStr := fmt.Sprintf("tic=%d", p.TICID)
		return path.Join("bronze", "tess", "target-pixel", sectorStr, ticStr, p.Filename), nil

	case mast.KindLightCurve:
		if p.TICID <= 0 {
			return "", fmt.Errorf("storage: missing tic_id for light curve product %s", p.Filename)
		}
		ticStr := fmt.Sprintf("tic=%d", p.TICID)
		return path.Join("bronze", "tess", "lightcurve", sectorStr, ticStr, p.Filename), nil

	case mast.KindFFI:
		cameraStr := fmt.Sprintf("camera=%d", p.Camera)
		ccdStr := fmt.Sprintf("ccd=%d", p.CCD)
		return path.Join("bronze", "tess", "ffi", sectorStr, cameraStr, ccdStr, p.Filename), nil

	default:
		return "", fmt.Errorf("storage: unsupported product kind %q for product %s", p.Kind, p.Filename)
	}
}
