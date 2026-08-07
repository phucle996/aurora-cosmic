package storage_test

import (
	"testing"

	"go-ingester/internal/manifest"
	"go-ingester/internal/mast"
	"go-ingester/internal/storage"
)

func TestBuildObjectKeyTargetPixel(t *testing.T) {
	p := manifest.ManifestProduct{
		Kind:     mast.KindTargetPixel,
		Filename: "tess2021001_tp.fits",
		Sector:   42,
		TICID:    123456789,
	}
	key, err := storage.BuildObjectKey(p)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	want := "bronze/tess/target-pixel/sector=0042/tic=123456789/tess2021001_tp.fits"
	if key != want {
		t.Errorf("BuildObjectKey() = %q, want %q", key, want)
	}
}

func TestBuildObjectKeyLightCurve(t *testing.T) {
	p := manifest.ManifestProduct{
		Kind:     mast.KindLightCurve,
		Filename: "tess2021001_lc.fits",
		Sector:   7,
		TICID:    987654321,
	}
	key, err := storage.BuildObjectKey(p)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	want := "bronze/tess/lightcurve/sector=0007/tic=987654321/tess2021001_lc.fits"
	if key != want {
		t.Errorf("BuildObjectKey() = %q, want %q", key, want)
	}
}

func TestBuildObjectKeyFFI(t *testing.T) {
	p := manifest.ManifestProduct{
		Kind:     mast.KindFFI,
		Filename: "tess2021001_ffic.fits",
		Sector:   42,
		Camera:   1,
		CCD:      3,
	}
	key, err := storage.BuildObjectKey(p)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	want := "bronze/tess/ffi/sector=0042/camera=1/ccd=3/tess2021001_ffic.fits"
	if key != want {
		t.Errorf("BuildObjectKey() = %q, want %q", key, want)
	}
}

func TestBuildObjectKeyValidationErrors(t *testing.T) {
	cases := []struct {
		name string
		prod manifest.ManifestProduct
	}{
		{
			name: "missing filename",
			prod: manifest.ManifestProduct{Kind: mast.KindTargetPixel, Sector: 1, TICID: 1},
		},
		{
			name: "invalid sector",
			prod: manifest.ManifestProduct{Kind: mast.KindTargetPixel, Filename: "a.fits", Sector: 0, TICID: 1},
		},
		{
			name: "missing tic for target pixel",
			prod: manifest.ManifestProduct{Kind: mast.KindTargetPixel, Filename: "a.fits", Sector: 1, TICID: 0},
		},
		{
			name: "missing tic for light curve",
			prod: manifest.ManifestProduct{Kind: mast.KindLightCurve, Filename: "a.fits", Sector: 1, TICID: 0},
		},
		{
			name: "unsupported product kind",
			prod: manifest.ManifestProduct{Kind: mast.KindUnknown, Filename: "a.fits", Sector: 1},
		},
	}

	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			_, err := storage.BuildObjectKey(c.prod)
			if err == nil {
				t.Errorf("expected error for case %q, got nil", c.name)
			}
		})
	}
}
