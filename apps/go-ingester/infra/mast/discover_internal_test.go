package mast

import (
	"testing"

	"go-ingester/internal/model"
)

func TestDeriveTargetProductPairSupportsCadenceFilenameContracts(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name  string
		lcURI string
		tpURI string
		input string
	}{
		{
			name:  "standard cadence",
			lcURI: "mast:TESS/product/tess-s0042-s_lc.fits",
			tpURI: "mast:TESS/product/tess-s0042-s_tp.fits",
			input: "mast:TESS/product/tess-s0042-s_lc.fits",
		},
		{
			name:  "fast cadence",
			lcURI: "mast:TESS/product/tess-s0042-a_fast-lc.fits",
			tpURI: "mast:TESS/product/tess-s0042-a_fast-tp.fits",
			input: "mast:TESS/product/tess-s0042-a_fast-lc.fits",
		},
		{
			name:  "target-pixel parent",
			lcURI: "mast:TESS/product/tess-s0002-s_lc.fits",
			tpURI: "mast:TESS/product/tess-s0002-s_tp.fits",
			input: "mast:TESS/product/tess-s0002-s_tp.fits",
		},
	}
	for _, test := range tests {
		test := test
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()
			pair, ok := deriveTargetProductPair(Observation{DataURL: test.input})
			if !ok || len(pair) != 2 {
				t.Fatalf("expected LC/TP pair, got ok=%v len=%d", ok, len(pair))
			}
			if pair[0].DataURI != test.tpURI || classifyFilenameProduct(pair[0].ProductFilename) != model.KindTargetPixel {
				t.Fatalf("unexpected target-pixel product: %+v", pair[0])
			}
			if pair[1].DataURI != test.lcURI || classifyFilenameProduct(pair[1].ProductFilename) != model.KindLightCurve {
				t.Fatalf("unexpected light-curve product: %+v", pair[1])
			}
		})
	}
}

func TestMultiSectorValidationRowsAreNotExpanded(t *testing.T) {
	t.Parallel()
	parent := Observation{
		ObsID:   "tess2018206190142-s0001-s0002-0000000370228465",
		DataURL: "mast:TESS/product/tess2018206190142-s0001-s0002-000000037022...",
	}
	if shouldExpandTargetProducts(parent) {
		t.Fatal("multi-sector validation row must not trigger Mast.Caom.Products")
	}
}
