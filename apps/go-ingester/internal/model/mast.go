package model

// ProductKind identifies the TESS product type.
type ProductKind string

const (
	KindTargetPixel ProductKind = "TARGET_PIXEL"
	KindLightCurve  ProductKind = "LIGHT_CURVE"
	KindUnknown     ProductKind = "UNKNOWN"
)

// Product represents a classified TESS data product extracted from MAST observations.
type Product struct {
	ObsID           string
	TICID           int64
	Sector          int
	Kind            ProductKind
	Filename        string
	DataURI         string
	SizeBytes       int64
	ProductSubGroup string
	Camera          int
	CCD             int
}
