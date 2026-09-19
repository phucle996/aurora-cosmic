package entity

import "time"

// EnrichmentControlStartRequest is the operator command submitted from the dashboard.
// STREAM waits for Silver and coalesces it; BATCH drains currently checkpointed
// Silver inputs once, then returns to PAUSED.
type EnrichmentControlStartRequest struct {
	Mode             string `json:"mode"`
	MaxBatchRecords  int    `json:"max_batch_records"`
	IdleFlushSeconds int    `json:"idle_flush_seconds"`
	TicketID         string `json:"ticket_id,omitempty"`
}

type EnrichmentCommandResult struct {
	TicketID string `json:"ticket_id"`
	Status   string `json:"status"`
}

type EnrichmentControlState struct {
	SchemaVersion    int       `json:"schema_version"`
	Mode             string    `json:"mode"`
	MaxBatchRecords  int       `json:"max_batch_records"`
	IdleFlushSeconds float64   `json:"idle_flush_seconds"`
	TicketID         string    `json:"ticket_id"`
	UpdatedAt        time.Time `json:"updated_at"`
	RequestedBy      string    `json:"requested_by,omitempty"`
}

// EnrichmentRuntimeStatus is written by the Gold/Enrichment Builder itself. It is intentionally
// separate from desired control state so a browser never has to infer runtime
// status from a systemd process.
type EnrichmentRuntimeStatus struct {
	SchemaVersion    int                         `json:"schema_version"`
	State            string                      `json:"state"`
	Mode             string                      `json:"mode"`
	MaxBatchRecords  int                         `json:"max_batch_records"`
	IdleFlushSeconds float64                     `json:"idle_flush_seconds"`
	TicketID         string                      `json:"ticket_id,omitempty"`
	PendingTotal     int                         `json:"pending_total"`
	PendingByKind    map[string]int              `json:"pending_by_kind"`
	Readiness        EnrichmentReadinessStatus   `json:"readiness"`
	CatalogSync      EnrichmentCatalogSyncStatus `json:"catalog_sync"`
	ActiveBuilds     int                         `json:"active_builds"`
	Workers          []EnrichmentWorkerStatus    `json:"workers"`
	FirstSilverAt    string                      `json:"first_silver_at"`
	LastSilverAt     string                      `json:"last_silver_at"`
	NextFlushAt      string                      `json:"next_flush_at"`
	LastSnapshotID   string                      `json:"last_snapshot_id"`
	LastError        string                      `json:"last_error"`
	UpdatedAt        string                      `json:"updated_at"`
}

// EnrichmentWorkerStatus is authored by the worker runtime. Lifecycle describes
// whether a process-pool slot exists; Action describes what that slot is doing
// right now. The API never derives either value from aggregate counters.
type EnrichmentWorkerStatus struct {
	WorkerID   string `json:"worker_id"`
	Lifecycle  string `json:"lifecycle"`
	Action     string `json:"action"`
	TicketID   string `json:"ticket_id,omitempty"`
	BatchRef   string `json:"batch_ref,omitempty"`
	InputCount int    `json:"input_count"`
	SnapshotID string `json:"snapshot_id,omitempty"`
	Detail     string `json:"detail,omitempty"`
	StepIndex  int    `json:"step_index"`
	StepName   string `json:"step_name,omitempty"`
	UpdatedAt  string `json:"updated_at"`
}

// EnrichmentCatalogSyncStatus describes the real, batch-scoped catalog evidence
// retrieval. Snapshot IDs are immutable inputs to the current/last Gold build,
// never a claim that a mutable global catalog is ready.
type EnrichmentCatalogSyncStatus struct {
	Mode        string            `json:"mode"`
	State       string            `json:"state"`
	TargetCount int               `json:"target_count"`
	TICRecords  int               `json:"tic_records"`
	TOIRecords  int               `json:"toi_records"`
	SnapshotIDs map[string]string `json:"snapshot_ids"`
	CacheHit    bool              `json:"cache_hit"`
	Error       string            `json:"error"`
}

// EnrichmentReadinessStatus explains a real eligibility gate for pending light
// curves. TPF contexts are durable and reusable, therefore they are not
// counted as pending inputs after their event has been checkpointed.
type EnrichmentReadinessStatus struct {
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

type EnrichmentControlOverview struct {
	Control EnrichmentControlState   `json:"control"`
	Runtime *EnrichmentRuntimeStatus `json:"runtime,omitempty"`
}

// EnrichmentLineageLookup identifies one upstream Silver product whose downstream
// Gold materialization must be verified.
type EnrichmentLineageLookup struct {
	SourceProductID string `json:"source_product_id"`
	SilverObjectKey string `json:"silver_object_key,omitempty"`
}

type EnrichmentLineageResolveRequest struct {
	Inputs []EnrichmentLineageLookup `json:"inputs"`
}

// EnrichmentLineageResolution is evidence from a committed Gold manifest, never an
// inference from the number of objects in the Silver tier.
type EnrichmentLineageResolution struct {
	SourceProductID string   `json:"source_product_id"`
	SilverObjectKey string   `json:"silver_object_key,omitempty"`
	Status          string   `json:"status"`
	SnapshotID      string   `json:"snapshot_id,omitempty"`
	Datasets        []string `json:"datasets,omitempty"`
}

// EnrichmentSnapshotInput is the immutable Silver lineage reference recorded in a
// committed Gold manifest.
type EnrichmentSnapshotInput struct {
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

type EnrichmentArtifact struct {
	Dataset       string `json:"dataset"`
	Sector        int    `json:"sector"`
	ObjectKey     string `json:"object_key"`
	RowCount      int    `json:"row_count"`
	ContentSHA256 string `json:"content_sha256"`
	ParquetSHA256 string `json:"parquet_sha256"`
	SizeBytes     int64  `json:"size_bytes"`
}

// EnrichmentSnapshotDetail is authored by the Gold builder materializer. It is the
// single Source of Truth for what inputs reached Gold and which dataset
// artifacts were committed.
type EnrichmentSnapshotDetail struct {
	SnapshotID           string                         `json:"snapshot_id"`
	SnapshotFingerprint  string                         `json:"snapshot_fingerprint"`
	SnapshotType         string                         `json:"snapshot_type"`
	GoldSchemaVersion    string                         `json:"gold_schema_version"`
	FeatureVersions      map[string]string              `json:"feature_versions"`
	CompletenessContract EnrichmentCompletenessContract `json:"completeness_contract"`
	Status               string                         `json:"status"`
	CreatedAt            string                         `json:"created_at"`
	Producer             string                         `json:"producer"`
	DatasetRowCounts     map[string]int                 `json:"dataset_row_counts"`
	Artifacts            []EnrichmentArtifact           `json:"artifacts"`
	Inputs               []EnrichmentSnapshotInput      `json:"inputs"`
}

// EnrichmentSnapshotSummary is an API-facing inventory record derived only from a
// persisted manifest. It prevents dashboard clients from enumerating every
// object beneath a snapshot merely to populate a training selector.
type EnrichmentSnapshotSummary struct {
	SnapshotID   string `json:"snapshot_id"`
	ManifestKey  string `json:"manifest_key"`
	SizeBytes    int64  `json:"size_bytes"`
	LastModified string `json:"last_modified"`
	CreatedAt    string `json:"created_at"`
	Status       string `json:"status"`
}

// EnrichmentCompletenessContract is recorded by the builder with every new
// research-ready snapshot. Legacy partial snapshots deliberately lack it.
type EnrichmentCompletenessContract struct {
	Policy               string   `json:"policy"`
	RequiredProductKinds []string `json:"required_product_kinds"`
	RequiredCatalogs     []string `json:"required_catalogs"`
}

type EnrichmentParquetColumn struct {
	Name     string `json:"name"`
	Path     string `json:"path"`
	Type     string `json:"type"`
	Nullable bool   `json:"nullable"`
	Repeated bool   `json:"repeated"`
}

type EnrichmentArtifactPreviewQuery struct {
	Offset       int
	Limit        int
	Search       string
	FilterColumn string
	FilterValue  string
}

type EnrichmentArtifactDetail struct {
	SnapshotID    string                    `json:"snapshot_id"`
	Artifact      EnrichmentArtifact        `json:"artifact"`
	Schema        []EnrichmentParquetColumn `json:"schema"`
	Preview       []map[string]any          `json:"preview"`
	PreviewOffset int                       `json:"preview_offset"`
	PreviewLimit  int                       `json:"preview_limit"`
	MatchedRows   int                       `json:"matched_rows"`
}
