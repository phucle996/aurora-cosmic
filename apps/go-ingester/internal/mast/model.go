package mast

import "strings"

// ProductKind is the AURORA classification of a TESS data product.
type ProductKind string

const (
	KindTargetPixel ProductKind = "TARGET_PIXEL"
	KindLightCurve  ProductKind = "LIGHT_CURVE"
	KindFFI         ProductKind = "FFI"
	KindUnknown     ProductKind = "UNKNOWN"
)

// Observation is a trimmed representation of a MAST CAOM observation row.
// Only fields useful for product discovery are retained.
type Observation struct {
	ObsID           string
	ObservationID   string
	TargetName      string
	DataProductType string
	Project         string
}

// rawObservation maps the MAST JSON fields for Mast.Caom.Filtered.
type rawObservation struct {
	ObsID           string `json:"obsid"`
	ObservationID   string `json:"obs_id"`
	TargetName      string `json:"target_name"`
	DataProductType string `json:"dataproduct_type"`
	Project         string `json:"project"`
}

func (r rawObservation) toObservation() Observation {
	return Observation{
		ObsID:           r.ObsID,
		ObservationID:   r.ObservationID,
		TargetName:      r.TargetName,
		DataProductType: r.DataProductType,
		Project:         r.Project,
	}
}

// Product is a TESS data product discovered via Mast.Caom.Products.
type Product struct {
	ObsID            string
	ProductID        string
	Filename         string
	DataURI          string
	SizeBytes        int64
	ProductType      string
	DataProductType  string
	CalibrationLevel int
	SourceVersion    string
	Kind             ProductKind
}

// rawProduct maps the MAST JSON fields for Mast.Caom.Products.
type rawProduct struct {
	ObsID            string  `json:"obs_id"`
	ProductID        string  `json:"productFilename"`
	Filename         string  `json:"productFilename"`
	DataURI          string  `json:"dataURI"`
	Size             float64 `json:"size"`
	ProductType      string  `json:"productType"`
	DataProductType  string  `json:"dataproduct_type"`
	CalibrationLevel int     `json:"calib_level"`
	Description      string  `json:"description"`
	SourceVersion    string  `json:"source_version"`
}

func (r rawProduct) toProduct() Product {
	p := Product{
		ObsID:            r.ObsID,
		ProductID:        r.ProductID,
		Filename:         r.Filename,
		DataURI:          r.DataURI,
		SizeBytes:        int64(r.Size),
		ProductType:      r.ProductType,
		DataProductType:  r.DataProductType,
		CalibrationLevel: r.CalibrationLevel,
		SourceVersion:    r.SourceVersion,
		Kind:             ClassifyProduct(r.Filename),
	}
	return p
}

// ClassifyProduct returns the AURORA product kind for a given filename.
// Classification is based solely on filename suffix — deterministic, no MAST state.
func ClassifyProduct(filename string) ProductKind {
	lower := strings.ToLower(filename)
	switch {
	case strings.HasSuffix(lower, "_tp.fits"):
		return KindTargetPixel
	case strings.HasSuffix(lower, "_lc.fits"):
		return KindLightCurve
	case strings.HasSuffix(lower, "_ffic.fits"):
		return KindFFI
	default:
		return KindUnknown
	}
}
