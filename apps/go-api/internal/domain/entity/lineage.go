package entity

// GoldLineageInput represents an immutable input mapping in the Gold lineage catalog.
type GoldLineageInput struct {
	SourceProductID string   `json:"source_product_id" ch:"source_product_id"`
	SilverObjectKey string   `json:"silver_object_key" ch:"silver_object_key"`
	SnapshotID      string   `json:"snapshot_id" ch:"snapshot_id"`
	Datasets        []string `json:"datasets" ch:"datasets"`
	Status          string   `json:"status" ch:"status"`
}

// LineageLookup identifies one upstream Silver product whose downstream
// Gold materialization must be verified.
type LineageLookup struct {
	SourceProductID string `json:"source_product_id"`
	SilverObjectKey string `json:"silver_object_key,omitempty"`
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

// LineageStorageRef represents storage metadata for an object in the lineage ledger.
type LineageStorageRef struct {
	Key          string `json:"key"`
	SizeBytes    int64  `json:"size_bytes"`
	ETag         string `json:"etag,omitempty"`
	LastModified string `json:"last_modified"`
}

// LineageRecord is a flat projection combining Bronze, Silver, Lineage, and Gold evidence.
type LineageRecord struct {
	Identity         string             `json:"identity"`
	TICID            string             `json:"tic_id"`
	Sector           *int               `json:"sector,omitempty"`
	ProductKind      string             `json:"product_kind"`
	SourceProductID  string             `json:"source_product_id"`
	Bronze           LineageStorageRef  `json:"bronze"`
	Silver           *LineageStorageRef `json:"silver,omitempty"`
	ProcessorVersion string             `json:"processor_version,omitempty"`
	LineageID        string             `json:"lineage_id,omitempty"`
	Lineage          *LineageStorageRef `json:"lineage,omitempty"`
	Gold             *LineageResolution `json:"gold,omitempty"`
}

// LineageInventory counts the available artifacts per stage.
type LineageInventory struct {
	Bronze  int `json:"bronze"`
	Silver  int `json:"silver"`
	Lineage int `json:"lineage"`
	Gold    int `json:"gold"`
}

// LineageLedgerQuery specifies criteria for ledger retrieval.
type LineageLedgerQuery struct {
	ProductKind string `json:"product_kind"`
	Page        int    `json:"page"`
	PageSize    int    `json:"page_size"`
	StageFilter string `json:"stage_filter"`
	Search      string `json:"search"`
}

// LineageLedgerResponse contains paginated lineage records and overall inventory counts.
type LineageLedgerResponse struct {
	Items     []LineageRecord  `json:"items"`
	Inventory LineageInventory `json:"inventory"`
	Total     int              `json:"total"`
	Page      int              `json:"page"`
	PageSize  int              `json:"page_size"`
}
