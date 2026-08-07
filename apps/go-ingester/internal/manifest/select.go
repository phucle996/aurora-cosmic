package manifest

import (
	"fmt"
	"sort"
	"strings"
	"time"

	"go-ingester/internal/mast"
)

// SelectOptions controls the selection / pairing policy.
type SelectOptions struct {
	IncludeTPF       bool
	IncludeLC        bool
	IncludeFFI       bool
	RequirePair      bool  // when true, only PAIRED samples are eligible
	MaxSamples       int   // 0 = unlimited
	MaxFFI           int   // 0 = unlimited
	MaxTotalBytes    int64 // 0 = unlimited
}

// DefaultSelectOptions returns the recommended production defaults.
func DefaultSelectOptions() SelectOptions {
	return SelectOptions{
		IncludeTPF:  true,
		IncludeLC:   true,
		IncludeFFI:  true,
		RequirePair: true,
	}
}

// rawEntry is an intermediate product with its resolved identity fields.
type rawEntry struct {
	obsID   string
	ticID   int64
	sector  int
	product mast.Product
}

// Build converts raw MAST discovery results into a fully-validated Manifest.
func Build(results []mast.DiscoveryResult, opts SelectOptions) (*Manifest, error) {
	// 1. Collect and classify all products.

	var tpfLC []rawEntry
	var ffis  []rawEntry

	for _, r := range results {
		ticID := ParseTICFromTarget(r.Observation.TargetName)
		sector := ParseSectorFromObsID(r.Observation.ObservationID)

		for _, p := range r.Products {
			e := rawEntry{obsID: r.Observation.ObsID, ticID: ticID, sector: sector, product: p}
			switch p.Kind {
			case mast.KindTargetPixel, mast.KindLightCurve:
				tpfLC = append(tpfLC, e)
			case mast.KindFFI:
				ffis = append(ffis, e)
			}
		}
	}

	// 2. Sort deterministically before any limit/selection.
	sort.Slice(tpfLC, func(i, j int) bool {
		a, b := tpfLC[i], tpfLC[j]
		if a.sector != b.sector {
			return a.sector < b.sector
		}
		if a.ticID != b.ticID {
			return a.ticID < b.ticID
		}
		if a.product.Kind != b.product.Kind {
			return a.product.Kind < b.product.Kind
		}
		return a.product.Filename < b.product.Filename
	})
	sort.Slice(ffis, func(i, j int) bool {
		a, b := ffis[i], ffis[j]
		if a.sector != b.sector {
			return a.sector < b.sector
		}
		if a.product.Filename != b.product.Filename {
			return a.product.Filename < b.product.Filename
		}
		return a.product.DataURI < b.product.DataURI
	})

	// 3. Group TPF/LC by SampleKey and select preferred product per slot.
	type bucket struct {
		tpfCandidates []rawEntry
		lcCandidates  []rawEntry
	}
	grouped := make(map[SampleKey]*bucket)
	keyOrder := make([]SampleKey, 0)

	for _, e := range tpfLC {
		k := SampleKey{TICID: e.ticID, Sector: e.sector}
		b, ok := grouped[k]
		if !ok {
			b = &bucket{}
			grouped[k] = b
			keyOrder = append(keyOrder, k)
		}
		switch e.product.Kind {
		case mast.KindTargetPixel:
			b.tpfCandidates = append(b.tpfCandidates, e)
		case mast.KindLightCurve:
			b.lcCandidates = append(b.lcCandidates, e)
		}
	}

	// 4. Build samples, applying pair policy and byte budget.
	var samples []Sample
	var totalBytes int64

	for _, k := range keyOrder {
		if opts.MaxSamples > 0 && len(samples) >= opts.MaxSamples {
			break
		}

		b := grouped[k]
		var tpf, lc *ManifestProduct

		if opts.IncludeTPF && len(b.tpfCandidates) > 0 {
			selected := selectPreferred(b.tpfCandidates)
			mp := toManifestProduct(selected, k)
			tpf = &mp
		}
		if opts.IncludeLC && len(b.lcCandidates) > 0 {
			selected := selectPreferred(b.lcCandidates)
			mp := toManifestProduct(selected, k)
			lc = &mp
		}

		status := pairStatus(tpf, lc)
		if opts.RequirePair && status != PairStatusPaired {
			continue
		}

		// Byte budget — treat pair atomically.
		sampleBytes := productBytes(tpf) + productBytes(lc)
		if opts.MaxTotalBytes > 0 && totalBytes+sampleBytes > opts.MaxTotalBytes {
			break
		}

		samples = append(samples, Sample{
			SampleID:    SampleID(k.TICID, k.Sector),
			TICID:       k.TICID,
			Sector:      k.Sector,
			PairStatus:  status,
			TargetPixel: tpf,
			LightCurve:  lc,
		})
		totalBytes += sampleBytes
	}

	// 5. FFI selection — independent from TPF/LC budget.
	var manifestFFIs []ManifestProduct
	var ffiBytesUsed int64

	for _, e := range ffis {
		if opts.MaxFFI > 0 && len(manifestFFIs) >= opts.MaxFFI {
			break
		}
		mp := toManifestProduct(e, SampleKey{})
		manifestFFIs = append(manifestFFIs, mp)
		ffiBytesUsed += mp.SizeBytes
	}

	// 6. Validate selected entries.
	for _, s := range samples {
		if err := validateSample(s); err != nil {
			return nil, fmt.Errorf("manifest: invalid sample %s: %w", s.SampleID, err)
		}
	}
	for _, f := range manifestFFIs {
		if err := validateProduct(f); err != nil {
			return nil, fmt.Errorf("manifest: invalid ffi %s: %w", f.Filename, err)
		}
	}

	stats := ComputeStatistics(samples, manifestFFIs)
	_ = ffiBytesUsed // already in stats

	return &Manifest{
		SchemaVersion: SchemaVersion,
		CreatedAt:     time.Now().UTC(),
		Source:        "NASA-MAST-TESS",
		Statistics:    stats,
		Samples:       samples,
		FFIs:          manifestFFIs,
	}, nil
}

// selectPreferred picks the best product from a set of candidates for the same
// slot. Priority: highest calibration level, then newer source version, then
// stable filename as tie-breaker.
func selectPreferred(candidates []rawEntry) rawEntry {
	best := candidates[0]
	for _, c := range candidates[1:] {
		if c.product.CalibrationLevel > best.product.CalibrationLevel {
			best = c
			continue
		}
		if c.product.CalibrationLevel == best.product.CalibrationLevel {
			if compareVersion(c.product.SourceVersion, best.product.SourceVersion) > 0 {
				best = c
				continue
			}
			// Tie-break: lexicographically stable filename.
			if c.product.CalibrationLevel == best.product.CalibrationLevel &&
				c.product.SourceVersion == best.product.SourceVersion &&
				c.product.Filename < best.product.Filename {
				best = c
			}
		}
	}
	return best
}

// compareVersion does a simple lexicographic comparison for source version strings.
func compareVersion(a, b string) int {
	return strings.Compare(a, b)
}

// toManifestProduct converts a raw discovery entry into a ManifestProduct.
func toManifestProduct(e rawEntry, k SampleKey) ManifestProduct {
	return ManifestProduct{
		SourceProductID:  e.product.ProductID,
		ObsID:            e.obsID,
		Kind:             e.product.Kind,
		Filename:         e.product.Filename,
		DataURI:          e.product.DataURI,
		SizeBytes:        e.product.SizeBytes,
		Sector:           k.Sector,
		TICID:            k.TICID,
		CalibrationLevel: e.product.CalibrationLevel,
		SourceVersion:    e.product.SourceVersion,
	}
}

func pairStatus(tpf, lc *ManifestProduct) PairStatus {
	switch {
	case tpf != nil && lc != nil:
		return PairStatusPaired
	case tpf != nil:
		return PairStatusTPFOnly
	default:
		return PairStatusLCOnly
	}
}

func productBytes(p *ManifestProduct) int64 {
	if p == nil {
		return 0
	}
	return p.SizeBytes
}

// validateSample checks required identity fields on a Sample.
func validateSample(s Sample) error {
	if s.SampleID == "" {
		return fmt.Errorf("missing sample_id")
	}
	if s.Sector <= 0 {
		return fmt.Errorf("missing or invalid sector")
	}
	if s.TargetPixel != nil {
		if err := validateProduct(*s.TargetPixel); err != nil {
			return fmt.Errorf("target_pixel: %w", err)
		}
	}
	if s.LightCurve != nil {
		if err := validateProduct(*s.LightCurve); err != nil {
			return fmt.Errorf("light_curve: %w", err)
		}
	}
	return nil
}

// validateProduct checks required fields on a ManifestProduct.
func validateProduct(p ManifestProduct) error {
	if p.DataURI == "" {
		return fmt.Errorf("missing data_uri for %s", p.Filename)
	}
	if p.SizeBytes < 0 {
		return fmt.Errorf("negative size_bytes for %s", p.Filename)
	}
	if p.Kind == mast.KindUnknown {
		return fmt.Errorf("unsupported product kind for %s", p.Filename)
	}
	return nil
}
