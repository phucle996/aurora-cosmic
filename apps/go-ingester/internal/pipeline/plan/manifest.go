package plan

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"

	"go-ingester/internal/model"
)

const SchemaVersion = 1

func SampleID(ticID int64, sector int) string {
	return fmt.Sprintf("sample:tic=%d:sector=%04d", ticID, sector)
}

func Products(manifest *model.Manifest) []model.ManifestProduct {
	if manifest == nil {
		return nil
	}
	products := make([]model.ManifestProduct, 0, len(manifest.Samples)*2)
	for _, sample := range manifest.Samples {
		if sample.TargetPixel != nil {
			products = append(products, *sample.TargetPixel)
		}
		if sample.LightCurve != nil {
			products = append(products, *sample.LightCurve)
		}
	}
	return products
}

// SampleProducts returns the complete target-product contract. TPF and LC are
// deliberately adjacent so a bounded worker queue starts both modalities for
// the same TIC before moving deeper into the sector backlog.
func SampleProducts(manifest *model.Manifest) []model.ManifestProduct {
	if manifest == nil {
		return nil
	}
	products := make([]model.ManifestProduct, 0, len(manifest.Samples)*2)
	for _, sample := range manifest.Samples {
		if sample.TargetPixel != nil {
			products = append(products, *sample.TargetPixel)
		}
		if sample.LightCurve != nil {
			products = append(products, *sample.LightCurve)
		}
	}
	return products
}

func ExpectedBytes(manifest *model.Manifest) int64 {
	var total int64
	for _, product := range Products(manifest) {
		if product.SizeBytes <= 0 {
			continue
		}
		if product.SizeBytes > (1<<63-1)-total {
			return 1<<63 - 1
		}
		total += product.SizeBytes
	}
	return total
}

func Hash(manifest *model.Manifest) (string, error) {
	data, err := marshal(manifest)
	if err != nil {
		return "", err
	}
	sum := sha256.Sum256(data)
	return hex.EncodeToString(sum[:]), nil
}
