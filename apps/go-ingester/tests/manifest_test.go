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

	m, err := plan.Build(products, plan.SelectOptions{})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if len(m.Samples) != 1 {
		t.Fatalf("expected 1 sample, got %d", len(m.Samples))
	}

	s := m.Samples[0]
	if s.TargetPixel == nil || s.LightCurve == nil {
		t.Errorf("expected both TPF and LC to be present")
	}

	if m.Statistics.PairedCount != 1 {
		t.Errorf("expected 1 paired count, got %d", m.Statistics.PairedCount)
	}
}

func TestManifestRejectsIncompleteResearchEvidence(t *testing.T) {
	for name, products := range map[string][]model.Product{
		"missing-lightcurve": {
			{ObsID: "tp", TICID: 100, Sector: 1, Kind: model.KindTargetPixel},
		},
		"missing-target-pixel": {
			{ObsID: "lc", TICID: 100, Sector: 1, Kind: model.KindLightCurve},
		},
	} {
		t.Run(name, func(t *testing.T) {
			if _, err := plan.Build(products, plan.SelectOptions{}); err == nil {
				t.Fatal("expected incomplete research evidence to be rejected")
			}
		})
	}
}

func TestByteBudgetAtomicPair(t *testing.T) {
	products := []model.Product{
		{ObsID: "obs1_tp", TICID: 100, Sector: 1, Kind: model.KindTargetPixel, Filename: "tess1_tp.fits", SizeBytes: 500},
		{ObsID: "obs1_lc", TICID: 100, Sector: 1, Kind: model.KindLightCurve, Filename: "tess1_lc.fits", SizeBytes: 500},
		{ObsID: "obs2_tp", TICID: 200, Sector: 1, Kind: model.KindTargetPixel, Filename: "tess2_tp.fits", SizeBytes: 500},
		{ObsID: "obs2_lc", TICID: 200, Sector: 1, Kind: model.KindLightCurve, Filename: "tess2_lc.fits", SizeBytes: 500},
	}

	opts := plan.SelectOptions{
		MaxTotalBytes: 1200, // One complete pair fits; two pairs exceed the budget.
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

func TestTOITargetsAreSelectedBeforeLexicalBacklog(t *testing.T) {
	products := []model.Product{
		{ObsID: "a_tp", TICID: 100, Sector: 1, Kind: model.KindTargetPixel},
		{ObsID: "a_lc", TICID: 100, Sector: 1, Kind: model.KindLightCurve},
		{ObsID: "z_tp", TICID: 900, Sector: 1, Kind: model.KindTargetPixel},
		{ObsID: "z_lc", TICID: 900, Sector: 1, Kind: model.KindLightCurve},
	}
	manifest, err := plan.Build(products, plan.SelectOptions{MaxSamples: 1, PreferredTICIDs: map[int64]struct{}{900: {}}})
	if err != nil {
		t.Fatal(err)
	}
	if manifest.Samples[0].TICID != 900 {
		t.Fatalf("selected TIC %d, want catalog-prioritized TIC 900", manifest.Samples[0].TICID)
	}
}

func TestStatisticsCorrect(t *testing.T) {
	products := []model.Product{
		{ObsID: "obs1_tp", TICID: 100, Sector: 1, Kind: model.KindTargetPixel, Filename: "tess1_tp.fits", SizeBytes: 500},
		{ObsID: "obs1_lc", TICID: 100, Sector: 1, Kind: model.KindLightCurve, Filename: "tess1_lc.fits", SizeBytes: 200},
	}

	m, err := plan.Build(products, plan.SelectOptions{})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	s := m.Statistics
	if s.PairedCount != 1 {
		t.Errorf("expected 1 paired count, got %d", s.PairedCount)
	}
	if s.TotalBytes != 700 {
		t.Errorf("expected total bytes 700, got %d", s.TotalBytes)
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

	if loaded.SchemaVersion != plan.SchemaVersion {
		t.Errorf("expected SchemaVersion %d, got %d", plan.SchemaVersion, loaded.SchemaVersion)
	}
	if len(loaded.Samples) != 1 {
		t.Errorf("expected 1 sample loaded, got %d", len(loaded.Samples))
	}

	_ = os.Remove(outPath)
}

func TestManifestProductsFlattensDeterministically(t *testing.T) {
	m := &model.Manifest{
		Samples: []model.Sample{{
			TargetPixel: &model.ManifestProduct{SourceProductID: "tp"},
			LightCurve:  &model.ManifestProduct{SourceProductID: "lc"},
		}},
	}

	products := plan.Products(m)
	if len(products) != 2 {
		t.Fatalf("expected 2 products, got %d", len(products))
	}
	for i, want := range []string{"tp", "lc"} {
		if products[i].SourceProductID != want {
			t.Errorf("product[%d] = %q, want %q", i, products[i].SourceProductID, want)
		}
	}

	products[0].SourceProductID = "mutated-copy"
	if m.Samples[0].TargetPixel.SourceProductID != "tp" {
		t.Fatal("Products should return value copies, not mutate the manifest")
	}
}

func TestManifestProductsKeepsEachTargetPairAdjacent(t *testing.T) {
	m := &model.Manifest{
		Samples: []model.Sample{
			{TargetPixel: &model.ManifestProduct{SourceProductID: "tp-1"}, LightCurve: &model.ManifestProduct{SourceProductID: "lc-1"}},
			{TargetPixel: &model.ManifestProduct{SourceProductID: "tp-2"}, LightCurve: &model.ManifestProduct{SourceProductID: "lc-2"}},
			{TargetPixel: &model.ManifestProduct{SourceProductID: "tp-3"}, LightCurve: &model.ManifestProduct{SourceProductID: "lc-3"}},
		},
	}

	products := plan.Products(m)
	for index, want := range []string{"tp-1", "lc-1", "tp-2", "lc-2", "tp-3", "lc-3"} {
		if products[index].SourceProductID != want {
			t.Errorf("product[%d] = %q, want %q", index, products[index].SourceProductID, want)
		}
	}
}
