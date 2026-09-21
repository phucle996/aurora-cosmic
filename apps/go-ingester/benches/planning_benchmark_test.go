package benches

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"math/rand"
	"sort"
	"testing"

	"go-ingester/internal/model"
	"go-ingester/internal/pipeline/plan"
)

func generateSyntheticProducts(count int) []model.Product {
	products := make([]model.Product, 0, count)
	// Each target has 1 LightCurve and 1 TargetPixel pair
	targets := count / 2
	for i := 1; i <= targets; i++ {
		ticID := int64(100000000 + i)
		products = append(products, model.Product{
			ObsID:     fmt.Sprintf("tess-s0002-%d-s_lc", ticID),
			TICID:     ticID,
			Sector:    2,
			Kind:      model.KindLightCurve,
			Filename:  fmt.Sprintf("tess2018234235059-s0002-%016d-0121-s_lc.fits", ticID),
			DataURI:   fmt.Sprintf("mast:TESS/product/tess2018234235059-s0002-%016d-0121-s_lc.fits", ticID),
			SizeBytes: 2004480,
		})
		products = append(products, model.Product{
			ObsID:     fmt.Sprintf("tess-s0002-%d-s_tp", ticID),
			TICID:     ticID,
			Sector:    2,
			Kind:      model.KindTargetPixel,
			Filename:  fmt.Sprintf("tess2018234235059-s0002-%016d-0121-s_tp.fits", ticID),
			DataURI:   fmt.Sprintf("mast:TESS/product/tess2018234235059-s0002-%016d-0121-s_tp.fits", ticID),
			SizeBytes: 48355200,
		})
	}
	return products
}

// BenchmarkPlanBuild measures performance of building research manifest
// for various scales (1K, 5K, 16K, 32K products) with and without TOI preferences.
func BenchmarkPlanBuild(b *testing.B) {
	sizes := []int{1000, 5000, 16574, 32042}

	for _, size := range sizes {
		products := generateSyntheticProducts(size)
		// Generate 100 preferred TOI targets
		preferred := make(map[int64]struct{})
		for i := 0; i < 100 && i < len(products)/2; i++ {
			preferred[products[i*2].TICID] = struct{}{}
		}

		b.Run(fmt.Sprintf("size_%d/no_preference", size), func(b *testing.B) {
			b.ReportAllocs()
			b.ResetTimer()
			for i := 0; i < b.N; i++ {
				m, err := plan.Build(products, plan.SelectOptions{})
				if err != nil {
					b.Fatalf("plan.Build failed: %v", err)
				}
				if len(m.Samples) == 0 {
					b.Fatal("unexpected empty manifest samples")
				}
			}
		})

		b.Run(fmt.Sprintf("size_%d/with_toi_preference", size), func(b *testing.B) {
			b.ReportAllocs()
			b.ResetTimer()
			for i := 0; i < b.N; i++ {
				m, err := plan.Build(products, plan.SelectOptions{
					MaxSamples:      size / 4,
					PreferredTICIDs: preferred,
				})
				if err != nil {
					b.Fatalf("plan.Build failed: %v", err)
				}
				if len(m.Samples) == 0 {
					b.Fatal("unexpected empty manifest samples")
				}
			}
		})
	}
}

type TICBenchRecord struct {
	TICID         int64    `json:"tic_id"`
	RADeg         *float64 `json:"ra_deg"`
	DecDeg        *float64 `json:"dec_deg"`
	TMag          *float64 `json:"tmag"`
	Teff          *float64 `json:"teff"`
	StellarRadius *float64 `json:"stellar_radius"`
	StellarMass   *float64 `json:"stellar_mass"`
	Logg          *float64 `json:"logg"`
}

func generateSyntheticTICRecords(count int) []TICBenchRecord {
	rng := rand.New(rand.NewSource(42))
	records := make([]TICBenchRecord, 0, count)
	for i := 0; i < count; i++ {
		ra := rng.Float64() * 360.0
		dec := rng.Float64()*180.0 - 90.0
		tmag := 6.0 + rng.Float64()*12.0
		teff := 3000.0 + rng.Float64()*7000.0
		rad := 0.2 + rng.Float64()*5.0
		mass := 0.2 + rng.Float64()*3.0
		logg := 3.0 + rng.Float64()*2.0

		records = append(records, TICBenchRecord{
			TICID:         int64(100000000 + i),
			RADeg:         &ra,
			DecDeg:        &dec,
			TMag:          &tmag,
			Teff:          &teff,
			StellarRadius: &rad,
			StellarMass:   &mass,
			Logg:          &logg,
		})
	}
	return records
}

// BenchmarkTICRecordSerialization measures CPU & memory cost of
// sorting, json marshaling, and sha256 digest computation for 1K, 5K, 15K records.
func BenchmarkTICRecordSerialization(b *testing.B) {
	sizes := []int{1000, 5000, 15000}

	for _, size := range sizes {
		records := generateSyntheticTICRecords(size)

		b.Run(fmt.Sprintf("records_%d", size), func(b *testing.B) {
			b.ReportAllocs()
			b.ResetTimer()
			for i := 0; i < b.N; i++ {
				// Clone slice for in-place sorting
				cloned := make([]TICBenchRecord, len(records))
				copy(cloned, records)

				sort.Slice(cloned, func(i, j int) bool { return cloned[i].TICID < cloned[j].TICID })
				data, err := json.Marshal(cloned)
				if err != nil {
					b.Fatalf("json.Marshal failed: %v", err)
				}
				sum := sha256.Sum256(data)
				_ = hex.EncodeToString(sum[:])
			}
		})
	}
}
