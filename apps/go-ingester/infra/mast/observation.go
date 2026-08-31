package mast

import "math"

// Observation is the MAST API response shape. It remains at the HTTP adapter
// boundary instead of leaking JSON concerns into the domain model.
type Observation struct {
	// CatalogID is the numeric parent observation identifier returned by
	// Mast.Caom.Filtered. It is required to ask Mast.Caom.Products for the
	// concrete FFI FITS products; image observation rows themselves do not
	// carry dataURI or productFilename.
	CatalogID          int64    `json:"obsid"`
	ObsID              string   `json:"obs_id"`
	RA                 float64  `json:"s_ra"`
	Dec                float64  `json:"s_dec"`
	Region             string   `json:"s_region"`
	Camera             int      `json:"-"`
	CCD                int      `json:"-"`
	TargetName         string   `json:"target_name"`
	ObsCollection      string   `json:"obs_collection"`
	InstrumentName     string   `json:"instrument_name"`
	Project            string   `json:"project"`
	ProposalID         string   `json:"proposal_id"`
	SequenceNumber     int      `json:"sequence_number"`
	DataURL            string   `json:"dataURL"`
	DataURI            string   `json:"dataURI"`
	ProductFilename    string   `json:"productFilename"`
	ProductSubGroup    string   `json:"productSubGroupDescription"`
	Description        string   `json:"description"`
	Distance           *float64 `json:"distance,omitempty"`
	ProductType        string   `json:"productType"`
	DataProductType    string   `json:"dataproduct_type"`
	CalibLevel         int      `json:"calib_level"`
	SizeBytes          int64    `json:"size"`
	JPEGURL            string   `json:"jpegURL"`
	ProvenanceName     string   `json:"provenance_name"`
	ProjectDescription string   `json:"projectDescription"`
}

func (o Observation) hasSkyPosition() bool { return !math.IsNaN(o.RA) && !math.IsNaN(o.Dec) }
