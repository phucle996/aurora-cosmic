package manifest

import (
	"fmt"
	"sort"

	"go-ingester/internal/model"
)

// Build constructs a deterministic Manifest from MAST discovery products and SelectOptions.
func Build(discovered []model.Product, opts model.SelectOptions) (*model.Manifest, error) {
	bySample := make(map[string][]model.Product)
	var ffis []model.Product

	for _, p := range discovered {
		switch p.Kind {
		case model.KindTargetPixel, model.KindLightCurve:
			if p.TICID > 0 && p.Sector > 0 {
				sid := model.SampleID(p.TICID, p.Sector)
				bySample[sid] = append(bySample[sid], p)
			}
		case model.KindFFI:
			ffis = append(ffis, p)
		}
	}

	sampleKeys := make([]string, 0, len(bySample))
	for k := range bySample {
		sampleKeys = append(sampleKeys, k)
	}
	sort.Strings(sampleKeys)

	var samples []model.Sample
	var tpfCount, lcCount, pairedCount int
	var tpfBytes, lcBytes int64

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
			}
			if p.Kind == model.KindTargetPixel && opts.IncludeTPF && tpf == nil {
				tpf = &mp
			} else if p.Kind == model.KindLightCurve && opts.IncludeLC && lc == nil {
				lc = &mp
			}
		}

		status := model.PairStatusPaired
		if tpf != nil && lc == nil {
			status = model.PairStatusTPFOnly
		} else if tpf == nil && lc != nil {
			status = model.PairStatusLCOnly
		}

		if opts.RequirePair && status != model.PairStatusPaired {
			continue
		}

		if tpf == nil && lc == nil {
			continue
		}

		sample := model.Sample{
			SampleID:    k,
			PairStatus:  status,
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

		if status == model.PairStatusPaired {
			pairedCount++
		}
		if tpf != nil {
			tpfCount++
			tpfBytes += tpf.SizeBytes
		}
		if lc != nil {
			lcCount++
			lcBytes += lc.SizeBytes
		}

		if opts.MaxSamples > 0 && len(samples) >= opts.MaxSamples {
			break
		}
	}

	var selectedFFIs []model.ManifestProduct
	var ffiBytes int64

	if opts.IncludeFFI {
		sort.Slice(ffis, func(i, j int) bool {
			return ffis[i].Filename < ffis[j].Filename
		})

		for _, f := range ffis {
			if opts.MaxFFI > 0 && len(selectedFFIs) >= opts.MaxFFI {
				break
			}
			mp := model.ManifestProduct{
				SourceProductID: f.ObsID,
				Kind:            f.Kind,
				Filename:        f.Filename,
				DataURI:         f.DataURI,
				SizeBytes:       f.SizeBytes,
				Sector:          f.Sector,
			}
			selectedFFIs = append(selectedFFIs, mp)
			ffiBytes += f.SizeBytes
		}
	}

	totalBytes := tpfBytes + lcBytes + ffiBytes

	if opts.MaxTotalBytes > 0 && totalBytes > opts.MaxTotalBytes {
		var prunedSamples []model.Sample
		var currentBytes int64
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
		totalBytes = currentBytes
	}

	stats := model.Statistics{
		PairedCount:  pairedCount,
		TPFOnlyCount: tpfCount - pairedCount,
		LCOnlyCount:  lcCount - pairedCount,
		FFICount:     len(selectedFFIs),
		TPFBytes:     tpfBytes,
		LCBytes:      lcBytes,
		FFIBytes:     ffiBytes,
		TotalBytes:   totalBytes,
	}

	manifest := &model.Manifest{
		SchemaVersion: model.SchemaVersion,
		Source:        "NASA MAST API",
		Samples:       samples,
		FFIs:          selectedFFIs,
		Statistics:    stats,
	}

	if len(samples) == 0 && len(selectedFFIs) == 0 {
		return manifest, fmt.Errorf("manifest: selection produced 0 products")
	}

	return manifest, nil
}
