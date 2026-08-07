package tests

import (
	"testing"

	"go-ingester/internal/model"
)

func TestBuildObjectKeyTargetPixel(t *testing.T) {
	prod := model.ManifestProduct{
		Kind:     model.KindTargetPixel,
		Filename: "tess2018206045859-s0001-0000000000000000-0120-s_tp.fits",
		Sector:   42,
		TICID:    123456789,
	}

	key, err := model.BuildObjectKey(prod)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	expected := "bronze/tess/target-pixel/sector=0042/tic=123456789/tess2018206045859-s0001-0000000000000000-0120-s_tp.fits"
	if key != expected {
		t.Errorf("key mismatch:\n got:  %s\n want: %s", key, expected)
	}
}

func TestBuildObjectKeyLightCurve(t *testing.T) {
	prod := model.ManifestProduct{
		Kind:     model.KindLightCurve,
		Filename: "tess2018206045859-s0001-0000000000000000-0120-s_lc.fits",
		Sector:   42,
		TICID:    123456789,
	}

	key, err := model.BuildObjectKey(prod)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	expected := "bronze/tess/lightcurve/sector=0042/tic=123456789/tess2018206045859-s0001-0000000000000000-0120-s_lc.fits"
	if key != expected {
		t.Errorf("key mismatch:\n got:  %s\n want: %s", key, expected)
	}
}

func TestBuildObjectKeyFFI(t *testing.T) {
	prod := model.ManifestProduct{
		Kind:     model.KindFFI,
		Filename: "tess2018206045859-s0001-1-3-0120-s_ffic.fits",
		Sector:   42,
		Camera:   1,
		CCD:      3,
	}

	key, err := model.BuildObjectKey(prod)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	expected := "bronze/tess/ffi/sector=0042/camera=1/ccd=3/tess2018206045859-s0001-1-3-0120-s_ffic.fits"
	if key != expected {
		t.Errorf("key mismatch:\n got:  %s\n want: %s", key, expected)
	}
}

func TestBuildObjectKeyValidationErrors(t *testing.T) {
	t.Run("missing filename", func(t *testing.T) {
		prod := model.ManifestProduct{Kind: model.KindTargetPixel, Sector: 1, TICID: 100}
		_, err := model.BuildObjectKey(prod)
		if err == nil {
			t.Errorf("expected error for missing filename, got nil")
		}
	})

	t.Run("invalid sector", func(t *testing.T) {
		prod := model.ManifestProduct{Kind: model.KindTargetPixel, Filename: "f.fits", Sector: -1, TICID: 100}
		_, err := model.BuildObjectKey(prod)
		if err == nil {
			t.Errorf("expected error for invalid sector, got nil")
		}
	})

	t.Run("missing tic for target pixel", func(t *testing.T) {
		prod := model.ManifestProduct{Kind: model.KindTargetPixel, Filename: "f.fits", Sector: 1, TICID: 0}
		_, err := model.BuildObjectKey(prod)
		if err == nil {
			t.Errorf("expected error for missing TIC, got nil")
		}
	})

	t.Run("missing tic for light curve", func(t *testing.T) {
		prod := model.ManifestProduct{Kind: model.KindLightCurve, Filename: "f.fits", Sector: 1, TICID: 0}
		_, err := model.BuildObjectKey(prod)
		if err == nil {
			t.Errorf("expected error for missing TIC, got nil")
		}
	})

	t.Run("unsupported product kind", func(t *testing.T) {
		prod := model.ManifestProduct{Kind: model.KindUnknown, Filename: "f.fits", Sector: 1}
		_, err := model.BuildObjectKey(prod)
		if err == nil {
			t.Errorf("expected error for unknown kind, got nil")
		}
	})
}
