package entity

import "time"

// GoldControlStartRequest is the operator command submitted from the dashboard.
// STREAM waits for Silver and coalesces it; BATCH drains currently checkpointed
// Silver inputs once, then returns to PAUSED.
type GoldControlStartRequest struct {
	Mode             string `json:"mode"`
	MaxBatchRecords  int    `json:"max_batch_records"`
	IdleFlushSeconds int    `json:"idle_flush_seconds"`
	TicketID         string `json:"ticket_id,omitempty"`
}

type GoldControlState struct {
	SchemaVersion    int       `json:"schema_version"`
	Mode             string    `json:"mode"`
	MaxBatchRecords  int       `json:"max_batch_records"`
	IdleFlushSeconds float64   `json:"idle_flush_seconds"`
	CommandID        string    `json:"command_id"`
	UpdatedAt        time.Time `json:"updated_at"`
	RequestedBy      string    `json:"requested_by"`
}

// GoldRuntimeStatus is written by the Gold Builder itself. It is intentionally
// separate from desired control state so a browser never has to infer runtime
// status from a systemd process.
type GoldRuntimeStatus struct {
	SchemaVersion    int                   `json:"schema_version"`
	State            string                `json:"state"`
	Mode             string                `json:"mode"`
	MaxBatchRecords  int                   `json:"max_batch_records"`
	IdleFlushSeconds float64               `json:"idle_flush_seconds"`
	CommandID        string                `json:"command_id"`
	PendingTotal     int                   `json:"pending_total"`
	PendingByKind    map[string]int        `json:"pending_by_kind"`
	Readiness        GoldReadinessStatus   `json:"readiness"`
	CatalogSync      GoldCatalogSyncStatus `json:"catalog_sync"`
	ActiveBuilds     int                   `json:"active_builds"`
	Workers          []GoldWorkerStatus    `json:"workers"`
	FirstSilverAt    string                `json:"first_silver_at"`
	LastSilverAt     string                `json:"last_silver_at"`
	NextFlushAt      string                `json:"next_flush_at"`
	LastSnapshotID   string                `json:"last_snapshot_id"`
	LastError        string                `json:"last_error"`
	UpdatedAt        string                `json:"updated_at"`
}

// GoldWorkerStatus is authored by the worker runtime. Lifecycle describes
// whether a process-pool slot exists; Action describes what that slot is doing
// right now. The API never derives either value from aggregate counters.
type GoldWorkerStatus struct {
	WorkerID   string `json:"worker_id"`
	Lifecycle  string `json:"lifecycle"`
	Action     string `json:"action"`
	CommandID  string `json:"command_id,omitempty"`
	BatchRef   string `json:"batch_ref,omitempty"`
	InputCount int    `json:"input_count"`
	SnapshotID string `json:"snapshot_id,omitempty"`
	Detail     string `json:"detail,omitempty"`
	UpdatedAt  string `json:"updated_at"`
}

// GoldCatalogSyncStatus describes the real, batch-scoped catalog evidence
// retrieval. Snapshot IDs are immutable inputs to the current/last Gold build,
// never a claim that a mutable global catalog is ready.
type GoldCatalogSyncStatus struct {
	Mode        string            `json:"mode"`
	State       string            `json:"state"`
	TargetCount int               `json:"target_count"`
	TICRecords  int               `json:"tic_records"`
	TOIRecords  int               `json:"toi_records"`
	SnapshotIDs map[string]string `json:"snapshot_ids"`
	CacheHit    bool              `json:"cache_hit"`
	Error       string            `json:"error"`
}

// GoldReadinessStatus explains a real eligibility gate for pending light
// curves. TPF contexts are durable and reusable, therefore they are not
// counted as pending inputs after their event has been checkpointed.
type GoldReadinessStatus struct {
	CatalogReady            bool `json:"catalog_ready"`
	TICCatalogReady         bool `json:"tic_catalog_ready"`
	TOICatalogReady         bool `json:"toi_catalog_ready"`
	WaitingLightcurves      int  `json:"waiting_lightcurves"`
	ReadyLightcurves        int  `json:"ready_lightcurves"`
	MissingTPF              int  `json:"missing_tpf"`
	TPFContexts             int  `json:"tpf_contexts"`
	ContractedLightcurves   int  `json:"contracted_lightcurves"`
	UncontractedLightcurves int  `json:"uncontracted_lightcurves"`
}

type GoldControlOverview struct {
	Control GoldControlState   `json:"control"`
	Runtime *GoldRuntimeStatus `json:"runtime,omitempty"`
}

// GoldLineageLookup identifies one upstream Silver product whose downstream
// Gold materialization must be verified.  The source product id is stable
// across Bronze, Silver and the Gold manifest; the Silver key is optional for
// callers that have it available.
type GoldLineageLookup struct {
	SourceProductID string `json:"source_product_id"`
	SilverObjectKey string `json:"silver_object_key,omitempty"`
}

type GoldLineageResolveRequest struct {
	Inputs []GoldLineageLookup `json:"inputs"`
}

// GoldLineageResolution is evidence from a committed Gold manifest, never an
// inference from the number of objects in the Silver tier.
type GoldLineageResolution struct {
	SourceProductID string   `json:"source_product_id"`
	SilverObjectKey string   `json:"silver_object_key,omitempty"`
	Status          string   `json:"status"`
	SnapshotID      string   `json:"snapshot_id,omitempty"`
	Datasets        []string `json:"datasets,omitempty"`
}

// GoldSnapshotInput is the immutable Silver lineage reference recorded in a
// committed Gold manifest.
type GoldSnapshotInput struct {
	LineageID           string `json:"lineage_id"`
	SourceProductID     string `json:"source_product_id"`
	ProductKind         string `json:"product_kind"`
	SilverBucket        string `json:"silver_bucket"`
	SilverObjectKey     string `json:"silver_object_key"`
	SilverSHA256        string `json:"silver_sha256"`
	SilverSchemaVersion string `json:"silver_schema_version"`
	ProcessorVersion    string `json:"processor_version"`
	SampleID            string `json:"sample_id"`
}

type GoldArtifact struct {
	Dataset       string `json:"dataset"`
	Sector        int    `json:"sector"`
	ObjectKey     string `json:"object_key"`
	RowCount      int    `json:"row_count"`
	ContentSHA256 string `json:"content_sha256"`
	ParquetSHA256 string `json:"parquet_sha256"`
	SizeBytes     int64  `json:"size_bytes"`
}

type GoldSnapshotDetail struct {
	SnapshotID           string                   `json:"snapshot_id"`
	SnapshotFingerprint  string                   `json:"snapshot_fingerprint"`
	SnapshotType         string                   `json:"snapshot_type"`
	GoldSchemaVersion    string                   `json:"gold_schema_version"`
	FeatureVersions      map[string]string        `json:"feature_versions"`
	CompletenessContract GoldCompletenessContract `json:"completeness_contract"`
	Status               string                   `json:"status"`
	CreatedAt            string                   `json:"created_at"`
	Producer             string                   `json:"producer"`
	DatasetRowCounts     map[string]int           `json:"dataset_row_counts"`
	Artifacts            []GoldArtifact           `json:"artifacts"`
	Inputs               []GoldSnapshotInput      `json:"inputs"`
}

// GoldSnapshotSummary is an API-facing inventory record derived only from a
// persisted manifest. It prevents dashboard clients from enumerating every
// object beneath a snapshot merely to populate a training selector.
type GoldSnapshotSummary struct {
	SnapshotID   string `json:"snapshot_id"`
	ManifestKey  string `json:"manifest_key"`
	SizeBytes    int64  `json:"size_bytes"`
	LastModified string `json:"last_modified"`
	CreatedAt    string `json:"created_at"`
	Status       string `json:"status"`
}

// GoldCompletenessContract is recorded by the builder with every new
// research-ready snapshot. Legacy partial snapshots deliberately lack it.
type GoldCompletenessContract struct {
	Policy               string   `json:"policy"`
	RequiredProductKinds []string `json:"required_product_kinds"`
	RequiredCatalogs     []string `json:"required_catalogs"`
}

type GoldParquetColumn struct {
	Name     string `json:"name"`
	Path     string `json:"path"`
	Type     string `json:"type"`
	Nullable bool   `json:"nullable"`
	Repeated bool   `json:"repeated"`
}

type GoldArtifactPreviewQuery struct {
	Offset       int
	Limit        int
	Search       string
	FilterColumn string
	FilterValue  string
}

type GoldArtifactDetail struct {
	SnapshotID    string              `json:"snapshot_id"`
	Artifact      GoldArtifact        `json:"artifact"`
	Schema        []GoldParquetColumn `json:"schema"`
	Preview       []map[string]any    `json:"preview"`
	PreviewOffset int                 `json:"preview_offset"`
	PreviewLimit  int                 `json:"preview_limit"`
	MatchedRows   int                 `json:"matched_rows"`
}
