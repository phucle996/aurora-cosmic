package tests

import (
	"os"
	"path/filepath"
	"testing"

	"go-ingester/internal/model"
	"go-ingester/internal/pipeline/plan"
)

func TestPairedBothPresent(t *testing.T) {
	products := []model.Product{
		{ObsID: "obs1_tp", TICID: 100, Sector: 1, Kind: model.KindTargetPixel, Filename: "tess1_tp.fits", SizeBytes: 500},
		{ObsID: "obs1_lc", TICID: 100, Sector: 1, Kind: model.KindLightCurve, Filename: "tess1_lc.fits", SizeBytes: 200},
	}

	opts := model.SelectOptions{
		IncludeTPF:  true,
		IncludeLC:   true,
		RequirePair: true,
	}

	m, err := plan.Build(products, opts)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if len(m.Samples) != 1 {
		t.Fatalf("expected 1 sample, got %d", len(m.Samples))
	}

	s := m.Samples[0]
	if s.PairStatus != model.PairStatusPaired {
		t.Errorf("expected status PAIRED, got %s", s.PairStatus)
	}
	if s.TargetPixel == nil || s.LightCurve == nil {
		t.Errorf("expected both TPF and LC to be present")
	}

	if m.Statistics.PairedCount != 1 {
		t.Errorf("expected 1 paired count, got %d", m.Statistics.PairedCount)
	}
}

func TestTPFOnly(t *testing.T) {
	products := []model.Product{
		{ObsID: "obs1_tp", TICID: 100, Sector: 1, Kind: model.KindTargetPixel, Filename: "tess1_tp.fits", SizeBytes: 500},
	}

	opts := model.SelectOptions{
		IncludeTPF:  true,
		IncludeLC:   true,
		RequirePair: false,
	}

	m, err := plan.Build(products, opts)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if len(m.Samples) != 1 {
		t.Fatalf("expected 1 sample, got %d", len(m.Samples))
	}

	s := m.Samples[0]
	if s.PairStatus != model.PairStatusTPFOnly {
		t.Errorf("expected status TPF_ONLY, got %s", s.PairStatus)
	}
}

func TestLCOnly(t *testing.T) {
	products := []model.Product{
		{ObsID: "obs1_lc", TICID: 100, Sector: 1, Kind: model.KindLightCurve, Filename: "tess1_lc.fits", SizeBytes: 200},
	}

	opts := model.SelectOptions{
		IncludeTPF:  true,
		IncludeLC:   true,
		RequirePair: false,
	}

	m, err := plan.Build(products, opts)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if len(m.Samples) != 1 {
		t.Fatalf("expected 1 sample, got %d", len(m.Samples))
	}

	s := m.Samples[0]
	if s.PairStatus != model.PairStatusLCOnly {
		t.Errorf("expected status LC_ONLY, got %s", s.PairStatus)
	}
}

func TestRequirePairExcludesIncomplete(t *testing.T) {
	products := []model.Product{
		{ObsID: "obs1_tp", TICID: 100, Sector: 1, Kind: model.KindTargetPixel, Filename: "tess1_tp.fits", SizeBytes: 500},
		{ObsID: "obs2_lc", TICID: 200, Sector: 1, Kind: model.KindLightCurve, Filename: "tess2_lc.fits", SizeBytes: 200},
	}

	opts := model.SelectOptions{
		IncludeTPF:  true,
		IncludeLC:   true,
		RequirePair: true,
	}

	_, err := plan.Build(products, opts)
	if err == nil {
		t.Errorf("expected error when no paired samples exist and RequirePair=true, got nil")
	}
}

func TestDifferentSectorsNotPaired(t *testing.T) {
	products := []model.Product{
		{ObsID: "obs1_tp", TICID: 100, Sector: 1, Kind: model.KindTargetPixel, Filename: "tess1_tp.fits", SizeBytes: 500},
		{ObsID: "obs1_lc", TICID: 100, Sector: 2, Kind: model.KindLightCurve, Filename: "tess1_lc.fits", SizeBytes: 200},
	}

	opts := model.SelectOptions{
		IncludeTPF:  true,
		IncludeLC:   true,
		RequirePair: false,
	}

	m, err := plan.Build(products, opts)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if len(m.Samples) != 2 {
		t.Fatalf("expected 2 separate samples for different sectors, got %d", len(m.Samples))
	}
}

func TestByteBudgetAtomicPair(t *testing.T) {
	products := []model.Product{
		{ObsID: "obs1_tp", TICID: 100, Sector: 1, Kind: model.KindTargetPixel, Filename: "tess1_tp.fits", SizeBytes: 500},
		{ObsID: "obs1_lc", TICID: 100, Sector: 1, Kind: model.KindLightCurve, Filename: "tess1_lc.fits", SizeBytes: 500},
		{ObsID: "obs2_tp", TICID: 200, Sector: 1, Kind: model.KindTargetPixel, Filename: "tess2_tp.fits", SizeBytes: 500},
		{ObsID: "obs2_lc", TICID: 200, Sector: 1, Kind: model.KindLightCurve, Filename: "tess2_lc.fits", SizeBytes: 500},
	}

	opts := model.SelectOptions{
		IncludeTPF:    true,
		IncludeLC:     true,
		RequirePair:   true,
		MaxTotalBytes: 1200, // Budget allows 1 pair (1000 bytes), but NOT 2 pairs (2000 bytes)
	}

	m, err := plan.Build(products, opts)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if len(m.Samples) != 1 {
		t.Errorf("expected 1 sample within byte budget, got %d", len(m.Samples))
	}
	if m.Statistics.TotalBytes != 1000 {
		t.Errorf("expected total bytes 1000, got %d", m.Statistics.TotalBytes)
	}
}

func TestStatisticsCorrect(t *testing.T) {
	products := []model.Product{
		{ObsID: "obs1_tp", TICID: 100, Sector: 1, Kind: model.KindTargetPixel, Filename: "tess1_tp.fits", SizeBytes: 500},
		{ObsID: "obs1_lc", TICID: 100, Sector: 1, Kind: model.KindLightCurve, Filename: "tess1_lc.fits", SizeBytes: 200},
		{ObsID: "ffi1", Sector: 1, Kind: model.KindFFI, Filename: "ffi1.fits", SizeBytes: 1000},
	}

	opts := model.SelectOptions{
		IncludeTPF: true,
		IncludeLC:  true,
		IncludeFFI: true,
	}

	m, err := plan.Build(products, opts)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	s := m.Statistics
	if s.PairedCount != 1 {
		t.Errorf("expected 1 paired count, got %d", s.PairedCount)
	}
	if s.FFICount != 1 {
		t.Errorf("expected 1 FFI count, got %d", s.FFICount)
	}
	if s.TotalBytes != 1700 {
		t.Errorf("expected total bytes 1700, got %d", s.TotalBytes)
	}

	tmpDir := t.TempDir()
	outPath := filepath.Join(tmpDir, "manifest.json")

	if err := plan.Write(m, outPath); err != nil {
		t.Fatalf("manifest write failed: %v", err)
	}

	loaded, err := plan.Read(outPath)
	if err != nil {
		t.Fatalf("manifest read failed: %v", err)
	}

	if loaded.SchemaVersion != model.SchemaVersion {
		t.Errorf("expected SchemaVersion %d, got %d", model.SchemaVersion, loaded.SchemaVersion)
	}
	if len(loaded.Samples) != 1 {
		t.Errorf("expected 1 sample loaded, got %d", len(loaded.Samples))
	}

	_ = os.Remove(outPath)
}
