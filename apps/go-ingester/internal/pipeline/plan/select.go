package plan

import (
	"fmt"
	"sort"

	"go-ingester/internal/model"
)

// SelectOptions constrains plan construction from MAST discovery results.
type SelectOptions struct {
	MaxSamples      int
	MaxTotalBytes   int64
	PreferredTICIDs map[int64]struct{}
}

// Build constructs a deterministic Manifest from MAST discovery products and SelectOptions.
func Build(discovered []model.Product, opts SelectOptions) (*model.Manifest, error) {
	bySample := make(map[string][]model.Product)

	for _, p := range discovered {
		switch p.Kind {
		case model.KindTargetPixel, model.KindLightCurve:
			if p.TICID > 0 && p.Sector > 0 {
				sid := SampleID(p.TICID, p.Sector)
				bySample[sid] = append(bySample[sid], p)
			}
		}
	}

	sampleKeys := make([]string, 0, len(bySample))
	for k := range bySample {
		sampleKeys = append(sampleKeys, k)
	}
	sort.Slice(sampleKeys, func(i, j int) bool {
		left, right := bySample[sampleKeys[i]], bySample[sampleKeys[j]]
		leftPreferred, rightPreferred := false, false
		if len(left) > 0 {
			_, leftPreferred = opts.PreferredTICIDs[left[0].TICID]
		}
		if len(right) > 0 {
			_, rightPreferred = opts.PreferredTICIDs[right[0].TICID]
		}
		if leftPreferred != rightPreferred {
			return leftPreferred
		}
		return sampleKeys[i] < sampleKeys[j]
	})

	var samples []model.Sample

	for _, k := range sampleKeys {
		prods := bySample[k]
		var tpf, lc *model.ManifestProduct

		for _, p := range prods {
			mp := model.ManifestProduct{
				SourceProductID: p.ObsID,
				Kind:            p.Kind,
				Filename:        p.Filename,
				DataURI:         p.DataURI,
				SizeBytes:       p.SizeBytes,
				Sector:          p.Sector,
				TICID:           p.TICID,
				Camera:          p.Camera,
				CCD:             p.CCD,
			}
			if p.Kind == model.KindTargetPixel && tpf == nil {
				tpf = &mp
			} else if p.Kind == model.KindLightCurve && lc == nil {
				lc = &mp
			}
		}
		if tpf == nil || lc == nil {
			continue
		}

		sample := model.Sample{
			SampleID:    k,
			TargetPixel: tpf,
			LightCurve:  lc,
		}

		if tpf != nil {
			sample.TICID = tpf.TICID
			sample.Sector = tpf.Sector
		} else if lc != nil {
			sample.TICID = lc.TICID
			sample.Sector = lc.Sector
		}

		samples = append(samples, sample)

		if opts.MaxSamples > 0 && len(samples) >= opts.MaxSamples {
			break
		}
	}

	selectedBytes := int64(0)
	for _, sample := range samples {
		selectedBytes += sample.TargetPixel.SizeBytes + sample.LightCurve.SizeBytes
	}
	if opts.MaxTotalBytes > 0 && selectedBytes > opts.MaxTotalBytes {
		var prunedSamples []model.Sample
		currentBytes := int64(0)
		for _, s := range samples {
			sampleBytes := int64(0)
			if s.TargetPixel != nil {
				sampleBytes += s.TargetPixel.SizeBytes
			}
			if s.LightCurve != nil {
				sampleBytes += s.LightCurve.SizeBytes
			}
			if currentBytes+sampleBytes > opts.MaxTotalBytes {
				break
			}
			prunedSamples = append(prunedSamples, s)
			currentBytes += sampleBytes
		}
		samples = prunedSamples
	}

	if len(samples) == 0 {
		return nil, fmt.Errorf("manifest: no matched TPF + light-curve samples within the selected budget")
	}
	var tpfBytes, lcBytes int64
	for _, sample := range samples {
		tpfBytes += sample.TargetPixel.SizeBytes
		lcBytes += sample.LightCurve.SizeBytes
	}
	totalBytes := tpfBytes + lcBytes

	stats := model.Statistics{
		PairedCount: len(samples),
		TPFBytes:    tpfBytes,
		LCBytes:     lcBytes,
		TotalBytes:  totalBytes,
	}

	manifest := &model.Manifest{
		SchemaVersion: SchemaVersion,
		Source:        "NASA MAST API",
		Samples:       samples,
		Statistics:    stats,
	}

	return manifest, nil
}
