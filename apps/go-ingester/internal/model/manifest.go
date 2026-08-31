package model

// ManifestProduct represents a selected product inside the ingestion manifest.
type ManifestProduct struct {
	SourceProductID string
	Kind            ProductKind
	Filename        string
	DataURI         string
	SizeBytes       int64
	Sector          int
	TICID           int64
	Camera          int
	CCD             int
}

// Sample represents a logical observation sample (TIC + Sector).
type Sample struct {
	SampleID    string
	TICID       int64
	Sector      int
	TargetPixel *ManifestProduct
	LightCurve  *ManifestProduct
}

// Statistics summarizes product counts and total volume selected in a manifest.
type Statistics struct {
	PairedCount int
	TPFBytes    int64
	LCBytes     int64
	TotalBytes  int64
}

// Manifest represents the top-level deterministic AURORA ingestion plan.
type Manifest struct {
	SchemaVersion    int
	Source           string
	Samples          []Sample
	Statistics       Statistics
	CatalogSnapshots map[string]string
}
