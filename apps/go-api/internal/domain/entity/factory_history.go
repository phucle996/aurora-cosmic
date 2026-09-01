package entity

// FactoryRun is an observed, durable operational run. It is never generated
// from dashboard state; Gold Builder writes it only after seeing control/runtime.
type FactoryRun struct {
	Pipeline         string `json:"pipeline"`
	RunID            string `json:"run_id"`
	Mode             string `json:"mode"`
	Status           string `json:"status"`
	StartedAt        string `json:"started_at"`
	FinishedAt       string `json:"finished_at,omitempty"`
	MaxBatchRecords  int64  `json:"max_batch_records"`
	IdleFlushSeconds int64  `json:"idle_flush_seconds"`
	PendingInputs    int64  `json:"pending_inputs"`
	CompletedBatches int64  `json:"completed_batches"`
	InputRecords     int64  `json:"input_records"`
	OutputRows       int64  `json:"output_rows"`
	IndexedRows      int64  `json:"indexed_rows"`
	LastSnapshotID   string `json:"last_snapshot_id,omitempty"`
	LastError        string `json:"last_error,omitempty"`
	UpdatedAt        string `json:"updated_at"`
}

type FactoryBatch struct {
	BatchID             string `json:"batch_id"`
	Mode                string `json:"mode"`
	Status              string `json:"status"`
	StartedAt           string `json:"started_at"`
	CompletedAt         string `json:"completed_at,omitempty"`
	InputRecords        int64  `json:"input_records"`
	CandidateRows       int64  `json:"candidate_rows"`
	ArtifactCount       int64  `json:"artifact_count"`
	IndexedRows         int64  `json:"indexed_rows"`
	SnapshotID          string `json:"snapshot_id,omitempty"`
	SnapshotFingerprint string `json:"snapshot_fingerprint,omitempty"`
	ManifestKey         string `json:"manifest_key,omitempty"`
	ManifestSHA256      string `json:"manifest_sha256,omitempty"`
	Error               string `json:"error,omitempty"`
}

type FactoryComponentEvent struct {
	ComponentID  string `json:"component_id"`
	Status       string `json:"status"`
	OccurredAt   string `json:"occurred_at"`
	InputRecords int64  `json:"input_records"`
	OutputRows   int64  `json:"output_rows"`
	IndexedRows  int64  `json:"indexed_rows"`
	SnapshotID   string `json:"snapshot_id,omitempty"`
	Error        string `json:"error,omitempty"`
}

// QuantileSummary is a durable distribution summary computed over the exact
// Gold snapshots owned by one factory run. Values are never sampled by the UI.
type QuantileSummary struct {
	Min float64 `json:"min"`
	P05 float64 `json:"p05"`
	P25 float64 `json:"p25"`
	P50 float64 `json:"p50"`
	P75 float64 `json:"p75"`
	P95 float64 `json:"p95"`
	Max float64 `json:"max"`
}

type LCFeatureEvidence struct {
	Rows                 int64           `json:"rows"`
	SnapshotCount        int64           `json:"snapshot_count"`
	TotalCadences        int64           `json:"total_cadences"`
	NPoints              QuantileSummary `json:"n_points"`
	TimeSpanDays         QuantileSummary `json:"time_span_days"`
	MedianCadenceMinutes QuantileSummary `json:"median_cadence_minutes"`
	MaxGapMinutes        QuantileSummary `json:"max_gap_minutes"`
	FluxStdPPM           QuantileSummary `json:"flux_std_ppm"`
	FluxAmplitudePPM     QuantileSummary `json:"flux_amplitude_ppm"`
	FluxRMSPPM           QuantileSummary `json:"flux_rms_ppm"`
	MedianFluxErrPPM     QuantileSummary `json:"median_flux_err_ppm"`
}

type HistogramBin struct {
	Label string `json:"label"`
	Count int64  `json:"count"`
}

type BLSSearchEvidence struct {
	Evaluated       int64           `json:"evaluated"`
	Available       int64           `json:"available"`
	Unavailable     int64           `json:"unavailable"`
	PeriodDays      QuantileSummary `json:"period_days"`
	DurationHours   QuantileSummary `json:"duration_hours"`
	DepthPPM        QuantileSummary `json:"depth_ppm"`
	Power           QuantileSummary `json:"power"`
	PeriodHistogram []HistogramBin  `json:"period_histogram"`
}

type TPFSpatialEvidence struct {
	Evaluated               int64           `json:"evaluated"`
	Available               int64           `json:"available"`
	Unavailable             int64           `json:"unavailable"`
	PixelMAD                QuantileSummary `json:"pixel_mad"`
	VariabilityPeakPercent  QuantileSummary `json:"variability_peak_percent"`
	TransitDeficitSum       QuantileSummary `json:"transit_deficit_sum"`
	CentroidOffsetPixels    QuantileSummary `json:"centroid_offset_pixels"`
	CentroidOffsetHistogram []HistogramBin  `json:"centroid_offset_histogram"`
}

type CandidateAssemblyEvidence struct {
	Rows                    int64          `json:"rows"`
	TICAvailable            int64          `json:"tic_available"`
	TICUnavailable          int64          `json:"tic_unavailable"`
	BLSAvailable            int64          `json:"bls_available"`
	TransitEvidence         int64          `json:"transit_evidence"`
	TOIMatched              int64          `json:"toi_matched"`
	EvidenceTierHistogram   []HistogramBin `json:"evidence_tier_histogram"`
	TOIMatchStatusHistogram []HistogramBin `json:"toi_match_status_histogram"`
}

type GoldArtifactEvidence struct {
	SnapshotID        string  `json:"snapshot_id"`
	Sector            int64   `json:"sector"`
	ObjectKey         string  `json:"object_key"`
	RowCount          int64   `json:"row_count"`
	SizeBytes         int64   `json:"size_bytes"`
	BytesPerRow       float64 `json:"bytes_per_row"`
	ObjectPresent     bool    `json:"object_present"`
	SizeVerified      bool    `json:"size_verified"`
	ChecksumsDeclared bool    `json:"checksums_declared"`
}

type GoldMaterializationEvidence struct {
	BatchCount                   int64                  `json:"batch_count"`
	CompletedBatches             int64                  `json:"completed_batches"`
	FailedBatches                int64                  `json:"failed_batches"`
	ManifestVerifiedBatches      int64                  `json:"manifest_verified_batches"`
	RowAccountingVerifiedBatches int64                  `json:"row_accounting_verified_batches"`
	Rows                         int64                  `json:"rows"`
	ArtifactCount                int64                  `json:"artifact_count"`
	TotalBytes                   int64                  `json:"total_bytes"`
	ObjectVerifiedArtifacts      int64                  `json:"object_verified_artifacts"`
	ChecksumDeclaredArtifacts    int64                  `json:"checksum_declared_artifacts"`
	Artifacts                    []GoldArtifactEvidence `json:"artifacts"`
	Issues                       []string               `json:"issues"`
}

type GoldProjectionSnapshotEvidence struct {
	SnapshotID             string `json:"snapshot_id"`
	ExpectedRows           int64  `json:"expected_rows"`
	LedgerIndexedRows      int64  `json:"ledger_indexed_rows"`
	RegistryIndexedRows    int64  `json:"registry_indexed_rows"`
	ActualCandidateRows    int64  `json:"actual_candidate_rows"`
	LightcurveSampleRows   int64  `json:"lightcurve_sample_rows"`
	TrainingPositiveRows   int64  `json:"training_positive_rows"`
	TrainingNegativeRows   int64  `json:"training_negative_rows"`
	TrainingUnresolvedRows int64  `json:"training_unresolved_rows"`
	RegistryStatus         string `json:"registry_status"`
	MarkerStatus           string `json:"marker_status"`
	ManifestBindingValid   bool   `json:"manifest_binding_valid"`
	RowParityValid         bool   `json:"row_parity_valid"`
}

type GoldProjectionEvidence struct {
	SnapshotCount           int64                            `json:"snapshot_count"`
	RegistryReadySnapshots  int64                            `json:"registry_ready_snapshots"`
	MarkerVerifiedSnapshots int64                            `json:"marker_verified_snapshots"`
	RowParitySnapshots      int64                            `json:"row_parity_snapshots"`
	ExpectedRows            int64                            `json:"expected_rows"`
	IndexedRows             int64                            `json:"indexed_rows"`
	ActualCandidateRows     int64                            `json:"actual_candidate_rows"`
	LightcurveSampleRows    int64                            `json:"lightcurve_sample_rows"`
	TrainingCohortRows      int64                            `json:"training_cohort_rows"`
	Snapshots               []GoldProjectionSnapshotEvidence `json:"snapshots"`
	Issues                  []string                         `json:"issues"`
}

type GoldCommitSnapshotEvidence struct {
	SnapshotID             string `json:"snapshot_id"`
	CompletedAt            string `json:"completed_at,omitempty"`
	BatchStatus            string `json:"batch_status"`
	ManifestStatus         string `json:"manifest_status"`
	ProjectionStatus       string `json:"projection_status"`
	BatchRows              int64  `json:"batch_rows"`
	ManifestRows           int64  `json:"manifest_rows"`
	ProjectedRows          int64  `json:"projected_rows"`
	ArtifactCount          int64  `json:"artifact_count"`
	ManifestSHAValid       bool   `json:"manifest_sha_valid"`
	FingerprintValid       bool   `json:"fingerprint_valid"`
	ArtifactIntegrityValid bool   `json:"artifact_integrity_valid"`
	RowAccountingValid     bool   `json:"row_accounting_valid"`
	ProjectionReady        bool   `json:"projection_ready"`
	Current                bool   `json:"current"`
	EndToEndValid          bool   `json:"end_to_end_valid"`
}

type GoldCommitEvidence struct {
	SnapshotCount             int64                        `json:"snapshot_count"`
	CommittedSnapshots        int64                        `json:"committed_snapshots"`
	EndToEndVerifiedSnapshots int64                        `json:"end_to_end_verified_snapshots"`
	ActiveCurrentSnapshots    int64                        `json:"active_current_snapshots"`
	Rows                      int64                        `json:"rows"`
	Artifacts                 int64                        `json:"artifacts"`
	Snapshots                 []GoldCommitSnapshotEvidence `json:"snapshots"`
	Issues                    []string                     `json:"issues"`
}

type FactoryScientificEvidence struct {
	LCFeatures          *LCFeatureEvidence           `json:"lc_features,omitempty"`
	BLSSearch           *BLSSearchEvidence           `json:"bls_search,omitempty"`
	TPFSpatial          *TPFSpatialEvidence          `json:"tpf_spatial,omitempty"`
	CandidateAssembly   *CandidateAssemblyEvidence   `json:"candidate_assembly,omitempty"`
	GoldMaterialization *GoldMaterializationEvidence `json:"gold_materialization,omitempty"`
	GoldProjection      *GoldProjectionEvidence      `json:"gold_projection,omitempty"`
	GoldCommit          *GoldCommitEvidence          `json:"gold_commit,omitempty"`
}

type FactoryRunDetail struct {
	Run                FactoryRun                 `json:"run"`
	Batches            []FactoryBatch             `json:"batches"`
	Components         []FactoryComponentEvent    `json:"components"`
	ScientificEvidence *FactoryScientificEvidence `json:"scientific_evidence,omitempty"`
}
