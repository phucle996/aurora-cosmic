package entity

// LineageLookup identifies one upstream Silver product whose downstream
// Gold materialization must be verified.
type LineageLookup struct {
	SourceProductID string `json:"source_product_id"`
	SilverObjectKey string `json:"silver_object_key,omitempty"`
}

type LineageTraceRequest struct {
	Inputs []LineageLookup `json:"inputs"`
}

// LineageResolution is evidence from a committed Gold manifest, never an
// inference from the number of objects in the Silver tier.
type LineageResolution struct {
	SourceProductID string   `json:"source_product_id"`
	SilverObjectKey string   `json:"silver_object_key,omitempty"`
	Status          string   `json:"status"`
	SnapshotID      string   `json:"snapshot_id,omitempty"`
	Datasets        []string `json:"datasets,omitempty"`
}
