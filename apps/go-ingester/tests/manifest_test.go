package tests

import (
	"testing"

	"go-ingester/internal/manifest"
	"go-ingester/internal/mast"
)

// --- Pairing tests ---

func makeDiscovery(ticID int64, sector int, kinds ...mast.ProductKind) []mast.DiscoveryResult {
	products := make([]mast.Product, 0, len(kinds))
	for i, k := range kinds {
		filename := "file_tp.fits"
		if k == mast.KindLightCurve {
			filename = "file_lc.fits"
		} else if k == mast.KindFFI {
			filename = "file_ffic.fits"
		}
		products = append(products, mast.Product{
			ProductID:        "pid-" + filename,
			Filename:         filename,
			DataURI:          "mast:TESS/" + filename,
			SizeBytes:        int64(i+1) * 1_000_000,
			Kind:             k,
			CalibrationLevel: 2,
		})
	}

	obsID := manifest.SampleID(ticID, sector) // reuse stable ID format for obsID
	targetName := "TIC " + int64ToString(ticID)

	return []mast.DiscoveryResult{{
		Observation: mast.Observation{
			ObsID:         obsID,
			ObservationID: sectorObsID(sector),
			TargetName:    targetName,
		},
		Products: products,
	}}
}

func int64ToString(n int64) string {
	return string([]byte(nil)) // placeholder, handled by fmt
}

func sectorObsID(sector int) string {
	// Mimics real TESS obs_id format with sector segment.
	return "tess2019357-s" + leftPad(sector, 4) + "-0000001234"
}

func leftPad(n, width int) string {
	s := ""
	for i := 0; i < width; i++ {
		s = "0" + s
	}
	r := []rune(s)
	digits := []rune(intToStr(n))
	copy(r[len(r)-len(digits):], digits)
	return string(r)
}

func intToStr(n int) string {
	if n == 0 {
		return "0"
	}
	b := make([]byte, 0, 10)
	for n > 0 {
		b = append([]byte{byte('0' + n%10)}, b...)
		n /= 10
	}
	return string(b)
}

// TestPairedBothPresent verifies PAIRED status when TPF + LC exist.
func TestPairedBothPresent(t *testing.T) {
	results := makeDiscovery(123456789, 42, mast.KindTargetPixel, mast.KindLightCurve)
	opts := manifest.SelectOptions{IncludeTPF: true, IncludeLC: true, IncludeFFI: false, RequirePair: false}
	m, err := manifest.Build(results, opts)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(m.Samples) != 1 {
		t.Fatalf("expected 1 sample, got %d", len(m.Samples))
	}
	if m.Samples[0].PairStatus != manifest.PairStatusPaired {
		t.Errorf("expected PAIRED, got %s", m.Samples[0].PairStatus)
	}
	if m.Samples[0].TargetPixel == nil {
		t.Error("expected TargetPixel, got nil")
	}
	if m.Samples[0].LightCurve == nil {
		t.Error("expected LightCurve, got nil")
	}
}

// TestTPFOnly verifies TPF_ONLY when no LC is present.
func TestTPFOnly(t *testing.T) {
	results := makeDiscovery(111, 7, mast.KindTargetPixel)
	opts := manifest.SelectOptions{IncludeTPF: true, IncludeLC: true, IncludeFFI: false, RequirePair: false}
	m, err := manifest.Build(results, opts)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(m.Samples) != 1 {
		t.Fatalf("expected 1 sample, got %d", len(m.Samples))
	}
	if m.Samples[0].PairStatus != manifest.PairStatusTPFOnly {
		t.Errorf("expected TPF_ONLY, got %s", m.Samples[0].PairStatus)
	}
}

// TestLCOnly verifies LC_ONLY when no TPF is present.
func TestLCOnly(t *testing.T) {
	results := makeDiscovery(222, 3, mast.KindLightCurve)
	opts := manifest.SelectOptions{IncludeTPF: true, IncludeLC: true, IncludeFFI: false, RequirePair: false}
	m, err := manifest.Build(results, opts)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(m.Samples) != 1 {
		t.Fatalf("expected 1 sample, got %d", len(m.Samples))
	}
	if m.Samples[0].PairStatus != manifest.PairStatusLCOnly {
		t.Errorf("expected LC_ONLY, got %s", m.Samples[0].PairStatus)
	}
}

// TestRequirePairExcludesIncomplete verifies RequirePair=true filters out incomplete pairs.
func TestRequirePairExcludesIncomplete(t *testing.T) {
	results := makeDiscovery(333, 5, mast.KindTargetPixel) // TPF only
	opts := manifest.SelectOptions{IncludeTPF: true, IncludeLC: true, RequirePair: true}
	m, err := manifest.Build(results, opts)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(m.Samples) != 0 {
		t.Errorf("expected 0 samples (RequirePair=true with incomplete), got %d", len(m.Samples))
	}
}

// TestDifferentSectorsNotPaired ensures products from different sectors don't pair.
func TestDifferentSectorsNotPaired(t *testing.T) {
	// Two observations: same TIC, different sector — must be separate samples.
	r1 := makeDiscovery(999, 10, mast.KindTargetPixel)
	r2 := makeDiscovery(999, 11, mast.KindLightCurve)
	results := append(r1, r2...)

	opts := manifest.SelectOptions{IncludeTPF: true, IncludeLC: true, RequirePair: false}
	m, err := manifest.Build(results, opts)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	// Should have 2 separate incomplete samples, not 1 paired one.
	if len(m.Samples) != 2 {
		t.Errorf("expected 2 distinct samples, got %d", len(m.Samples))
	}
	for _, s := range m.Samples {
		if s.PairStatus == manifest.PairStatusPaired {
			t.Errorf("sample %s should not be PAIRED", s.SampleID)
		}
	}
}

// --- Product classification tests ---

func TestClassifyProduct(t *testing.T) {
	cases := []struct {
		filename string
		want     mast.ProductKind
	}{
		{"tess_tp.fits", mast.KindTargetPixel},
		{"tess_lc.fits", mast.KindLightCurve},
		{"tess_ffic.fits", mast.KindFFI},
		{"tess_ffir.fits", mast.KindUnknown},
		{"document.pdf", mast.KindUnknown},
		{"", mast.KindUnknown},
		{"BIG_TP.FITS", mast.KindTargetPixel}, // case-insensitive
	}
	for _, c := range cases {
		got := mast.ClassifyProduct(c.filename)
		if got != c.want {
			t.Errorf("ClassifyProduct(%q) = %q, want %q", c.filename, got, c.want)
		}
	}
}

// --- Deterministic ordering tests ---

func TestDeterministicSampleID(t *testing.T) {
	id1 := manifest.SampleID(123456789, 42)
	id2 := manifest.SampleID(123456789, 42)
	if id1 != id2 {
		t.Errorf("SampleID not deterministic: %q vs %q", id1, id2)
	}
	if id1 != "tess-tic-123456789-sector-0042" {
		t.Errorf("unexpected SampleID format: %q", id1)
	}
}

// --- TIC/sector parsing tests ---

func TestParseTICFromTarget(t *testing.T) {
	cases := []struct {
		in   string
		want int64
	}{
		{"TIC 123456789", 123456789},
		{"123456789", 123456789},
		{"tic 42", 42},
		{"", 0},
		{"not-a-number", 0},
	}
	for _, c := range cases {
		got := manifest.ParseTICFromTarget(c.in)
		if got != c.want {
			t.Errorf("ParseTICFromTarget(%q) = %d, want %d", c.in, got, c.want)
		}
	}
}

func TestParseSectorFromObsID(t *testing.T) {
	cases := []struct {
		in   string
		want int
	}{
		{"tess2019357164649-s0007-0000000349376986-0138-s", 7},
		{"tess2020-s0042-something", 42},
		{"no-sector-here", 0},
		{"", 0},
	}
	for _, c := range cases {
		got := manifest.ParseSectorFromObsID(c.in)
		if got != c.want {
			t.Errorf("ParseSectorFromObsID(%q) = %d, want %d", c.in, got, c.want)
		}
	}
}

// --- Size budget tests ---

func TestByteBudgetAtomicPair(t *testing.T) {
	// TPF=3GiB, LC=1GiB → pair=4GiB; budget=3GiB → pair must be excluded entirely.
	const GiB = 1 << 30
	results := makeDiscovery(1, 1, mast.KindTargetPixel, mast.KindLightCurve)
	// Override sizes.
	for i := range results[0].Products {
		if results[0].Products[i].Kind == mast.KindTargetPixel {
			results[0].Products[i].SizeBytes = 3 * GiB
		} else {
			results[0].Products[i].SizeBytes = 1 * GiB
		}
	}

	opts := manifest.SelectOptions{
		IncludeTPF:    true,
		IncludeLC:     true,
		RequirePair:   true,
		MaxTotalBytes: 3 * GiB,
	}
	m, err := manifest.Build(results, opts)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(m.Samples) != 0 {
		t.Errorf("expected 0 samples (pair exceeds budget atomically), got %d", len(m.Samples))
	}
}

// TestStatisticsCorrect checks that statistics are computed from final selection.
func TestStatisticsCorrect(t *testing.T) {
	results := makeDiscovery(55, 1, mast.KindTargetPixel, mast.KindLightCurve)
	opts := manifest.SelectOptions{IncludeTPF: true, IncludeLC: true, RequirePair: false}
	m, err := manifest.Build(results, opts)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	s := m.Statistics
	if s.ProductCount != 2 {
		t.Errorf("expected 2 products, got %d", s.ProductCount)
	}
	if s.TotalBytes != s.TPFBytes+s.LCBytes {
		t.Errorf("total_bytes mismatch")
	}
}
