package model

// ProductKind identifies the TESS product type.
type ProductKind string

const (
	KindTargetPixel ProductKind = "TARGET_PIXEL"
	KindLightCurve  ProductKind = "LIGHT_CURVE"
	KindFFI         ProductKind = "FFI"
	KindUnknown     ProductKind = "UNKNOWN"
)

// Observation represents a raw record returned by NASA MAST API.
type Observation struct {
	ObsID              string   `json:"obs_id"`
	TargetName         string   `json:"target_name"`
	ObsCollection      string   `json:"obs_collection"`
	InstrumentName     string   `json:"instrument_name"`
	Project            string   `json:"project"`
	ProposalID         string   `json:"proposal_id"`
	SequenceNumber     int      `json:"sequence_number"`
	DataURL            string   `json:"dataURL"`
	ProductFilename    string   `json:"productFilename"`
	ProductSubGroup    string   `json:"productSubGroupDescription"`
	Description        string   `json:"description"`
	Distance           *float64 `json:"distance,omitempty"`
	ProductType        string   `json:"productType"`
	CalibLevel         int      `json:"calib_level"`
	SizeBytes          int64    `json:"size_bytes"`
	JPEGURL            string   `json:"jpegURL"`
	ProvenanceName     string   `json:"provenance_name"`
	ProjectDescription string   `json:"projectDescription"`
}

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
}
