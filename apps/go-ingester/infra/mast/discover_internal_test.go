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
	}{
		{
			name:  "standard cadence",
			lcURI: "mast:TESS/product/tess-s0042-s_lc.fits",
			tpURI: "mast:TESS/product/tess-s0042-s_tp.fits",
		},
		{
			name:  "fast cadence",
			lcURI: "mast:TESS/product/tess-s0042-a_fast-lc.fits",
			tpURI: "mast:TESS/product/tess-s0042-a_fast-tp.fits",
		},
	}
	for _, test := range tests {
		test := test
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()
			pair, ok := deriveTargetProductPair(Observation{DataURL: test.lcURI})
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
