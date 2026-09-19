package entity

import "time"

// LakehouseObject represents an immutable artifact stored in the Medallion lakehouse.
type LakehouseObject struct {
	Key          string    `json:"key"`
	SizeBytes    int64     `json:"size_bytes"`
	ETag         string    `json:"etag,omitempty"`
	LastModified time.Time `json:"last_modified"`
	Tier         string    `json:"tier"`   // "bronze", "silver", "gold", "other"
	Format       string    `json:"format"` // "parquet", "fits", "json", "text", "binary"
}

// LakehouseListingQuery represents the request query for browsing Lakehouse storage objects.
type LakehouseListingQuery struct {
	Prefix string `json:"prefix"`
	Search string `json:"search"`
	Page   int    `json:"page"`
	Limit  int    `json:"limit"`
}

// LakehouseListing represents a paginated slice of Lakehouse objects.
type LakehouseListing struct {
	Bucket     string            `json:"bucket"`
	Prefix     string            `json:"prefix"`
	Page       int               `json:"page"`
	Limit      int               `json:"limit"`
	Total      int               `json:"total"`
	TotalPages int               `json:"total_pages"`
	TotalBytes int64             `json:"total_bytes"`
	Objects    []LakehouseObject `json:"objects"`
}

// LakehousePreviewQuery specifies which object to inspect and preview.
type LakehousePreviewQuery struct {
	Key    string `json:"key"`
	Offset int    `json:"offset"`
	Limit  int    `json:"limit"`
	Search string `json:"search"`
}

// LakehouseParquetColumn describes a physical column extracted from Parquet footer metadata.
type LakehouseParquetColumn struct {
	Name     string `json:"name"`
	Path     string `json:"path"`
	Type     string `json:"type"`
	Nullable bool   `json:"nullable"`
	Repeated bool   `json:"repeated"`
}

// LakehouseParquetPreview holds schema and tabular rows preview for a Parquet object.
type LakehouseParquetPreview struct {
	Columns     []LakehouseParquetColumn `json:"columns"`
	Rows        []map[string]any         `json:"rows"`
	TotalRows   int64                    `json:"total_rows"`
	MatchedRows int                      `json:"matched_rows"`
	Offset      int                      `json:"offset"`
	Limit       int                      `json:"limit"`
}

// LakehouseFITSHeaderCard represents one standard 80-byte FITS card image.
type LakehouseFITSHeaderCard struct {
	Keyword string `json:"keyword"`
	Value   string `json:"value"`
	Comment string `json:"comment"`
}

// LakehouseFITSHDU represents one Header and Data Unit (HDU) within a FITS file.
type LakehouseFITSHDU struct {
	Index   int                       `json:"index"`
	Name    string                    `json:"name"`
	Type    string                    `json:"type"` // "PRIMARY", "BINTABLE", "IMAGE", "EXTENSION"
	Cards   []LakehouseFITSHeaderCard `json:"cards"`
	Summary map[string]string         `json:"summary"` // Quick highlights: OBJECT, TICID, SECTOR, CAMERA, etc.
}

// LakehouseFITSPreview holds parsed HDU headers and context for a FITS object.
type LakehouseFITSPreview struct {
	HDUs []LakehouseFITSHDU `json:"hdus"`
}

// LakehousePreviewResponse is the unified result of inspecting any Lakehouse artifact.
type LakehousePreviewResponse struct {
	Key           string                   `json:"key"`
	Tier          string                   `json:"tier"`   // "bronze", "silver", "gold"
	Format        string                   `json:"format"` // "parquet", "fits", "json", "text", "binary"
	SizeBytes     int64                    `json:"size_bytes"`
	ContentSHA256 string                   `json:"content_sha256"`
	LastModified  string                   `json:"last_modified"`
	Parquet       *LakehouseParquetPreview `json:"parquet,omitempty"`
	FITS          *LakehouseFITSPreview    `json:"fits,omitempty"`
	JSONContent   any                      `json:"json_content,omitempty"`
	TextContent   string                   `json:"text_content,omitempty"`
	Error         string                   `json:"error,omitempty"`
}
