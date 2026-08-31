package plan

import (
	"encoding/json"

	"go-ingester/internal/model"
)

type manifestDocument struct {
	SchemaVersion    int                `json:"schema_version"`
	Source           string             `json:"source"`
	Samples          []sampleDocument   `json:"samples"`
	Statistics       statisticsDocument `json:"statistics"`
	CatalogSnapshots map[string]string  `json:"catalog_snapshots,omitempty"`
}

type sampleDocument struct {
	SampleID    string           `json:"sample_id"`
	TICID       int64            `json:"tic_id"`
	Sector      int              `json:"sector"`
	TargetPixel *productDocument `json:"target_pixel,omitempty"`
	LightCurve  *productDocument `json:"light_curve,omitempty"`
}

type productDocument struct {
	SourceProductID string `json:"source_product_id"`
	Kind            string `json:"kind"`
	Filename        string `json:"filename"`
	DataURI         string `json:"data_uri"`
	SizeBytes       int64  `json:"size_bytes"`
	Sector          int    `json:"sector"`
	TICID           int64  `json:"tic_id,omitempty"`
	Camera          int    `json:"camera,omitempty"`
	CCD             int    `json:"ccd,omitempty"`
}

type statisticsDocument struct {
	PairedCount int   `json:"paired_count"`
	TPFBytes    int64 `json:"tpf_bytes"`
	LCBytes     int64 `json:"lc_bytes"`
	TotalBytes  int64 `json:"total_bytes"`
}

func marshal(manifest *model.Manifest) ([]byte, error) {
	return json.Marshal(toDocument(manifest))
}

func marshalIndented(manifest *model.Manifest) ([]byte, error) {
	return json.MarshalIndent(toDocument(manifest), "", "  ")
}

func unmarshal(data []byte) (*model.Manifest, error) {
	var document manifestDocument
	if err := json.Unmarshal(data, &document); err != nil {
		return nil, err
	}
	return fromDocument(document), nil
}

func toDocument(manifest *model.Manifest) manifestDocument {
	if manifest == nil {
		return manifestDocument{}
	}
	document := manifestDocument{
		SchemaVersion:    manifest.SchemaVersion,
		Source:           manifest.Source,
		Samples:          make([]sampleDocument, 0, len(manifest.Samples)),
		Statistics:       statisticsDocument(manifest.Statistics),
		CatalogSnapshots: manifest.CatalogSnapshots,
	}
	for _, sample := range manifest.Samples {
		document.Samples = append(document.Samples, sampleDocument{
			SampleID: sample.SampleID, TICID: sample.TICID, Sector: sample.Sector,
			TargetPixel: productPointerToDocument(sample.TargetPixel),
			LightCurve:  productPointerToDocument(sample.LightCurve),
		})
	}
	return document
}

func fromDocument(document manifestDocument) *model.Manifest {
	manifest := &model.Manifest{
		SchemaVersion:    document.SchemaVersion,
		Source:           document.Source,
		Samples:          make([]model.Sample, 0, len(document.Samples)),
		Statistics:       model.Statistics(document.Statistics),
		CatalogSnapshots: document.CatalogSnapshots,
	}
	for _, sample := range document.Samples {
		manifest.Samples = append(manifest.Samples, model.Sample{
			SampleID: sample.SampleID, TICID: sample.TICID, Sector: sample.Sector,
			TargetPixel: productPointerFromDocument(sample.TargetPixel),
			LightCurve:  productPointerFromDocument(sample.LightCurve),
		})
	}
	return manifest
}

func productToDocument(product model.ManifestProduct) productDocument {
	return productDocument{SourceProductID: product.SourceProductID, Kind: string(product.Kind), Filename: product.Filename, DataURI: product.DataURI, SizeBytes: product.SizeBytes, Sector: product.Sector, TICID: product.TICID, Camera: product.Camera, CCD: product.CCD}
}

func productFromDocument(document productDocument) model.ManifestProduct {
	return model.ManifestProduct{SourceProductID: document.SourceProductID, Kind: model.ProductKind(document.Kind), Filename: document.Filename, DataURI: document.DataURI, SizeBytes: document.SizeBytes, Sector: document.Sector, TICID: document.TICID, Camera: document.Camera, CCD: document.CCD}
}

func productPointerToDocument(product *model.ManifestProduct) *productDocument {
	if product == nil {
		return nil
	}
	document := productToDocument(*product)
	return &document
}

func productPointerFromDocument(document *productDocument) *model.ManifestProduct {
	if document == nil {
		return nil
	}
	product := productFromDocument(*document)
	return &product
}
